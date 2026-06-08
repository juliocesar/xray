import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { configure, enabled, setTrace, xray } from '../src/index'

interface Captured {
  contentType?: string
  body: unknown
}

/** Minimal relay stand-in that captures POST /events bodies. */
function captureServer(): {
  server: Server
  url: () => string
  next: () => Promise<Captured>
} {
  const waiters: ((c: Captured) => void)[] = []
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/events') {
      let raw = ''
      req.on('data', c => (raw += c))
      req.on('end', () => {
        const captured: Captured = {
          contentType: req.headers['content-type'],
          body: JSON.parse(raw),
        }
        waiters.shift()?.(captured)
        res.writeHead(202).end('{}')
      })
      return
    }
    res.writeHead(404).end()
  })
  return {
    server,
    url: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    next: () => new Promise<Captured>(resolve => waiters.push(resolve)),
  }
}

const relay = captureServer()

beforeAll(async () => {
  await new Promise<void>(resolve => relay.server.listen(0, '127.0.0.1', resolve))
})
afterAll(async () => {
  await new Promise<void>(resolve => relay.server.close(() => resolve()))
})
beforeEach(() => {
  // Reset overrides to a known, enabled state pointing at the capture server.
  configure({ url: relay.url(), source: 'node-test', enabled: true, trace: undefined })
})

describe('@xray/client', () => {
  it('sends a v2 event with event/source/ts and a text/plain body', async () => {
    const received = relay.next()
    xray('order.created', { orderId: 'abc' })
    const { contentType, body } = await received
    expect(contentType).toContain('text/plain') // CORS simple request
    expect(body).toMatchObject({
      event: 'order.created',
      source: 'node-test',
      data: { orderId: 'abc' },
    })
    expect(typeof (body as { ts: string }).ts).toBe('string')
  })

  it('omits data and trace when not provided', async () => {
    const received = relay.next()
    xray('ping')
    const { body } = await received
    expect(body).not.toHaveProperty('data')
    expect(body).not.toHaveProperty('trace')
  })

  it('attaches a trace set via setTrace', async () => {
    setTrace('req_123')
    const received = relay.next()
    xray('sync.started')
    const { body } = await received
    expect((body as { trace: string }).trace).toBe('req_123')
  })

  it('no-ops when disabled', async () => {
    configure({ enabled: false })
    expect(enabled()).toBe(false)
    let got = false
    void relay.next().then(() => (got = true))
    xray('should.not.send', { nope: true })
    await new Promise(r => setTimeout(r, 50))
    expect(got).toBe(false)
  })

  it('enabled() reflects an explicit override', () => {
    configure({ enabled: true })
    expect(enabled()).toBe(true)
  })
})
