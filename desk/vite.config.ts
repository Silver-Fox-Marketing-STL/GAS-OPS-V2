import { defineConfig } from 'vite';

// base './' → relative asset URLs, so the same build serves from a GitHub Pages
// project path (…/GAS-OPS-V2/) or a custom subdomain without a rebuild.
// server.fs.allow '..' → the dev server may serve ../appsscript.json, which
// auth.ts imports for the scope list (one source of truth with the script).
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2022', sourcemap: false }
});
