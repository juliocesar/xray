# xray wire format — event v2

The wire format is the real contract. Any client that POSTs this shape to the
relay's `/events` endpoint works, independent of releases or language. A vendored
helper carries no version-coupling risk because it only has to produce this shape.

## Ingest

```
POST /events
Content-Type: application/json   (or text/plain — see "Browser" below)
```

Body is a single event object, or an array of them (a batch). Every field except
`event` is optional; the relay fills in sensible defaults.

```jsonc
{
  "event": "order.created", // user label, convention: domain.action
  "source": "web", // which process: "web" | "api" | "worker" | custom
  "data": { "orderId": "abc" }, // arbitrary structured payload
  "trace": "req_123", // optional correlation id across processes
  "ts": "2026-06-07T12:34:56.789Z", // optional client time (ISO 8601)
}
```

The relay stamps two fields on receipt and stores the result:

```jsonc
{
  "seq": 42, // monotonic, relay-assigned; global ordering
  "event": "order.created",
  "source": "web",
  "data": { "orderId": "abc" },
  "trace": "req_123",
  "ts": "2026-06-07T12:34:56.789Z",
  "received_at": "2026-06-07T12:34:56.901Z", // relay time
}
```

### Field semantics

| Field         | Who sets it | Notes                                                                                     |
| ------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `event`       | client      | Defaults to `"event"` if missing/empty. Convention `domain.action`.                       |
| `source`      | client      | Defaults to `"unknown"`. The key field that makes one timeline legible.                   |
| `data`        | client      | Any JSON. Omitted when not provided.                                                      |
| `trace`       | client      | Optional. Stitches one action across processes.                                           |
| `ts`          | client      | Optional client wall-clock. Only used for display; **never** for ordering.                |
| `seq`         | relay       | Monotonic across the relay's whole lifetime (survives `clear`). Ordering source of truth. |
| `received_at` | relay       | Relay receipt time. Clock-skew-proof ordering still comes from `seq`.                     |

`seq` is the ordering authority precisely because client clocks across processes
disagree; `received_at` is informational.

## Browser ("simple request")

To stay preflight-free, the browser posts with `navigator.sendBeacon` and a
`text/plain` body. The relay parses the body as JSON regardless of `Content-Type`,
so a `text/plain` body containing JSON is accepted. `source` and `trace` travel in
the body, never in custom headers (custom headers would force a CORS preflight).

## Other endpoints

| Method    | Path       | Purpose                                                                                                                                      |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`     | `/drain`   | New-since-cursor as NDJSON. Query: `?source=`, `?prefix=`, `?since=` (`0` = from start). Advances the shared cursor unless `since` is given. |
| `GET`     | `/hook`    | New-since-cursor as a Claude Code `UserPromptSubmit` `hookSpecificOutput` payload.                                                           |
| `GET`     | `/stream`  | Server-Sent Events live tail. Does not touch the cursor.                                                                                     |
| `GET`     | `/health`  | `{ ok, total, buffered, pending, evicted, evictedUndrained }`.                                                                               |
| `DELETE`  | `/events`  | Clear the buffer and reset the cursor. `seq` stays monotonic.                                                                                |
| `GET`     | `/xray.js` | The browser client, relay origin baked in. Also `/xray.rb`, `/xray.py`, `/xray.go`, `/xray.rs`, `/xray.php`, `/xray.sh`.                     |
| `OPTIONS` | `*`        | CORS + Private Network Access preflight.                                                                                                     |

### Loss accounting

The buffer is a bounded ring (drop-oldest). The relay never drops silently:

- `/health` reports cumulative `evicted` and `evictedUndrained` (dropped while still
  behind the cursor — never seen by a reader).
- `/drain` sets `X-Xray-Evicted-Undrained` (cumulative) and
  `X-Xray-Evicted-Undrained-New` (since your last drain) response headers.
- `/hook` prepends a `⚠ N events evicted before you read them` line when new loss
  occurred.

## CORS headers

Every response (and the `OPTIONS` preflight) carries:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Private-Network: true   # only when the preflight requests it
```
