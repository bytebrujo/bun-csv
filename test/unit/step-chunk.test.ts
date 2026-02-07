/**
 * Tests for Issue #9: step and chunk streaming callbacks
 */

import { describe, test, expect } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import type { ParserHandle } from "../../src/ts/parser";

describe("step callback", () => {
  test("fires once per data row", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\nBob,25\nCharlie,35\n"
    );
    const rows: any[] = [];

    const parser = new CSVParser(data, {
      step: (results) => {
        rows.push(results.data);
      },
    });
    parser.parse();
    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("Alice");
    expect(rows[1].name).toBe("Bob");
    expect(rows[2].name).toBe("Charlie");
  });

  test("returns objects when headers present", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\n"
    );
    let receivedData: any = null;

    const parser = new CSVParser(data, {
      step: (results) => {
        receivedData = results.data;
      },
    });
    parser.parse();
    parser.close();

    expect(receivedData).not.toBeNull();
    expect(receivedData.name).toBe("Alice");
    expect(receivedData.age).toBe("30");
  });

  test("returns arrays without headers", () => {
    const data = new TextEncoder().encode(
      "Alice,30\nBob,25\n"
    );
    const rows: any[] = [];

    const parser = new CSVParser(data, {
      hasHeader: false,
      step: (results) => {
        rows.push(results.data);
      },
    });
    parser.parse();
    parser.close();

    expect(rows.length).toBe(2);
    expect(Array.isArray(rows[0])).toBe(true);
    expect(rows[0][0]).toBe("Alice");
    expect(rows[0][1]).toBe("30");
  });

  test("includes meta with delimiter info", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\n"
    );
    let meta: any = null;

    const parser = new CSVParser(data, {
      step: (results) => {
        meta = results.meta;
      },
    });
    parser.parse();
    parser.close();

    expect(meta).not.toBeNull();
    expect(meta.delimiter).toBe(",");
    expect(meta.aborted).toBe(false);
    expect(meta.linebreak).toBe("\n");
  });

  test("abort stops parsing mid-stream", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\nBob\nCharlie\nDave\nEve\n"
    );
    const rows: any[] = [];

    const parser = new CSVParser(data, {
      step: (results, handle) => {
        rows.push(results.data);
        if (rows.length >= 2) {
          handle.abort();
        }
      },
    });
    parser.parse();
    parser.close();

    expect(rows.length).toBe(2);
  });

  test("pause and resume", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\nBob\nCharlie\n"
    );
    const rows: any[] = [];
    let savedHandle: ParserHandle | null = null;

    const parser = new CSVParser(data, {
      step: (results, handle) => {
        rows.push(results.data);
        if (rows.length === 1 && !savedHandle) {
          savedHandle = handle;
          handle.pause();
        }
      },
    });
    parser.parse();

    // After pause, only 1 row processed
    expect(rows.length).toBe(1);

    // Resume parsing
    savedHandle!.resume();

    // After resume, all rows processed
    expect(rows.length).toBe(3);

    parser.close();
  });
});

describe("chunk callback", () => {
  test("fires with batches of rows", () => {
    const csv = "name,age\n" +
      Array.from({ length: 10 }, (_, i) => `User${i},${20 + i}`).join("\n") + "\n";
    const data = new TextEncoder().encode(csv);
    const chunks: any[][] = [];

    const parser = new CSVParser(data, {
      chunkSize: 3,
      chunk: (results) => {
        chunks.push(results.data);
      },
    });
    parser.parse();
    parser.close();

    // 10 rows with chunkSize=3 → 4 chunks (3+3+3+1)
    expect(chunks.length).toBe(4);
    expect(chunks[0]!.length).toBe(3);
    expect(chunks[1]!.length).toBe(3);
    expect(chunks[2]!.length).toBe(3);
    expect(chunks[3]!.length).toBe(1);
  });

  test("default chunk size collects all rows in one chunk", () => {
    const csv = "name\n" +
      Array.from({ length: 5 }, (_, i) => `User${i}`).join("\n") + "\n";
    const data = new TextEncoder().encode(csv);
    const chunks: any[][] = [];

    const parser = new CSVParser(data, {
      chunk: (results) => {
        chunks.push(results.data);
      },
    });
    parser.parse();
    parser.close();

    // 5 rows < 1000 default → 1 chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBe(5);
  });

  test("abort stops chunk processing", () => {
    const csv = "name\n" +
      Array.from({ length: 10 }, (_, i) => `User${i}`).join("\n") + "\n";
    const data = new TextEncoder().encode(csv);
    const chunks: any[][] = [];

    const parser = new CSVParser(data, {
      chunkSize: 3,
      chunk: (results, handle) => {
        chunks.push(results.data);
        if (chunks.length >= 2) {
          handle.abort();
        }
      },
    });
    parser.parse();
    parser.close();

    expect(chunks.length).toBe(2);
  });

  test("chunk includes meta", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\n"
    );
    let meta: any = null;

    const parser = new CSVParser(data, {
      chunk: (results) => {
        meta = results.meta;
      },
    });
    parser.parse();
    parser.close();

    expect(meta).not.toBeNull();
    expect(meta.delimiter).toBe(",");
    expect(meta.aborted).toBe(false);
  });

  test("pause and resume with chunks", () => {
    const csv = "name\n" +
      Array.from({ length: 9 }, (_, i) => `User${i}`).join("\n") + "\n";
    const data = new TextEncoder().encode(csv);
    const chunks: any[][] = [];
    let savedHandle: ParserHandle | null = null;

    const parser = new CSVParser(data, {
      chunkSize: 3,
      chunk: (results, handle) => {
        chunks.push(results.data);
        if (chunks.length === 1 && !savedHandle) {
          savedHandle = handle;
          handle.pause();
        }
      },
    });
    parser.parse();

    // After pause, only 1 chunk (3 rows) processed
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBe(3);

    // Resume parsing
    savedHandle!.resume();

    // After resume, all 3 chunks processed
    expect(chunks.length).toBe(3);

    parser.close();
  });
});

describe("parse() validation", () => {
  test("throws without step or chunk", () => {
    const data = new TextEncoder().encode("name\nAlice\n");
    const parser = new CSVParser(data);

    expect(() => parser.parse()).toThrow("step or chunk");
    parser.close();
  });

  test("throws if parser not initialized", () => {
    const data = new TextEncoder().encode("name\nAlice\n");
    const parser = new CSVParser(data);
    parser.close();

    // Parser is closed, handle is null
    expect(() => {
      // Re-create with step but close first
      const p = new CSVParser(data, {
        step: () => {},
      });
      p.close();
      p.parse();
    }).toThrow();
  });
});
