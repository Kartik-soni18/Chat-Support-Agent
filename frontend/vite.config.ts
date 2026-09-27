import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { proxy: Object.fromEntries(['/chat', '/transcribe', '/order', '/customers', '/review', '/events'].map((p) => [p, 'http://localhost:4000'])) },
})
