import { defineConfig, type ViteDevServer } from "vite";

// Custom plugin to show a clear startup message and add /ping endpoint
function travelrPlugin() {
  return {
    name: "travelr-plugin",
    configureServer(server: ViteDevServer) {
      server.httpServer?.once("listening", () => {
        console.log("Travelr Web Server listening on http://localhost:5173");
      });
      // Add /ping endpoint
      server.middlewares.use((req, res, next) => {
        if (req.url === "/ping") {
          res.setHeader("Content-Type", "text/plain");
          res.end("pong");
        } else {
          next();
        }
      });
    }
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [travelrPlugin()],
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
            if ("headersSent" in res && res.headersSent) return;
            // Silently return 503 while server is starting up
            if ("writeHead" in res && typeof res.writeHead === "function") {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Server starting up..." }));
            }
          });
        }
      },
      "/auth": {
        target: "http://localhost:4000",
        changeOrigin: true
      },
      "/admin": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
