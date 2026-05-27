import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api':     'http://localhost:3001',
      '/auth':    'http://localhost:3001',
      '/avatars': 'http://localhost:3001',
    }
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  }
})
