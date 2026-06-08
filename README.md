# xray

**Give your coding agent x-ray vision into your workflows, code paths, and
cross-process timing** — the runtime behavior it otherwise has to guess at. Fire
small labeled events from anywhere in your stack and let the agent drain a clean,
ordered timeline of what actually happened.

xray is a small HTTP server you run on your machine. From anywhere in your stack
(back-end, front-end, a worker, a shell script, in any language) you fire those
events with a one-line helper, then "develop the x-ray": drain the buffered events
and read what actually happened. Because every process points at the same relay,
you watch a single user action travel from a browser click, through your API, into
a background job, on one timeline.

It pairs especially well with coding agents (Claude Code): `xray init` teaches the
agent the workflow, then you say "x-ray this" and it instruments, reproduces, and
drains on its own (see [Use it with your coding agent](#use-it-with-your-coding-agent)).

```
npx @julio_ody/xray                      # start the relay on 127.0.0.1:7200
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
// api (Node) — npm i -D @julio_ody/xray
import { xray, setTrace } from '@julio_ody/xray/client'
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

## Use it with your coding agent

`xray init` wires xray into a repo and, importantly, **teaches your coding agent how
to use it**. It writes a short xray block into your `CLAUDE.md` / `AGENTS.md` — the
terminology, the event conventions, and the instrument → reproduce → drain loop —
then vendors a helper for your stack. With `--hook` it also installs a Claude Code
`UserPromptSubmit` hook so new events inject into the agent's context automatically.

```sh
xray init            # detects your stack; --lang <l> to override, --hook for ambient mode
```

Agent instruction files are read at startup, so **restart your agent (or `/clear`)
after `init`** to load the new block. After that, say "x-ray this" in a session and
the agent follows the loop on its own: instrument the suspect paths, ask you to
reproduce, drain the timeline, iterate, and remove the calls when done. Helpers are
dev-only and no-op unless enabled (`XRAY_ENABLED=1`).

## This repo

A pnpm + Turbo workspace with one published package, [`packages/relay`](packages/relay)
(npm **`@julio_ody/xray`**): the relay + `xray` CLI, bundled to a single
dependency-free file, plus the typed JS/TS client exposed at the `@julio_ody/xray/client`
subpath (`import { xray } from '@julio_ody/xray/client'`).

It also carries [`packages/relay/templates`](packages/relay/templates) — the
vendorable, dependency-free helper sources for browser, Ruby, Python, Go, Rust, PHP,
and shell that `xray init` writes into a project and the relay serves at `/xray.<ext>`.

## Develop

```
pnpm install
pnpm build        # bundle the CLI/relay and the client (tsup)
pnpm test         # vitest
pnpm typecheck
pnpm lint
pnpm format

pnpm xray         # run the relay from source (tsx)
pnpm release      # build + publish @julio_ody/xray to npm (clean tree on main)
```

Requires Node >= 24 and pnpm 10. Conventions (ESLint flat config, Prettier,
TSConfig base) live at the repo root.

`pnpm release` runs `pnpm -r publish`; a `prepublishOnly` build guarantees a fresh
bundle, and pnpm's git checks require a clean working tree on `main`. npm 2FA (your
security key) prompts at publish time.

The event v2 wire format — the real cross-language contract — is documented in
[WIRE_FORMAT.md](WIRE_FORMAT.md).
