import { build } from 'esbuild'

const common = {
  entryPoints: [
    './src/index.js',
  ],
  bundle: true,
  target: 'esnext',
  external: [
    'ethers',
  ]
}

build({
  ...common,
  format: 'esm',
  outdir: 'dist/esm',
  splitting: true,
  alias: {
    'buffer': 'buffer'
  }
})

build({
  ...common,
  format: 'esm',
  outfile: 'dist/id.all.min.js',
  minify: true,
  sourcemap: true,
})

build({
  ...common,
  format: 'cjs',
  outdir: 'dist/cjs',
})
