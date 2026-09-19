import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      "/upi-qr.jpeg": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: () => "/api/payment-qr/image",
      },
      // Proxy API calls to the backend so the frontend can use a relative
      // /api path (same origin). This avoids LAN-IP reachability and CORS
      // issues when the site is opened via localhost or a network address.
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
})
