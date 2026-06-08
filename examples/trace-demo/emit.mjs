// A tiny "API" step. Posts directly to the relay (no dependency needed) using the
// same v2 wire format the helpers produce. Reads XRAY_URL / XRAY_SOURCE / XRAY_TRACE.
const url = (process.env.XRAY_URL ?? 'http://127.0.0.1:7200').replace(/\/+$/, '')

await fetch(`${url}/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: 'request.received',
    source: process.env.XRAY_SOURCE ?? 'api',
    trace: process.env.XRAY_TRACE,
    data: { path: '/captures', method: 'POST' },
    ts: new Date().toISOString(),
  }),
}).catch(() => {})
