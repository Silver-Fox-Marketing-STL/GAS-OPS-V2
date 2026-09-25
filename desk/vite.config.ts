import { defineConfig } from 'vite';

// base './' → relative asset URLs, so the same build serves from a GitHub Pages
// project path (…/GAS-OPS-V2/) or a custom subdomain without a rebuild.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', sourcemap: false }
});
