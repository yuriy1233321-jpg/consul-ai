
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // 🔥 критично для Railway + Express

  plugins: [react()],

  server: {
    proxy: {
      '/chat': 'http://localhost:3000',
      '/api': 'http://localhost:3000'
    }
  }
})
