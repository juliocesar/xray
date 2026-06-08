/**
 * xray wire format — event v2.
 *
 * The wire format is the real contract: any client that POSTs this shape to
 * `/events` works, independent of releases. See WIRE_FORMAT.md.
 */

/** What a client sends. Everything is optional except, by convention, `event`. */
export interface IncomingEvent {
  /** User label, convention `domain.action`, e.g. `order.created`. */
  event?: string
  /** Which process emitted this, e.g. `web` | `api` | `worker`. */
  source?: string
  /** Arbitrary structured payload. */
  data?: unknown
  /** Optional correlation id to stitch one action across processes. */
  trace?: string
  /** Client wall-clock time (ISO 8601). The relay never trusts this for ordering. */
  ts?: string
}

/** What the relay stores and serves. `seq` and `received_at` are relay-assigned. */
export interface XrayEvent {
  /** Monotonic, relay-assigned on receipt. Global ordering across all sources. */
  seq: number
  event: string
  source: string
  data?: unknown
  trace?: string
  ts?: string
  /** Relay receipt time (ISO 8601). Clock-skew-proof ordering comes from `seq`. */
  received_at: string
}

/** Shape returned by `GET /health`. */
export interface HealthStatus {
  ok: true
  /** Total events ever received (== next seq to be assigned). */
  total: number
  /** Events currently held in the ring buffer. */
  buffered: number
  /** Events newer than the drain cursor (not yet drained). */
  pending: number
  /** Total events evicted by the ring buffer cap over the relay's lifetime. */
  evicted: number
  /** Of those, how many were evicted while still undrained (never seen by a reader). */
  evictedUndrained: number
}

/** Result of a drain: the matching events plus loss accounting. */
export interface DrainResult {
  events: XrayEvent[]
  /**
   * Undrained events evicted since the previous cursor-advancing drain. When
   * `> 0`, the reader lost events before seeing them and should drain sooner.
   */
  newlyEvictedUndrained: number
  /** Cumulative undrained-eviction count, for surfacing in headers/health. */
  evictedUndrained: number
}

export interface DrainOptions {
  /**
   * Re-read from this seq instead of the shared cursor. `0` means "from the
   * start". When set, the cursor is NOT advanced (a non-destructive re-read).
   */
  since?: number
  /** Only events from this source. */
  source?: string
  /** Only events whose label starts with this prefix, e.g. `order.`. */
  prefix?: string
}
