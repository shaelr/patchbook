import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from the iPad during development
    proxy: { '/api': 'http://localhost:3000' },
  },
})
