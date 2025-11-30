import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        // Suppress connection errors during server startup
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if (res.headersSent) return;
            // Silently return 503 while server is starting up
            if ("writeHead" in res && typeof res.writeHead === "function") {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Server starting up..." }));
            }
          });
        }
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
