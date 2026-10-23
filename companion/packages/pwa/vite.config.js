import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Cursor Companion",
        short_name: "Companion",
        description: "Approve shell commands and mirror Cursor chats",
        theme_color: "#0f1419",
        background_color: "#0f1419",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,ico}"],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
