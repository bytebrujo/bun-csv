/**
 * Tests for Issue #13: skipFirstNLines option
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // File with metadata preamble
  writeFileSync(
    join(TEST_DIR, "with-preamble.csv"),
    "Generated: 2024-01-01\nSource: System Export\nname,age,city\nAlice,30,NYC\nBob,25,LA\n"
  );

  // File with single metadata line
  writeFileSync(
    join(TEST_DIR, "single-meta-line.csv"),
    "# Report generated 2024\nname,age\nAlice,30\nBob,25\n"
  );
});

describe("skipFirstNLines", () => {
  test("skip 2 metadata lines before header", () => {
    const parser = new CSVParser(join(TEST_DIR, "with-preamble.csv"), {
      skipFirstNLines: 2,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("skip 1 metadata line", () => {
    const parser = new CSVParser(join(TEST_DIR, "single-meta-line.csv"), {
      skipFirstNLines: 1,
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

  test("skip 0 lines (default) parses everything", () => {
    const parser = new CSVParser(join(TEST_DIR, "single-meta-line.csv"), {
      skipFirstNLines: 0,
    });
    let rowCount = 0;

    for (const row of parser) {
      rowCount++;
    }
    parser.close();

    // Header is "# Report generated 2024", data rows include "name,age", "Alice,30", "Bob,25"
    expect(rowCount).toBe(3);
  });

  test("no skipFirstNLines option parses everything", () => {
    const parser = new CSVParser(join(TEST_DIR, "single-meta-line.csv"));
    let rowCount = 0;

    for (const row of parser) {
      rowCount++;
    }
    parser.close();

    expect(rowCount).toBe(3);
  });

  test("skip more lines than file has returns no rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "single-meta-line.csv"), {
      skipFirstNLines: 100,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(0);
  });

  test("skipFirstNLines works with buffer input", () => {
    const data = new TextEncoder().encode(
      "metadata line 1\nmetadata line 2\nname,age\nAlice,30\nBob,25\n"
    );
    const parser = new CSVParser(data, { skipFirstNLines: 2 });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("skipFirstNLines combined with custom delimiter", () => {
    const data = new TextEncoder().encode(
      "preamble\nname\tage\nAlice\t30\nBob\t25\n"
    );
    const parser = new CSVParser(data, {
      skipFirstNLines: 1,
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
  });

  test("skipFirstNLines combined with comments", () => {
    const data = new TextEncoder().encode(
      "preamble\nname,age\n# comment\nAlice,30\nBob,25\n"
    );
    const parser = new CSVParser(data, {
      skipFirstNLines: 1,
      comments: true,
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
});
