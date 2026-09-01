import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// En Docker el backend no es "localhost" sino el servicio `backend` de compose,
// por eso el destino del proxy sale de una variable de entorno.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8011'
const wsTarget = apiTarget.replace(/^http/, 'ws')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 5181),
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
})
