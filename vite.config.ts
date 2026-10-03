import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The TTS proxy (server/index.ts) answers /api in production; in dev, run it on 8080 next to Vite.
const API_TARGET = process.env.BAZAAR_LIVE_API ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
})
