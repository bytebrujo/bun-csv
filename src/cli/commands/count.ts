/**
 * count command - Count rows in CSV
 */

import { CSVParser } from "../../ts/parser";
import { printSummary, type ParserFlags } from "../index";

interface CountOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  parserOpts?: ParserFlags;
}

export async function count(
  filePath: string,
  options: CountOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
    ...options.parserOpts,
  });

  let rowCount = 0;

  for (const _row of parser) {
    rowCount++;
  }

  parser.close();

  // Output count
  console.log(rowCount);

  // Print summary to stderr
  printSummary(rowCount, startTime, options.fileSize);
}
