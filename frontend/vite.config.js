import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss(),],
  build: {
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing libraries so the app shell loads faster and caches better.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase'
          if (id.includes('leaflet')) return 'maps'
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('@reduxjs') || id.includes('react-redux')) return 'framework'
        },
      },
    },
  },
})
