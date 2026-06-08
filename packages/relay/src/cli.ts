#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRelayServer } from './server'
import type { XrayEvent } from './types'

const DEFAULT_PORT = 7200
const DEFAULT_URL = 'http://127.0.0.1:7200'

// --- arg parsing -------------------------------------------------------------

interface ParsedArgs {
  command: string
  positionals: string[]
  flags: Record<string, string | boolean>
}

const SHORT_ALIASES: Record<string, string> = { p: 'port', h: 'help', v: 'version' }

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next != null && !next.startsWith('-')) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      const name = SHORT_ALIASES[token.slice(1)] ?? token.slice(1)
      const next = argv[i + 1]
      if (next != null && !next.startsWith('-')) {
        flags[name] = next
        i++
      } else {
        flags[name] = true
      }
    } else {
      positionals.push(token)
    }
  }
  const command = positionals.shift() ?? 'start'
  return { command, positionals, flags }
}

// --- colors ------------------------------------------------------------------

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR == null
const paint =
  (code: string) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s
const dim = paint('2')
const bold = paint('1')
const red = paint('31')
const green = paint('32')
const yellow = paint('33')
const cyan = paint('36')

const SOURCE_COLORS = ['36', '35', '32', '33', '34', '31']
function sourceColor(source: string): (s: string) => string {
  let hash = 0
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0
  return paint(SOURCE_COLORS[Math.abs(hash) % SOURCE_COLORS.length]!)
}

// --- shared helpers ----------------------------------------------------------

function resolveUrl(flags: Record<string, string | boolean>): string {
  const raw = (typeof flags.url === 'string' && flags.url) || process.env.XRAY_URL || DEFAULT_URL
  return raw.replace(/\/+$/, '')
}

function version(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function lanAddress(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return undefined
}

function formatEvent(e: XrayEvent, prev?: XrayEvent): string {
  const seq = dim(`[${e.seq}]`)
  const src = sourceColor(e.source)(e.source.padEnd(8))
  const label = bold(e.event)
  const trace = e.trace ? dim(` trace=${e.trace}`) : ''
  const data = e.data === undefined ? '' : ' ' + JSON.stringify(e.data)
  let delta = ''
  if (prev) {
    const ms = Date.parse(e.received_at) - Date.parse(prev.received_at)
    if (Number.isFinite(ms)) delta = dim(` +${ms}ms`)
  }
  return `${seq} ${src} ${label}${trace}${delta}${dim(data)}`
}

function dieOnConnError(url: string, err: unknown): never {
  // Node's global fetch rejects with `TypeError: fetch failed` and carries the
  // real network error (ECONNREFUSED/ENOTFOUND) on `.cause`.
  const e = err as { code?: string; cause?: { code?: string } }
  const code = e.code ?? e.cause?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    console.error(red(`No xray relay at ${url}. Start one with: npx @julio_ody/xray`))
  } else {
    console.error(red(`xray: ${(err as Error).message}`))
  }
  process.exit(1)
}

// --- commands ----------------------------------------------------------------

function cmdStart(flags: Record<string, string | boolean>): void {
  const port = Number(flags.port ?? process.env.XRAY_PORT ?? DEFAULT_PORT)
  const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1'
  const maxEnv = process.env.XRAY_MAX_EVENTS
  const maxEvents =
    flags['max-events'] != null ? Number(flags['max-events']) : maxEnv ? Number(maxEnv) : undefined

  let tls: { cert: Buffer; key: Buffer } | undefined
  if (flags.tls) {
    const certPath = flags['tls-cert']
    const keyPath = flags['tls-key']
    if (typeof certPath !== 'string' || typeof keyPath !== 'string') {
      console.error(
        red('--tls requires --tls-cert <file> and --tls-key <file>.') +
          '\nGenerate a loopback cert with mkcert: mkcert 127.0.0.1 localhost',
      )
      process.exit(1)
    }
    tls = { cert: readFileSync(certPath), key: readFileSync(keyPath) }
  }

  const { server, secure } = createRelayServer({ maxEvents, tls })
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(red(`Port ${port} is already in use. Another xray relay may be running.`))
      process.exit(1)
    }
    throw err
  })
  server.listen(port, host, () => {
    const scheme = secure ? 'https' : 'http'
    const lan = lanAddress()
    console.log(bold(green('xray relay listening')))
    console.log(`  ${scheme}://127.0.0.1:${port}`)
    if (lan) console.log(`  ${scheme}://${lan}:${port}   ${dim('(LAN / other devices)')}`)
    console.log('')
    console.log(
      dim('  browser:') + ` <script src="${scheme}://127.0.0.1:${port}/xray.js"></script>`,
    )
    console.log(
      dim('  drain:  ') +
        ' xray drain     ' +
        dim('· tail:') +
        ' xray tail     ' +
        dim('· clear:') +
        ' xray clear',
    )
    console.log(dim('  health: ') + ` curl -s ${scheme}://127.0.0.1:${port}/health`)
    console.log('')
    console.log(dim('  Ctrl-C to stop.'))
  })
  const shutdown = (): void => {
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function cmdTail(flags: Record<string, string | boolean>): Promise<void> {
  const url = resolveUrl(flags)
  console.error(dim(`tailing ${url}/stream — Ctrl-C to stop`))
  let res: Response
  try {
    res = await fetch(`${url}/stream`, { headers: { Accept: 'text/event-stream' } })
  } catch (err) {
    dieOnConnError(url, err)
  }
  if (!res.body) {
    console.error(red('xray: stream returned no body'))
    process.exit(1)
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let prev: XrayEvent | undefined
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl = buffer.indexOf('\n\n')
    while (nl !== -1) {
      const frame = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 2)
      const line = frame.split('\n').find(l => l.startsWith('data:'))
      if (line) {
        try {
          const event = JSON.parse(line.slice(5).trim()) as XrayEvent
          console.log(formatEvent(event, prev))
          prev = event
        } catch {
          // Ignore non-JSON frames (comments, heartbeats).
        }
      }
      nl = buffer.indexOf('\n\n')
    }
  }
  console.error(dim('stream closed'))
}

