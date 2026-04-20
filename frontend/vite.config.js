import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Port defaults to 5742 — a unique number to avoid clashes when multiple
// developers share the same remote desktop. Override via VITE_PORT in .env.
export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.VITE_PORT || '5742'),
    strictPort: false,   // auto-increment if the port is already taken
  },
})
