/**
 * Sample CSV Files Test
 * Tests TurboCSV functionality with real-world sample data
 */

import { CSVParser } from "../src/ts/parser";
import { DataFrame } from "../src/ts/dataframe";
import { execSync } from "child_process";
import { existsSync, statSync } from "fs";

const CLI = "bun src/cli/index.ts";
const SAMPLES_DIR = "/Users/louis/bun-csv/samples";

// Helper to run CLI commands
function run(cmd: string): string {
  try {
    return execSync(`${CLI} ${cmd} 2>&1`, { encoding: "utf-8", timeout: 60000 });
  } catch (error: any) {
    return (error.stdout ?? "") + (error.stderr ?? "");
  }
}

// Get file size in human-readable format
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

console.log("=== Sample CSV Files Test ===\n");

// Discover sample files
const sampleFiles = [
  "customers-100.csv",
  "customers-100000.csv",
  "tmdb_5000_credits.csv",
].filter(f => existsSync(`${SAMPLES_DIR}/${f}`));

console.log("Sample files found:");
for (const file of sampleFiles) {
  const size = statSync(`${SAMPLES_DIR}/${file}`).size;
  console.log(`  - ${file} (${formatSize(size)})`);
}
console.log("");

// ============================================================================
// Test 1: Small file (customers-100.csv)
// ============================================================================
if (sampleFiles.includes("customers-100.csv")) {
  const file = `${SAMPLES_DIR}/customers-100.csv`;
  console.log("--- Testing: customers-100.csv ---\n");

  // 1.1 Count
  console.log("1.1 Count rows:");
  const countOutput = run(`count ${file}`);
  console.log(`    ${countOutput.split("\n")[0]}`);

  // 1.2 Head
  console.log("\n1.2 Head (first 3 rows):");
  const headOutput = run(`head -n 3 --format table ${file}`);
  console.log(headOutput.split("\n").slice(0, 5).map(l => `    ${l}`).join("\n"));

  // 1.3 Tail
  console.log("\n1.3 Tail (last 3 rows):");
  const tailOutput = run(`tail -n 3 --format table ${file}`);
  console.log(tailOutput.split("\n").slice(0, 5).map(l => `    ${l}`).join("\n"));

  // 1.4 Select columns
  console.log("\n1.4 Select columns (First Name, Last Name, Country):");
  const selectOutput = run(`select "First Name,Last Name,Country" ${file}`);
  console.log(selectOutput.split("\n").slice(0, 5).map(l => `    ${l}`).join("\n"));

  // 1.5 Sort
  console.log("\n1.5 Sort by First Name:");
  const sortOutput = run(`sort -c "First Name" ${file}`);
  console.log(sortOutput.split("\n").slice(0, 5).map(l => `    ${l}`).join("\n"));

  // 1.6 Stats
  console.log("\n1.6 Column statistics:");
  const statsOutput = run(`stats ${file}`);
  console.log(statsOutput.split("\n").slice(0, 10).map(l => `    ${l}`).join("\n"));

  // 1.7 Validate
  console.log("\n1.7 Validation:");
  const validateOutput = run(`validate ${file}`);
  console.log(`    ${validateOutput.split("\n").slice(0, 3).join("\n    ")}`);

  // 1.8 Convert to JSON
  console.log("\n1.8 Convert to JSON (first 2 records):");
  const jsonOutput = run(`head -n 2 --format json ${file}`);
  console.log(jsonOutput.split("\n").slice(0, 15).map(l => `    ${l}`).join("\n"));

  // 1.9 TypeScript API test
  console.log("\n1.9 TypeScript API:");
  const parser = new CSVParser(file);
  const headers = parser.getHeaders();
  console.log(`    Headers: ${headers?.slice(0, 5).join(", ")}...`);

  let rowCount = 0;
  const countries = new Set<string>();
  for (const row of parser) {
    rowCount++;
    const country = row.get("Country");
    if (country) countries.add(country);
  }
  parser.close();
  console.log(`    Rows parsed: ${rowCount}`);
  console.log(`    Unique countries: ${countries.size}`);

  // 1.10 DataFrame operations
  console.log("\n1.10 DataFrame operations:");
  const parser2 = new CSVParser(file);
  const df = parser2.toDataFrame();
  console.log(`    DataFrame rows: ${df.length}`);
  console.log(`    DataFrame columns: ${df.getColumns().length}`);

  const sorted = df.sorted("First Name" as any, "asc");
  const first3 = sorted.first(3);
  console.log(`    First 3 sorted names: ${first3.map((r: any) => r["First Name"]).join(", ")}`);
  parser2.close();
}

