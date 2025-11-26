import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
