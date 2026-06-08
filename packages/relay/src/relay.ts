import type { DrainOptions, DrainResult, HealthStatus, IncomingEvent, XrayEvent } from './types'

/** Default ring-buffer capacity. A few thousand is plenty for a debug session. */
export const DEFAULT_MAX_EVENTS = 5000

export interface RelayState {
  maxEvents: number
}

type Listener = (event: XrayEvent) => void

/**
 * The relay core: an in-memory, bounded ring buffer with a single shared drain
 * cursor. Pure logic, no HTTP — the server layer wraps this. Reads are
 * non-destructive: draining advances the cursor but never clears the buffer.
 *
 * Eviction is drop-oldest (FIFO) and never silent: the relay tracks how many
 * events it dropped and, crucially, how many were dropped while still undrained
 * (behind the cursor, i.e. never seen by a reader).
 */
export class Relay {
  private readonly maxEvents: number
  private entries: XrayEvent[] = []

  /** Monotonic for the whole relay lifetime; survives `clear()` so stale refs are obvious. */
  private nextSeq = 0
  /** Drain returns events with `seq >= cursorSeq`; advanced to `nextSeq` on each drain. */
  private cursorSeq = 0

  private evicted = 0
  private evictedUndrained = 0
  /** Last `evictedUndrained` value a cursor-advancing drain acknowledged. */
  private ackedEvictedUndrained = 0

  private readonly listeners = new Set<Listener>()

  constructor(maxEvents: number = DEFAULT_MAX_EVENTS) {
    this.maxEvents = Math.max(1, Math.floor(maxEvents))
  }

  /** Ingest a single event, stamping `seq` and `received_at`. Returns the stored event. */
  ingest(raw: IncomingEvent): XrayEvent {
    const event: XrayEvent = {
      seq: this.nextSeq++,
      event: typeof raw.event === 'string' && raw.event.length > 0 ? raw.event : 'event',
      source: typeof raw.source === 'string' && raw.source.length > 0 ? raw.source : 'unknown',
      data: raw.data,
      received_at: new Date().toISOString(),
    }
    if (typeof raw.trace === 'string') event.trace = raw.trace
    if (typeof raw.ts === 'string') event.ts = raw.ts

    this.entries.push(event)
    this.evict()

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A misbehaving stream listener must never break ingestion.
      }
    }
    return event
  }

  /** Ingest a batch. Each element is stamped independently, in array order. */
  ingestBatch(raws: IncomingEvent[]): XrayEvent[] {
    return raws.map(raw => this.ingest(raw))
  }

  private evict(): void {
    while (this.entries.length > this.maxEvents) {
      const dropped = this.entries.shift()
      if (!dropped) break
      this.evicted++
      if (dropped.seq >= this.cursorSeq) this.evictedUndrained++
    }
  }

  /**
   * Return events the caller has not seen, then advance the cursor. With
   * `since` set this is a non-destructive re-read and the cursor is untouched.
   * `source`/`prefix` filter the view but do not affect cursor advancement: the
   * cursor is shared and always advances to the end on a normal drain (use
   * `since: 0` to re-read everything).
   */
  drain(options: DrainOptions = {}): DrainResult {
    const isReread = options.since != null
    const from = isReread ? options.since! : this.cursorSeq

    let events = this.entries.filter(e => e.seq >= from)
    if (options.source) events = events.filter(e => e.source === options.source)
    if (options.prefix) events = events.filter(e => e.event.startsWith(options.prefix!))

    let newlyEvictedUndrained = 0
    if (!isReread) {
      newlyEvictedUndrained = this.evictedUndrained - this.ackedEvictedUndrained
      this.ackedEvictedUndrained = this.evictedUndrained
      this.cursorSeq = this.nextSeq
    }

    return {
      events,
      newlyEvictedUndrained,
      evictedUndrained: this.evictedUndrained,
    }
  }

  health(): HealthStatus {
    return {
      ok: true,
      total: this.nextSeq,
      buffered: this.entries.length,
      pending: this.entries.reduce((n, e) => (e.seq >= this.cursorSeq ? n + 1 : n), 0),
      evicted: this.evicted,
      evictedUndrained: this.evictedUndrained,
    }
  }

  /** Empty the buffer and reset the cursor. `seq` stays monotonic across clears. */
  clear(): void {
    this.entries = []
    this.cursorSeq = this.nextSeq
    this.evicted = 0
    this.evictedUndrained = 0
    this.ackedEvictedUndrained = 0
  }

  /** Subscribe to every ingested event (live tail). Returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
