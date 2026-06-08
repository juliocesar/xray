import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // Runs in both browsers and Node; guards pick the environment at runtime.
  target: 'es2020',
  platform: 'neutral',
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
})
