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

## Why

Print debugging is per-process and unordered across services. xray gives you one
timeline across many processes and languages, structured and intentional events
(not log noise), a drain an agent can read on demand, and zero production risk
(helpers are dev-only, no-op when disabled, and never throw).

## Install and start

```
npx @julio_ody/xray            # starts the relay on 127.0.0.1:7200
```

(Or `npm i -g @julio_ody/xray` for an `xray` command on your PATH.) Confirm it is up:

```
curl -s 127.0.0.1:7200/health
```

## Add a helper

Run `xray init` to vendor a helper into your project and write the docs; pass
`--lang` to choose the language. Helpers are tiny, dependency-free files (or, for
JS/TS, the typed client at `@julio_ody/xray/client` from `npm i -D @julio_ody/xray`),
so nothing lands in your production dependency manifest.

| Language     | Call |
|--------------|------|
| Browser      | `window.xray('order.created', { orderId })` (load `http://127.0.0.1:7200/xray.js`) |
| Node / TS    | `import { xray } from '@julio_ody/xray/client'` then `xray('order.created', { orderId })` |
| Ruby         | `Xray.emit('order.created', order_id: id)` |
| Python       | `xray('order.created', {'order_id': id})` |
| Go           | `xray.Emit("order.created", map[string]any{"orderId": id})` |
| Rust/PHP/shell | the vendored `xray` helper, same `(event, data)` shape |

### Conventions

- **Event names:** `domain.action`, e.g. `order.created`, `sync.failed`.
- **`source`:** set `XRAY_SOURCE` per process (`web`, `api`, `worker`) so a combined
  timeline is legible.
- **`trace`:** pass a shared id to stitch one action across processes.

### Config

| Variable       | Meaning |
|----------------|---------|
| `XRAY_URL`     | Relay URL. Helper no-ops when unset outside dev. Default `http://127.0.0.1:7200`. |
| `XRAY_SOURCE`  | Label for this process. |
| `XRAY_ENABLED` | Force enable/disable. |

## The workflow

1. Start the relay (`npx @julio_ody/xray`).
2. Add helper calls to the code paths you are investigating.
3. Reproduce the scenario (run the request, click through the UI, run the job).
4. Drain: `xray drain`.
5. Read the timeline, add or move helper calls, repeat.
6. Remove the helper calls when done.

## Reading events

- `xray drain` prints events received since your last drain. The cursor advances but
  the buffer is not cleared, so a terminal tail and an agent do not steal events from
  each other.
- Filters: `--source web`, `--prefix order.`, `--since 0` to re-read from the start.
- `xray tail` streams events live. `xray clear` empties the buffer explicitly.

## Front-end

The browser helper posts directly to the relay (`navigator.sendBeacon`, a
preflight-free request that survives page unload). It works from plain
`http://localhost` dev and, because loopback is a trusted origin, from HTTPS
localhost too, with no proxy. For HTTPS custom domains, run the relay with `--tls`.
If you already run a dev-server proxy you may route `/__xray__/*` to the relay for
same-origin purity, but it is optional.

## Retention

Events live in memory in a bounded ring buffer; when it fills, the oldest are dropped
and the newest kept. xray never drops silently: `xray drain` and `/health` report how
many events were evicted, and flag any evicted before you read them.

## Using with Claude Code

- **On demand (default):** the agent runs `xray drain` when it wants events.
- **Ambient (opt-in):** install the `UserPromptSubmit` hook so new events inject into
  the agent's context automatically each turn.

By convention the agent only starts instrumenting when you ask ("x-ray this", "use
the relay").
