import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The real foobar2000 box. Override with BEEFWEB_URL=http://10.100.100.20:8880 pnpm dev
const target = process.env.BEEFWEB_URL ?? 'http://home.local:8880'

export default defineConfig({
  plugins: [react()],

  // Relative asset paths, so a build works under whatever prefix beefweb
  // mounts it at (/, /jean, anything) without rebuilding.
  base: './',

  server: {
    // Bind on the LAN too, so a phone can load the dev server directly.
    host: true,
    proxy: {
      // Same-origin during development: no CORS, and beefweb needs no changes.
      // SSE streams through untouched.
      '/api': { target, changeOrigin: true },
    },
  },
})
