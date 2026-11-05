import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5195,
    // this computer only; `WEB_BIND=0.0.0.0 make web` opens it to devices on the same Wi-Fi (LAN play)
    host: loadEnv(mode, '.', 'WEB_').WEB_BIND || 'localhost',
    proxy: { '/api': { target: 'http://localhost:8095', ws: true } },
  },
}))
