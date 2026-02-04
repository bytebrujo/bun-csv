/**
 * convert command - Convert between formats (CSV, TSV, JSON)
 */

import { CSVParser } from "../../ts/parser";
import { printSummary } from "../index";

interface ConvertOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  to: string;
  output?: string;
}

export async function convert(
  filePath: string,
  options: ConvertOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  const targetFormat = options.to.toLowerCase();
  const rows: Record<string, string | null>[] = [];
  let rowCount = 0;

  for (const row of parser) {
    rows.push(row.toObject());
    rowCount++;
  }

  const headers = parser.getHeaders() ?? Object.keys(rows[0] ?? {});
  parser.close();

  let output: string;

  switch (targetFormat) {
    case "json":
      output = JSON.stringify(rows, null, 2);
      break;

    case "jsonl":
    case "ndjson":
      output = rows.map((row) => JSON.stringify(row)).join("\n");
      break;

    case "tsv":
      const tsvLines = [
        headers.join("\t"),
        ...rows.map((row) =>
          headers.map((h) => formatTSVField(row[h] ?? null)).join("\t")
        ),
      ];
      output = tsvLines.join("\n");
      break;

    case "csv":
      const csvLines = [
        headers.join(","),
        ...rows.map((row) =>
          headers.map((h) => formatCSVField(row[h] ?? null)).join(",")
        ),
      ];
      output = csvLines.join("\n");
      break;

    default:
      throw new Error(
        `Unknown format: ${targetFormat}. Supported: csv, tsv, json, jsonl`
      );
  }

  // Write to file or stdout
  if (options.output) {
    await Bun.write(options.output, output);
    console.error(`✓ Written to: ${options.output}`);
  } else {
    console.log(output);
  }

  // Print summary to stderr
  printSummary(rowCount, startTime, options.fileSize);
}

/** Format a field for CSV output */
function formatCSVField(value: string | null): string {
  if (value === null) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Format a field for TSV output (escape tabs and newlines) */
function formatTSVField(value: string | null): string {
  if (value === null) return "";
  return value.replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}
