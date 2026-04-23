import path from 'path'
import fs from 'fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function readRootEnv(envPath) {
  if (!fs.existsSync(envPath)) return {}
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  const out = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
    out[key] = value
  }
  return out
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load both frontend env files (default Vite behavior) and root .env (project-level single source)
  const env = loadEnv(mode, process.cwd(), '')
  const rootEnvPath = path.resolve(process.cwd(), '..', '.env')
  const rootEnv = readRootEnv(rootEnvPath)

  const frontendPort = Number(
    rootEnv.FRONTEND_PORT ||
      process.env.FRONTEND_PORT ||
      rootEnv.VITE_DEV_PORT ||
      process.env.VITE_DEV_PORT ||
      env.VITE_DEV_PORT ||
      5179
  )
  const backendPort = Number(
    rootEnv.BACKEND_PORT ||
      process.env.BACKEND_PORT ||
      9080
  )

  const apiBaseUrl =
    rootEnv.VITE_API_BASE_URL ||
    rootEnv.VITE_API_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.VITE_API_URL ||
    env.VITE_API_BASE_URL ||
    env.VITE_API_URL ||
    `http://127.0.0.1:${backendPort}`

  const normalizedApiBaseUrl = String(apiBaseUrl).replace(/\/$/, '')

  return {
    plugins: [react()],
    // Force frontend runtime env vars from one place (root .env via BACKEND_PORT/FRONTEND_PORT)
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(normalizedApiBaseUrl),
      'import.meta.env.VITE_API_URL': JSON.stringify(normalizedApiBaseUrl),
      'import.meta.env.VITE_DEV_PORT': JSON.stringify(String(frontendPort)),
    },
    server: {
      host: '0.0.0.0',
      port: Number.isFinite(frontendPort) ? frontendPort : 5179,
    },
  }
})
