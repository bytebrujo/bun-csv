/**
 * Tests for Issue #2: Wire existing Zig config options through FFI
 * Tests: delimiter, escapeChar, skipEmptyRows passing through FFI
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // Tab-delimited file
  writeFileSync(
    join(TEST_DIR, "tab-delimited.csv"),
    "name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA\n"
  );

  // Pipe-delimited file
  writeFileSync(
    join(TEST_DIR, "pipe-delimited.csv"),
    "name|age|city\nAlice|30|NYC\nBob|25|LA\n"
  );

  // Semicolon-delimited file
  writeFileSync(
    join(TEST_DIR, "semicolon-delimited.csv"),
    "name;age;city\nAlice;30;NYC\nBob;25;LA\n"
  );

  // File with empty rows
  writeFileSync(
    join(TEST_DIR, "empty-rows.csv"),
    "name,age,city\nAlice,30,NYC\n\n\nBob,25,LA\n\nCharlie,35,Chicago\n"
  );

  // File that is only empty rows
  writeFileSync(
    join(TEST_DIR, "all-empty-rows.csv"),
    "name,age\n\n\n\n"
  );

  // File with custom escape char (backslash-escaped quotes)
  writeFileSync(
    join(TEST_DIR, "custom-escape.csv"),
    'name,note\nAlice,"says \\"hello\\""\nBob,normal\n'
  );
});

describe("Custom delimiter", () => {
  test("parses tab-delimited file", () => {
    const parser = new CSVParser(join(TEST_DIR, "tab-delimited.csv"), {
      delimiter: "\t",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[0]?.city).toBe("NYC");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("parses pipe-delimited file", () => {
    const parser = new CSVParser(join(TEST_DIR, "pipe-delimited.csv"), {
      delimiter: "|",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });

  test("parses semicolon-delimited file", () => {
    const parser = new CSVParser(join(TEST_DIR, "semicolon-delimited.csv"), {
      delimiter: ";",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.city).toBe("LA");
  });

  test("delimiter works with buffer input", () => {
    const data = new TextEncoder().encode(
      "name\tage\nAlice\t30\nBob\t25\n"
    );
    const parser = new CSVParser(data, { delimiter: "\t" });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });
});

describe("Skip empty rows", () => {
  test("skips empty rows by default", () => {
    const parser = new CSVParser(join(TEST_DIR, "empty-rows.csv"));
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
    expect(rows[2]?.name).toBe("Charlie");
  });

  test("includes empty rows when skipEmptyRows is false", () => {
    const parser = new CSVParser(join(TEST_DIR, "empty-rows.csv"), {
      skipEmptyRows: false,
    });
    let rowCount = 0;

    for (const row of parser) {
      rowCount++;
    }
    parser.close();

    // Should include the empty rows now (3 data + 3 empty = 6)
    expect(rowCount).toBeGreaterThan(3);
  });

  test("handles file with only empty rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "all-empty-rows.csv"));
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(0);
  });

  test("skipEmptyRows works with buffer input", () => {
    const data = new TextEncoder().encode("a,b\n1,2\n\n3,4\n");
    const parser = new CSVParser(data, { skipEmptyRows: true });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.a).toBe("1");
    expect(rows[1]?.a).toBe("3");
  });
});

describe("Escape character", () => {
  test("accepts escapeChar option without error", () => {
    const parser = new CSVParser(join(TEST_DIR, "tab-delimited.csv"), {
      delimiter: "\t",
      escapeChar: '"',
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
  });

  test("defaults escapeChar to quoteChar", () => {
    const parser = new CSVParser(join(TEST_DIR, "tab-delimited.csv"), {
      delimiter: "\t",
      quoteChar: "'",
    });

    // Should not throw - escapeChar defaults to quoteChar ("'")
    const rows: Record<string, string | null>[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
  });
});

describe("Combined config options", () => {
  test("delimiter + skipEmptyRows together", () => {
    const data = new TextEncoder().encode(
      "name\tage\nAlice\t30\n\nBob\t25\n"
    );
    const parser = new CSVParser(data, {
      delimiter: "\t",
      skipEmptyRows: true,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("hasHeader=false returns all rows as arrays", () => {
    const data = new TextEncoder().encode("Alice,30,NYC\nBob,25,LA\n");
    const parser = new CSVParser(data, { hasHeader: false });

    const rows: (string | null)[][] = [];
    for (const row of parser) {
      rows.push(row.toArray());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.[0]).toBe("Alice");
    expect(rows[0]?.[1]).toBe("30");
  });
});
