import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  ssr: true,
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
