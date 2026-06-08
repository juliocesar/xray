# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-07

Initial release of `@julio_ody/xray`.

### Added

- Relay core and the `xray` CLI (`start`, `tail`, `drain`, `clear`, `init`), bundled
  to a single dependency-free file.
- In-memory ring buffer with a shared, non-destructive drain cursor and a
  never-silent drop-oldest eviction policy (reports evicted and evicted-undrained
  counts via `/health`, `/drain` headers, and the `/hook` banner).
- HTTP API: `POST`/`DELETE /events`, `GET /drain` (NDJSON), `GET /hook` (Claude Code
  `UserPromptSubmit` payload), `GET /stream` (SSE), `GET /health`, served
  `/xray.<ext>` snippets, and CORS + Private Network Access support.
- Typed JS/TS client at the `@julio_ody/xray/client` subpath (browser + Node, ESM +
  CJS + types) with a `sendBeacon`-first, fire-and-forget transport.
- Vendorable, dependency-free helpers for browser, Ruby, Python, Go, Rust, PHP, and
  shell — written into a project by `xray init` and served by the relay.
- `xray init`: writes a tight xray block into `CLAUDE.md` / `AGENTS.md`, vendors a
  helper for the detected stack, optionally installs the ambient `UserPromptSubmit`
  hook (`--hook`), and reminds you to restart your agent.
- The event v2 wire format, documented in [WIRE_FORMAT.md](WIRE_FORMAT.md).

[unreleased]: https://github.com/juliocesar/xray/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/juliocesar/xray/releases/tag/v0.1.0
