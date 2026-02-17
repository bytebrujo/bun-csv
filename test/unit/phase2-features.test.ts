/**
 * Tests for Phase 2 features:
 * - ltrim / rtrim / trim
 * - skipEmptyLines: "greedy"
 * - fromLine / toLine (range processing)
 * - CSVRow.index and CSVRow.columns (row metadata)
 * - CSVReadStream (Node.js Readable)
 * - createCSVReadableStream (Web ReadableStream)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { CSVReadStream, createCSVReadableStream } from "../../src/ts/stream";
import { writeFileSync } from "fs";
import { join } from "path";
import { Writable } from "stream";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // File with leading/trailing whitespace in fields
  writeFileSync(
    join(TEST_DIR, "p2-whitespace.csv"),
    "name,age,city\n  Alice  , 30 , NYC \n Bob ,25, LA\n  Charlie  ,35,  Chicago  \n"
  );

  // File with whitespace-only rows
  writeFileSync(
    join(TEST_DIR, "p2-greedy-empty.csv"),
    "name,age\nAlice,30\n   ,   \nBob,25\n  \t , \nCharlie,35\n"
  );

  // File for range testing (10 data rows)
  writeFileSync(
    join(TEST_DIR, "p2-range.csv"),
    "name,val\nA,1\nB,2\nC,3\nD,4\nE,5\nF,6\nG,7\nH,8\nI,9\nJ,10\n"
  );

  // File for stream testing
  writeFileSync(
    join(TEST_DIR, "p2-stream.csv"),
    "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago\n"
  );
});

// ==========================================================================
// ltrim / rtrim / trim
// ==========================================================================

describe("ltrim", () => {
  test("trims leading whitespace from fields", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      ltrim: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]!.name).toBe("Alice  ");
    expect(rows[0]!.age).toBe("30 ");
    expect(rows[0]!.city).toBe("NYC ");
    expect(rows[1]!.name).toBe("Bob ");
  });

  test("does not trim trailing whitespace", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      ltrim: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Should still have trailing spaces
    expect(rows[0]!.name).toBe("Alice  ");
  });
});

describe("rtrim", () => {
  test("trims trailing whitespace from fields", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      rtrim: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]!.name).toBe("  Alice");
    expect(rows[0]!.age).toBe(" 30");
    expect(rows[0]!.city).toBe(" NYC");
  });

  test("does not trim leading whitespace", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      rtrim: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]!.name).toBe("  Alice");
  });
});

describe("trim", () => {
  test("trims both leading and trailing whitespace", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      trim: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]!.name).toBe("Alice");
    expect(rows[0]!.age).toBe("30");
    expect(rows[0]!.city).toBe("NYC");
    expect(rows[1]!.name).toBe("Bob");
    expect(rows[1]!.age).toBe("25");
    expect(rows[2]!.name).toBe("Charlie");
    expect(rows[2]!.city).toBe("Chicago");
  });

  test("trim overrides ltrim/rtrim", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      trim: true,
      ltrim: false,
      rtrim: false,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // trim=true should still trim both sides
    expect(rows[0]!.name).toBe("Alice");
  });

  test("disabled by default", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"));
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Should have original whitespace
    expect(rows[0]!.name).toBe("  Alice  ");
  });
});

// ==========================================================================
// skipEmptyLines: "greedy"
// ==========================================================================

describe('skipEmptyLines: "greedy"', () => {
  test("skips lines that contain only whitespace", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-greedy-empty.csv"), {
      skipEmptyRows: "greedy",
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Only real data rows should remain
    expect(rows.length).toBe(3);
    expect(rows[0]!.name).toBe("Alice");
    expect(rows[1]!.name).toBe("Bob");
    expect(rows[2]!.name).toBe("Charlie");
  });

  test("regular skipEmptyRows does not skip whitespace-only rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-greedy-empty.csv"), {
      skipEmptyRows: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Whitespace-only rows should still be present
    expect(rows.length).toBeGreaterThan(3);
  });
});

// ==========================================================================
// fromLine / toLine (range processing)
// ==========================================================================

describe("fromLine / toLine", () => {
  test("fromLine skips initial data rows", () => {
    // p2-range.csv: header=line1, A=line2, B=line3, ...
    // fromLine=4 means start from line 4 (C)
    const parser = new CSVParser(join(TEST_DIR, "p2-range.csv"), {
      fromLine: 4,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]!.name).toBe("C");
    expect(rows.length).toBe(8); // C through J
  });

  test("toLine stops after specified line", () => {
    // toLine=4 means stop after line 4 (C = data row 2, 0-indexed)
    const parser = new CSVParser(join(TEST_DIR, "p2-range.csv"), {
      toLine: 4,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3); // A, B, C
    expect(rows[0]!.name).toBe("A");
    expect(rows[2]!.name).toBe("C");
  });

  test("fromLine + toLine selects a range", () => {
    // fromLine=4, toLine=6 => lines 4, 5, 6 => C, D, E
    const parser = new CSVParser(join(TEST_DIR, "p2-range.csv"), {
      fromLine: 4,
      toLine: 6,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]!.name).toBe("C");
    expect(rows[1]!.name).toBe("D");
    expect(rows[2]!.name).toBe("E");
  });

  test("fromLine=1 returns all rows (no skip)", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-range.csv"), {
      fromLine: 1,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(10);
  });

  test("toLine beyond file length returns all rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-range.csv"), {
      toLine: 999,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(10);
  });
});

// ==========================================================================
// CSVRow.index and CSVRow.columns
// ==========================================================================

describe("CSVRow metadata", () => {
  test("row.index provides 0-based data row index", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-stream.csv"));
    const indices: number[] = [];
    for (const row of parser) {
      indices.push(row.index);
    }
    parser.close();

    expect(indices).toEqual([0, 1, 2]);
  });

  test("row.columns provides header names", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-stream.csv"));
    let columns: string[] | null = null;
    for (const row of parser) {
      columns = row.columns;
      break;
    }
    parser.close();

    expect(columns).toEqual(["name", "age", "city"]);
  });

  test("row.columns is null when no headers", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-stream.csv"), {
      hasHeader: false,
    });
    let columns: string[] | null = null;
    for (const row of parser) {
      columns = row.columns;
      break;
    }
    parser.close();

    expect(columns).toBeNull();
  });

  test("row.index works with fromLine offset", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-range.csv"), {
      fromLine: 4,
    });
    const indices: number[] = [];
    for (const row of parser) {
      indices.push(row.index);
    }
    parser.close();

    // Row index is absolute (0-based), not relative to fromLine
    expect(indices[0]).toBe(2); // C is data row index 2
  });
});

// ==========================================================================
// CSVReadStream (Node.js Readable)
// ==========================================================================

describe("CSVReadStream", () => {
  test("emits row objects in object mode", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-stream.csv"));
    const rows: any[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (row) => rows.push(row));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("Alice");
    expect(rows[1].name).toBe("Bob");
    expect(rows[2].name).toBe("Charlie");
  });

  test("emits arrays in array mode", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-stream.csv"), {
      outputMode: "array",
    });
    const rows: any[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (row) => rows.push(row));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(["Alice", "30", "NYC"]);
  });

  test("supports pipe()", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-stream.csv"));
    const collected: any[] = [];

    const sink = new Writable({
      objectMode: true,
      write(chunk, _encoding, callback) {
        collected.push(chunk);
        callback();
      },
    });

    await new Promise<void>((resolve, reject) => {
      stream.pipe(sink);
      sink.on("finish", resolve);
      sink.on("error", reject);
    });

    expect(collected.length).toBe(3);
    expect(collected[0].name).toBe("Alice");
  });

  test("passes parser options through", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-whitespace.csv"), {
      trim: true,
    });
    const rows: any[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (row) => rows.push(row));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe("30");
  });

  test("exposes errors", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-stream.csv"));
    await new Promise<void>((resolve, reject) => {
      stream.on("data", () => {});
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    expect(stream.errors.length).toBe(0);
  });

  test("exposes meta", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-stream.csv"));
    await new Promise<void>((resolve, reject) => {
      stream.on("data", () => {});
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    expect(stream.meta.delimiter).toBe(",");
    expect(stream.meta.fields).toEqual(["name", "age", "city"]);
  });
});

// ==========================================================================
// createCSVReadableStream (Web ReadableStream)
// ==========================================================================

describe("createCSVReadableStream", () => {
  test("creates a Web ReadableStream of row objects", async () => {
    const stream = createCSVReadableStream(join(TEST_DIR, "p2-stream.csv"));
    const rows: any[] = [];

    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rows.push(value);
    }

    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("Alice");
    expect(rows[2].city).toBe("Chicago");
  });

  test("supports array output mode", async () => {
    const stream = createCSVReadableStream(join(TEST_DIR, "p2-stream.csv"), {
      outputMode: "array",
    });
    const rows: any[] = [];

    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rows.push(value);
    }

    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(["Alice", "30", "NYC"]);
  });

  test("supports for-await-of", async () => {
    const stream = createCSVReadableStream(join(TEST_DIR, "p2-stream.csv"));
    const rows: any[] = [];

    for await (const row of stream) {
      rows.push(row);
    }

    expect(rows.length).toBe(3);
  });
});

// ==========================================================================
// Combined Phase 2 features
// ==========================================================================

describe("Combined Phase 2 features", () => {
  test("trim + fromLine + toLine", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-whitespace.csv"), {
      trim: true,
      fromLine: 3,
      toLine: 3,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe("Bob");
    expect(rows[0]!.age).toBe("25");
  });

  test("trim + skipRecordsWithEmptyValues", () => {
    const parser = new CSVParser(join(TEST_DIR, "p2-greedy-empty.csv"), {
      trim: true,
      skipRecordsWithEmptyValues: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // After trimming, whitespace-only fields become empty, so they get skipped
    expect(rows.length).toBe(3);
    expect(rows[0]!.name).toBe("Alice");
    expect(rows[1]!.name).toBe("Bob");
    expect(rows[2]!.name).toBe("Charlie");
  });

  test("stream with range processing", async () => {
    const stream = new CSVReadStream(join(TEST_DIR, "p2-range.csv"), {
      fromLine: 3,
      toLine: 5,
    });
    const rows: any[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (row) => rows.push(row));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("B");
    expect(rows[2].name).toBe("D");
  });
});
