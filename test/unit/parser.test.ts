/**
 * Parser unit tests
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import { CSVWriter } from "../../src/ts/writer";
import { generateCSV } from "../../src/ts/testing";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, "..", "fixtures");
const SIMPLE_CSV = join(TEST_DIR, "simple.csv");
const QUOTED_CSV = join(TEST_DIR, "quoted.csv");

beforeAll(() => {
  // Create test fixtures
  writeFileSync(SIMPLE_CSV, "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago\n");
  writeFileSync(
    QUOTED_CSV,
    'name,address,note\nAlice,"123 Main St, Apt 4",normal\nBob,"456 Oak Ave","says ""hello"""\n'
  );
});

describe("CSVParser", () => {
  test("parses simple CSV", () => {
    const parser = new CSVParser(SIMPLE_CSV);
    const rows: Record<string, string | null>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }

    parser.close();

    expect(rows.length).toBe(3);
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("handles headers correctly", () => {
    const parser = new CSVParser(SIMPLE_CSV);
    const headers = parser.getHeaders();

    expect(headers).toEqual(["name", "age", "city"]);

    parser.close();
  });

  test("accesses fields by name", () => {
    const parser = new CSVParser(SIMPLE_CSV);

    for (const row of parser) {
      const name = row.get("name" as keyof Record<string, string>);
      const age = row.get("age" as keyof Record<string, string>);
      expect(name).toBeDefined();
      expect(age).toBeDefined();
      break;
    }

    parser.close();
  });

  test("accesses fields by index", () => {
    const parser = new CSVParser(SIMPLE_CSV);

    for (const row of parser) {
      expect(row.get(0)).toBe("Alice");
      expect(row.get(1)).toBe("30");
      expect(row.get(2)).toBe("NYC");
      break;
    }

    parser.close();
  });

  test("throws on out of bounds", () => {
    const parser = new CSVParser(SIMPLE_CSV);

    for (const row of parser) {
      expect(() => row.get(100)).toThrow(RangeError);
      break;
    }

    parser.close();
  });
});

describe("CSVWriter", () => {
  const OUTPUT_FILE = join(TEST_DIR, "output.csv");

  test("writes simple CSV", () => {
    const writer = new CSVWriter(OUTPUT_FILE);
    writer.writeRow(["name", "age"]);
    writer.writeRow(["Alice", "30"]);
    writer.writeRow(["Bob", "25"]);
    writer.close();

    const parser = new CSVParser(OUTPUT_FILE);
    const rows: Record<string, string | null>[] = [];
    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("Alice");

    // Cleanup
    unlinkSync(OUTPUT_FILE);
  });

  test("quotes fields with commas", () => {
    const writer = new CSVWriter(OUTPUT_FILE);
    writer.writeRow(["hello, world", "normal"]);
    writer.close();

    const content = Bun.file(OUTPUT_FILE).text();

    // Cleanup
    unlinkSync(OUTPUT_FILE);

    expect(content).resolves.toContain('"hello, world"');
  });
});

describe("generateCSV", () => {
  test("generates specified number of rows", () => {
    const csv = generateCSV({
      rows: 100,
      columns: ["name:string", "age:number"],
    });

    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(101); // header + 100 rows
  });

  test("is deterministic with seed", () => {
    const csv1 = generateCSV({
      rows: 10,
      columns: ["value:number"],
      seed: 12345,
    });

    const csv2 = generateCSV({
      rows: 10,
      columns: ["value:number"],
      seed: 12345,
    });

    expect(csv1).toBe(csv2);
  });
});
