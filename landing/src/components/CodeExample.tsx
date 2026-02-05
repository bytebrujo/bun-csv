"use client";
import { createSignal, For, onMount } from "solid-js";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-bash";
import "prismjs/themes/prism-tomorrow.css";
import "./CodeExample.css";

const tabs = [
  {
    id: "basic",
    label: "Basic Parsing",
    lang: "typescript",
    code: `import { CSVParser } from "turbocsv";

const parser = new CSVParser("data.csv");

for (const row of parser) {
  console.log(row.get("name"), row.get("email"));
}

parser.close();`,
  },
  {
    id: "dataframe",
    label: "DataFrame",
    lang: "typescript",
    code: `import { CSVParser } from "turbocsv";

const parser = new CSVParser("data.csv");
const df = parser.toDataFrame();

// Chain operations
const result = df
  .filter(row => row.age > 18)
  .select("name", "email", "age")
  .sorted("name", "asc")
  .first(100);

// Aggregation
const grouped = df.groupBy("department", [
  { col: "salary", fn: "mean" },
  { col: "id", fn: "count" },
]);

parser.close();`,
  },
  {
    id: "cli",
    label: "CLI",
    lang: "bash",
    code: `# Count rows
turbocsv count data.csv

# Preview data
turbocsv head -n 10 data.csv
turbocsv tail -n 5 --format table data.csv

# Filter and transform
turbocsv filter "age > 21" data.csv
turbocsv sort -c name --order asc data.csv
turbocsv select "name,email,phone" data.csv

# Convert formats
turbocsv convert --to json data.csv -o data.json`,
  },
];

function highlightCode(code: string, lang: string): string {
  const grammar = Prism.languages[lang];
  if (!grammar) return code;
  return Prism.highlight(code, grammar, lang);
}

export default function CodeExample() {
  const [activeTab, setActiveTab] = createSignal("basic");
  const [highlightedCode, setHighlightedCode] = createSignal<Record<string, string>>({});

  onMount(() => {
    const highlighted: Record<string, string> = {};
    for (const tab of tabs) {
      highlighted[tab.id] = highlightCode(tab.code, tab.lang);
    }
    setHighlightedCode(highlighted);
  });

  return (
    <section class="code-example" id="code">
      <div class="container">
        <h2>Quick Start</h2>

        <div class="tabs">
          <For each={tabs}>
            {(tab) => (
              <button
                class="tab"
                classList={{ active: activeTab() === tab.id }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <div class="code-container">
          <For each={tabs}>
            {(tab) => (
              <div
                class="code-block"
                classList={{ visible: activeTab() === tab.id }}
              >
                <pre>
                  <code
                    class={`language-${tab.lang}`}
                    innerHTML={highlightedCode()[tab.id] || tab.code}
                  />
                </pre>
              </div>
            )}
          </For>
        </div>

        <p class="code-note">
          See the full API documentation on{" "}
          <a
            href="https://github.com/bytebrujo/bun-csv#readme"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}
