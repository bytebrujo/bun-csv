import { createSignal, For } from "solid-js";
import "./CodeExample.css";

const tabs = [
  {
    id: "basic",
    label: "Basic Parsing",
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

export default function CodeExample() {
  const [activeTab, setActiveTab] = createSignal("basic");

  return (
    <section class="code-example" id="code">
      <div class="container">
        <h2>Quick Start</h2>

        <div class="tabs">
          <For each={tabs}>
            {(tab) => (
              <button
                class={`tab ${activeTab() === tab.id ? "active" : ""}`}
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
              <pre
                class={`code-block ${activeTab() === tab.id ? "visible" : ""}`}
              >
                <code>{tab.code}</code>
              </pre>
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
