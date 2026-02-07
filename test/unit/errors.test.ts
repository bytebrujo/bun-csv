/**
 * Tests for Issue #11: Structured error reporting and error callbacks
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import type { CSVError } from "../../src/ts/errors";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // File with too many fields in some rows
  writeFileSync(
    join(TEST_DIR, "too-many-fields.csv"),
    "name,age\nAlice,30\nBob,25,extra\nCharlie,35\n"
  );

  // File with too few fields in some rows
  writeFileSync(
    join(TEST_DIR, "too-few-fields.csv"),
    "name,age,city\nAlice,30,NYC\nBob\nCharlie,35,Chicago\n"
  );

  // File with mixed errors
  writeFileSync(
    join(TEST_DIR, "mixed-errors.csv"),
    "name,age\nAlice,30\nBob,25,extra1,extra2\nCharlie\nDiana,28\n"
  );

  // Clean file (no errors)
  writeFileSync(
    join(TEST_DIR, "clean.csv"),
    "name,age\nAlice,30\nBob,25\nCharlie,35\n"
  );
});

describe("Error reporting - errors array", () => {
  test("detects TooManyFields errors", () => {
    const parser = new CSVParser(join(TEST_DIR, "too-many-fields.csv"));
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(parser.errors.length).toBe(1);
    expect(parser.errors[0]?.code).toBe("TooManyFields");
    expect(parser.errors[0]?.type).toBe("FieldMismatch");
    expect(parser.errors[0]?.row).toBe(1); // 0-based: Bob's row
    expect(parser.errors[0]?.message).toContain("Expected 2");
    expect(parser.errors[0]?.message).toContain("found 3");
  });

  test("detects TooFewFields errors", () => {
    const parser = new CSVParser(join(TEST_DIR, "too-few-fields.csv"));

    for (const row of parser) {
      row.toArray(); // Use toArray to avoid out-of-bounds on mismatched rows
    }
    parser.close();

    expect(parser.errors.length).toBe(1);
    expect(parser.errors[0]?.code).toBe("TooFewFields");
    expect(parser.errors[0]?.row).toBe(1); // Bob's row
  });

  test("detects multiple errors in one file", () => {
    const parser = new CSVParser(join(TEST_DIR, "mixed-errors.csv"));

    for (const row of parser) {
      // consume all rows
      row.toArray();
    }
    parser.close();

    expect(parser.errors.length).toBe(2);
    expect(parser.errors[0]?.code).toBe("TooManyFields");
    expect(parser.errors[0]?.row).toBe(1);
    expect(parser.errors[1]?.code).toBe("TooFewFields");
    expect(parser.errors[1]?.row).toBe(2);
  });

  test("clean file has no errors", () => {
    const parser = new CSVParser(join(TEST_DIR, "clean.csv"));

    for (const row of parser) {
      row.toObject();
    }
    parser.close();

    expect(parser.errors.length).toBe(0);
  });

  test("errors with buffer input", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\nBob,25,extra\nCharlie,35\n"
    );
    const parser = new CSVParser(data);

    for (const row of parser) {
      row.toArray();
    }
    parser.close();

    expect(parser.errors.length).toBe(1);
    expect(parser.errors[0]?.code).toBe("TooManyFields");
  });
});

describe("Error reporting - onError callback", () => {
  test("onError callback is invoked for each error", () => {
    const collectedErrors: CSVError[] = [];

    const parser = new CSVParser(join(TEST_DIR, "mixed-errors.csv"), {
      onError: (err) => collectedErrors.push(err),
    });

    for (const row of parser) {
      row.toArray();
    }
    parser.close();

    expect(collectedErrors.length).toBe(2);
    expect(collectedErrors[0]?.code).toBe("TooManyFields");
    expect(collectedErrors[1]?.code).toBe("TooFewFields");
  });

  test("onError not called when no errors", () => {
    let called = false;

    const parser = new CSVParser(join(TEST_DIR, "clean.csv"), {
      onError: () => { called = true; },
    });

    for (const row of parser) {
      row.toObject();
    }
    parser.close();

    expect(called).toBe(false);
  });
});

describe("Error reporting - no header mode", () => {
  test("no field mismatch errors when hasHeader=false", () => {
    const data = new TextEncoder().encode(
      "Alice,30\nBob,25,extra\nCharlie\n"
    );
    const parser = new CSVParser(data, { hasHeader: false });

    for (const row of parser) {
      row.toArray();
    }
    parser.close();

    // Without headers, we have no expected field count to compare against
    expect(parser.errors.length).toBe(0);
  });
});
