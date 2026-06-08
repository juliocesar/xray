import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Directory holding the vendorable helper sources and doc templates. Resolved
 * relative to this module: in dev that is `packages/relay/templates`, and in the
 * bundled package it is `dist/../templates` — the same `templates/` shipped via
 * the package `files` list.
 */
export const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')

/**
 * Token in every template replaced with the live relay origin when served (or
 * the default URL when vendored). Deliberately not a valid identifier so it
 * never collides with code that references `window.__XRAY_URL__` and friends.
 */
const URL_TOKEN = '{{XRAY_URL}}'

/** Snippet routes the relay serves with its own origin baked in. */
export const SNIPPET_ROUTES: Record<string, { file: string; contentType: string }> = {
  '/xray.js': { file: 'browser.js', contentType: 'text/javascript; charset=utf-8' },
  '/xray.rb': { file: 'ruby.rb', contentType: 'text/plain; charset=utf-8' },
  '/xray.py': { file: 'python.py', contentType: 'text/plain; charset=utf-8' },
  '/xray.go': { file: 'go.go', contentType: 'text/plain; charset=utf-8' },
  '/xray.rs': { file: 'rust.rs', contentType: 'text/plain; charset=utf-8' },
  '/xray.php': { file: 'php.php', contentType: 'text/plain; charset=utf-8' },
  '/xray.sh': { file: 'shell.sh', contentType: 'text/plain; charset=utf-8' },
}

const cache = new Map<string, string>()

/** Read a raw template file (cached). */
export function readTemplate(file: string): string {
  const cached = cache.get(file)
  if (cached != null) return cached
  const content = readFileSync(join(TEMPLATES_DIR, file), 'utf8')
  cache.set(file, content)
  return content
}

/** Read a template with the relay origin baked into its `__XRAY_URL__` default. */
export function renderTemplate(file: string, baseUrl: string): string {
  return readTemplate(file).split(URL_TOKEN).join(baseUrl)
}
