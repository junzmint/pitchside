import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5195,
    host: true, // reachable from other devices on the Wi-Fi (LAN play)
    proxy: { '/api': { target: 'http://localhost:8095', ws: true } },
  },
})
