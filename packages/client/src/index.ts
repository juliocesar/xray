/**
 * @xray/client — Tier 1 typed client for the xray relay.
 *
 * One helper for browser and Node. Fire a labeled event and forget it: the call
 * never blocks, never throws, and no-ops unless xray is enabled. Browser sends
 * use `navigator.sendBeacon` with a `text/plain` body (a CORS "simple request",
 * preflight-free, survives unload); Node uses `fetch` with `keepalive`.
 *
 * Enablement (safe by construction):
 *   - explicit wins: `configure({ enabled })`, `window.__XRAY_ENABLED__`, or
 *     `XRAY_ENABLED` ("1"/"true"/"yes"/"on" vs "0"/"false"/"no"/"off").
 *   - otherwise enabled when a URL is configured (`XRAY_URL` / `window.__XRAY_URL__`),
 *     or in dev: a loopback page in the browser, `NODE_ENV !== "production"` in Node.
 */

export interface XrayConfig {
  /** Relay base URL. Default `http://127.0.0.1:7200`. */
  url: string
  /** Label for this process, e.g. `web` | `api` | `worker`. */
  source: string
  /** Optional correlation id stitched onto every event until changed. */
  trace?: string
  /** Force enable/disable, overriding all heuristics. */
  enabled?: boolean
}

const DEFAULT_URL = 'http://127.0.0.1:7200'
const TRUTHY = /^(1|true|yes|on)$/i
const FALSY = /^(0|false|no|off)$/i

const overrides: Partial<XrayConfig> = {}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function winVar(name: string): unknown {
  if (!hasWindow()) return undefined
  return (window as unknown as Record<string, unknown>)[name]
}

function env(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  return process.env[name]
}

function resolveUrl(): string {
  if (typeof overrides.url === 'string') return overrides.url
  const fromWin = winVar('__XRAY_URL__')
  if (typeof fromWin === 'string' && fromWin) return fromWin
  return env('XRAY_URL') ?? DEFAULT_URL
}

function resolveSource(): string {
  if (typeof overrides.source === 'string') return overrides.source
  const fromWin = winVar('__XRAY_SOURCE__')
  if (typeof fromWin === 'string' && fromWin) return fromWin
  return env('XRAY_SOURCE') ?? (hasWindow() ? 'web' : 'node')
}

function resolveTrace(): string | undefined {
  if ('trace' in overrides) return overrides.trace
  const fromWin = winVar('__XRAY_TRACE__')
  if (typeof fromWin === 'string') return fromWin
  return env('XRAY_TRACE')
}

function isLoopbackPage(): boolean {
  if (!hasWindow() || typeof location === 'undefined') return false
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')
}

function isEnabled(): boolean {
  if (typeof overrides.enabled === 'boolean') return overrides.enabled

  const winFlag = winVar('__XRAY_ENABLED__')
  if (winFlag === true) return true
  if (winFlag === false) return false

  const envFlag = env('XRAY_ENABLED')
  if (envFlag != null && TRUTHY.test(envFlag)) return true
  if (envFlag != null && FALSY.test(envFlag)) return false

  // No explicit signal: enable when a URL is set, or in dev.
  if (typeof overrides.url === 'string') return true
  if (typeof winVar('__XRAY_URL__') === 'string') return true
  if (env('XRAY_URL')) return true
  if (hasWindow()) return isLoopbackPage()
  return env('NODE_ENV') !== 'production'
}

function send(body: string, url: string): void {
  const endpoint = `${url.replace(/\/+$/, '')}/events`
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return
    }
  } catch {
    // sendBeacon can throw on some payload/blob combos; fall through to fetch.
  }
  if (typeof fetch === 'function') {
    void fetch(endpoint, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
    }).catch(() => {
      // Fire-and-forget: an instrumentation call must never surface errors.
    })
  }
}

/** Override config programmatically (Node especially). Merges into prior calls. */
export function configure(config: Partial<XrayConfig>): void {
  Object.assign(overrides, config)
}

/** Set (or clear) the correlation id applied to subsequent events. */
export function setTrace(trace: string | undefined): void {
  overrides.trace = trace
}

/** Whether xray will currently send. Useful for guarding expensive payload prep. */
export function enabled(): boolean {
  return isEnabled()
}

/**
 * Fire a labeled event at the relay. No-ops when disabled; never throws.
 *
 * @example xray('order.created', { orderId, status })
 */
export function xray(event: string, data?: unknown): void {
  try {
    if (!isEnabled()) return
    const trace = resolveTrace()
    const payload: Record<string, unknown> = {
      event,
      source: resolveSource(),
      ts: new Date().toISOString(),
    }
    if (data !== undefined) payload.data = data
    if (trace != null) payload.trace = trace
    send(JSON.stringify(payload), resolveUrl())
  } catch {
    // Swallow everything: instrumentation must never affect the host program.
  }
}

export default xray
