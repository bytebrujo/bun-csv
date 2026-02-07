/**
 * Tests for Issue #12: __parsed_extra for excess fields
 */

import { describe, test, expect } from "bun:test";
import { CSVParser } from "../../src/ts/parser";

describe("__parsed_extra", () => {
  test("collects excess fields into __parsed_extra", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30,extra1,extra2\n"
    );
    const parser = new CSVParser(data);
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe("30");
    expect(rows[0].__parsed_extra).toEqual(["extra1", "extra2"]);
  });

  test("no __parsed_extra when fields match headers", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\nBob,25\n"
    );
    const parser = new CSVParser(data);
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].__parsed_extra).toBeUndefined();
    expect(rows[1].__parsed_extra).toBeUndefined();
  });

  test("fewer fields than headers returns null for missing", () => {
    const data = new TextEncoder().encode(
      "name,age,city\nAlice,30\n"
    );
    const parser = new CSVParser(data);
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].name).toBe("Alice");
    expect(rows[0].age).toBe("30");
    expect(rows[0].city).toBeNull();
    expect(rows[0].__parsed_extra).toBeUndefined();
  });

  test("mixed rows: some with extras, some without", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\nBob,25,NYC,extra\nCharlie,35\n"
    );
    const parser = new CSVParser(data);
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].__parsed_extra).toBeUndefined();
    expect(rows[1].__parsed_extra).toEqual(["NYC", "extra"]);
    expect(rows[2].__parsed_extra).toBeUndefined();
  });

  test("single extra field", () => {
    const data = new TextEncoder().encode(
      "a,b\n1,2,3\n"
    );
    const parser = new CSVParser(data);
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0].__parsed_extra).toEqual(["3"]);
  });

  test("no __parsed_extra without headers", () => {
    const data = new TextEncoder().encode(
      "Alice,30,extra\n"
    );
    const parser = new CSVParser(data, { hasHeader: false });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    // Without headers, all fields are col0, col1, col2 — no extras
    expect(rows[0].__parsed_extra).toBeUndefined();
    expect(rows[0].col0).toBe("Alice");
    expect(rows[0].col1).toBe("30");
    expect(rows[0].col2).toBe("extra");
  });

  test("toArray still returns all fields including extras", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30,extra1,extra2\n"
    );
    const parser = new CSVParser(data);

    for (const row of parser) {
      const arr = row.toArray();
      expect(arr.length).toBe(4);
      expect(arr[0]).toBe("Alice");
      expect(arr[1]).toBe("30");
      expect(arr[2]).toBe("extra1");
      expect(arr[3]).toBe("extra2");
    }
    parser.close();
  });
});
