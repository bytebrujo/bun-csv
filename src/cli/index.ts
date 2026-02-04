#!/usr/bin/env bun
/**
 * TurboCSV CLI
 */

import { parseArgs } from "util";
import { existsSync, statSync } from "fs";
import { count } from "./commands/count";
import { head } from "./commands/head";
import { tail } from "./commands/tail";
import { select } from "./commands/select";
import { filter } from "./commands/filter";
import { sort } from "./commands/sort";
import { convert } from "./commands/convert";
import { benchmark } from "./commands/benchmark";
import { completions } from "./commands/completions";
import { validate } from "./commands/validate";
import { stats } from "./commands/stats";
import { loadConfig, mergeConfig } from "./config";

const HELP = `
turbocsv - High-performance CSV parser

Usage: turbocsv <command> [options] [file]

Commands:
  count       Count rows in CSV file
  head        Show first N rows
  tail        Show last N rows
  select      Select specific columns
  filter      Filter rows by condition
  sort        Sort rows by column
  convert     Convert between formats
  validate    Check CSV validity
  stats       Show column statistics
  benchmark   Measure parsing performance

Options:
  -h, --help       Show this help message
  -v, --version    Show version
  -d, --delimiter  Field delimiter (default: auto-detect)
  -e, --encoding   File encoding (default: auto-detect)
  --no-header      File has no header row
  --format         Output format: table, csv, json (default: auto)
  --color          Force colored output
  --no-color       Disable colored output

Examples:
  turbocsv count data.csv
  turbocsv head -n 10 data.csv
  turbocsv select name,age data.csv
  turbocsv filter "age > 18" data.csv
  turbocsv sort -c age --desc data.csv
  cat data.csv | turbocsv count
`;

const VERSION = "0.1.0";

/** Check if output is TTY for auto-formatting */
function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}

/** Format output based on mode */
export function formatOutput(
  data: unknown[],
  format: "auto" | "table" | "csv" | "json"
): string {
  const actualFormat = format === "auto" ? (isTTY() ? "table" : "csv") : format;

  switch (actualFormat) {
    case "json":
      return JSON.stringify(data, null, 2);

    case "csv":
      if (data.length === 0) return "";
      const headers = Object.keys(data[0] as object);
      const lines = [
        headers.join(","),
        ...data.map((row) =>
          headers.map((h) => formatCSVField((row as Record<string, unknown>)[h])).join(",")
        ),
      ];
      return lines.join("\n");

    case "table":
    default:
      return formatTable(data);
  }
}

/** Format a field for CSV output */
function formatCSVField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Format data as ASCII table */
function formatTable(data: unknown[]): string {
  if (data.length === 0) return "(empty)";

  const headers = Object.keys(data[0] as object);

  // Calculate column widths
  const widths = headers.map((h) => {
    const values = data.map((row) => String((row as Record<string, unknown>)[h] ?? ""));
    return Math.max(h.length, ...values.map((v) => v.length));
  });

  // Build table
  const lines: string[] = [];

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join(" | ");
  lines.push(headerLine);
  lines.push(widths.map((w) => "-".repeat(w)).join("-+-"));

  // Rows
  for (const row of data) {
    const line = headers
      .map((h, i) =>
        String((row as Record<string, unknown>)[h] ?? "").padEnd(widths[i] ?? 0)
      )
      .join(" | ");
    lines.push(line);
  }

  return lines.join("\n");
}

/** Print summary stats after operation */
export function printSummary(
  rowCount: number,
  startTime: number,
  fileSize?: number
): void {
  const elapsed = (performance.now() - startTime) / 1000;
  const throughput = fileSize ? (fileSize / 1024 / 1024 / elapsed).toFixed(1) : null;

  let message = `✓ Processed ${rowCount.toLocaleString()} rows in ${elapsed.toFixed(2)}s`;
  if (throughput) {
    message += ` (${throughput} MB/s)`;
  }

  console.error(message);
}

