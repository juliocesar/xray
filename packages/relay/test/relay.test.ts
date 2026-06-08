import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'

import { Relay } from '../src/relay'
import { createRelayServer } from '../src/server'
import type { HealthStatus, XrayEvent } from '../src/types'

describe('Relay core', () => {
  it('stamps monotonic seq, source default, and received_at', () => {
    const relay = new Relay()
    const a = relay.ingest({ event: 'a.one', source: 'web' })
    const b = relay.ingest({ event: 'a.two' })
    expect(a.seq).toBe(0)
    expect(b.seq).toBe(1)
    expect(b.source).toBe('unknown')
    expect(typeof a.received_at).toBe('string')
  })

  it('drain returns only new-since-cursor and advances the cursor', () => {
    const relay = new Relay()
    relay.ingest({ event: 'a' })
    relay.ingest({ event: 'b' })
    expect(relay.drain().events.map(e => e.event)).toEqual(['a', 'b'])
    // Nothing new -> empty, buffer not cleared.
    expect(relay.drain().events).toEqual([])
    relay.ingest({ event: 'c' })
    expect(relay.drain().events.map(e => e.event)).toEqual(['c'])
  })

  it('since=0 re-reads from the start without moving the cursor', () => {
    const relay = new Relay()
    relay.ingest({ event: 'a' })
    relay.ingest({ event: 'b' })
    relay.drain() // advance cursor past both
    expect(relay.drain({ since: 0 }).events.map(e => e.event)).toEqual(['a', 'b'])
    // Re-read did not advance the cursor: a fresh event is still pending.
    relay.ingest({ event: 'c' })
    expect(relay.drain().events.map(e => e.event)).toEqual(['c'])
  })

  it('filters by source and prefix', () => {
    const relay = new Relay()
    relay.ingest({ event: 'order.created', source: 'web' })
    relay.ingest({ event: 'sync.failed', source: 'worker' })
    relay.ingest({ event: 'order.deleted', source: 'web' })
    expect(relay.drain({ since: 0, source: 'web' }).events).toHaveLength(2)
    expect(relay.drain({ since: 0, prefix: 'order.' }).events).toHaveLength(2)
    expect(relay.drain({ since: 0, source: 'worker', prefix: 'order.' }).events).toHaveLength(0)
  })

  it('evicts oldest beyond the cap and reports undrained loss once', () => {
    const relay = new Relay(3)
    for (let i = 0; i < 5; i++) relay.ingest({ event: `e${i}` })
    const health = relay.health()
    expect(health.buffered).toBe(3)
    expect(health.evicted).toBe(2)
    expect(health.evictedUndrained).toBe(2)
    const drain = relay.drain()
    expect(drain.events.map(e => e.event)).toEqual(['e2', 'e3', 'e4'])
    expect(drain.newlyEvictedUndrained).toBe(2)
    // Loss is reported only once; a follow-up drain does not re-warn.
    relay.ingest({ event: 'e5' })
    expect(relay.drain().newlyEvictedUndrained).toBe(0)
  })

  it('clear empties the buffer but keeps seq monotonic', () => {
    const relay = new Relay()
    relay.ingest({ event: 'a' })
    relay.clear()
    expect(relay.health().buffered).toBe(0)
    const next = relay.ingest({ event: 'b' })
    expect(next.seq).toBe(1)
  })

  it('subscribe receives every ingested event until unsubscribed', () => {
    const relay = new Relay()
    const seen: string[] = []
    const off = relay.subscribe(e => seen.push(e.event))
    relay.ingest({ event: 'a' })
    off()
    relay.ingest({ event: 'b' })
    expect(seen).toEqual(['a'])
  })
})

describe('Relay HTTP server', () => {
  const { server, secure } = createRelayServer({ maxEvents: 100 })
  let base = ''

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    expect(secure).toBe(false)
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('ingests JSON and a text/plain simple-request body', async () => {
    const json = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'json.one', source: 'test' }),
    })
    expect(json.status).toBe(202)

    // Browser "simple request": text/plain, no preflight.
    const beacon = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ event: 'beacon.one', source: 'web' }),
    })
    expect(beacon.status).toBe(202)

    // Batch array.
    const batch = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ event: 'b1' }, { event: 'b2' }]),
    })
    expect(((await batch.json()) as { accepted: number }).accepted).toBe(2)
  })

  it('serves CORS + Private Network Access headers on preflight', async () => {
    const res = await fetch(`${base}/events`, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Private-Network': 'true' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('drains NDJSON and reports loss via headers', async () => {
    const res = await fetch(`${base}/drain`)
    expect(res.headers.get('content-type')).toContain('x-ndjson')
    const text = await res.text()
    const events = text
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as XrayEvent)
    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(res.headers.get('x-xray-evicted-undrained-new')).toBe('0')
  })

  it('returns a Claude Code UserPromptSubmit payload from /hook', async () => {
    await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'hook.one', source: 'test' }),
    })
    const res = await fetch(`${base}/hook`)
    const body = (await res.json()) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string }
    }
    expect(body.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(body.hookSpecificOutput.additionalContext).toContain('hook.one')
  })

  it('serves /xray.js with the relay origin baked in', async () => {
    const res = await fetch(`${base}/xray.js`)
    expect(res.headers.get('content-type')).toContain('javascript')
    const body = await res.text()
    expect(body).toContain('sendBeacon')
    expect(body).toContain(base) // {{XRAY_URL}} bake token replaced with this origin
    expect(body).not.toContain('{{XRAY_URL}}')
    expect(body).toContain('window.__XRAY_URL__') // override knob left intact
  })

  it('clears the buffer via DELETE', async () => {
    await fetch(`${base}/events`, { method: 'DELETE' })
    const health = (await (await fetch(`${base}/health`)).json()) as HealthStatus
    expect(health.buffered).toBe(0)
  })
})
