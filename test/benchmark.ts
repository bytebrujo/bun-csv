#!/usr/bin/env bun
/**
 * TurboCSV benchmark runner.
 *
 * This is the target of `bun run benchmark`. It benchmarks TurboCSV itself
 * against generated sample files by default, or against explicit file paths
 * passed on the command line.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { CSVParser } from "../src/ts/parser";
import { generateCSV } from "../src/ts/testing";

const SAMPLES_DIR = join(import.meta.dir, "..", "samples");
const DEFAULT_ITERATIONS = 5;

interface Options {
  iterations: number;
  files: string[];
}

interface RunResult {
  rows: number;
  timeMs: number;
  throughputMBps: number;
}

function parseArgs(argv: string[]): Options {
  const files: string[] = [];
  let iterations = DEFAULT_ITERATIONS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--iterations" || arg === "-i") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      iterations = Number.parseInt(value, 10);
      i++;
    } else if (arg?.startsWith("--iterations=")) {
      iterations = Number.parseInt(arg.slice("--iterations=".length), 10);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg) {
      files.push(arg);
    }
  }

  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error("--iterations must be a positive integer");
  }

  return { iterations, files };
}

function printUsage(): void {
  console.log(`TurboCSV benchmark

Usage:
  bun run benchmark
  bun run benchmark -- --iterations 10
  bun run benchmark -- samples/custom.csv

Options:
  -i, --iterations <n>  Number of measured runs per file (default: ${DEFAULT_ITERATIONS})
`);
}

function ensureBenchmarkFile(name: string, rows: number): string {
  mkdirSync(SAMPLES_DIR, { recursive: true });

  const filePath = join(SAMPLES_DIR, name);
  if (existsSync(filePath)) {
    return filePath;
  }

  const csv = generateCSV({
    rows,
    seed: rows,
    columns: [
      "id:integer",
      "name:name",
      "email:email",
      "city:city",
      "signup_date:date",
      "active:boolean",
      "score:float",
      "department:string",
    ],
  });

  writeFileSync(filePath, csv);
  return filePath;
}

function defaultFiles(): string[] {
  return [
    ensureBenchmarkFile("benchmark-1k.csv", 1_000),
    ensureBenchmarkFile("benchmark-10k.csv", 10_000),
    ensureBenchmarkFile("benchmark-100k.csv", 100_000),
  ];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function parseFile(filePath: string): number {
  const parser = new CSVParser(filePath);
  let rows = 0;

  for (const row of parser) {
    rows++;
    row.get(0);
  }

  parser.close();
  return rows;
}

function benchmarkFile(filePath: string, iterations: number): RunResult[] {
  const fileSize = statSync(filePath).size;
  const fileSizeMB = fileSize / 1024 / 1024;

  // Warm up native library loading and parser setup.
  parseFile(filePath);

  const results: RunResult[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const rows = parseFile(filePath);
    const timeMs = performance.now() - start;

    results.push({
      rows,
      timeMs,
      throughputMBps: fileSizeMB / (timeMs / 1000),
    });
  }

  return results;
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const files = options.files.length > 0 ? options.files : defaultFiles();

  console.log("TurboCSV Benchmark");
  console.log("=".repeat(70));
  console.log(`Iterations: ${options.iterations}`);
  console.log(`SIMD width: ${CSVParser.getSIMDWidth()} bytes`);
  console.log("");

  for (const filePath of files) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileSize = statSync(filePath).size;
    const results = benchmarkFile(filePath, options.iterations);
    const times = results.map((result) => result.timeMs);
    const throughputs = results.map((result) => result.throughputMBps);
    const rows = results[0]?.rows ?? 0;

    console.log(`${basename(filePath)} (${formatSize(fileSize)})`);
    console.log("-".repeat(70));

    for (const [index, result] of results.entries()) {
      console.log(
        `  Run ${String(index + 1).padStart(2)}: ` +
          `${result.timeMs.toFixed(1).padStart(8)} ms  ` +
          `${result.throughputMBps.toFixed(1).padStart(8)} MB/s  ` +
          `${result.rows.toLocaleString()} rows`
      );
    }

    console.log(
      `  Avg:    ${average(times).toFixed(1).padStart(8)} ms  ` +
        `${average(throughputs).toFixed(1).padStart(8)} MB/s`
    );
    console.log(
      `  Median: ${median(times).toFixed(1).padStart(8)} ms  ` +
        `${median(throughputs).toFixed(1).padStart(8)} MB/s`
    );
    console.log(`  Rows:   ${rows.toLocaleString()}`);
    console.log("");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
