# xray

A tiny local relay that lets you see what your code is doing from the inside.

xray is a small HTTP server you run on your machine. From anywhere in your stack
(back-end, front-end, a worker, a shell script, in any language) you fire small
labeled events at it with a one-line helper, then "develop the x-ray": drain the
buffered events and read a clean, ordered timeline of what actually happened.
Because every process points at the same relay, you watch a single user action
travel from a browser click, through your API, into a background job, on one
timeline.

It pairs especially well with coding agents (Claude Code): ask the agent to
instrument the suspect paths, reproduce, then let it drain and analyze.

```
npx xray                      # start the relay on 127.0.0.1:7200
curl -s 127.0.0.1:7200/health # confirm it is up
xray drain                    # read new events (or `xray tail` for a live stream)
```

See **[packages/relay/README.md](packages/relay/README.md)** for the full user
guide and **[WIRE_FORMAT.md](WIRE_FORMAT.md)** for the event v2 contract.

## Example: x-ray a checkout that never ships

A customer checks out successfully, but the order never gets fulfilled. The bug
spans the browser, the API, and a background worker — print debugging shows each
piece in isolation but not the order across them. So instrument all three with a
shared `trace`:

```js
// browser — loaded via <script src="http://127.0.0.1:7200/xray.js"></script>
window.__XRAY_TRACE__ = crypto.randomUUID()
window.xray('checkout.submitted', { orderId })
```

```ts
// api (Node) — npm i -D @xray/client
import { xray, setTrace } from '@xray/client'
setTrace(req.headers['x-trace']) // the same id, forwarded from the browser
xray('payment.authorized', { orderId, amount })
```

```rb
# worker (Ruby) — vendored via `xray init --lang ruby`
Xray.emit('fulfillment.started', order_id: order_id)
Xray.emit('fulfillment.failed', error: e.message) # XRAY_TRACE set on the worker process
```

Reproduce the checkout, then drain the timeline:

```console
$ xray drain
[0] web      checkout.submitted   trace=9f2a {"orderId":"ord_8821"}
[1] api      payment.authorized   trace=9f2a +41ms  {"orderId":"ord_8821","amount":4200}
[2] worker   fulfillment.started  trace=9f2a +12ms  {"orderId":"ord_8821"}
[3] worker   fulfillment.failed   trace=9f2a +3ms   {"error":"SKU out of stock"}
```

One timeline, three processes, in real order: checkout and payment went through
fine — the worker picked up the order and failed because the item was out of stock.
Fix it, reproduce again, drain again. When you're done, remove the helper calls
(they no-op in production anyway).

Reads are non-destructive, so a teammate running `xray tail` in another terminal
sees the same events without stealing them from your drain.

## This repo

A pnpm + Turbo monorepo with two published packages:

| Package                              | npm            | What it is                                                                                                  |
| ------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- |
| [`packages/relay`](packages/relay)   | `xray`         | The relay + `xray` CLI. Single bundled, dependency-free file. Also serves and vendors the language helpers. |
| [`packages/client`](packages/client) | `@xray/client` | The typed JS/TS client for browser and Node (Tier 1).                                                       |

Plus [`packages/relay/templates`](packages/relay/templates) — the vendorable,
dependency-free helper sources for browser, Ruby, Python, Go, Rust, PHP, and shell
that `xray init` writes into a project and the relay serves at `/xray.<ext>`.

## Develop

```
pnpm install
pnpm build        # bundle both packages (tsup)
pnpm test         # vitest, all packages
pnpm typecheck
pnpm lint
pnpm format

pnpm xray         # run the relay from source (tsx)
```

Requires Node >= 24 and pnpm 10. Conventions (ESLint flat config, Prettier,
TSConfig base) live at the repo root and are shared by both packages.

The event v2 wire format — the real cross-language contract — is documented in
[WIRE_FORMAT.md](WIRE_FORMAT.md).
