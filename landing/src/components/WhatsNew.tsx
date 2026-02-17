import { For, createSignal } from "solid-js";
import "./WhatsNew.css";

const v3Features = [
  {
    title: "Security & Validation",
    features: [
      <>CSV injection protection with <code>escapeFormulae</code></>,
      "Structured errors with type, code, row fields",
      <><code>skipRecordsWithError</code> — silently drop malformed rows</>,
      <><code>maxRecordSize</code> — reject oversized rows</>,
      "Flexible column count handling (relax constraints)",
    ],
  },
  {
    title: "Whitespace & Processing",
    features: [
      <><code>trim</code>, <code>ltrim</code>, <code>rtrim</code> — strip whitespace</>,
      <>Greedy empty row skipping with <code>skipEmptyRows</code></>,
      <><code>fromLine</code> / <code>toLine</code> — parse file ranges</>,
      <>Comment support with <code>comments: true</code></>,
      "Skip rows where all fields are empty",
    ],
  },
  {
    title: "Fast Mode & Typing",
    features: [
      "Fast Mode — TypeScript-only parser for clean data",
      "Dynamic typing — auto-convert to numbers/booleans",
      "Cast functions — per-column type transformers",
      <><code>flatten()</code> / <code>unflatten()</code> for nested JSON</>,
      <><code>unparse()</code> with <code>flattenObjects</code> option</>,
    ],
  },
  {
    title: "Advanced Features",
    features: [
      "Duplicate header handling (rename or error)",
      <><code>beforeFirstChunk</code> — transform raw data</>,
      <><code>onRecord</code> — per-record filtering/transform</>,
      "Fixed SIMD quote handling bug",
      "22 CLI flags — all parser options available",
    ],
  },
];

const v2Features = [
  {
    title: "Streaming & Input",
    features: [
      "ReadableStream support",
      "URL/HTTP input (fetch & parse)",
      "Step callback (row-by-row)",
      "Chunk callback (batched processing)",
    ],
  },
  {
    title: "Data Processing",
    features: [
      "Delimiter auto-detection",
      "Dynamic typing (auto type coercion)",
      "Transform & transformHeader callbacks",
      "Comment line filtering",
    ],
  },
];

export default function WhatsNew() {
  const [showV2, setShowV2] = createSignal(false);

  return (
    <section class="whats-new" id="whats-new">
      <div class="container">
        <h2>What's New in v0.3.0</h2>
        <p class="whats-new-subtitle">
          Major feature release — 22 new CLI flags, security hardening, Fast Mode, and robust error handling.
        </p>

        <div class="whats-new-grid">
          <For each={v3Features}>
            {(group) => (
              <div class="whats-new-card">
                <h3>{group.title}</h3>
                <ul class="whats-new-list">
                  <For each={group.features}>
                    {(feature) => <li>{feature}</li>}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>

        <div class="version-toggle">
          <button
            class="version-toggle-btn"
            onClick={() => setShowV2(!showV2())}
          >
            {showV2() ? "Hide" : "Show"} v0.2.0 features
            <span class="toggle-arrow">{showV2() ? "▲" : "▼"}</span>
          </button>
        </div>

        {showV2() && (
          <div class="v2-features">
            <h3 class="v2-title">Previously in v0.2.0</h3>
            <p class="whats-new-subtitle">
              PapaParse-compatible API — streaming, writing, and data processing.
            </p>
            <div class="whats-new-grid">
              <For each={v2Features}>
                {(group) => (
                  <div class="whats-new-card">
                    <h3>{group.title}</h3>
                    <ul class="whats-new-list">
                      <For each={group.features}>
                        {(feature) => <li>{feature}</li>}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
