import { For } from "solid-js";
import "./WhatsNew.css";

const featureGroups = [
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
  {
    title: "Output & Metadata",
    features: [
      <><code>unparse()</code> — arrays/objects to CSV</>,
      <><code>getMeta()</code> — delimiter, headers, row count</>,
      <><code>__parsed_extra</code> — excess field capture</>,
    ],
  },
  {
    title: "Configuration",
    features: [
      "Preview / row limit",
      <><code>skipFirstNLines</code></>,
      <><code>onError</code> callback & structured errors</>,
    ],
  },
];

export default function WhatsNew() {
  return (
    <section class="whats-new" id="whats-new">
      <div class="container">
        <h2>What's New in v0.2.0</h2>
        <p class="whats-new-subtitle">
          PapaParse-compatible API — 13 new features for streaming, writing, and data processing.
        </p>

        <div class="whats-new-grid">
          <For each={featureGroups}>
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
    </section>
  );
}
