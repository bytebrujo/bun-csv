import { createSignal } from "solid-js";
import "./Hero.css";

const ASCII_LOGO = `
████████╗██╗   ██╗██████╗ ██████╗  ██████╗  ██████╗███████╗██╗   ██╗
╚══██╔══╝██║   ██║██╔══██╗██╔══██╗██╔═══██╗██╔════╝██╔════╝██║   ██║
   ██║   ██║   ██║██████╔╝██████╔╝██║   ██║██║     ███████╗██║   ██║
   ██║   ██║   ██║██╔══██╗██╔══██╗██║   ██║██║     ╚════██║╚██╗ ██╔╝
   ██║   ╚██████╔╝██║  ██║██████╔╝╚██████╔╝╚██████╗███████║ ╚████╔╝
   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚═════╝╚══════╝  ╚═══╝
`;

export default function Hero() {
  const [copied, setCopied] = createSignal(false);

  const copyCommand = async () => {
    await navigator.clipboard.writeText("bun add turbocsv");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section class="hero">
      <div class="container">
        <pre class="ascii-logo" aria-label="TurboCSV">{ASCII_LOGO}</pre>

        <p class="tagline">
          High-performance CSV parser with <span class="text-accent">SIMD acceleration</span>
        </p>

        <p class="subtitle">
          Built with Zig for native performance. DataFrame API, Copy-on-Write, and full-featured CLI.
        </p>

        <div class="install-box">
          <code class="install-command">bun add turbocsv</code>
          <button
            class="copy-btn"
            onClick={copyCommand}
            aria-label="Copy install command"
          >
            {copied() ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
        </div>

        <div class="stats">
          <div class="stat">
            <span class="stat-value">269 MB/s</span>
            <span class="stat-label">Peak throughput</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <span class="stat-value">5.8x</span>
            <span class="stat-label">faster than fast-csv</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <span class="stat-value">6.35x</span>
            <span class="stat-label">faster than csv-parse</span>
          </div>
        </div>

        <div class="cta-buttons">
          <a href="#features" class="btn btn-primary">Get Started</a>
          <a href="https://github.com/bytebrujo/bun-csv" class="btn btn-secondary" target="_blank" rel="noopener">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 0.5rem">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/turbocsv" class="btn btn-secondary" target="_blank" rel="noopener">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 0.5rem">
              <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z"/>
            </svg>
            npm
          </a>
        </div>
      </div>
    </section>
  );
}
