# trace demo — one action across three processes

Shows the core idea: many sources, one relay, one timeline. A Node "API", a Python
"worker", and a shell step all emit events tagged with the **same `trace` id**, so
draining the relay reconstructs a single action end-to-end.

## Run

```sh
# 1. Start the relay in one terminal
npx @julio_ody/xray

# 2. In another terminal, from this directory:
./run.sh

# 3. See the stitched timeline (newest drain):
xray drain
#   or filter to this action:
xray drain --since 0 | grep demo_trace
```

Each script sets `XRAY_ENABLED=1`, a distinct `XRAY_SOURCE`, and a shared
`XRAY_TRACE=demo_trace`. Nothing here depends on xray being installed as a library —
the Node and shell steps post directly, and the Python step uses the relay-served
helper.
