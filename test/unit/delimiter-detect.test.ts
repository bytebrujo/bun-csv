/**
 * Tests for Issue #3: Delimiter auto-detection
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  writeFileSync(
    join(TEST_DIR, "auto-comma.csv"),
    "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago\n"
  );

  writeFileSync(
    join(TEST_DIR, "auto-tab.csv"),
    "name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA\nCharlie\t35\tChicago\n"
  );

  writeFileSync(
    join(TEST_DIR, "auto-pipe.csv"),
    "name|age|city\nAlice|30|NYC\nBob|25|LA\nCharlie|35|Chicago\n"
  );

  writeFileSync(
    join(TEST_DIR, "auto-semicolon.csv"),
    "name;age;city\nAlice;30;NYC\nBob;25;LA\nCharlie;35;Chicago\n"
  );

  writeFileSync(
    join(TEST_DIR, "auto-single-col.csv"),
    "name\nAlice\nBob\nCharlie\n"
  );
});

describe("Delimiter auto-detection", () => {
  test("detects comma delimiter from file", () => {
    const parser = new CSVParser(join(TEST_DIR, "auto-comma.csv"), {
      delimiter: "auto",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[0]?.city).toBe("NYC");
  });

  test("detects tab delimiter from file", () => {
    const parser = new CSVParser(join(TEST_DIR, "auto-tab.csv"), {
      delimiter: "auto",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[0]?.city).toBe("NYC");
  });

  test("detects pipe delimiter from file", () => {
    const parser = new CSVParser(join(TEST_DIR, "auto-pipe.csv"), {
      delimiter: "auto",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.city).toBe("NYC");
  });

  test("detects semicolon delimiter from file", () => {
    const parser = new CSVParser(join(TEST_DIR, "auto-semicolon.csv"), {
      delimiter: "auto",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });

  test("detects delimiter from buffer input", () => {
    const data = new TextEncoder().encode(
      "name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA\n"
    );
    const parser = new CSVParser(data, { delimiter: "auto" });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });

  test("falls back to comma for single-column file", () => {
    const parser = new CSVParser(join(TEST_DIR, "auto-single-col.csv"), {
      delimiter: "auto",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Single-column: detection falls back to comma, parses as 1 field per row
    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
  });

  test("delimitersToGuess limits candidates", () => {
    // Data with semicolons, but only offer pipe and tab as guesses
    const data = new TextEncoder().encode(
      "name;age;city\nAlice;30;NYC\nBob;25;LA\n"
    );
    const parser = new CSVParser(data, {
      delimiter: "auto",
      delimitersToGuess: ["|", "\t"],
    });
    let rowCount = 0;

    for (const row of parser) {
      rowCount++;
    }
    parser.close();

    // Neither pipe nor tab splits the data, so falls back to first candidate
    // The data will be treated as single-field rows
    expect(rowCount).toBeGreaterThan(0);
  });

  test("detects delimiter with quoted fields", () => {
    const data = new TextEncoder().encode(
      'name|note|city\nAlice|"hello|world"|NYC\nBob|normal|LA\n'
    );
    const parser = new CSVParser(data, { delimiter: "auto" });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.city).toBe("NYC");
  });
});