/** Main CLI entry point */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      delimiter: { type: "string", short: "d" },
      encoding: { type: "string", short: "e" },
      "no-header": { type: "boolean" },
      format: { type: "string" },
      color: { type: "boolean" },
      "no-color": { type: "boolean" },
      number: { type: "string", short: "n" },
      column: { type: "string", short: "c" },
      desc: { type: "boolean" },
      to: { type: "string" },
      output: { type: "string", short: "o" },
      iterations: { type: "string" },
    },
    allowPositionals: true,
  });

  // Handle global flags (version first, since help triggers on empty positionals)
  if (values.version) {
    console.log(`turbocsv v${VERSION}`);
    process.exit(0);
  }

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = positionals[0];

  // Handle completions command (no file required)
  if (command === "completions") {
    const shell = positionals[1];
    if (!shell) {
      console.error("Usage: turbocsv completions <bash|zsh|fish>");
      process.exit(1);
    }
    completions(shell);
    process.exit(0);
  }

  // Load config file
  const { config: fileConfig, path: configPath } = loadConfig();
  if (configPath && process.env.TURBOCSV_DEBUG) {
    console.error(`Loaded config from: ${configPath}`);
  }

  // Determine file path (may be positional[1] or positional[2] for select/filter)
  let filePath: string | undefined;
  let extraArg: string | undefined;

  if (command === "select" || command === "filter") {
    // select <columns> <file> or filter <expression> <file>
    extraArg = positionals[1];
    filePath = positionals[2];
  } else {
    filePath = positionals[1];
  }

  // Validate file exists
  if (filePath && !existsSync(filePath) && filePath !== "-") {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const fileSize = filePath && filePath !== "-" ? statSync(filePath).size : undefined;

  // Merge config sources: CLI > env > file config
  const mergedConfig = mergeConfig(
    {
      delimiter: values.delimiter,
      encoding: values.encoding,
      hasHeader: values["no-header"] ? false : undefined,
      format: values.format as "table" | "csv" | "json" | undefined,
    },
    fileConfig
  );

  // Common options
  const options = {
    delimiter: mergedConfig.delimiter,
    encoding: mergedConfig.encoding,
    hasHeader: mergedConfig.hasHeader ?? true,
    format: (mergedConfig.format ?? "auto") as "auto" | "table" | "csv" | "json",
    fileSize,
  };

  try {
    switch (command) {
      case "count":
        await count(filePath ?? "-", options);
        break;

      case "head":
        await head(filePath ?? "-", {
          ...options,
          n: parseInt(values.number ?? "10", 10),
        });
        break;

      case "tail":
        await tail(filePath ?? "-", {
          ...options,
          n: parseInt(values.number ?? "10", 10),
        });
        break;

      case "select":
        if (!extraArg) {
          console.error("Usage: turbocsv select <columns> <file>");
          console.error("Example: turbocsv select name,age,city data.csv");
          process.exit(1);
        }
        await select(filePath ?? "-", {
          ...options,
          columns: extraArg,
        });
        break;

      case "filter":
        if (!extraArg) {
          console.error("Usage: turbocsv filter <expression> <file>");
          console.error('Example: turbocsv filter "age > 18" data.csv');
          process.exit(1);
        }
        await filter(filePath ?? "-", {
          ...options,
          expression: extraArg,
        });
        break;

      case "sort":
        if (!values.column) {
          console.error("Usage: turbocsv sort -c <column> [--desc] <file>");
          console.error("Example: turbocsv sort -c age --desc data.csv");
          process.exit(1);
        }
        await sort(filePath ?? "-", {
          ...options,
          column: values.column,
          desc: values.desc ?? false,
        });
        break;

      case "convert":
        if (!values.to) {
          console.error("Usage: turbocsv convert --to <format> [--output <file>] <file>");
          console.error("Example: turbocsv convert --to json data.csv");
          process.exit(1);
        }
        await convert(filePath ?? "-", {
          ...options,
          to: values.to,
          output: values.output,
        });
        break;

      case "benchmark":
        if (!filePath || filePath === "-") {
          console.error("Benchmark requires a file path (stdin not supported)");
          process.exit(1);
        }
        await benchmark(filePath, {
          ...options,
          iterations: values.iterations ? parseInt(values.iterations, 10) : undefined,
        });
        break;

      case "validate":
        await validate(filePath ?? "-", options);
        break;

      case "stats":
        await stats(filePath ?? "-", options);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main().catch(console.error);
