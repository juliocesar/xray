# xray

A tiny local relay that lets you see what your code is doing from the inside.

xray is a small HTTP server you run on your machine. From anywhere in your stack
(back-end, front-end, a worker, a shell script, in any language) you fire small
labeled events at it with a one-line helper. Then you "develop the x-ray": drain the
buffered events and read a clean, ordered timeline of what actually happened during a
scenario. Because every process points at the same relay, you can watch a single user
action travel from a browser click, through your API, into a background job, all on
one timeline.

It pairs especially well with coding agents (Claude Code): ask the agent to
instrument the suspect code paths, reproduce the scenario, then let it drain and
analyze the events.

## Install and start

```
npx @julio_ody/xray            # starts the relay on 127.0.0.1:7200
```

(Or `npm i -g @julio_ody/xray` for an `xray` command on your PATH.) Confirm it is up:

```
curl -s 127.0.0.1:7200/health
```

## CLI

```
xray [start]              start the relay on :7200 (default command)
  -p, --port <n>          port (default 7200, or $XRAY_PORT)
  --host <addr>           bind address (default 127.0.0.1)
  --max-events <n>        ring-buffer cap (default 5000, or $XRAY_MAX_EVENTS)
  --tls --tls-cert <f> --tls-key <f>   serve HTTPS on loopback

xray tail                 live SSE stream, pretty-printed
xray drain                new-since-cursor events (--source, --prefix, --since, --json)
xray clear                empty the buffer
xray init [--lang <l>]    scaffold xray into a repo (docs, helper, optional hook)
```

Client commands accept `--url <relay url>` (default `$XRAY_URL` or
`http://127.0.0.1:7200`).

## Add a helper

Run `xray init` to vendor a helper into your project and write the docs; pass
`--lang` to choose the language. Helpers are tiny, dependency-free files (or the
`@julio_ody/xray/client` npm package for JS/TS), so nothing lands in your production
dependency manifest.

| Language       | Call                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| Browser        | `window.xray('order.created', { orderId })` (load `http://127.0.0.1:7200/xray.js`)        |
| Node/TS        | `import { xray } from '@julio_ody/xray/client'` then `xray('order.created', { orderId })` |
| Ruby           | `Xray.emit('order.created', order_id: id)`                                                |
| Python         | `xray('order.created', {'order_id': id})`                                                 |
| Go             | `xray.Emit("order.created", map[string]any{"orderId": id})`                               |
| Rust/PHP/shell | the vendored `xray` helper, same `(event, data)` shape                                    |

### Conventions

- **Event names:** `domain.action`, e.g. `order.created`, `sync.failed`.
- **`source`:** set `XRAY_SOURCE` per process (`web`, `api`, `worker`).
- **`trace`:** pass a shared id (`XRAY_TRACE`) to stitch one action across processes.

### Config

| Variable       | Meaning                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `XRAY_URL`     | Relay URL. Default `http://127.0.0.1:7200`. Helpers no-op when unset and not explicitly enabled. |
| `XRAY_SOURCE`  | Label for this process.                                                                          |
| `XRAY_ENABLED` | Force enable/disable (`1`/`true`/`yes`/`on` vs `0`/`false`/`no`/`off`).                          |
| `XRAY_TRACE`   | Correlation id applied to events from this process.                                              |

## Reading events

`xray drain` prints events received since your last drain. The cursor advances but
the buffer is **not** cleared, so a terminal tail and an agent do not steal events
from each other. Re-read everything with `--since 0`. `xray tail` streams live;
`xray clear` empties the buffer explicitly.

The buffer is a bounded ring (drop-oldest). xray never drops silently: `/health` and
`xray drain` report how many events were evicted, and flag any evicted before you
read them.

## Typed client (`@julio_ody/xray/client`)

Installing the package gives you a typed JS/TS client for browser and Node at the
`@julio_ody/xray/client` subpath — no separate install:

```ts
import { xray, configure, setTrace, enabled } from '@julio_ody/xray/client'

configure({ source: 'api' }) // optional; Node especially
xray('order.created', { orderId, status })
```

`xray(event, data?)` is fire-and-forget: it never blocks, never throws, and no-ops
unless enabled. Browser sends use `navigator.sendBeacon` (a preflight-free
`text/plain` simple request that survives page unload); Node uses `fetch` with
`keepalive`. Enablement is safe by construction — explicit (`configure({ enabled })`,
`window.__XRAY_ENABLED__`, or `XRAY_ENABLED`) wins; otherwise it enables itself only
when a URL is configured or in dev (a loopback page in the browser,
`NODE_ENV !== "production"` in Node).

## Front-end

The browser helper posts directly to the relay (`navigator.sendBeacon`, a
preflight-free request that survives page unload). It works from plain
`http://localhost` dev and, because loopback is a trusted origin, from HTTPS
localhost too, with no proxy. For HTTPS custom domains, run with `--tls`. For a
zero-install path, load `http://127.0.0.1:7200/xray.js` (Tier 0) instead of the
bundled client.

## Using with Claude Code

- **On demand (default):** the agent runs `xray drain` when it wants events.
- **Ambient (opt-in):** `xray init --hook` installs a `UserPromptSubmit` hook so new
  events inject into the agent's context automatically each turn.

By convention the agent only instruments when you ask ("x-ray this").

See `WIRE_FORMAT.md` in the repository for the event v2 contract.
