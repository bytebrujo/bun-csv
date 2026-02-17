/**
 * Tests for Phase 1 features:
 * - escapeFormulae (CSV injection protection)
 * - Expanded error codes
 * - skipRecordsWithError / skipRecordsWithEmptyValues / maxRecordSize
 * - relaxColumnCount / relaxColumnCountLess / relaxColumnCountMore
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { unparse } from "../../src/ts/unparse";
import { CSVWriter } from "../../src/ts/writer";
import { createCSVError } from "../../src/ts/errors";
import type { CSVError } from "../../src/ts/errors";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");
const OUTPUT_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // File with too many fields
  writeFileSync(
    join(TEST_DIR, "p1-too-many.csv"),
    "name,age\nAlice,30\nBob,25,extra\nCharlie,35\n"
  );

  // File with too few fields
  writeFileSync(
    join(TEST_DIR, "p1-too-few.csv"),
    "name,age,city\nAlice,30,NYC\nBob\nCharlie,35,Chicago\n"
  );

  // File with mixed mismatch
  writeFileSync(
    join(TEST_DIR, "p1-mixed-mismatch.csv"),
    "name,age\nAlice,30\nBob,25,extra1,extra2\nCharlie\nDiana,28\n"
  );

  // File with large row
  const longValue = "x".repeat(200);
  writeFileSync(
    join(TEST_DIR, "p1-large-row.csv"),
    `name,data\nAlice,short\nBob,${longValue}\nCharlie,tiny\n`
  );

  // File with empty value rows
  writeFileSync(
    join(TEST_DIR, "p1-empty-values.csv"),
    "name,age,city\nAlice,30,NYC\n,,\nBob,25,LA\n,,\n"
  );
});

// ==========================================================================
// escapeFormulae - unparse()
// ==========================================================================

describe("escapeFormulae - unparse()", () => {
  test("escapes formula starting with =", () => {
    const result = unparse(
      [["name", "formula"], ["Alice", "=SUM(A1:A10)"]],
      { escapeFormulae: true }
    );
    expect(result).toContain("'=SUM(A1:A10)");
  });

  test("escapes formula starting with +", () => {
    const result = unparse(
      [["val"], ["+cmd|'/C calc'!A0"]],
      { escapeFormulae: true }
    );
    expect(result).toContain("'+cmd|'/C calc'!A0");
  });

  test("escapes formula starting with -", () => {
    const result = unparse(
      [["val"], ["-1+1"]],
      { escapeFormulae: true }
    );
    expect(result).toContain("'-1+1");
  });

  test("escapes formula starting with @", () => {
    const result = unparse(
      [["val"], ["@SUM(A1)"]],
      { escapeFormulae: true }
    );
    expect(result).toContain("'@SUM(A1)");
  });

  test("escapes formula starting with tab", () => {
    const result = unparse(
      [["val"], ["\tcmd"]],
      { escapeFormulae: true }
    );
    expect(result).toContain("'\tcmd");
  });

  test("escapes formula starting with carriage return", () => {
    const result = unparse(
      [["val"], ["\rcmd"]],
      { escapeFormulae: true }
    );
    expect(result).toContain("'\rcmd");
  });

  test("does not escape normal values", () => {
    const result = unparse(
      [["name", "age"], ["Alice", "30"]],
      { escapeFormulae: true }
    );
    expect(result).toBe("name,age\r\nAlice,30");
  });

  test("does not escape when disabled (default)", () => {
    const result = unparse(
      [["val"], ["=SUM(A1:A10)"]],
    );
    // Should not have the leading quote
    expect(result).not.toContain("'=SUM");
  });

  test("supports custom RegExp pattern", () => {
    const result = unparse(
      [["val"], ["DANGEROUS_VALUE"], ["safe"]],
      { escapeFormulae: /^DANGEROUS/ }
    );
    expect(result).toContain("'DANGEROUS_VALUE");
    expect(result).toContain("\r\nsafe");
  });

  test("escapes header values too", () => {
    const result = unparse(
      [{ "=evil_header": "value" }],
      { escapeFormulae: true }
    );
    expect(result).toContain("'=evil_header");
  });

  test("empty string is not escaped", () => {
    const result = unparse(
      [["val"], [""]],
      { escapeFormulae: true }
    );
    // Empty string stays empty
    expect(result).toBe("val\r\n");
  });
});

// ==========================================================================
// escapeFormulae - CSVWriter
// ==========================================================================

describe("escapeFormulae - CSVWriter", () => {
  test("escapes formula values when writing", () => {
    const outPath = join(OUTPUT_DIR, "p1-writer-escape.csv");
    const writer = new CSVWriter(outPath, { escapeFormulae: true });
    writer.writeRow(["name", "formula"]);
    writer.writeRow(["Alice", "=SUM(A1:A10)"]);
    writer.writeRow(["Bob", "+cmd"]);
    writer.writeRow(["Charlie", "normal"]);
    writer.close();

    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("'=SUM(A1:A10)");
    expect(content).toContain("'+cmd");
    expect(content).toContain("normal");
    expect(content).not.toContain("'normal");

    unlinkSync(outPath);
  });

  test("supports custom RegExp in writer", () => {
    const outPath = join(OUTPUT_DIR, "p1-writer-regex.csv");
    const writer = new CSVWriter(outPath, { escapeFormulae: /^(EXEC|RUN)/ });
    writer.writeRow(["cmd"]);
    writer.writeRow(["EXEC something"]);
    writer.writeRow(["RUN cmd"]);
    writer.writeRow(["normal"]);
    writer.close();

    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("'EXEC something");
    expect(content).toContain("'RUN cmd");
    expect(content).not.toContain("'normal");

    unlinkSync(outPath);
  });
});

// ==========================================================================
// Expanded error codes
// ==========================================================================

describe("Expanded error codes", () => {
  test("createCSVError helper creates proper error objects", () => {
    const error = createCSVError(
      "FieldMismatch",
      "TooManyFields",
      "Expected 2 fields but found 3",
      5,
      { column: 2 }
    );

    expect(error.type).toBe("FieldMismatch");
    expect(error.code).toBe("TooManyFields");
    expect(error.message).toBe("Expected 2 fields but found 3");
    expect(error.row).toBe(5);
    expect(error.column).toBe(2);
  });

  test("createCSVError without optional fields", () => {
    const error = createCSVError(
      "RecordSize",
      "MaxRecordSize",
      "Record too large",
      10,
    );

    expect(error.type).toBe("RecordSize");
    expect(error.code).toBe("MaxRecordSize");
    expect(error.index).toBeUndefined();
    expect(error.column).toBeUndefined();
  });

  test("error codes include all new types", () => {
    // Verify the type system accepts all new codes
    const errors: CSVError[] = [
      createCSVError("Quotes", "QuoteNotClosed", "msg", 0),
      createCSVError("Quotes", "InvalidClosingQuote", "msg", 0),
      createCSVError("Quotes", "NonTrimableCharAfterClosingQuote", "msg", 0),
      createCSVError("Delimiter", "InvalidDelimiter", "msg", 0),
      createCSVError("FieldMismatch", "InvalidColumnCount", "msg", 0),
      createCSVError("InvalidArgument", "InvalidArgument", "msg", 0),
      createCSVError("InvalidArgument", "InvalidOption", "msg", 0),
      createCSVError("InvalidArgument", "InvalidColumnHeader", "msg", 0),
      createCSVError("RecordSize", "MaxRecordSize", "msg", 0),
      createCSVError("Validation", "InvalidCast", "msg", 0),
      createCSVError("Validation", "ConstraintViolation", "msg", 0),
    ];

    expect(errors.length).toBe(11);
    // All should be valid CSVError objects
    for (const err of errors) {
      expect(err.type).toBeDefined();
      expect(err.code).toBeDefined();
      expect(err.message).toBe("msg");
    }
  });
});

// ==========================================================================
// skipRecordsWithError
// ==========================================================================

describe("skipRecordsWithError", () => {
  test("skips rows with field mismatch errors when enabled", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"), {
      skipRecordsWithError: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Should only get rows that match header count (Alice, Diana)
    // Bob has extra fields, Charlie has too few
    expect(rows.length).toBe(2);
    expect(rows[0]!.name).toBe("Alice");
    expect(rows[1]!.name).toBe("Diana");

    // Errors should still be recorded
    expect(parser.errors.length).toBe(2);
  });

  test("does not skip rows when disabled (default)", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"));
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // All 4 rows should be yielded
    expect(rows.length).toBe(4);
    // Errors still recorded
    expect(parser.errors.length).toBe(2);
  });
});

// ==========================================================================
// skipRecordsWithEmptyValues
// ==========================================================================

describe("skipRecordsWithEmptyValues", () => {
  test("skips rows where all values are empty", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-empty-values.csv"), {
      skipRecordsWithEmptyValues: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Should skip the empty rows (,,)
    expect(rows.length).toBe(2);
    expect(rows[0]!.name).toBe("Alice");
    expect(rows[1]!.name).toBe("Bob");
  });

  test("does not skip rows when disabled (default)", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-empty-values.csv"));
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // All rows yielded (but skipEmptyRows default may handle completely empty lines)
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

// ==========================================================================
// maxRecordSize
// ==========================================================================

describe("maxRecordSize", () => {
  test("records error for oversized rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-large-row.csv"), {
      maxRecordSize: 50,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // All rows yielded (skipRecordsWithError is false by default)
    expect(rows.length).toBe(3);

    // Should have one MaxRecordSize error for the long row
    const sizeErrors = parser.errors.filter(e => e.code === "MaxRecordSize");
    expect(sizeErrors.length).toBe(1);
    expect(sizeErrors[0]!.type).toBe("RecordSize");
  });

  test("skips oversized rows when skipRecordsWithError is true", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-large-row.csv"), {
      maxRecordSize: 50,
      skipRecordsWithError: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Bob's row should be skipped
    expect(rows.length).toBe(2);
    expect(rows[0]!.name).toBe("Alice");
    expect(rows[1]!.name).toBe("Charlie");

    // Error still recorded
    const sizeErrors = parser.errors.filter(e => e.code === "MaxRecordSize");
    expect(sizeErrors.length).toBe(1);
  });

  test("no error when maxRecordSize is 0 (unlimited)", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-large-row.csv"), {
      maxRecordSize: 0,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(parser.errors.length).toBe(0);
  });
});

// ==========================================================================
// relaxColumnCount
// ==========================================================================

describe("relaxColumnCount", () => {
  test("suppresses both TooMany and TooFew errors", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"), {
      relaxColumnCount: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // All rows yielded
    expect(rows.length).toBe(4);
    // No errors recorded
    expect(parser.errors.length).toBe(0);
  });
});

describe("relaxColumnCountLess", () => {
  test("suppresses TooFewFields but not TooManyFields", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"), {
      relaxColumnCountLess: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // All rows yielded (no skipping, just error suppression)
    expect(rows.length).toBe(4);

    // Only TooManyFields errors should remain
    expect(parser.errors.every(e => e.code === "TooManyFields")).toBe(true);
    expect(parser.errors.length).toBe(1); // Bob's row
  });
});

describe("relaxColumnCountMore", () => {
  test("suppresses TooManyFields but not TooFewFields", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"), {
      relaxColumnCountMore: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // All rows yielded
    expect(rows.length).toBe(4);

    // Only TooFewFields errors should remain
    expect(parser.errors.every(e => e.code === "TooFewFields")).toBe(true);
    expect(parser.errors.length).toBe(1); // Charlie's row
  });
});

describe("relaxColumnCount + skipRecordsWithError interaction", () => {
  test("relaxColumnCountMore + skipRecordsWithError skips only too-few rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"), {
      relaxColumnCountMore: true,
      skipRecordsWithError: true,
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Charlie (too few) should be skipped, Bob (too many) should be kept
    expect(rows.length).toBe(3);
    const names = rows.map(r => r.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).toContain("Diana");
    expect(names).not.toContain("Charlie");
  });
});

// ==========================================================================
// Combined features
// ==========================================================================

describe("Combined Phase 1 features", () => {
  test("onError callback fires for all error types", () => {
    const errors: CSVError[] = [];
    const parser = new CSVParser(join(TEST_DIR, "p1-mixed-mismatch.csv"), {
      maxRecordSize: 50,
      onError: (err) => errors.push(err),
    });

    for (const _row of parser) {
      // consume all rows
    }
    parser.close();

    // Should have field mismatch errors
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.code === "TooManyFields" || e.code === "TooFewFields")).toBe(true);
  });
});
