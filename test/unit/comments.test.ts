/**
 * Tests for Issue #4: Comment line support
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  writeFileSync(
    join(TEST_DIR, "with-hash-comments.csv"),
    "name,age,city\n# This is a comment\nAlice,30,NYC\n# Another comment\nBob,25,LA\n"
  );

  writeFileSync(
    join(TEST_DIR, "with-semicolon-comments.csv"),
    "name,age\n; comment line\nAlice,30\nBob,25\n"
  );

  writeFileSync(
    join(TEST_DIR, "comments-only.csv"),
    "name,age\n# comment 1\n# comment 2\n# comment 3\n"
  );

  writeFileSync(
    join(TEST_DIR, "no-comments.csv"),
    "name,age\nAlice,30\nBob,25\n"
  );

  writeFileSync(
    join(TEST_DIR, "comment-in-field.csv"),
    'name,note\nAlice,"# not a comment"\nBob,normal\n'
  );
});

describe("Comment support", () => {
  test("skips # comment lines when comments=true", () => {
    const parser = new CSVParser(join(TEST_DIR, "with-hash-comments.csv"), {
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

  test("skips custom comment character", () => {
    const parser = new CSVParser(join(TEST_DIR, "with-semicolon-comments.csv"), {
      comments: ";",
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

  test("all comment lines results in no data rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "comments-only.csv"), {
      comments: true,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(0);
  });

  test("does not skip comments when comments=false (default)", () => {
    const parser = new CSVParser(join(TEST_DIR, "with-hash-comments.csv"));
    let rowCount = 0;

    for (const row of parser) {
      rowCount++;
    }
    parser.close();

    // Without comments option, # lines are treated as data
    expect(rowCount).toBeGreaterThan(2);
  });

  test("does not affect file without comments", () => {
    const parser = new CSVParser(join(TEST_DIR, "no-comments.csv"), {
      comments: true,
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
  });

  test("comments work with buffer input", () => {
    const data = new TextEncoder().encode(
      "name,age\n# skip this\nAlice,30\n# skip that\nBob,25\n"
    );
    const parser = new CSVParser(data, { comments: true });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("comments combined with custom delimiter", () => {
    const data = new TextEncoder().encode(
      "name\tage\n# comment\nAlice\t30\nBob\t25\n"
    );
    const parser = new CSVParser(data, {
      delimiter: "\t",
      comments: "#",
    });
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");
  });
});
