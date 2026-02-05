// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="description" content="High-performance CSV parser with SIMD acceleration, DataFrame operations, and CLI. Built with Zig for native performance." />
          <link rel="icon" href="/bun-csv/favicon.svg" type="image/svg+xml" />

          {/* Open Graph / Social Media */}
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://bytebrujo.github.io/bun-csv/" />
          <meta property="og:title" content="TurboCSV - High-performance CSV parser with SIMD acceleration" />
          <meta property="og:description" content="High-performance CSV parser with SIMD acceleration, DataFrame operations, and CLI. Built with Zig for native performance." />
          <meta property="og:image" content="https://bytebrujo.github.io/bun-csv/og-image.png" />

          {/* Twitter Card */}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="TurboCSV - High-performance CSV parser with SIMD acceleration" />
          <meta name="twitter:description" content="High-performance CSV parser with SIMD acceleration, DataFrame operations, and CLI. Built with Zig for native performance." />
          <meta name="twitter:image" content="https://bytebrujo.github.io/bun-csv/og-image.png" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
