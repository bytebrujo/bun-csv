/**
 * Tests for Issue #8: transform and transformHeader callbacks
 */

import { describe, test, expect } from "bun:test";
import { CSVParser } from "../../src/ts/parser";

describe("transformHeader", () => {
  test("lowercases header names", () => {
    const data = new TextEncoder().encode(
      "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n"
    );
    const parser = new CSVParser(data, {
      transformHeader: (header) => header.toLowerCase(),
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[0]?.city).toBe("NYC");
    // Original casing should not be present
    expect(rows[0]?.Name).toBeUndefined();
  });

  test("trims header whitespace", () => {
    const data = new TextEncoder().encode(
      " name , age \nAlice,30\n"
    );
    const parser = new CSVParser(data, {
      transformHeader: (header) => header.trim(),
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });

  test("renames headers via index", () => {
    const data = new TextEncoder().encode(
      "col1,col2\nAlice,30\n"
    );
    const renames = ["name", "age"];
    const parser = new CSVParser(data, {
      transformHeader: (_header, index) => renames[index] ?? _header,
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });

  test("no transformHeader leaves headers unchanged", () => {
    const data = new TextEncoder().encode(
      "Name,Age\nAlice,30\n"
    );
    const parser = new CSVParser(data);
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.Name).toBe("Alice");
    expect(rows[0]?.Age).toBe("30");
  });
});

describe("transform", () => {
  test("trims all field values", () => {
    const data = new TextEncoder().encode(
      "name,age\n Alice , 30 \n Bob , 25 \n"
    );
    const parser = new CSVParser(data, {
      transform: (value) => value.trim(),
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
    expect(rows[1]?.name).toBe("Bob");
  });

  test("uppercases specific fields", () => {
    const data = new TextEncoder().encode(
      "name,city\nAlice,nyc\nBob,la\n"
    );
    const parser = new CSVParser(data, {
      transform: (value, field) => field === "city" ? value.toUpperCase() : value,
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.city).toBe("NYC");
    expect(rows[1]?.name).toBe("Bob");
    expect(rows[1]?.city).toBe("LA");
  });

  test("replaces values", () => {
    const data = new TextEncoder().encode(
      "name,status\nAlice,active\nBob,inactive\n"
    );
    const parser = new CSVParser(data, {
      transform: (value, field) => {
        if (field === "status") return value === "active" ? "1" : "0";
        return value;
      },
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.status).toBe("1");
    expect(rows[1]?.status).toBe("0");
  });

  test("no transform leaves values unchanged", () => {
    const data = new TextEncoder().encode(
      "name,age\n Alice ,30\n"
    );
    const parser = new CSVParser(data);
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe(" Alice ");
  });
});

describe("transform + transformHeader combined", () => {
  test("both applied together", () => {
    const data = new TextEncoder().encode(
      "NAME,AGE\n alice , 30 \n"
    );
    const parser = new CSVParser(data, {
      transformHeader: (h) => h.toLowerCase(),
      transform: (v) => v.trim(),
    });
    const rows: Record<string, any>[] = [];

    for (const row of parser) {
      rows.push(row.toObject());
    }
    parser.close();

    expect(rows[0]?.name).toBe("alice");
    expect(rows[0]?.age).toBe("30");
  });
});

describe("transform with toArray", () => {
  test("transform applies to toArray values", () => {
    const data = new TextEncoder().encode(
      "name,age\n Alice , 30 \n"
    );
    const parser = new CSVParser(data, {
      transform: (v) => v.trim(),
    });

    for (const row of parser) {
      const arr = row.toArray();
      expect(arr[0]).toBe("Alice");
      expect(arr[1]).toBe("30");
    }
    parser.close();
  });
});
