import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

import { DEFAULT_MAX_EVENTS, Relay } from './relay'
import { SNIPPET_ROUTES, renderTemplate } from './templates'
import type { IncomingEvent, XrayEvent } from './types'

export interface RelayServerOptions {
  maxEvents?: number
  /** When set, the relay serves HTTPS on loopback (optional `--tls` mode). */
  tls?: { cert: Buffer | string; key: Buffer | string }
}

export interface RelayServer {
  server: Server
  relay: Relay
  secure: boolean
}

const MAX_BODY_BYTES = 5 * 1024 * 1024 // 5 MB: a debug payload, not a file upload.

function setCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Opt into the Private Network Access preflight only when the browser asks.
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function baseUrlFrom(req: IncomingMessage, secure: boolean): string {
  const host = req.headers.host ?? '127.0.0.1'
  return `${secure ? 'https' : 'http'}://${host}`
}

/** Render the agent-facing context block returned by `GET /hook`. */
function formatHookContext(events: XrayEvent[], newlyEvictedUndrained: number): string {
  const lines: string[] = []
  if (newlyEvictedUndrained > 0) {
    lines.push(
      `⚠ ${newlyEvictedUndrained} xray event(s) evicted before you read them — drain sooner.`,
    )
  }
  if (events.length === 0) {
    lines.push('xray: no new events since last drain.')
    return lines.join('\n')
  }
  lines.push(`xray: ${events.length} new event(s) since last drain (oldest first):`)
  for (const e of events) {
    const data = e.data === undefined ? '' : ` ${JSON.stringify(e.data)}`
    const trace = e.trace ? ` trace=${e.trace}` : ''
    lines.push(`  [${e.seq}] ${e.source} ${e.event}${trace}${data}`)
  }
  return lines.join('\n')
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  relay: Relay,
  secure: boolean,
): Promise<void> {
  setCors(req, res)

  const method = req.method ?? 'GET'
  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', baseUrlFrom(req, secure))
  const path = url.pathname

  // --- Ingest ----------------------------------------------------------------
  if (path === '/events' && method === 'POST') {
    let raw: string
    try {
      raw = await readBody(req)
    } catch {
      sendJson(res, 413, { ok: false, error: 'payload too large' })
      return
    }
    let parsed: unknown
    try {
      parsed = raw.length === 0 ? {} : JSON.parse(raw)
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid JSON' })
      return
    }
    const stored = Array.isArray(parsed)
      ? relay.ingestBatch(parsed as IncomingEvent[])
      : [relay.ingest(parsed as IncomingEvent)]
    sendJson(res, 202, { ok: true, accepted: stored.length, seq: stored.at(-1)?.seq })
    return
  }

  // --- Clear -----------------------------------------------------------------
  if (path === '/events' && method === 'DELETE') {
    relay.clear()
    sendJson(res, 200, { ok: true, cleared: true })
    return
  }

  // --- Health ----------------------------------------------------------------
  if (path === '/health' && method === 'GET') {
    sendJson(res, 200, relay.health())
    return
  }

  // --- Drain (NDJSON) --------------------------------------------------------
  if (path === '/drain' && method === 'GET') {
    const sinceParam = url.searchParams.get('since')
    const result = relay.drain({
      since: sinceParam == null ? undefined : Number(sinceParam),
      source: url.searchParams.get('source') ?? undefined,
      prefix: url.searchParams.get('prefix') ?? undefined,
    })
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Xray-Evicted-Undrained': String(result.evictedUndrained),
      'X-Xray-Evicted-Undrained-New': String(result.newlyEvictedUndrained),
    })
    res.end(
      result.events.map(e => JSON.stringify(e)).join('\n') + (result.events.length ? '\n' : ''),
    )
    return
  }

  // --- Hook (Claude Code UserPromptSubmit) -----------------------------------
  if (path === '/hook' && method === 'GET') {
    const result = relay.drain()
    sendJson(res, 200, {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: formatHookContext(result.events, result.newlyEvictedUndrained),
      },
    })
    return
  }

  // --- Live tail (SSE) -------------------------------------------------------
  if (path === '/stream' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    res.write('retry: 2000\n\n')
    const unsubscribe = relay.subscribe(event => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)
    const cleanup = (): void => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
    return
  }

  // --- Served snippets (/xray.js, /xray.rb, ...) -----------------------------
  const snippet = SNIPPET_ROUTES[path]
  if (snippet && method === 'GET') {
    try {
      const body = renderTemplate(snippet.file, baseUrlFrom(req, secure))
      res.writeHead(200, { 'Content-Type': snippet.contentType, 'Cache-Control': 'no-cache' })
      res.end(body)
    } catch {
      sendJson(res, 500, { ok: false, error: `snippet ${snippet.file} unavailable` })
    }
    return
  }

  sendJson(res, 404, { ok: false, error: 'not found' })
}

/** Build (but do not start) the relay HTTP/HTTPS server. */
export function createRelayServer(options: RelayServerOptions = {}): RelayServer {
  const relay = new Relay(options.maxEvents ?? DEFAULT_MAX_EVENTS)
  const secure = options.tls != null
  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res, relay, secure).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' })
    })
  }
  const server = options.tls
    ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, listener)
    : createHttpServer(listener)
  return { server, relay, secure }
}
