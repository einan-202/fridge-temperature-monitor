import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // Forwarded server-side by the Vite dev server running inside the
      // `frontend` container, over the Docker network, to the `backend`
      // service. This is what lets any LAN device (e.g. a phone hitting
      // http://<host-LAN-ip>:5173) reach the backend without knowing its
      // address — no VITE_API_URL env var needed. See NOTES.md.
      "/health": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
      // Reserved for future business endpoints (not implemented yet).
      "/api": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
