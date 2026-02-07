/**
 * Tests for Issue #10: ReadableStream and URL/HTTP input support
 */

import { describe, test, expect } from "bun:test";
import { CSVParser } from "../../src/ts/parser";

describe("ReadableStream input", () => {
  test("parses from ReadableStream", async () => {
    const csvData = "name,age\nAlice,30\nBob,25\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(csvData));
        controller.close();
      },
    });

    const parser = new CSVParser(stream);
    await parser.load();

    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe("30");
    expect(rows[1].name).toBe("Bob");
  });

  test("parses from multi-chunk ReadableStream", async () => {
    const chunks = [
      "name,age\nAli",
      "ce,30\nBob,25\n",
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const parser = new CSVParser(stream);
    await parser.load();

    const rows: any[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");
    expect(rows[1].name).toBe("Bob");
  });

  test("async iterator auto-loads from ReadableStream", async () => {
    const csvData = "name,age\nAlice,30\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(csvData));
        controller.close();
      },
    });

    const parser = new CSVParser(stream);
    const rows: any[] = [];

    // for-await-of should auto-load
    for await (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Alice");
  });

  test("sync iterator throws without load() for stream", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("name\nAlice\n"));
        controller.close();
      },
    });

    const parser = new CSVParser(stream);

    expect(() => {
      for (const _row of parser) { /* should not reach here */ }
    }).toThrow("async loading");

    parser.close();
  });
});

describe("URL input", () => {
  test("fetches and parses from URL", async () => {
    const csvData = "name,age\nAlice,30\nBob,25\n";
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(csvData, {
          headers: { "Content-Type": "text/csv" },
        });
      },
    });

    try {
      const parser = new CSVParser(`http://localhost:${server.port}/data.csv`);
      await parser.load();

      const rows: any[] = [];
      for (const row of parser) {
        rows.push(row.toObject());
      }
      parser.close();

      expect(rows.length).toBe(2);
      expect(rows[0].name).toBe("Alice");
      expect(rows[1].name).toBe("Bob");
    } finally {
      server.stop();
    }
  });

  test("async iterator auto-loads from URL", async () => {
    const csvData = "name,city\nAlice,NYC\n";
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(csvData, {
          headers: { "Content-Type": "text/csv" },
        });
      },
    });

    try {
      const parser = new CSVParser(`http://localhost:${server.port}/data.csv`);
      const rows: any[] = [];

      for await (const row of parser) {
        rows.push(row.toObject());
      }
      parser.close();

      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Alice");
      expect(rows[0].city).toBe("NYC");
    } finally {
      server.stop();
    }
  });

  test("download flag treats string as URL", async () => {
    const csvData = "x\n1\n";
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(csvData);
      },
    });

    try {
      // Use download: true with full URL
      const parser = new CSVParser(
        `http://localhost:${server.port}/data`,
        { download: true }
      );
      await parser.load();

      const rows: any[] = [];
      for (const row of parser) {
        rows.push(row.toObject());
      }
      parser.close();

      expect(rows.length).toBe(1);
      expect(rows[0].x).toBe("1");
    } finally {
      server.stop();
    }
  });

  test("throws on HTTP error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const parser = new CSVParser(`http://localhost:${server.port}/missing.csv`);

      await expect(parser.load()).rejects.toThrow("404");
      parser.close();
    } finally {
      server.stop();
    }
  });

  test("load() is idempotent", async () => {
    const csvData = "name\nAlice\n";
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(csvData);
      },
    });

    try {
      const parser = new CSVParser(`http://localhost:${server.port}/data.csv`);
      await parser.load();
      await parser.load(); // Second call should be a no-op

      const rows: any[] = [];
      for (const row of parser) {
        rows.push(row.toObject());
      }
      parser.close();

      expect(rows.length).toBe(1);
    } finally {
      server.stop();
    }
  });
});
