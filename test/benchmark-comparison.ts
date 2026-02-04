#!/usr/bin/env bun
/**
 * Benchmark Comparison: TurboCSV vs Other CSV Libraries
 *
 * Compares parsing performance against popular CSV parsers:
 * - papaparse (most popular)
 * - csv-parse (Node.js standard)
 * - fast-csv (streaming focused)
 */

import { readFileSync, statSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

// Import libraries
import { CSVParser } from "../src/ts/parser";
import Papa from "papaparse";
import { parse as csvParse } from "csv-parse/sync";
import { parseString as fastCsvParse } from "fast-csv";

const SAMPLES_DIR = join(import.meta.dir, "..", "samples");
const ITERATIONS = 5;

interface BenchmarkResult {
  library: string;
  file: string;
  fileSize: number;
  rows: number;
  timeMs: number;
  throughputMBs: number;
}

// Helper to format bytes
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Helper to format throughput with color
function formatThroughput(mbps: number, best: number): string {
  const formatted = mbps.toFixed(1).padStart(8);
  if (mbps === best) {
    return `\x1b[32m${formatted} MB/s\x1b[0m`; // Green for best
  }
  const ratio = mbps / best;
  if (ratio < 0.5) {
    return `\x1b[31m${formatted} MB/s\x1b[0m`; // Red for slow
  }
  return `\x1b[33m${formatted} MB/s\x1b[0m`; // Yellow for medium
}

// Generate test CSV if samples don't exist
function ensureTestFile(name: string, rows: number): string {
  const path = join(SAMPLES_DIR, name);

  if (existsSync(path)) {
    return path;
  }

  console.log(`Generating ${name} (${rows} rows)...`);

  const headers = ["id", "first_name", "last_name", "email", "gender", "ip_address", "country", "birthdate", "salary", "department"];
  const lines = [headers.join(",")];

  const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
  const genders = ["Male", "Female", "Other"];
  const countries = ["USA", "Canada", "UK", "Germany", "France", "Australia", "Japan", "Brazil", "India", "Mexico"];
  const departments = ["Engineering", "Sales", "Marketing", "HR", "Finance", "Operations", "Legal", "Support"];

  for (let i = 1; i <= rows; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const row = [
      i,
      firstName,
      lastName,
      `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      genders[i % genders.length],
      `${(i % 256)}.${((i * 7) % 256)}.${((i * 13) % 256)}.${((i * 17) % 256)}`,
      countries[i % countries.length],
      `${1950 + (i % 50)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      30000 + (i % 170000),
      departments[i % departments.length],
    ];
    lines.push(row.join(","));
  }

  const { mkdirSync } = require("fs");
  mkdirSync(SAMPLES_DIR, { recursive: true });
  writeFileSync(path, lines.join("\n"));
  console.log(`Created ${path}`);

  return path;
}

// Benchmark TurboCSV
async function benchmarkTurboCSV(filePath: string): Promise<{ rows: number; timeMs: number }> {
  const start = performance.now();
  const parser = new CSVParser(filePath);
  let rows = 0;

  for (const row of parser) {
    rows++;
    // Access a field to ensure parsing
    row.get(0);
  }

  parser.close();
  const timeMs = performance.now() - start;

  return { rows, timeMs };
}

// Benchmark PapaParse
async function benchmarkPapaParse(filePath: string): Promise<{ rows: number; timeMs: number }> {
  const content = readFileSync(filePath, "utf-8");

  const start = performance.now();
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
  });
  const timeMs = performance.now() - start;

  return { rows: result.data.length, timeMs };
}

// Benchmark csv-parse (sync)
async function benchmarkCsvParse(filePath: string): Promise<{ rows: number; timeMs: number }> {
  const content = readFileSync(filePath, "utf-8");

  const start = performance.now();
  const records = csvParse(content, {
    columns: true,
    skip_empty_lines: true,
  });
  const timeMs = performance.now() - start;

  return { rows: records.length, timeMs };
}

// Benchmark fast-csv
async function benchmarkFastCsv(filePath: string): Promise<{ rows: number; timeMs: number }> {
  const content = readFileSync(filePath, "utf-8");

  return new Promise((resolve) => {
    const start = performance.now();
    let rows = 0;

    fastCsvParse(content, { headers: true })
      .on("data", () => { rows++; })
      .on("end", () => {
        const timeMs = performance.now() - start;
        resolve({ rows, timeMs });
      })
      .on("error", (err) => {
        console.error("fast-csv error:", err);
        resolve({ rows: 0, timeMs: 0 });
      });
  });
}

