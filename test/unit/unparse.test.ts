/**
 * Tests for Issue #6: unparse() function
 */

import { describe, test, expect } from "bun:test";
import { unparse } from "../../src/ts/unparse";

describe("unparse - array of arrays", () => {
  test("basic array of arrays", () => {
    const result = unparse([
      ["name", "age", "city"],
      ["Alice", "30", "NYC"],
      ["Bob", "25", "LA"],
    ]);
    expect(result).toBe("name,age,city\r\nAlice,30,NYC\r\nBob,25,LA");
  });

  test("single row", () => {
    const result = unparse([["hello", "world"]]);
    expect(result).toBe("hello,world");
  });

  test("empty input", () => {
    const result = unparse([]);
    expect(result).toBe("");
  });
});

describe("unparse - array of objects", () => {
  test("basic array of objects with header", () => {
    const result = unparse([
      { name: "Alice", age: 30, city: "NYC" },
      { name: "Bob", age: 25, city: "LA" },
    ]);
    expect(result).toBe("name,age,city\r\nAlice,30,NYC\r\nBob,25,LA");
  });

  test("header=false omits header row", () => {
    const result = unparse(
      [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
      { header: false },
    );
    expect(result).toBe("Alice,30\r\nBob,25");
  });

  test("columns option selects and orders fields", () => {
    const result = unparse(
      [
        { name: "Alice", age: 30, city: "NYC" },
        { name: "Bob", age: 25, city: "LA" },
      ],
      { columns: ["city", "name"] },
    );
    expect(result).toBe("city,name\r\nNYC,Alice\r\nLA,Bob");
  });

  test("handles missing keys as empty string", () => {
    const result = unparse([
      { name: "Alice", age: 30 },
      { name: "Bob" },
    ]);
    expect(result).toBe("name,age\r\nAlice,30\r\nBob,");
  });
});

describe("unparse - PapaParse result shape", () => {
  test("accepts { fields, data } shape", () => {
    const result = unparse({
      fields: ["name", "age"],
      data: [
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    });
    expect(result).toBe("name,age\r\nAlice,30\r\nBob,25");
  });
});

describe("unparse - JSON string input", () => {
  test("auto-parses JSON string", () => {
    const json = JSON.stringify([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    const result = unparse(json);
    expect(result).toBe("name,age\r\nAlice,30\r\nBob,25");
  });
});

describe("unparse - quoting", () => {
  test("auto-quotes fields with delimiter", () => {
    const result = unparse([["hello,world", "normal"]]);
    expect(result).toBe('"hello,world",normal');
  });

  test("auto-quotes fields with newline", () => {
    const result = unparse([["line1\nline2", "normal"]]);
    expect(result).toBe('"line1\nline2",normal');
  });

  test("auto-quotes fields with quote char", () => {
    const result = unparse([['say "hello"', "normal"]]);
    expect(result).toBe('"say ""hello""",normal');
  });

  test("auto-quotes fields with leading/trailing spaces", () => {
    const result = unparse([["  padded  ", "normal"]]);
    expect(result).toBe('"  padded  ",normal');
  });

  test("quotes=true forces all fields to be quoted", () => {
    const result = unparse(
      [["Alice", "30"]],
      { quotes: true },
    );
    expect(result).toBe('"Alice","30"');
  });

  test("quotes as per-column array", () => {
    const result = unparse(
      [["Alice", "30", "NYC"]],
      { quotes: [true, false, true] },
    );
    expect(result).toBe('"Alice",30,"NYC"');
  });
});

describe("unparse - config options", () => {
  test("custom delimiter", () => {
    const result = unparse(
      [["Alice", "30"]],
      { delimiter: "\t" },
    );
    expect(result).toBe("Alice\t30");
  });

  test("custom newline", () => {
    const result = unparse(
      [["a", "b"], ["c", "d"]],
      { newline: "\n" },
    );
    expect(result).toBe("a,b\nc,d");
  });

  test("custom quoteChar", () => {
    const result = unparse(
      [["hello,world"]],
      { quoteChar: "'" },
    );
    expect(result).toBe("'hello,world'");
  });

  test("skipEmptyLines removes empty rows", () => {
    const result = unparse(
      [
        ["Alice", "30"],
        ["", ""],
        ["Bob", "25"],
      ],
      { skipEmptyLines: true },
    );
    expect(result).toBe("Alice,30\r\nBob,25");
  });
});

describe("unparse - special values", () => {
  test("null and undefined become empty string", () => {
    const result = unparse([[null, undefined, "hello"]]);
    expect(result).toBe(",,hello");
  });

  test("Date objects become ISO strings", () => {
    const date = new Date("2024-01-15T10:30:00.000Z");
    const result = unparse([[date, "event"]]);
    expect(result).toBe("2024-01-15T10:30:00.000Z,event");
  });

  test("numbers are stringified", () => {
    const result = unparse([[42, 3.14, -1]]);
    expect(result).toBe("42,3.14,-1");
  });

  test("booleans are stringified", () => {
    const result = unparse([[true, false]]);
    expect(result).toBe("true,false");
  });
});
