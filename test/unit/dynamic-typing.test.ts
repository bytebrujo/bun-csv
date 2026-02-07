/**
 * Tests for Issue #7: Dynamic typing (auto type coercion)
 */

import { describe, test, expect } from "bun:test";
import { CSVParser } from "../../src/ts/parser";

describe("Dynamic typing - basic", () => {
  test("converts booleans", () => {
    const data = new TextEncoder().encode(
      "name,active,verified\nAlice,true,FALSE\nBob,false,TRUE\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.verified).toBe(false);
    expect(rows[1]?.active).toBe(false);
    expect(rows[1]?.verified).toBe(true);
  });

  test("converts integers", () => {
    const data = new TextEncoder().encode(
      "name,age,score\nAlice,30,100\nBob,25,0\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.age).toBe(30);
    expect(rows[0]?.score).toBe(100);
    expect(rows[1]?.age).toBe(25);
    expect(rows[1]?.score).toBe(0);
  });

  test("converts floats", () => {
    const data = new TextEncoder().encode(
      "name,price,rate\nA,19.99,0.5\nB,100.0,3.14\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.price).toBe(19.99);
    expect(rows[0]?.rate).toBe(0.5);
    expect(rows[1]?.price).toBe(100.0);
    expect(rows[1]?.rate).toBe(3.14);
  });

  test("converts negative numbers", () => {
    const data = new TextEncoder().encode(
      "name,balance\nAlice,-50\nBob,-3.14\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.balance).toBe(-50);
    expect(rows[1]?.balance).toBe(-3.14);
  });

  test("converts scientific notation", () => {
    const data = new TextEncoder().encode(
      "name,value\nA,1e5\nB,2.5E-3\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.value).toBe(100000);
    expect(rows[1]?.value).toBe(0.0025);
  });

  test("empty string becomes null", () => {
    const data = new TextEncoder().encode(
      'name,value\nAlice,""\nBob,hello\n'
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.value).toBe(null);
    expect(rows[1]?.value).toBe("hello");
  });

  test("strings that are not numbers stay as strings", () => {
    const data = new TextEncoder().encode(
      "name,city\nAlice,NYC\nBob,LA\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.city).toBe("NYC");
    expect(typeof rows[0]?.name).toBe("string");
  });
});

describe("Dynamic typing - disabled", () => {
  test("dynamicTyping=false returns all strings", () => {
    const data = new TextEncoder().encode(
      "name,age,active\nAlice,30,true\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: false });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.age).toBe("30");
    expect(rows[0]?.active).toBe("true");
    expect(typeof rows[0]?.age).toBe("string");
  });

  test("default (no option) returns all strings", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\n"
    );
    const parser = new CSVParser(data);
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.age).toBe("30");
    expect(typeof rows[0]?.age).toBe("string");
  });
});

describe("Dynamic typing - per-field config", () => {
  test("Record<string, boolean> enables per header", () => {
    const data = new TextEncoder().encode(
      "name,age,score\nAlice,30,100\n"
    );
    const parser = new CSVParser(data, {
      dynamicTyping: { age: true, score: false },
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.age).toBe(30);
    expect(rows[0]?.score).toBe("100"); // not typed
    expect(rows[0]?.name).toBe("Alice"); // not typed
  });

  test("function config enables per field dynamically", () => {
    const data = new TextEncoder().encode(
      "name,age,score\nAlice,30,100\n"
    );
    const parser = new CSVParser(data, {
      dynamicTyping: (field: string | number) => field === "age",
    });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.age).toBe(30);
    expect(rows[0]?.score).toBe("100");
  });
});

describe("Dynamic typing - toArray", () => {
  test("toArray also applies dynamic typing", () => {
    const data = new TextEncoder().encode(
      "name,age,active\nAlice,30,true\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true, hasHeader: false });
    const rows: any[][] = [];

    for (const row of parser) {
      rows.push(row.toArray());
    }
    parser.close();

    // First row is "name,age,active" - all strings
    expect(rows[0]?.[0]).toBe("name");
    // Second row is "Alice,30,true"
    expect(rows[1]?.[0]).toBe("Alice");
    expect(rows[1]?.[1]).toBe(30);
    expect(rows[1]?.[2]).toBe(true);
  });
});

describe("Dynamic typing - mixed types in one row", () => {
  test("mixed types coerced correctly", () => {
    const data = new TextEncoder().encode(
      "str,num,bool,empty,float\nhello,42,true,,3.14\n"
    );
    const parser = new CSVParser(data, { dynamicTyping: true });
    const rows: any[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.str).toBe("hello");
    expect(rows[0]?.num).toBe(42);
    expect(rows[0]?.bool).toBe(true);
    expect(rows[0]?.empty).toBe(null);
    expect(rows[0]?.float).toBe(3.14);
  });
});
