/**
 * Tests for Issue #5: Preview / row limit support
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  writeFileSync(
    join(TEST_DIR, "ten-rows.csv"),
    "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago\nDiana,28,Seattle\nEve,32,Boston\nFrank,29,Denver\nGrace,31,Miami\nHank,27,Austin\nIvy,33,Portland\nJack,26,Dallas\n"
  );
});

describe("Preview / row limit", () => {
  test("preview=3 returns only first 3 data rows from file", () => {
    const parser = new CSVParser(join(TEST_DIR, "ten-rows.csv"), {
      preview: 3,
    });
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

  test("preview=1 returns only the first data row", () => {
    const parser = new CSVParser(join(TEST_DIR, "ten-rows.csv"), {
      preview: 1,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe("Alice");
  });

  test("preview larger than row count returns all rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "ten-rows.csv"), {
      preview: 100,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(10);
  });

  test("preview=0 (default) returns all rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "ten-rows.csv"), {
      preview: 0,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(10);
  });

  test("no preview option returns all rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "ten-rows.csv"));
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(10);
  });

  test("preview works with buffer input", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\nBob,25\nCharlie,35\nDiana,28\nEve,32\n"
    );
    const parser = new CSVParser(data, { preview: 2 });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("preview combined with comments skips comment lines correctly", () => {
    const data = new TextEncoder().encode(
      "name,age\n# comment\nAlice,30\n# comment\nBob,25\nCharlie,35\nDiana,28\n"
    );
    const parser = new CSVParser(data, { preview: 2, comments: true });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("preview combined with custom delimiter", () => {
    const data = new TextEncoder().encode(
      "name\tage\nAlice\t30\nBob\t25\nCharlie\t35\n"
    );
    const parser = new CSVParser(data, { delimiter: "\t", preview: 2 });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("preview combined with skipEmptyRows", () => {
    const data = new TextEncoder().encode(
      "name,age\n\nAlice,30\n\nBob,25\n\nCharlie,35\n"
    );
    const parser = new CSVParser(data, { preview: 2, skipEmptyRows: true });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });
});
