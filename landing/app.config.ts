import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: {
    prerender: {
      crawlLinks: true,
    },
    preset: "static",
  },
  vite: {
    base: "/bun-csv/",
  },
});
