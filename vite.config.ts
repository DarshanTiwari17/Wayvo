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
    // Bind all interfaces so the app can be opened from a phone or a second
    // machine on the same network while testing.
    //
    // `allowedHosts` is deliberately an explicit list rather than `true`:
    // `true` accepts any Host header, which leaves the dev server open to
    // DNS-rebinding attacks. Add your own LAN address here when it changes.
    host: true,
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', '192.168.120.220', '10.46.232.204'],
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: ['localhost', '127.0.0.1', '192.168.120.220', '10.46.232.204'],
  },
})
