/**
 * head command - Show first N rows
 */

import { CSVParser } from "../../ts/parser";
import { formatOutput, printSummary } from "../index";

interface HeadOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  n: number;
}

export async function head(
  filePath: string,
  options: HeadOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  const rows: Record<string, string | null>[] = [];
  let rowCount = 0;

  for (const row of parser) {
    if (rowCount >= options.n) break;
    rows.push(row.toObject());
    rowCount++;
  }

  parser.close();

  // Output rows
  console.log(formatOutput(rows, options.format));

  // Print summary to stderr
  printSummary(rowCount, startTime, options.fileSize);
}
