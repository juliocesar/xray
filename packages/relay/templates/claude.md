### xray (relay)

Local relay for observing runtime behavior across processes. Helpers POST labeled
events to `127.0.0.1:7200`; drain them to x-ray a scenario from the inside. Good for
event ordering, data flow, cross-process timing, and state-dependent bugs.

**Use only when the user asks** (e.g. "x-ray this", "use the relay"). You may
suggest it, but do not start the relay, instrument code, or drain unprompted.

Workflow:

1. Start if needed: `npx @julio_ody/xray` (`:7200`). Check: `curl -s 127.0.0.1:7200/health`.
2. Add helper calls to the suspect paths (helper is vendored; else
   `xray init --lang <lang>`):
   - JS/TS `import { xray } from '@julio_ody/xray/client'` (`npm i -D @julio_ody/xray`)
     then `xray('order.created', { orderId })` · browser `window.xray(...)` via
     `/xray.js` · Ruby `Xray.emit('order.created', order_id: id)` · Python
     `xray('order.created', {...})` · Go `xray.Emit(...)`.
   - Name events `domain.action`. Set `XRAY_SOURCE` per process (`web`/`api`/`worker`).
     Pass a shared `trace` to follow one action across processes.
3. Ask the user to reproduce.
4. `xray drain` (new since last drain; `--source`, `--prefix`, `--since 0`, or
   `xray tail` for live).
5. Iterate: add/move calls, reproduce, drain.
6. Remove the helper calls when done.

Notes: dev-only; helpers no-op when disabled and never throw. Reads are
non-destructive (cursor-based); `xray clear` empties the buffer. If drain warns about
evicted events, drain sooner. If the ambient hook is installed, step 4 happens
automatically.
