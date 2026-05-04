

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    
    proxy: {
      '/team1': {
        target: 'http://127.0.0.1:8766', // Change to 8766 if your backend uses that
        changeOrigin: true,
        ws: true, // Added this for real-time features
      },
      '/api': {
        target: 'http://127.0.0.1:8766', // Match the port above
        changeOrigin: true,
      },
    },
  },
})