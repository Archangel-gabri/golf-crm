import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Vite (Rollup) treats "#" in paths as URL fragments. When the real path
  // contains "#" we launch through subst'd drive Z: + preserveSymlinks so Vite
  // never realpath()s back to the dirty path. See run-v2.bat.
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    preserveSymlinks: true,
  },
  optimizeDeps: {
    // Without this flag Vite's depScan writes to the realpath cache dir,
    // blowing up on "#" again.
    esbuildOptions: { preserveSymlinks: true },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
