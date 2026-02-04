/**
 * stats command - Show column statistics
 */

import { CSVParser } from "../../ts/parser";
import { formatOutput, printSummary } from "../index";

interface StatsOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
}

interface ColumnStats {
  column: string;
  type: string;
  count: number;
  nullCount: number;
  uniqueCount: number;
  min?: string | number;
  max?: string | number;
  mean?: number;
}

export async function stats(
  filePath: string,
  options: StatsOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  const headers = parser.getHeaders() ?? [];
  const columnStats: Map<string, ColumnStats> = new Map();
  const columnValues: Map<string, Set<string>> = new Map();
  const numericValues: Map<string, number[]> = new Map();

  // Initialize stats
  for (const header of headers) {
    columnStats.set(header, {
      column: header,
      type: "unknown",
      count: 0,
      nullCount: 0,
      uniqueCount: 0,
    });
    columnValues.set(header, new Set());
    numericValues.set(header, []);
  }

  let rowCount = 0;

  for (const row of parser) {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]!;
      const value = row.get(i);
      const stats = columnStats.get(header)!;

      stats.count++;

      if (value === null || value === "") {
        stats.nullCount++;
      } else {
        columnValues.get(header)!.add(value);

        // Try to parse as number
        const num = parseFloat(value);
        if (!isNaN(num)) {
          numericValues.get(header)!.push(num);
        }
      }
    }
    rowCount++;
  }

  parser.close();

  // Compute final stats
  const results: ColumnStats[] = [];

  for (const header of headers) {
    const stats = columnStats.get(header)!;
    const values = columnValues.get(header)!;
    const nums = numericValues.get(header)!;

    stats.uniqueCount = values.size;

    // Determine type
    if (nums.length === stats.count - stats.nullCount && nums.length > 0) {
      stats.type = "number";
      stats.min = Math.min(...nums);
      stats.max = Math.max(...nums);
      stats.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    } else if (values.size <= 10 && stats.count > 100) {
      stats.type = "categorical";
    } else {
      stats.type = "string";
      if (values.size > 0) {
        const sorted = [...values].sort();
        stats.min = sorted[0];
        stats.max = sorted[sorted.length - 1];
      }
    }

    results.push(stats);
  }

  // Output
  console.log(formatOutput(results, options.format));

  // Print summary to stderr
  printSummary(rowCount, startTime, options.fileSize);
}
