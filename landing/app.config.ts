import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: {
    prerender: {
      crawlLinks: true,
      routes: ["/"],
    },
    preset: "static",
  },
  vite: {
    base: "/bun-csv/",
  },
});
