// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="description" content="High-performance CSV parser with Zig, SIMD acceleration, Fast Mode benchmarks, DataFrame operations, and CLI tooling." />
          <link rel="icon" href="/bun-csv/favicon.ico" type="image/x-icon" />

          {/* Open Graph / Social Media */}
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://bytebrujo.github.io/bun-csv/" />
          <meta property="og:title" content="TurboCSV - Fast CSV parsing with Zig, SIMD, and Fast Mode" />
          <meta property="og:description" content="High-performance CSV parser with Zig, SIMD acceleration, Fast Mode benchmarks, DataFrame operations, and CLI tooling." />
          <meta property="og:image" content="https://bytebrujo.github.io/bun-csv/og-image.png" />

          {/* Twitter Card */}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="TurboCSV - Fast CSV parsing with Zig, SIMD, and Fast Mode" />
          <meta name="twitter:description" content="High-performance CSV parser with Zig, SIMD acceleration, Fast Mode benchmarks, DataFrame operations, and CLI tooling." />
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
