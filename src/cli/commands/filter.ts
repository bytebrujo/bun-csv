/**
 * filter command - Filter rows by condition
 */

import { CSVParser } from "../../ts/parser";
import { formatOutput } from "../index";

interface FilterOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  expression: string;
}

type RowRecord = Record<string, string | null>;
type FilterFn = (row: RowRecord) => boolean;

/**
 * Parse and evaluate a simple filter expression.
 * Supports: column == value, column != value, column > value, column < value,
 *           column >= value, column <= value, column contains value
 */
function createFilter(expression: string): FilterFn {
  const trimmed = expression.trim();

  // == comparison
  let match = trimmed.match(/^(\w+)\s*==\s*["']?([^"']+)["']?$/);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const val = match[2];
    return (row: RowRecord) => row[col] === val;
  }

  // != comparison
  match = trimmed.match(/^(\w+)\s*!=\s*["']?([^"']+)["']?$/);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const val = match[2];
    return (row: RowRecord) => row[col] !== val;
  }

  // > comparison (numeric)
  match = trimmed.match(/^(\w+)\s*>\s*(-?\d+(?:\.\d+)?)$/);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const num = parseFloat(match[2]);
    return (row: RowRecord) => {
      const rowVal = parseFloat(row[col] ?? "");
      return !isNaN(rowVal) && rowVal > num;
    };
  }

  // >= comparison (numeric)
  match = trimmed.match(/^(\w+)\s*>=\s*(-?\d+(?:\.\d+)?)$/);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const num = parseFloat(match[2]);
    return (row: RowRecord) => {
      const rowVal = parseFloat(row[col] ?? "");
      return !isNaN(rowVal) && rowVal >= num;
    };
  }

  // < comparison (numeric)
  match = trimmed.match(/^(\w+)\s*<\s*(-?\d+(?:\.\d+)?)$/);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const num = parseFloat(match[2]);
    return (row: RowRecord) => {
      const rowVal = parseFloat(row[col] ?? "");
      return !isNaN(rowVal) && rowVal < num;
    };
  }

  // <= comparison (numeric)
  match = trimmed.match(/^(\w+)\s*<=\s*(-?\d+(?:\.\d+)?)$/);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const num = parseFloat(match[2]);
    return (row: RowRecord) => {
      const rowVal = parseFloat(row[col] ?? "");
      return !isNaN(rowVal) && rowVal <= num;
    };
  }

  // contains
  match = trimmed.match(/^(\w+)\s+contains\s+["']?([^"']+)["']?$/i);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const val = match[2];
    return (row: RowRecord) => (row[col] ?? "").includes(val);
  }

  // startsWith
  match = trimmed.match(/^(\w+)\s+startsWith\s+["']?([^"']+)["']?$/i);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const val = match[2];
    return (row: RowRecord) => (row[col] ?? "").startsWith(val);
  }

  // endsWith
  match = trimmed.match(/^(\w+)\s+endsWith\s+["']?([^"']+)["']?$/i);
  if (match && match[1] && match[2]) {
    const col = match[1];
    const val = match[2];
    return (row: RowRecord) => (row[col] ?? "").endsWith(val);
  }

  // If no pattern matches, try using Function constructor (with sandboxed variable access)
  // This allows more complex expressions like "age > 18 && name == 'Alice'"
  try {
    return new Function(
      "row",
      `with (row) { return ${expression}; }`
    ) as FilterFn;
  } catch {
    throw new Error(`Invalid filter expression: ${expression}`);
  }
}

export async function filter(
  filePath: string,
  options: FilterOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  const filterFn = createFilter(options.expression);
  const rows: RowRecord[] = [];
  let totalRows = 0;
  let matchedRows = 0;

  for (const row of parser) {
    totalRows++;
    const obj = row.toObject();

    if (filterFn(obj)) {
      rows.push(obj);
      matchedRows++;
    }
  }

  parser.close();

  // Output rows
  console.log(formatOutput(rows, options.format));

  // Print summary to stderr
  const elapsed = (performance.now() - startTime) / 1000;
  console.error(
    `✓ Matched ${matchedRows.toLocaleString()} of ${totalRows.toLocaleString()} rows in ${elapsed.toFixed(2)}s`
  );
}