async function cmdDrain(flags: Record<string, string | boolean>): Promise<void> {
  const url = resolveUrl(flags)
  const query = new URLSearchParams()
  if (typeof flags.source === 'string') query.set('source', flags.source)
  if (typeof flags.prefix === 'string') query.set('prefix', flags.prefix)
  if (flags.since != null) query.set('since', String(flags.since))
  const qs = query.toString()

  let res: Response
  try {
    res = await fetch(`${url}/drain${qs ? `?${qs}` : ''}`)
  } catch (err) {
    dieOnConnError(url, err)
  }
  const text = await res.text()
  const lines = text.split('\n').filter(l => l.length > 0)
  const events = lines.map(l => JSON.parse(l) as XrayEvent)

  const newlyLost = Number(res.headers.get('X-Xray-Evicted-Undrained-New') ?? '0')
  if (newlyLost > 0) {
    console.error(yellow(`⚠ ${newlyLost} event(s) evicted before you read them — drain sooner.`))
  }

  if (flags.json || flags.ndjson) {
    for (const line of lines) console.log(line)
    return
  }
  if (events.length === 0) {
    console.error(dim('no new events'))
    return
  }
  let prev: XrayEvent | undefined
  for (const e of events) {
    console.log(formatEvent(e, prev))
    prev = e
  }
}

async function cmdClear(flags: Record<string, string | boolean>): Promise<void> {
  const url = resolveUrl(flags)
  try {
    await fetch(`${url}/events`, { method: 'DELETE' })
  } catch (err) {
    dieOnConnError(url, err)
  }
  console.log(green('xray: buffer cleared'))
}

function printHelp(): void {
  console.log(`xray — a tiny local relay (v${version()})

Usage:
  xray [start]              Start the relay on :${DEFAULT_PORT} (default command)
  xray tail                 Live SSE stream of events, pretty-printed
  xray drain                Print new-since-cursor events
  xray clear                Empty the buffer
  xray init [--lang <l>]    Scaffold xray into a repo (docs, helper, hook)
  xray mcp                  (deferred) MCP server for shell-less clients

Start options:
  -p, --port <n>            Port (default ${DEFAULT_PORT}, or $XRAY_PORT)
  --host <addr>             Bind address (default 127.0.0.1)
  --max-events <n>          Ring-buffer cap (default 5000, or $XRAY_MAX_EVENTS)
  --tls --tls-cert <f> --tls-key <f>   Serve HTTPS on loopback

Drain options:
  --source <s>              Only events from this source
  --prefix <p>              Only events whose label starts with this prefix
  --since <seq>             Re-read from this seq (0 = from the start)
  --json | --ndjson         Print raw NDJSON instead of pretty output

Client commands accept --url <relay url> (default $XRAY_URL or ${DEFAULT_URL}).`)
}

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2))

  if (flags.help) {
    printHelp()
    return
  }
  if (flags.version && command === 'start') {
    console.log(version())
    return
  }

  switch (command) {
    case 'start':
      cmdStart(flags)
      break
    case 'tail':
      await cmdTail(flags)
      break
    case 'drain':
      await cmdDrain(flags)
      break
    case 'clear':
      await cmdClear(flags)
      break
    case 'init': {
      const { runInit } = await import('./init')
      await runInit(positionals, flags)
      break
    }
    case 'mcp':
      console.error(
        cyan('xray mcp is deferred.') +
          ' A shell-capable agent should use `xray drain` (or GET /drain) directly.\n' +
          'MCP will be built only when a shell-less client needs it.',
      )
      process.exit(1)
      break
    case 'help':
      printHelp()
      break
    default:
      console.error(red(`Unknown command: ${command}`))
      printHelp()
      process.exit(1)
  }
}

void main().catch((err: unknown) => {
  console.error(red(`xray: ${(err as Error).message}`))
  process.exit(1)
})
