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
      "/wiki-api": {
        target: "https://helldivers.wiki.gg",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wiki-api/, ""),
        headers: { "User-Agent": "hd2-kill-card/0.1 (local research)" },
      },
      "/hd2-data": {
        target: "https://raw.githubusercontent.com/SalmonC/HD2Tool/main/src/data",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hd2-data/, ""),
      },
    },
  },
});
