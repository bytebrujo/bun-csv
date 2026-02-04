/**
 * validate command - Check CSV validity
 */

import { CSVParser } from "../../ts/parser";
import { printSummary } from "../index";

interface ValidateOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
}

interface ValidationResult {
  valid: boolean;
  rowCount: number;
  columnCount: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  line: number;
  message: string;
}

interface ValidationWarning {
  line: number;
  message: string;
}

export async function validate(
  filePath: string,
  options: ValidateOptions
): Promise<void> {
  const startTime = performance.now();

  const parser = new CSVParser(filePath, {
    delimiter: options.delimiter,
    hasHeader: options.hasHeader,
  });

  const result: ValidationResult = {
    valid: true,
    rowCount: 0,
    columnCount: 0,
    errors: [],
    warnings: [],
  };

  let expectedColumns: number | null = null;
  let lineNumber = options.hasHeader ? 2 : 1;

  for (const row of parser) {
    const fieldCount = row.length;

    // Set expected columns from first row
    if (expectedColumns === null) {
      expectedColumns = fieldCount;
      result.columnCount = fieldCount;
    }

    // Check column count consistency
    if (fieldCount !== expectedColumns) {
      result.warnings.push({
        line: lineNumber,
        message: `Expected ${expectedColumns} columns, found ${fieldCount}`,
      });
    }

    result.rowCount++;
    lineNumber++;
  }

  parser.close();

  // Output results
  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log("✓ CSV is valid");
  } else {
    if (result.errors.length > 0) {
      console.log("✗ CSV has errors:");
      for (const error of result.errors) {
        console.log(`  Line ${error.line}: ${error.message}`);
      }
      result.valid = false;
    }

    if (result.warnings.length > 0) {
      console.log("⚠ Warnings:");
      for (const warning of result.warnings.slice(0, 10)) {
        console.log(`  Line ${warning.line}: ${warning.message}`);
      }
      if (result.warnings.length > 10) {
        console.log(`  ... and ${result.warnings.length - 10} more`);
      }
    }
  }

  console.log(`\nRows: ${result.rowCount.toLocaleString()}`);
  console.log(`Columns: ${result.columnCount}`);

  // Print summary to stderr
  printSummary(result.rowCount, startTime, options.fileSize);

  if (!result.valid) {
    process.exit(1);
  }
}
