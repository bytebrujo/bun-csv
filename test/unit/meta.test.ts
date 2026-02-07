/**
 * Tests for Issue #14: meta output in parse results
 */

import { describe, test, expect } from "bun:test";
import { CSVParser } from "../../src/ts/parser";
import type { CSVMeta } from "../../src/ts/parser";

describe("getMeta()", () => {
  test("returns delimiter used", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\n"
    );
    const parser = new CSVParser(data);
    for (const _row of parser) { /* consume */ }

    const meta = parser.getMeta();
    expect(meta.delimiter).toBe(",");
    parser.close();
  });

  test("returns custom delimiter", () => {
    const data = new TextEncoder().encode(
      "name\tage\nAlice\t30\n"
    );
    const parser = new CSVParser(data, { delimiter: "\t" });
    for (const _row of parser) { /* consume */ }

    const meta = parser.getMeta();
    expect(meta.delimiter).toBe("\t");
    parser.close();
  });

  test("returns linebreak", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\n"
    );
    const parser = new CSVParser(data);
    const meta = parser.getMeta();

    expect(meta.linebreak).toBe("\n");
    parser.close();
  });

  test("returns fields array with header names", () => {
    const data = new TextEncoder().encode(
      "name,age,city\nAlice,30,NYC\n"
    );
    const parser = new CSVParser(data);
    const meta = parser.getMeta();

    expect(meta.fields).toEqual(["name", "age", "city"]);
    parser.close();
  });

  test("returns null fields without headers", () => {
    const data = new TextEncoder().encode(
      "Alice,30\n"
    );
    const parser = new CSVParser(data, { hasHeader: false });
    const meta = parser.getMeta();

    expect(meta.fields).toBeNull();
    parser.close();
  });

  test("aborted is false by default", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\n"
    );
    const parser = new CSVParser(data);
    for (const _row of parser) { /* consume */ }

    const meta = parser.getMeta();
    expect(meta.aborted).toBe(false);
    parser.close();
  });

  test("truncated is false by default", () => {
    const data = new TextEncoder().encode(
      "name\nAlice\nBob\n"
    );
    const parser = new CSVParser(data);
    for (const _row of parser) { /* consume */ }

    const meta = parser.getMeta();
    expect(meta.truncated).toBe(false);
    parser.close();
  });

  test("elapsedMs is a positive number after parsing", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\nBob,25\n"
    );
    const parser = new CSVParser(data);
    for (const _row of parser) { /* consume */ }

    const meta = parser.getMeta();
    expect(meta.elapsedMs).toBeGreaterThanOrEqual(0);
    parser.close();
  });

  test("fields is a copy, not a reference", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\n"
    );
    const parser = new CSVParser(data);
    const meta1 = parser.getMeta();
    const meta2 = parser.getMeta();

    // Should be equal but not the same reference
    expect(meta1.fields).toEqual(meta2.fields);
    expect(meta1.fields).not.toBe(meta2.fields);
    parser.close();
  });

  test("meta available before iteration", () => {
    const data = new TextEncoder().encode(
      "name,age\nAlice,30\n"
    );
    const parser = new CSVParser(data);

    // Meta should be available immediately after construction
    const meta = parser.getMeta();
    expect(meta.delimiter).toBe(",");
    expect(meta.fields).toEqual(["name", "age"]);
    expect(meta.aborted).toBe(false);
    parser.close();
  });
});
