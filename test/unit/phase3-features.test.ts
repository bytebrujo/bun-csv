/**
 * Tests for Phase 3 features:
 * - Nested JSON support (flatten/unflatten, dot-notation)
 * - Fast mode (skip quote detection)
 * - Custom cast functions per field
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { unparse } from "../../src/ts/unparse";
import { flatten, unflatten, flattenObjects } from "../../src/ts/nested";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // File with dot-notation headers
  writeFileSync(
    join(TEST_DIR, "p3-nested-headers.csv"),
    "user.name,user.age,address.city,address.zip\nAlice,30,NYC,10001\nBob,25,LA,90001\n"
  );

  // Simple clean file for fast mode
  writeFileSync(
    join(TEST_DIR, "p3-fast.csv"),
    "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago\nDiana,28,Boston\n"
  );

  // File for cast testing
  writeFileSync(
    join(TEST_DIR, "p3-cast.csv"),
    "name,age,score,active\nAlice,30,95.5,true\nBob,25,87.3,false\nCharlie,35,92.1,true\n"
  );

  // Large file for fast mode performance comparison
  const lines = ["id,name,value"];
  for (let i = 0; i < 1000; i++) {
    lines.push(`${i},item_${i},${Math.random() * 100}`);
  }
  writeFileSync(join(TEST_DIR, "p3-fast-large.csv"), lines.join("\n") + "\n");
});

// ==========================================================================
// flatten / unflatten utilities
// ==========================================================================

describe("flatten()", () => {
  test("flattens nested object with dot notation", () => {
    const result = flatten({
      user: { name: "Alice", age: 30 },
      city: "NYC",
    });
    expect(result).toEqual({
      "user.name": "Alice",
      "user.age": 30,
      "city": "NYC",
    });
  });

  test("handles deeply nested objects", () => {
    const result = flatten({
      a: { b: { c: { d: 1 } } },
    });
    expect(result).toEqual({ "a.b.c.d": 1 });
  });

  test("handles custom separator", () => {
    const result = flatten({ user: { name: "Alice" } }, "/");
    expect(result).toEqual({ "user/name": "Alice" });
  });

  test("preserves arrays as values (not flattened)", () => {
    const result = flatten({ tags: [1, 2, 3], name: "Alice" });
    expect(result).toEqual({ tags: [1, 2, 3], name: "Alice" });
  });

  test("preserves Date objects", () => {
    const date = new Date("2024-01-01");
    const result = flatten({ created: date });
    expect(result).toEqual({ created: date });
  });

  test("handles null values", () => {
    const result = flatten({ a: null, b: { c: null } });
    expect(result).toEqual({ a: null, "b.c": null });
  });

  test("handles empty object", () => {
    const result = flatten({});
    expect(result).toEqual({});
  });
});

describe("unflatten()", () => {
  test("unflattens dot-notation keys into nested object", () => {
    const result = unflatten({
      "user.name": "Alice",
      "user.age": "30",
      "city": "NYC",
    });
    expect(result).toEqual({
      user: { name: "Alice", age: "30" },
      city: "NYC",
    });
  });

  test("handles deeply nested keys", () => {
    const result = unflatten({ "a.b.c.d": 1 });
    expect(result).toEqual({ a: { b: { c: { d: 1 } } } });
  });

  test("handles custom separator", () => {
    const result = unflatten({ "user/name": "Alice" }, "/");
    expect(result).toEqual({ user: { name: "Alice" } });
  });

  test("handles non-nested keys", () => {
    const result = unflatten({ name: "Alice", age: "30" });
    expect(result).toEqual({ name: "Alice", age: "30" });
  });

  test("handles empty object", () => {
    const result = unflatten({});
    expect(result).toEqual({});
  });
});

describe("flattenObjects()", () => {
  test("flattens array of nested objects and collects headers", () => {
    const { headers, rows } = flattenObjects([
      { user: { name: "Alice" }, age: 30 },
      { user: { name: "Bob" }, age: 25 },
    ]);
    expect(headers).toEqual(["user.name", "age"]);
    expect(rows).toEqual([["Alice", 30], ["Bob", 25]]);
  });

  test("handles objects with different keys", () => {
    const { headers, rows } = flattenObjects([
      { a: { x: 1 } },
      { a: { x: 2 }, b: 3 },
    ]);
    expect(headers).toEqual(["a.x", "b"]);
    expect(rows[0]).toEqual([1, null]);
    expect(rows[1]).toEqual([2, 3]);
  });
});

// ==========================================================================
// Nested JSON - unparse() with flattenObjects
// ==========================================================================

describe("unparse() with flattenObjects", () => {
  test("flattens nested objects to dot-notation CSV", () => {
    const result = unparse(
      [
        { user: { name: "Alice", age: 30 }, city: "NYC" },
        { user: { name: "Bob", age: 25 }, city: "LA" },
      ],
      { flattenObjects: true }
    );
    expect(result).toContain("user.name");
    expect(result).toContain("user.age");
    expect(result).toContain("city");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });

  test("uses custom separator for flattening", () => {
    const result = unparse(
      [{ user: { name: "Alice" } }],
      { flattenObjects: "/" }
    );
    expect(result).toContain("user/name");
  });

  test("does not flatten when disabled (default)", () => {
    const result = unparse(
      [{ name: "Alice", age: 30 }],
    );
    expect(result).toContain("name,age");
    expect(result).toContain("Alice,30");
  });
});

// ==========================================================================
// Nested JSON - CSVRow.toNestedObject()
// ==========================================================================

describe("CSVRow.toNestedObject()", () => {
  test("converts dot-notation headers to nested object", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-nested-headers.csv"));
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toNestedObject());
    }
    parser.close();

    expect(rows[0]).toEqual({
      user: { name: "Alice", age: "30" },
      address: { city: "NYC", zip: "10001" },
    });
    expect(rows[1]).toEqual({
      user: { name: "Bob", age: "25" },
      address: { city: "LA", zip: "90001" },
    });
  });

  test("supports custom separator", () => {
    // Write a file with / separator
    writeFileSync(
      join(TEST_DIR, "p3-nested-slash.csv"),
      "user/name,user/age\nAlice,30\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p3-nested-slash.csv"));
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toNestedObject("/"));
    }
    parser.close();

    expect(rows[0]).toEqual({
      user: { name: "Alice", age: "30" },
    });
  });

  test("works with non-nested headers (pass-through)", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast.csv"));
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toNestedObject());
      break;
    }
    parser.close();

    expect(rows[0]).toEqual({ name: "Alice", age: "30", city: "NYC" });
  });
});

// ==========================================================================
// Fast mode
// ==========================================================================

describe("fastMode", () => {
  test("parses simple CSV without native parser", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast.csv"), {
      fastMode: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    // fast mode doesn't use native handle, so close is a no-op
    parser.close();

    expect(rows.length).toBe(4);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe("30");
    expect(rows[0].city).toBe("NYC");
    expect(rows[3].name).toBe("Diana");
  });

  test("fast mode supports trim", () => {
    writeFileSync(
      join(TEST_DIR, "p3-fast-trim.csv"),
      "name,age\n  Alice  , 30 \n Bob ,25\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p3-fast-trim.csv"), {
      fastMode: true,
      trim: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe("30");
    expect(rows[1].name).toBe("Bob");
  });

  test("fast mode supports fromLine/toLine", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast.csv"), {
      fastMode: true,
      fromLine: 3,
      toLine: 4,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Bob");
    expect(rows[1].name).toBe("Charlie");
  });

  test("fast mode supports skipEmptyRows", () => {
    writeFileSync(
      join(TEST_DIR, "p3-fast-empty.csv"),
      "name,age\nAlice,30\n\nBob,25\n\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p3-fast-empty.csv"), {
      fastMode: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
  });

  test("fast mode supports comment lines", () => {
    writeFileSync(
      join(TEST_DIR, "p3-fast-comments.csv"),
      "name,age\n# This is a comment\nAlice,30\n# Another comment\nBob,25\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p3-fast-comments.csv"), {
      fastMode: true,
      comments: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");
    expect(rows[1].name).toBe("Bob");
  });

  test("fast mode provides row index", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast.csv"), {
      fastMode: true,
    });
    const indices: number[] = [];
    for (const row of parser) {
      indices.push(row.index);
    }
    parser.close();

    expect(indices).toEqual([0, 1, 2, 3]);
  });

  test("fast mode provides columns", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast.csv"), {
      fastMode: true,
    });
    let columns: string[] | null = null;
    for (const row of parser) {
      columns = row.columns;
      break;
    }
    parser.close();

    expect(columns).toEqual(["name", "age", "city"]);
  });

  test("fast mode parses 1000 rows correctly", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast-large.csv"), {
      fastMode: true,
    });
    let count = 0;
    for (const _row of parser) {
      count++;
    }
    parser.close();

    expect(count).toBe(1000);
  });

  test("fast mode supports transformHeader", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-fast.csv"), {
      fastMode: true,
      transformHeader: (h) => h.toUpperCase(),
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
      break;
    }
    parser.close();

    expect(rows[0].NAME).toBe("Alice");
    expect(rows[0].AGE).toBe("30");
  });

  test("fast mode field mismatch detection", () => {
    writeFileSync(
      join(TEST_DIR, "p3-fast-mismatch.csv"),
      "name,age\nAlice,30\nBob,25,extra\nCharlie\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p3-fast-mismatch.csv"), {
      fastMode: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(parser.errors.length).toBe(2);
    expect(parser.errors[0]!.code).toBe("TooManyFields");
    expect(parser.errors[1]!.code).toBe("TooFewFields");
  });
});

// ==========================================================================
// Custom cast functions
// ==========================================================================

describe("cast - function form", () => {
  test("applies cast function to all fields", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      cast: (value, context) => {
        if (context.column === "age") return parseInt(value);
        if (context.column === "score") return parseFloat(value);
        if (context.column === "active") return value === "true";
        return value;
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe(30);
    expect(rows[0].score).toBe(95.5);
    expect(rows[0].active).toBe(true);
    expect(rows[1].active).toBe(false);
  });

  test("cast context provides row index", () => {
    const rowIndices: number[] = [];
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      cast: (value, context) => {
        if (context.column === "name") {
          rowIndices.push(context.row);
        }
        return value;
      },
    });
    for (const row of parser) {
      row.toObject(); // trigger cast
    }
    parser.close();

    expect(rowIndices).toEqual([0, 1, 2]);
  });

  test("cast context provides column index", () => {
    const colIndices: number[] = [];
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      cast: (value, context) => {
        if (context.row === 0) {
          colIndices.push(context.index);
        }
        return value;
      },
    });
    for (const row of parser) {
      row.toObject();
      break;
    }
    parser.close();

    expect(colIndices).toEqual([0, 1, 2, 3]);
  });
});

describe("cast - record form", () => {
  test("applies per-column cast functions", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      cast: {
        age: (v) => parseInt(v),
        score: (v) => parseFloat(v),
        active: (v) => v === "true",
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("Alice"); // no cast
    expect(rows[0].age).toBe(30);
    expect(rows[0].score).toBe(95.5);
    expect(rows[0].active).toBe(true);
  });

  test("unspecified columns are not cast", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      cast: {
        age: (v) => parseInt(v),
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].age).toBe(30);
    expect(rows[0].score).toBe("95.5"); // string, not cast
    expect(rows[0].active).toBe("true"); // string, not cast
  });
});

describe("cast - with fast mode", () => {
  test("cast works in fast mode", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      fastMode: true,
      cast: {
        age: (v) => parseInt(v),
        score: (v) => parseFloat(v),
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].age).toBe(30);
    expect(rows[0].score).toBe(95.5);
    expect(rows[0].name).toBe("Alice");
  });
});

describe("cast - with dynamicTyping", () => {
  test("cast runs after dynamicTyping", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-cast.csv"), {
      dynamicTyping: true,
      cast: (value, context) => {
        // dynamicTyping already converted numbers, cast receives string form
        if (context.column === "age") {
          return `age:${value}`;
        }
        return value;
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // dynamicTyping coerced age to number, then cast converted to string
    expect(rows[0].age).toBe("age:30");
  });
});

// ==========================================================================
// Combined Phase 3 features
// ==========================================================================

describe("Combined Phase 3 features", () => {
  test("fast mode + toNestedObject", () => {
    const parser = new CSVParser(join(TEST_DIR, "p3-nested-headers.csv"), {
      fastMode: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toNestedObject());
    }
    parser.close();

    expect(rows[0]).toEqual({
      user: { name: "Alice", age: "30" },
      address: { city: "NYC", zip: "10001" },
    });
  });

  test("unparse flatten roundtrip", () => {
    const original = [
      { user: { name: "Alice" }, score: 95 },
      { user: { name: "Bob" }, score: 87 },
    ];
    const csv = unparse(original, { flattenObjects: true });
    expect(csv).toContain("user.name,score");
    expect(csv).toContain("Alice,95");
    expect(csv).toContain("Bob,87");
  });

  test("fast mode + cast + trim", () => {
    writeFileSync(
      join(TEST_DIR, "p3-combined.csv"),
      "name,value\n  Alice  , 100 \n  Bob  , 200 \n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p3-combined.csv"), {
      fastMode: true,
      trim: true,
      cast: {
        value: (v) => parseInt(v),
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("Alice");
    expect(rows[0].value).toBe(100);
    expect(rows[1].name).toBe("Bob");
    expect(rows[1].value).toBe(200);
  });
});
