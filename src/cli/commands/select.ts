/**
 * select command - Select specific columns
 */

import { CSVParser } from "../../ts/parser";
import { formatOutput, printSummary } from "../index";

interface SelectOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  columns: string;
}

export async function select(
  filePath: string,
  options: SelectOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  // Parse column specification (can be names or indices)
  const columnSpec = options.columns.split(",").map((c) => c.trim());
  const headers = parser.getHeaders();

  // Resolve column names/indices
  const resolvedColumns = columnSpec.map((spec) => {
    // Check if it's a numeric index
    const index = parseInt(spec, 10);
    if (!isNaN(index) && headers) {
      return headers[index] ?? spec;
    }
    return spec;
  });

  const rows: Record<string, string | null>[] = [];
  let rowCount = 0;

  for (const row of parser) {
    const selectedRow: Record<string, string | null> = {};

    for (const col of resolvedColumns) {
      selectedRow[col] = row.get(col);
    }

    rows.push(selectedRow);
    rowCount++;
  }

  parser.close();

  // Output rows
  console.log(formatOutput(rows, options.format));

  // Print summary to stderr
  printSummary(rowCount, startTime, options.fileSize);
}
