# @xray/client

Tiny typed [xray](https://www.npmjs.com/package/xray) client for browser and Node.
Fire a labeled debug event at a local xray relay and forget it: the call never
blocks, never throws, and no-ops unless xray is enabled.

```
npm i -D @xray/client
```

```ts
import { xray } from '@xray/client'

xray('order.created', { orderId, status })
```

In the browser, sends use `navigator.sendBeacon` with a `text/plain` body (a CORS
"simple request" — preflight-free, survives page unload), falling back to
`fetch(keepalive)`. In Node, it uses `fetch` with `keepalive`, fire-and-forget.

## API

```ts
xray(event: string, data?: unknown): void   // fire an event (the default export too)

configure(opts: {                            // override config (Node especially)
  url?: string                               // relay URL; default http://127.0.0.1:7200
  source?: string                            // process label; default "web"/"node"
  trace?: string                             // correlation id for subsequent events
  enabled?: boolean                          // force on/off
}): void

setTrace(trace: string | undefined): void    // set/clear the correlation id
enabled(): boolean                           // whether xray will currently send
```

## Enablement

Safe by construction — explicit settings win, otherwise it enables itself only in
development:

- `configure({ enabled })`, `window.__XRAY_ENABLED__`, or `XRAY_ENABLED`
  (`1`/`true`/`yes`/`on` vs `0`/`false`/`no`/`off`) — explicit, wins.
- otherwise enabled when a URL is configured (`XRAY_URL` / `window.__XRAY_URL__`),
  or in dev: a loopback page in the browser, `NODE_ENV !== "production"` in Node.

## Config (browser)

Set before the bundle runs, or use `configure()`:

```js
window.__XRAY_URL__ = 'http://127.0.0.1:7200' // relay URL
window.__XRAY_SOURCE__ = 'web' // process label
window.__XRAY_TRACE__ = 'req_123' // correlation id
window.__XRAY_ENABLED__ = false // hard-disable
```

For a zero-install browser path, load `http://127.0.0.1:7200/xray.js` from the
running relay instead — it exposes the same `window.xray(event, data)`.

See the [xray](https://www.npmjs.com/package/xray) package for the relay, CLI, and
the event v2 wire format.
