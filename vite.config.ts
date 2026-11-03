import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/hd2-api": {
        target: "https://api.helldivers2.dev",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hd2-api/, ""),
        headers: { "X-Super-Client": "hd2-kill-card", "X-Super-Contact": "hd2-kill-card@local" },
      },
    },
  },
});