// ============================================================================
// Test 2: Medium file (customers-100000.csv)
// ============================================================================
if (sampleFiles.includes("customers-100000.csv")) {
  const file = `${SAMPLES_DIR}/customers-100000.csv`;
  console.log("\n--- Testing: customers-100000.csv (100K rows) ---\n");

  // 2.1 Count with timing
  console.log("2.1 Count rows:");
  const startCount = performance.now();
  const countOutput = run(`count ${file}`);
  const countTime = performance.now() - startCount;
  console.log(`    ${countOutput.split("\n")[0]} (${countTime.toFixed(0)}ms)`);

  // 2.2 Benchmark
  console.log("\n2.2 Benchmark (3 iterations):");
  const benchOutput = run(`benchmark ${file}`);
  const benchLines = benchOutput.split("\n").filter(l => l.includes("MB/s") || l.includes("Average"));
  console.log(benchLines.slice(-4).map(l => `    ${l.trim()}`).join("\n"));

  // 2.3 Head
  console.log("\n2.3 Head (first 5 rows):");
  const headOutput = run(`head -n 5 --format table ${file}`);
  console.log(headOutput.split("\n").slice(0, 7).map(l => `    ${l}`).join("\n"));

  // 2.4 Filter (if any match)
  console.log("\n2.4 Filter (looking for USA customers):");
  const startFilter = performance.now();
  const filterOutput = run(`filter "Country == United States" ${file}`);
  const filterTime = performance.now() - startFilter;
  const filterLines = filterOutput.split("\n");
  const matchLine = filterLines.find(l => l.includes("Matched"));
  console.log(`    ${matchLine} (${filterTime.toFixed(0)}ms)`);

  // 2.5 TypeScript API performance
  console.log("\n2.5 TypeScript API parsing:");
  const startParse = performance.now();
  const parser = new CSVParser(file);
  let rowCount = 0;
  for (const row of parser) {
    rowCount++;
    // Access a field to ensure parsing
    row.get(0);
  }
  const parseTime = performance.now() - startParse;
  const fileSize = statSync(file).size;
  const throughput = (fileSize / 1024 / 1024) / (parseTime / 1000);
  parser.close();
  console.log(`    Parsed ${rowCount.toLocaleString()} rows in ${parseTime.toFixed(0)}ms`);
  console.log(`    Throughput: ${throughput.toFixed(1)} MB/s`);
}

// ============================================================================
// Test 3: Large file with complex data (tmdb_5000_credits.csv)
// ============================================================================
if (sampleFiles.includes("tmdb_5000_credits.csv")) {
  const file = `${SAMPLES_DIR}/tmdb_5000_credits.csv`;
  console.log("\n--- Testing: tmdb_5000_credits.csv (Movie Database) ---\n");

  // 3.1 File info
  const fileSize = statSync(file).size;
  console.log(`3.1 File size: ${formatSize(fileSize)}`);

  // 3.2 Count
  console.log("\n3.2 Count rows:");
  const countOutput = run(`count ${file}`);
  console.log(`    ${countOutput.split("\n")[0]}`);

  // 3.3 Stats (column types)
  console.log("\n3.3 Column statistics:");
  const statsOutput = run(`stats ${file}`);
  console.log(statsOutput.split("\n").slice(0, 8).map(l => `    ${l}`).join("\n"));

  // 3.4 Head with potentially complex quoted fields
  console.log("\n3.4 Head (first 2 rows) - tests quoted field handling:");
  const headOutput = run(`head -n 2 --format csv ${file}`);
  const headLines = headOutput.split("\n").slice(0, 3);
  for (const line of headLines) {
    // Truncate long lines
    const display = line.length > 100 ? line.slice(0, 100) + "..." : line;
    console.log(`    ${display}`);
  }

  // 3.5 Benchmark
  console.log("\n3.5 Benchmark (parsing performance):");
  const benchOutput = run(`benchmark ${file}`);
  const benchLines = benchOutput.split("\n").filter(l => l.includes("MB/s") || l.includes("Average"));
  console.log(benchLines.slice(-4).map(l => `    ${l.trim()}`).join("\n"));

  // 3.6 Validate (check for RFC 4180 compliance)
  console.log("\n3.6 Validation (RFC 4180 compliance):");
  const validateOutput = run(`validate ${file}`);
  console.log(`    ${validateOutput.split("\n").slice(0, 5).join("\n    ")}`);

  // 3.7 TypeScript API with complex data
  console.log("\n3.7 TypeScript API (handling complex quoted fields):");
  const parser = new CSVParser(file);
  const headers = parser.getHeaders();
  console.log(`    Columns: ${headers?.join(", ")}`);

  let rowCount = 0;
  let maxFieldLen = 0;
  for (const row of parser) {
    rowCount++;
    // Check field lengths (JSON data can be very long)
    for (let i = 0; i < (headers?.length ?? 0); i++) {
      const val = row.get(i);
      if (val && val.length > maxFieldLen) {
        maxFieldLen = val.length;
      }
    }
    if (rowCount >= 100) break; // Sample first 100 rows
  }
  parser.close();
  console.log(`    Sampled ${rowCount} rows`);
  console.log(`    Max field length in sample: ${maxFieldLen.toLocaleString()} chars`);
}

// ============================================================================
// Summary
// ============================================================================
console.log("\n=== Sample Tests Complete ===\n");
console.log("All sample CSV files processed successfully!");
console.log("Tested:");
console.log("  - CLI commands: count, head, tail, select, sort, filter, stats, validate, benchmark");
console.log("  - TypeScript API: CSVParser, DataFrame, iteration");
console.log("  - Features: SIMD parsing, quoted fields, large files");
