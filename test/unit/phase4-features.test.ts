/**
 * Tests for Phase 4 features:
 * - Remote file auth headers / withCredentials (interface validation)
 * - Duplicate header handling (group_columns_by_name)
 * - beforeFirstChunk / onRecord callbacks
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");

beforeAll(() => {
  // File with duplicate headers
  writeFileSync(
    join(TEST_DIR, "p4-dup-headers.csv"),
    "name,age,name,score,age\nAlice,30,Alice2,95,31\nBob,25,Bob2,87,26\n"
  );

  // Simple file for callback tests
  writeFileSync(
    join(TEST_DIR, "p4-callbacks.csv"),
    "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago\nDiana,28,Boston\n"
  );

  // File for beforeFirstChunk tests
  writeFileSync(
    join(TEST_DIR, "p4-before-chunk.csv"),
    "# metadata line\nname,age\nAlice,30\nBob,25\n"
  );

  // File for onRecord with fast mode
  writeFileSync(
    join(TEST_DIR, "p4-onrecord-fast.csv"),
    "name,value\nAlice,100\nBob,200\nCharlie,300\n"
  );
});

// ==========================================================================
// Remote file auth headers (interface validation)
// ==========================================================================

describe("downloadRequestHeaders / withCredentials", () => {
  test("options are accepted without error", () => {
    // These options only take effect when fetching from URLs.
    // We validate they're accepted in the options interface.
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      downloadRequestHeaders: { Authorization: "Bearer token123" },
      withCredentials: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Parser works normally for file sources — headers are just ignored
    expect(rows.length).toBe(4);
    expect(rows[0].name).toBe("Alice");
  });

  test("downloadRequestHeaders defaults to undefined", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"));
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();
    expect(rows.length).toBe(4);
  });
});

// ==========================================================================
// Duplicate header handling
// ==========================================================================

describe("duplicateHeaders", () => {
  test("renames duplicates by default", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-dup-headers.csv"));
    const headers = parser.getHeaders();
    parser.close();

    expect(headers).toEqual(["name", "age", "name_1", "score", "age_1"]);
  });

  test("renames duplicates with explicit 'rename' option", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-dup-headers.csv"), {
      duplicateHeaders: "rename",
    });
    const headers = parser.getHeaders();
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(headers).toEqual(["name", "age", "name_1", "score", "age_1"]);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].name_1).toBe("Alice2");
    expect(rows[0].age).toBe("30");
    expect(rows[0].age_1).toBe("31");
  });

  test("throws error with 'error' option", () => {
    expect(() => {
      new CSVParser(join(TEST_DIR, "p4-dup-headers.csv"), {
        duplicateHeaders: "error",
      });
    }).toThrow('Duplicate header "name" found at column 2');
  });

  test("handles triple duplicates", () => {
    writeFileSync(
      join(TEST_DIR, "p4-triple-dup.csv"),
      "x,x,x\n1,2,3\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p4-triple-dup.csv"));
    const headers = parser.getHeaders();
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(headers).toEqual(["x", "x_1", "x_2"]);
    expect(rows[0].x).toBe("1");
    expect(rows[0].x_1).toBe("2");
    expect(rows[0].x_2).toBe("3");
  });

  test("no duplicates passes through unchanged", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"));
    const headers = parser.getHeaders();
    parser.close();

    expect(headers).toEqual(["name", "age", "city"]);
  });

  test("duplicate headers in fast mode", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-dup-headers.csv"), {
      fastMode: true,
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // In fast mode, headers are parsed during iteration
    const headers = parser.getHeaders();
    expect(headers).toEqual(["name", "age", "name_1", "score", "age_1"]);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].name_1).toBe("Alice2");
  });

  test("duplicate headers error in fast mode", () => {
    expect(() => {
      const parser = new CSVParser(join(TEST_DIR, "p4-dup-headers.csv"), {
        fastMode: true,
        duplicateHeaders: "error",
      });
      // Need to iterate to trigger header parsing in fast mode
      for (const _row of parser) {
        break;
      }
    }).toThrow('Duplicate header "name" found at column 2');
  });
});

// ==========================================================================
// beforeFirstChunk callback
// ==========================================================================

describe("beforeFirstChunk", () => {
  test("receives raw content and can modify it", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-before-chunk.csv"), {
      beforeFirstChunk: (chunk) => {
        // Remove the metadata line
        const lines = chunk.split("\n");
        return lines.filter(l => !l.startsWith("#")).join("\n");
      },
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

  test("returning void keeps content unchanged", () => {
    let receivedChunk = "";
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      beforeFirstChunk: (chunk) => {
        receivedChunk = chunk;
        // return void (undefined) — no modification
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(receivedChunk).toContain("name,age,city");
    expect(receivedChunk).toContain("Alice,30,NYC");
    expect(rows.length).toBe(4);
  });

  test("works with fast mode", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-before-chunk.csv"), {
      fastMode: true,
      beforeFirstChunk: (chunk) => {
        // Remove the metadata line
        return chunk.split("\n").filter(l => !l.startsWith("#")).join("\n");
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");
  });

  test("can inject additional rows", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      fastMode: true,
      beforeFirstChunk: (chunk) => {
        return chunk.trimEnd() + "\nEve,40,Seattle\n";
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(5);
    expect(rows[4].name).toBe("Eve");
    expect(rows[4].city).toBe("Seattle");
  });
});

// ==========================================================================
// onRecord callback
// ==========================================================================

describe("onRecord", () => {
  test("receives each record with context", () => {
    const records: { fields: (string | null)[]; index: number }[] = [];
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      onRecord: (record, context) => {
        records.push({ fields: [...record], index: context.index });
        return record;
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(records.length).toBe(4);
    expect(records[0].fields).toEqual(["Alice", "30", "NYC"]);
    expect(records[0].index).toBe(0);
    expect(records[3].fields).toEqual(["Diana", "28", "Boston"]);
    expect(records[3].index).toBe(3);
  });

  test("context includes column names", () => {
    let columns: string[] | null = null;
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      onRecord: (record, context) => {
        if (!columns) columns = context.columns;
        return record;
      },
    });
    for (const _row of parser) { break; }
    parser.close();

    expect(columns).toEqual(["name", "age", "city"]);
  });

  test("returning null skips the record", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      onRecord: (record, _context) => {
        // Skip Bob
        if (record[0] === "Bob") return null;
        return record;
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows.map((r: any) => r.name)).toEqual(["Alice", "Charlie", "Diana"]);
  });

  test("returning undefined skips the record", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      onRecord: (record) => {
        if (record[0] === "Charlie") return undefined;
        return record;
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows.map((r: any) => r.name)).toEqual(["Alice", "Bob", "Diana"]);
  });

  test("can modify record values", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      onRecord: (record) => {
        // Uppercase all names
        return [record[0]?.toUpperCase() ?? null, record[1], record[2]];
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("ALICE");
    expect(rows[1].name).toBe("BOB");
    expect(rows[2].name).toBe("CHARLIE");
  });

  test("works with fast mode", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-onrecord-fast.csv"), {
      fastMode: true,
      onRecord: (record) => {
        // Double the value
        const val = parseInt(record[1] ?? "0") * 2;
        return [record[0], String(val)];
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].value).toBe("200");
    expect(rows[1].value).toBe("400");
    expect(rows[2].value).toBe("600");
  });

  test("skip and modify combined", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-callbacks.csv"), {
      onRecord: (record) => {
        // Skip records from LA, uppercase names for the rest
        if (record[2] === "LA") return null;
        return [record[0]?.toUpperCase() ?? null, record[1], record[2]];
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("ALICE");
    expect(rows[0].city).toBe("NYC");
    // Bob (LA) was skipped
    expect(rows[1].name).toBe("CHARLIE");
  });
});

// ==========================================================================
// Combined Phase 4 features
// ==========================================================================

describe("Combined Phase 4 features", () => {
  test("duplicate headers + onRecord", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-dup-headers.csv"), {
      onRecord: (record, context) => {
        // Only keep records where first name starts with A
        if (record[0]?.startsWith("A")) return record;
        return null;
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].name_1).toBe("Alice2");
  });

  test("beforeFirstChunk + onRecord", () => {
    const parser = new CSVParser(join(TEST_DIR, "p4-before-chunk.csv"), {
      fastMode: true,
      beforeFirstChunk: (chunk) => {
        // Remove metadata lines
        return chunk.split("\n").filter(l => !l.startsWith("#")).join("\n");
      },
      onRecord: (record) => {
        // Uppercase names
        return [record[0]?.toUpperCase() ?? null, record[1]];
      },
    });
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("ALICE");
    expect(rows[1].name).toBe("BOB");
  });

  test("all Phase 4 features together", () => {
    writeFileSync(
      join(TEST_DIR, "p4-all-combined.csv"),
      "# preamble\nid,name,id\n1,Alice,A1\n2,Bob,B2\n3,Charlie,C3\n"
    );
    const parser = new CSVParser(join(TEST_DIR, "p4-all-combined.csv"), {
      fastMode: true,
      beforeFirstChunk: (chunk) => {
        // Strip comments
        return chunk.split("\n").filter(l => !l.startsWith("#")).join("\n");
      },
      duplicateHeaders: "rename",
      onRecord: (record) => {
        // Skip Bob
        if (record[1] === "Bob") return null;
        return record;
      },
    });
    const headers = parser.getHeaders();
    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Headers won't be set until iteration starts in fast mode
    // but after iteration, headerRow should be set
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].id).toBe("1");
    expect(rows[0].id_1).toBe("A1");
    expect(rows[1].name).toBe("Charlie");
  });
});
