import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react-dom/client", replacement: "preact/compat/client" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react", replacement: "preact/compat" },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    reportCompressedSize: true,
  },
});
