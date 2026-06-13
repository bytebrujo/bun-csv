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
    id: "advanced",
    label: "Advanced (v0.3.0)",
    lang: "typescript",
    code: `import { CSVParser, unparse, flatten } from "turbocsv";

// Robust parsing with error handling
const parser = new CSVParser("messy.csv", {
  trim: true,                     // Clean whitespace
  skipRecordsWithError: true,     // Skip bad rows
  comments: true,                  // Skip # prefixed lines
  duplicateHeaders: "rename",      // Handle duplicate columns
  dynamicTyping: true,             // Auto-convert types
  maxRecordSize: 10000,            // Reject huge rows
  cast: {                          // Custom transformers
    price: (val) => parseFloat(val.replace("$", "")),
    date: (val) => new Date(val)
  }
});

// Process with structured error handling
for (const row of parser) {
  try {
    processRow(row);
  } catch (error) {
    if (error.code === "TooFewFields") {
      console.log(\`Row \${error.row}: Missing fields\`);
    }
  }
}

// Secure CSV output
const csv = unparse(data, {
  escapeFormulae: true,    // Prevent CSV injection
  flattenObjects: true     // Handle nested JSON
});`,
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
    label: "CLI & Benchmarks",
    lang: "bash",
    code: `# Trim whitespace and skip bad rows
turbocsv head --trim --skip-errors data.csv

# Fast mode with dynamic typing
turbocsv head --fast --dynamic-typing --format json data.csv

# Run local benchmarks
bun run benchmark
bun run benchmark:compare

# Validate with structured error reporting
turbocsv validate data.csv
# Output: ERROR [TooFewFields] at row 42: Expected 5 fields, got 3

# Process specific range with comments
turbocsv head --from-line 5 --to-line 20 --comments data.csv

# Security: escape formula injection
turbocsv convert --escape-formulae data.csv -o safe.csv

# Handle duplicate headers
turbocsv head --duplicate-headers rename data.csv`,
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
