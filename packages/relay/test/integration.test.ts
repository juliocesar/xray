import { execFile, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createRelayServer } from '../src/server'
import { SNIPPET_ROUTES } from '../src/templates'
import type { XrayEvent } from '../src/types'

const execFileP = promisify(execFile)

/** Is a runtime on PATH? Used to skip languages that aren't installed. */
function has(bin: string): boolean {
  return spawnSync('which', [bin]).status === 0
}

/** Child env that enables xray and forces use of the relay's baked-in URL. */
function childEnv(source: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.XRAY_URL // exercise the URL baked into the served snippet
  env.XRAY_ENABLED = '1'
  env.XRAY_SOURCE = source
  return env
}

async function fetchSnippet(base: string, route: string, dest: string): Promise<void> {
  const body = await (await fetch(`${base}${route}`)).text()
  await writeFile(dest, body)
}

interface Lang {
  name: string
  bin: string
  emit: (dir: string, base: string) => Promise<void>
}

// Each helper is fetched from the live relay (testing URL-baking), run in its own
// runtime with only XRAY_ENABLED=1 set, and expected to POST `<name>.ping`.
const LANGS: Lang[] = [
  {
    name: 'python',
    bin: 'python3',
    async emit(dir, base) {
      await fetchSnippet(base, '/xray.py', join(dir, 'xrayhelper.py'))
      const prog = `import sys, time\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom xrayhelper import xray\nxray('python.ping', {'n': 1})\ntime.sleep(0.4)\n`
      await writeFile(join(dir, 'run.py'), prog)
      await execFileP('python3', [join(dir, 'run.py')], { env: childEnv('python') })
    },
  },
  {
    name: 'ruby',
    bin: 'ruby',
    async emit(dir, base) {
      await fetchSnippet(base, '/xray.rb', join(dir, 'xray.rb'))
      const prog = `require_relative 'xray'\nXray.emit('ruby.ping', n: 1)\nsleep 0.4\n`
      await writeFile(join(dir, 'run.rb'), prog)
      await execFileP('ruby', [join(dir, 'run.rb')], { env: childEnv('ruby') })
    },
  },
  {
    name: 'go',
    bin: 'go',
    async emit(dir, base) {
      await mkdir(join(dir, 'xray'), { recursive: true })
      await fetchSnippet(base, '/xray.go', join(dir, 'xray', 'xray.go'))
      await writeFile(join(dir, 'go.mod'), 'module xraydemo\n\ngo 1.21\n')
      const main = `package main\n\nimport (\n\t"time"\n\n\t"xraydemo/xray"\n)\n\nfunc main() {\n\txray.Emit("go.ping", map[string]any{"n": 1})\n\ttime.Sleep(400 * time.Millisecond)\n}\n`
      await writeFile(join(dir, 'main.go'), main)
      await execFileP('go', ['run', '.'], { cwd: dir, env: childEnv('go') })
    },
  },
  {
    name: 'rust',
    bin: 'rustc',
    async emit(dir, base) {
      await fetchSnippet(base, '/xray.rs', join(dir, 'xray.rs'))
      const main = `mod xray;\nuse std::{thread, time::Duration};\nfn main() {\n    xray::xray("rust.ping", "{\\"n\\":1}");\n    thread::sleep(Duration::from_millis(400));\n}\n`
      await writeFile(join(dir, 'main.rs'), main)
      await execFileP('rustc', ['-A', 'dead_code', 'main.rs', '-o', 'demo'], { cwd: dir })
      await execFileP(join(dir, 'demo'), [], { cwd: dir, env: childEnv('rust') })
    },
  },
  {
    name: 'shell',
    bin: 'bash',
    async emit(dir, base) {
      await fetchSnippet(base, '/xray.sh', join(dir, 'xray.sh'))
      const prog = `#!/usr/bin/env bash\n. "$(dirname "$0")/xray.sh"\nxray shell.ping '{"n":1}'\nsleep 0.5\nwait\n`
      await writeFile(join(dir, 'run.sh'), prog)
      await execFileP('bash', [join(dir, 'run.sh')], { env: childEnv('shell') })
    },
  },
  {
    name: 'php',
    bin: 'php',
    async emit(dir, base) {
      await fetchSnippet(base, '/xray.php', join(dir, 'xray.php'))
      const prog = `<?php\nrequire __DIR__ . '/xray.php';\nxray('php.ping', ['n' => 1]);\n`
      await writeFile(join(dir, 'run.php'), prog)
      await execFileP('php', [join(dir, 'run.php')], { env: childEnv('php') })
    },
  },
]

describe('cross-language helpers against a live relay', () => {
  let server: Server
  let base = ''

  beforeAll(async () => {
    ;({ server } = createRelayServer({ maxEvents: 1000 }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  /** Poll the relay until an event from `source` shows up (sends are async). */
  async function waitForSource(source: string): Promise<XrayEvent> {
    for (let i = 0; i < 40; i++) {
      const text = await (await fetch(`${base}/drain?since=0&source=${source}`)).text()
      const events = text
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as XrayEvent)
      if (events.length > 0) return events[0]!
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`no event from source "${source}" arrived in time`)
  }

  it('serves every helper snippet with the relay origin baked in', async () => {
    for (const [route, { contentType }] of Object.entries(SNIPPET_ROUTES)) {
      const res = await fetch(`${base}${route}`)
      expect(res.headers.get('content-type')).toBe(contentType)
      const body = await res.text()
      expect(body).toContain(base)
      expect(body).not.toContain('{{XRAY_URL}}')
    }
  })

  for (const lang of LANGS) {
    const available = has(lang.bin)
    it.skipIf(!available)(
      `${lang.name}: served helper posts a v2 event to the relay`,
      async () => {
        const dir = await mkdtemp(join(tmpdir(), `xray-${lang.name}-`))
        await lang.emit(dir, base)
        const event = await waitForSource(lang.name)
        expect(event.event).toBe(`${lang.name}.ping`)
        expect(event.source).toBe(lang.name)
        expect(event.data).toEqual({ n: 1 })
      },
      30000,
    )
  }
})

describe('one action stitched across processes by trace', () => {
  let server: Server
  let base = ''

  beforeAll(async () => {
    ;({ server } = createRelayServer())
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('correlates browser → api → worker on one ordered timeline', async () => {
    const trace = 'stitch_42'
    // Three sources, same trace — the shape the trace-demo produces.
    for (const [source, event] of [
      ['web', 'checkout.submitted'],
      ['api', 'payment.authorized'],
      ['worker', 'fulfillment.failed'],
    ] as const) {
      await fetch(`${base}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, source, trace, data: { orderId: 'ord_1' } }),
      })
    }

    const text = await (await fetch(`${base}/drain?since=0`)).text()
    const timeline = text
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as XrayEvent)

    expect(timeline).toHaveLength(3)
    expect(timeline.every(e => e.trace === trace)).toBe(true)
    expect(timeline.map(e => e.source)).toEqual(['web', 'api', 'worker'])
    // seq is the ordering authority and is strictly increasing.
    expect(timeline.map(e => e.seq)).toEqual([0, 1, 2])
  })
})
