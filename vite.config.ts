import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function formatBuildDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __BUILD_DATE__: JSON.stringify(formatBuildDate(new Date())),
  },
  server: {
    port: 5173,
    watch: {
      ignored: [
        "**/workspaces/**",
        "**/server/src/workspaces/**",
        "**/server/workspaces/**",
        "**/server/data/**",
      ],
    },
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
