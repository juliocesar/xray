import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'

import { renderTemplate } from './templates'

const DEFAULT_URL = 'http://127.0.0.1:7200'
const CLAUDE_BEGIN = '<!-- BEGIN xray claude template -->'
const CLAUDE_END = '<!-- END xray claude template -->'
const HOOK_COMMAND = `curl -s ${DEFAULT_URL}/hook`

type Lang = 'node' | 'browser' | 'ruby' | 'python' | 'go' | 'rust' | 'php' | 'shell'

interface VendorSpec {
  template: string
  /** Output filename, relative to the project dir. */
  out: string
}

const VENDOR: Partial<Record<Lang, VendorSpec>> = {
  ruby: { template: 'ruby.rb', out: 'xray.rb' },
  python: { template: 'python.py', out: 'xray.py' },
  go: { template: 'go.go', out: 'xray.go' },
  rust: { template: 'rust.rs', out: 'xray.rs' },
  php: { template: 'php.php', out: 'xray.php' },
  shell: { template: 'shell.sh', out: 'xray.sh' },
}

/** Sniff the project's primary language from its manifest files. */
function detectLang(dir: string): Lang {
  if (existsSync(join(dir, 'go.mod'))) return 'go'
  if (existsSync(join(dir, 'Cargo.toml'))) return 'rust'
  if (existsSync(join(dir, 'composer.json'))) return 'php'
  if (
    existsSync(join(dir, 'Gemfile')) ||
    existsSync(join(dir, 'config.ru')) ||
    existsSync(join(dir, 'Rakefile'))
  ) {
    return 'ruby'
  }
  if (
    existsSync(join(dir, 'requirements.txt')) ||
    existsSync(join(dir, 'pyproject.toml')) ||
    existsSync(join(dir, 'setup.py'))
  ) {
    return 'python'
  }
  if (existsSync(join(dir, 'package.json'))) return 'node'
  return 'shell'
}

function lanAddress(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return undefined
}

/** Append the tight xray block to a doc file (idempotent, marker-guarded). */
function writeClaudeBlock(path: string): 'created' | 'updated' | 'skipped' {
  const block = `${CLAUDE_BEGIN}\n\n${renderTemplate('claude.md', DEFAULT_URL).trimEnd()}\n\n${CLAUDE_END}\n`
  if (!existsSync(path)) {
    writeFileSync(path, block)
    return 'created'
  }
  const existing = readFileSync(path, 'utf8')
  if (existing.includes(CLAUDE_BEGIN)) {
    const before = existing.slice(0, existing.indexOf(CLAUDE_BEGIN))
    const afterIdx = existing.indexOf(CLAUDE_END)
    const after = afterIdx === -1 ? '' : existing.slice(afterIdx + CLAUDE_END.length)
    writeFileSync(path, `${before}${block.trimEnd()}${after}`)
    return 'updated'
  }
  writeFileSync(path, `${existing.trimEnd()}\n\n${block}`)
  return 'updated'
}

/** Install the UserPromptSubmit hook into .claude/settings.json (merging). */
function installHook(dir: string): 'installed' | 'present' {
  const settingsPath = join(dir, '.claude', 'settings.json')
  interface HookEntry {
    hooks: { type: string; command: string }[]
  }
  interface Settings {
    hooks?: { UserPromptSubmit?: HookEntry[] }
    [key: string]: unknown
  }
  let settings: Settings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Settings
    } catch {
      settings = {}
    }
  }
  const hooks = (settings.hooks ??= {})
  const list = (hooks.UserPromptSubmit ??= [])
  const already = list.some(entry => entry.hooks?.some(h => h.command === HOOK_COMMAND))
  if (already) return 'present'
  list.push({ hooks: [{ type: 'command', command: HOOK_COMMAND }] })
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  return 'installed'
}

export async function runInit(
  _positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const dir = typeof flags.dir === 'string' ? flags.dir : process.cwd()
  const lang: Lang = (typeof flags.lang === 'string' ? flags.lang : detectLang(dir)) as Lang
  const done: string[] = []

  // 1. Docs: tight block into CLAUDE.md (+ AGENTS.md if present), long README doc.
  const claudeStatus = writeClaudeBlock(join(dir, 'CLAUDE.md'))
  done.push(`CLAUDE.md xray block ${claudeStatus}`)
  if (existsSync(join(dir, 'AGENTS.md'))) {
    writeClaudeBlock(join(dir, 'AGENTS.md'))
    done.push('AGENTS.md xray block updated')
  }
  const docPath = join(dir, 'XRAY.md')
  if (!existsSync(docPath)) {
    writeFileSync(docPath, renderTemplate('readme.md', DEFAULT_URL))
    done.push('XRAY.md written')
  }

  // 2. Vendor (or advise on) the helper for the chosen stack.
  if (lang === 'node') {
    done.push('JS/TS: install the typed client with `npm i -D @xray/client`')
  } else if (lang === 'browser') {
    done.push(`browser: add <script src="${DEFAULT_URL}/xray.js"></script> (dev only)`)
  } else {
    const spec = VENDOR[lang]
    if (spec) {
      const outPath = join(dir, spec.out)
      if (existsSync(outPath) && !flags.force) {
        done.push(`${spec.out} already exists (use --force to overwrite)`)
      } else {
        writeFileSync(outPath, renderTemplate(spec.template, DEFAULT_URL))
        done.push(`vendored ${spec.out}`)
      }
    }
  }

  // 3. Optional ambient hook.
  if (flags.hook) {
    const status = installHook(dir)
    done.push(`Claude Code UserPromptSubmit hook ${status}`)
  }

  // Report.
  console.log(`xray init — detected stack: ${lang}\n`)
  for (const line of done) console.log(`  ✓ ${line}`)

  // Agent instruction files (CLAUDE.md / AGENTS.md) and hooks are read at
  // startup, so an already-open session won't see what init just wrote.
  console.log(
    `\n⚠ Restart your coding agent so it loads the updated CLAUDE.md` +
      (flags.hook ? ' and the new UserPromptSubmit hook' : '') +
      `.\n  Agent instructions are read at startup (in Claude Code: /clear or start a new session).`,
  )

  const lan = lanAddress()
  console.log('\nStart the relay with: npx xray')
  console.log(`Relay URL: ${DEFAULT_URL}${lan ? `  (LAN: http://${lan}:7200)` : ''}`)
  if (!flags.hook) {
    console.log('\nTip: re-run with --hook to auto-inject events into Claude Code each prompt.')
  }
}
