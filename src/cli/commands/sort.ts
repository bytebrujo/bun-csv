/**
 * sort command - Sort rows by column
 */

import { CSVParser } from "../../ts/parser";
import { formatOutput, printSummary } from "../index";

interface SortOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  column: string;
  desc: boolean;
}

export async function sort(
  filePath: string,
  options: SortOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  // Load all rows into DataFrame for sorting
  const df = parser.toDataFrame();

  // Sort by specified column
  const sortOrder = options.desc ? "desc" : "asc";
  const sorted = df.sorted(options.column as keyof Record<string, string>, sortOrder);

  // Convert to output format
  const rows: Record<string, string | null>[] = [];
  for (const row of sorted) {
    rows.push(row as Record<string, string | null>);
  }

  parser.close();

  // Output rows
  console.log(formatOutput(rows, options.format));

  // Print summary to stderr
  printSummary(rows.length, startTime, options.fileSize);
}
