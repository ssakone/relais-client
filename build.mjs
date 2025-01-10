import { build } from 'esbuild';

try {
  await build({
    entryPoints: ['src/cli.cjs'],
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'cjs',
    outfile: 'dist/bundle.cjs',
    external: ['net', 'fs', 'path', 'os', 'url'],
    minify: true,
  });
  console.log('Build completed');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
