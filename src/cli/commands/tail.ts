/**
 * tail command - Show last N rows
 */

import { CSVParser } from "../../ts/parser";
import { formatOutput, printSummary } from "../index";

interface TailOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  n: number;
}

export async function tail(
  filePath: string,
  options: TailOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  // Buffer the last N rows using a circular buffer approach
  const buffer: Record<string, string | null>[] = [];
  let totalRows = 0;

  for (const row of parser) {
    if (buffer.length >= options.n) {
      buffer.shift();
    }
    buffer.push(row.toObject());
    totalRows++;
  }

  parser.close();

  // Output rows
  console.log(formatOutput(buffer, options.format));

  // Print summary to stderr
  printSummary(totalRows, startTime, options.fileSize);
}
