import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  // The CLI entry carries a shebang in source; tsup preserves it.
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  splitting: false,
  sourcemap: false,
  // Zero runtime dependencies: nothing to leave external.
  noExternal: [/.*/],
})
