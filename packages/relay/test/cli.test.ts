import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Run the CLI from source via tsx — exercises the real `xray` binary behavior
// without a build step.
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

interface CliResult {
  stdout: string
  stderr: string
  code: number
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      ['--import', 'tsx', CLI, ...args],
      { env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0
        resolve({ stdout, stderr, code })
      },
    )
  })
}

function freePort(): Promise<number> {
  return new Promise(resolve => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

/** Start `xray start` as a real child process and wait until it serves /health. */
async function startRelay(port: number, maxEvents: number): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', CLI, 'start', '--port', String(port), '--max-events', String(maxEvents)],
    { env: { ...process.env, NO_COLOR: '1' }, stdio: 'ignore' },
  )
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/health`)).ok) return child
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 50))
  }
  child.kill('SIGKILL')
  throw new Error('relay did not start in time')
}

async function stopRelay(child: ChildProcess): Promise<void> {
  await new Promise<void>(resolve => {
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2000)
  })
}

async function post(base: string, body: unknown): Promise<void> {
  await fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('xray CLI against a live relay', () => {
  let child: ChildProcess
  let port: number
  let base: string

  beforeAll(async () => {
    port = await freePort()
    base = `http://127.0.0.1:${port}`
    child = await startRelay(port, 1000)
  }, 15000)

  afterAll(async () => {
    await stopRelay(child)
  })

  it('serves /health once started', async () => {
    const health = await (await fetch(`${base}/health`)).json()
    expect(health).toMatchObject({ ok: true })
  })

  it('drain prints posted events, then reports nothing new', async () => {
    await post(base, { event: 'order.created', source: 'web', data: { orderId: 'o1' } })
    await post(base, { event: 'payment.authorized', source: 'api' })

    const first = await runCli(['drain', '--url', base])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain('order.created')
    expect(first.stdout).toContain('payment.authorized')
    expect(first.stdout).toContain('web')

    // Cursor advanced: a second drain sees nothing new.
    const second = await runCli(['drain', '--url', base])
    expect(`${second.stdout}${second.stderr}`).toContain('no new events')
  })

  it('drain --json emits raw NDJSON, and --since 0 re-reads', async () => {
    const res = await runCli(['drain', '--url', base, '--since', '0', '--json'])
    const lines = res.stdout.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const parsed = JSON.parse(lines[0]!) as { seq: number; event: string }
    expect(parsed.seq).toBe(0)
  })

  it('clear empties the buffer', async () => {
    const res = await runCli(['clear', '--url', base])
    expect(res.stdout).toContain('cleared')
    const health = (await (await fetch(`${base}/health`)).json()) as { buffered: number }
    expect(health.buffered).toBe(0)
  })

  it('reports a friendly error when no relay is reachable', async () => {
    const dead = await freePort()
    const res = await runCli(['drain', '--url', `http://127.0.0.1:${dead}`])
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('No xray relay')
  })
})

describe('xray CLI eviction warning', () => {
  let child: ChildProcess
  let base: string

  beforeAll(async () => {
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    child = await startRelay(port, 2)
  }, 15000)

  afterAll(async () => {
    await stopRelay(child)
  })

  it('warns on drain when undrained events were evicted', async () => {
    for (let i = 0; i < 4; i++) await post(base, { event: `e${i}`, source: 'test' })
    const res = await runCli(['drain', '--url', base])
    expect(res.stderr).toContain('evicted before you read them')
    // Only the freshest survive the cap of 2.
    expect(res.stdout).toContain('e2')
    expect(res.stdout).toContain('e3')
    expect(res.stdout).not.toContain('e0')
  })
})
