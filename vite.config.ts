import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the two big, rarely-changing dependencies out of the app chunk
        // so a code change does not invalidate 400 kB of vendor code in caches.
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    // Localhost only. If you need to reach the dev server from another device
    // on the network, run `npm run dev -- --host` for that session rather than
    // committing the exposure to the config.
    port: 5173,
  },
})
