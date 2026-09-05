import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "NAPIER_");
  const apiPort = env["NAPIER_PORT"] ?? "8787";

  return {
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: "react/jsx-dev-runtime",
          replacement: "preact/jsx-dev-runtime",
        },
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
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      target: "es2022",
      sourcemap: true,
      reportCompressedSize: true,
    },
  };
});
