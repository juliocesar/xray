import { defineConfig } from 'tsup'

// Two build profiles in one package: the Node relay/CLI, and the universal
// (browser + Node) typed client exposed at `@julio_ody/xray/client`.
export default defineConfig([
  {
    entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
    format: ['esm'],
    target: 'node24',
    platform: 'node',
    // The CLI entry carries a shebang in source; tsup preserves it.
    dts: { entry: { index: 'src/index.ts' } },
    clean: true,
    splitting: false,
    sourcemap: false,
    noExternal: [/.*/],
  },
  {
    entry: { client: 'src/client.ts' },
    format: ['esm', 'cjs'],
    target: 'es2020',
    platform: 'neutral',
    dts: true,
    clean: false,
    treeshake: true,
    sourcemap: false,
  },
])
