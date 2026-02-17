/**
 * validate command - Check CSV validity
 */

import { CSVParser } from "../../ts/parser";
import { printSummary, type ParserFlags } from "../index";

interface ValidateOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  parserOpts?: ParserFlags;
}

export async function validate(
  filePath: string,
  options: ValidateOptions
): Promise<void> {
  const startTime = performance.now();

  // Validate uses the parser's own error collection
  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
    ...options.parserOpts,
  });

  const headers = parser.getHeaders();
  const columnCount = headers ? headers.length : 0;
  let rowCount = 0;

  for (const _row of parser) {
    rowCount++;
  }

  const parserErrors = parser.errors;
  parser.close();

  // Output results
  if (parserErrors.length === 0) {
    console.log("✓ CSV is valid");
  } else {
    console.log(`✗ CSV has ${parserErrors.length} issue(s):`);
    for (const error of parserErrors.slice(0, 10)) {
      console.log(`  Row ${error.row}: [${error.type}/${error.code}] ${error.message}`);
    }
    if (parserErrors.length > 10) {
      console.log(`  ... and ${parserErrors.length - 10} more`);
    }
  }

  console.log(`\nRows: ${rowCount.toLocaleString()}`);
  console.log(`Columns: ${columnCount}`);

  if (headers) {
    console.log(`Headers: ${headers.join(", ")}`);
  }

  // Print summary to stderr
  printSummary(rowCount, startTime, options.fileSize);

  if (parserErrors.length > 0) {
    process.exit(1);
  }
}