// Run benchmarks for a single file
async function benchmarkFile(filePath: string): Promise<BenchmarkResult[]> {
  const fileName = filePath.split("/").pop()!;
  const fileSize = statSync(filePath).size;
  const results: BenchmarkResult[] = [];

  console.log(`\n${"─".repeat(70)}`);
  console.log(`File: ${fileName} (${formatSize(fileSize)})`);
  console.log(`${"─".repeat(70)}`);

  const libraries = [
    { name: "TurboCSV", fn: benchmarkTurboCSV },
    { name: "PapaParse", fn: benchmarkPapaParse },
    { name: "csv-parse", fn: benchmarkCsvParse },
    { name: "fast-csv", fn: benchmarkFastCsv },
  ];

  for (const { name, fn } of libraries) {
    const times: number[] = [];
    let rows = 0;

    // Warmup
    await fn(filePath);

    // Actual runs
    for (let i = 0; i < ITERATIONS; i++) {
      const result = await fn(filePath);
      times.push(result.timeMs);
      rows = result.rows;
    }

    // Calculate average (excluding outliers)
    times.sort((a, b) => a - b);
    const trimmedTimes = times.slice(1, -1); // Remove best and worst
    const avgTime = trimmedTimes.length > 0
      ? trimmedTimes.reduce((a, b) => a + b, 0) / trimmedTimes.length
      : times[Math.floor(times.length / 2)];

    const throughput = (fileSize / 1024 / 1024) / (avgTime / 1000);

    results.push({
      library: name,
      file: fileName,
      fileSize,
      rows,
      timeMs: avgTime,
      throughputMBs: throughput,
    });
  }

  // Sort by throughput and display
  results.sort((a, b) => b.throughputMBs - a.throughputMBs);
  const bestThroughput = results[0].throughputMBs;

  console.log(`\n${"Library".padEnd(15)} ${"Rows".padStart(10)} ${"Time".padStart(12)} ${"Throughput".padStart(15)}  Relative`);
  console.log(`${"─".repeat(15)} ${"─".repeat(10)} ${"─".repeat(12)} ${"─".repeat(15)}  ${"─".repeat(8)}`);

  for (const r of results) {
    const relative = (r.throughputMBs / bestThroughput * 100).toFixed(0) + "%";
    const relativeColor = r.throughputMBs === bestThroughput
      ? `\x1b[32m${relative.padStart(7)}\x1b[0m`
      : `\x1b[33m${relative.padStart(7)}\x1b[0m`;

    console.log(
      `${r.library.padEnd(15)} ` +
      `${r.rows.toLocaleString().padStart(10)} ` +
      `${r.timeMs.toFixed(1).padStart(9)} ms ` +
      `${formatThroughput(r.throughputMBs, bestThroughput)}  ` +
      `${relativeColor}`
    );
  }

  return results;
}

// Main benchmark runner
async function main() {
  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║           CSV Parser Benchmark Comparison                          ║");
  console.log("║  TurboCSV vs PapaParse vs csv-parse vs fast-csv                    ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝");
  console.log(`\nIterations per library: ${ITERATIONS}`);
  console.log("Methodology: Average of middle runs (excluding best/worst)\n");

  // Test files of different sizes
  const testFiles = [
    ensureTestFile("benchmark-1k.csv", 1_000),
    ensureTestFile("benchmark-10k.csv", 10_000),
    ensureTestFile("benchmark-100k.csv", 100_000),
  ];

  // Also include existing sample files if available
  const existingSamples = [
    "customers-100.csv",
    "customers-100000.csv",
  ];

  for (const sample of existingSamples) {
    const path = join(SAMPLES_DIR, sample);
    if (existsSync(path)) {
      testFiles.push(path);
    }
  }

  const allResults: BenchmarkResult[] = [];

  for (const file of testFiles) {
    const results = await benchmarkFile(file);
    allResults.push(...results);
  }

  // Summary
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║                         Summary                                    ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝");

  // Calculate average speedup for TurboCSV vs others
  const turboResults = allResults.filter(r => r.library === "TurboCSV");
  const otherLibraries = ["PapaParse", "csv-parse", "fast-csv"];

  console.log("\nAverage speedup (TurboCSV vs others):");
  console.log("─".repeat(40));

  for (const lib of otherLibraries) {
    const libResults = allResults.filter(r => r.library === lib);
    let totalSpeedup = 0;
    let count = 0;

    for (const turbo of turboResults) {
      const other = libResults.find(r => r.file === turbo.file);
      if (other) {
        totalSpeedup += turbo.throughputMBs / other.throughputMBs;
        count++;
      }
    }

    const avgSpeedup = count > 0 ? totalSpeedup / count : 0;
    const speedupStr = avgSpeedup >= 1
      ? `\x1b[32m${avgSpeedup.toFixed(2)}x faster\x1b[0m`
      : `\x1b[31m${(1/avgSpeedup).toFixed(2)}x slower\x1b[0m`;

    console.log(`  vs ${lib.padEnd(12)}: ${speedupStr}`);
  }

  // Winner summary
  console.log("\nWins by file size:");
  console.log("─".repeat(40));

  const fileGroups = new Map<string, BenchmarkResult[]>();
  for (const r of allResults) {
    if (!fileGroups.has(r.file)) {
      fileGroups.set(r.file, []);
    }
    fileGroups.get(r.file)!.push(r);
  }

  for (const [file, results] of fileGroups) {
    results.sort((a, b) => b.throughputMBs - a.throughputMBs);
    const winner = results[0];
    const winnerColor = winner.library === "TurboCSV" ? "\x1b[32m" : "\x1b[33m";
    console.log(`  ${file.padEnd(25)}: ${winnerColor}${winner.library}\x1b[0m (${winner.throughputMBs.toFixed(1)} MB/s)`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("Benchmark complete!");
}

main().catch(console.error);
