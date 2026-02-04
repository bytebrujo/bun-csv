/**
 * CSVRow - Lazy row accessor
 */

import { loadNativeLibrary, readString } from "./ffi";
import type { Schema, SchemaField, ColumnType } from "./types";

/**
 * Represents a single row in the CSV file.
 * Fields are lazily decoded from the native parser only when accessed.
 */
export class CSVRow<T = Record<string, string>> {
  private handle: number;
  private fieldCount: number;
  private headers: Map<string, number> | null;
  private schema: Schema<T> | null;
  private cache: Map<number, string>;

  constructor(
    handle: number,
    fieldCount: number,
    headers: Map<string, number> | null = null,
    schema: Schema<T> | null = null
  ) {
    this.handle = handle;
    this.fieldCount = fieldCount;
    this.headers = headers;
    this.schema = schema;
    this.cache = new Map();
  }

  /**
   * Get raw field value by column index or name.
   * Returns null for empty unquoted fields (SQL-style NULL).
   * Automatically unescapes quoted fields (removes quotes, handles "").
   */
  get(column: keyof T | number): string | null {
    const colIndex = this.resolveColumn(column);

    // Check cache first
    if (this.cache.has(colIndex)) {
      return this.cache.get(colIndex)!;
    }

    const lib = loadNativeLibrary();

    // Check if field needs unescaping (starts with quote)
    const needsUnescape = lib.csv_field_needs_unescape(this.handle, colIndex);

    let value: string;

    if (needsUnescape) {
      // Use native unescape function (handles "" -> " conversion)
      const outLenBuf = new Uint8Array(8); // u64 for length
      const ptr = lib.csv_get_field_unescaped(this.handle, colIndex, outLenBuf);

      if (ptr === null || ptr === 0) {
        return null;
      }

      // Read length from output buffer (little-endian u64)
      const dataView = new DataView(outLenBuf.buffer);
      const len = Number(dataView.getBigUint64(0, true));

      if (len === 0) {
        // Quoted empty field "" returns empty string (not null)
        value = "";
      } else {
        value = readString(ptr, len);
      }
    } else {
      // No unescaping needed - get raw pointer
      const ptr = lib.csv_get_field_ptr(this.handle, colIndex);
      const len = lib.csv_get_field_len(this.handle, colIndex);

      if (ptr === null || ptr === 0) {
        return null;
      }

      // SQL-style NULL: empty unquoted field returns null
      if (len === 0) {
        return null;
      }

      value = readString(ptr, len);
    }

    // Cache the result
    this.cache.set(colIndex, value);

    return value;
  }

  /**
   * Get typed field value with validation.
   * Throws TypeError if value cannot be parsed as the schema type.
   */
  getTyped<K extends keyof T>(column: K): T[K] {
    if (!this.schema) {
      throw new Error("Schema not defined. Use get() for raw access.");
    }

    const schemaField = this.schema[column] as SchemaField;
    if (!schemaField) {
      throw new Error(`Column "${String(column)}" not found in schema.`);
    }

    const rawValue = this.get(column);

    if (rawValue === null) {
      if (schemaField.nullable) {
        return null as T[K];
      }
      if (schemaField.default !== undefined) {
        return schemaField.default as T[K];
      }
      throw new TypeError(
        `Column "${String(column)}" is null but not nullable in schema.`
      );
    }

    return this.coerce(rawValue, schemaField.type, String(column)) as T[K];
  }

  /**
   * Get field count for this row.
   */
  get length(): number {
    return this.fieldCount;
  }

  /**
   * Convert row to plain object using headers.
   */
  toObject(): Record<string, string | null> {
    const obj: Record<string, string | null> = {};

    if (this.headers) {
      for (const [name, index] of this.headers) {
        obj[name] = this.get(index as keyof T | number);
      }
    } else {
      for (let i = 0; i < this.fieldCount; i++) {
        obj[`col${i}`] = this.get(i);
      }
    }

    return obj;
  }

  /**
   * Convert row to array of values.
   */
  toArray(): (string | null)[] {
    const arr: (string | null)[] = [];
    for (let i = 0; i < this.fieldCount; i++) {
      arr.push(this.get(i));
    }
    return arr;
  }

  /**
   * Resolve column name to index.
   */
  private resolveColumn(column: keyof T | number): number {
    if (typeof column === "number") {
      if (column < 0 || column >= this.fieldCount) {
        throw new RangeError(
          `Column index ${column} out of bounds. Row has ${this.fieldCount} columns.`
        );
      }
      return column;
    }

    // String column name
    if (this.schema) {
      const schemaField = this.schema[column] as SchemaField;
      if (schemaField) {
        return schemaField.col;
      }
    }

    if (this.headers) {
      const index = this.headers.get(String(column));
      if (index !== undefined) {
        return index;
      }
    }

    throw new RangeError(`Column "${String(column)}" not found.`);
  }

  /**
   * Remove surrounding quotes and unescape doubled quotes.
   * Note: This is now handled by the native library, but kept for fallback.
   */
  private unquote(value: string): string {
    if (value.length < 2) return value;

    if (value.startsWith('"') && value.endsWith('"')) {
      // Remove quotes and unescape doubled quotes
      return value.slice(1, -1).replace(/""/g, '"');
    }

    return value;
  }

  /**
   * Coerce string value to typed value.
   */
  private coerce(value: string, type: ColumnType, columnName: string): unknown {
    switch (type) {
      case "string":
        return value;

      case "number":
      case "float": {
        // Handle currency and percentage
        const cleaned = value
          .replace(/[$€£¥,]/g, "")
          .replace(/\(([0-9.]+)\)/, "-$1") // Accounting negative
          .replace(/%$/, "");

        const num = parseFloat(cleaned);
        if (isNaN(num)) {
          throw new TypeError(
            `Cannot parse "${value}" as number for column "${columnName}".`
          );
        }

        // Convert percentage to decimal
        if (value.endsWith("%")) {
          return num / 100;
        }

        return num;
      }

      case "integer": {
        const cleaned = value.replace(/,/g, "");
        const num = parseInt(cleaned, 10);
        if (isNaN(num)) {
          throw new TypeError(
            `Cannot parse "${value}" as integer for column "${columnName}".`
          );
        }
        return num;
      }

      case "boolean": {
        const lower = value.toLowerCase();
        if (["true", "1", "yes", "y"].includes(lower)) return true;
        if (["false", "0", "no", "n"].includes(lower)) return false;
        throw new TypeError(
          `Cannot parse "${value}" as boolean for column "${columnName}".`
        );
      }

      case "date": {
        // ISO 8601 only
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new TypeError(
            `Cannot parse "${value}" as ISO 8601 date for column "${columnName}".`
          );
        }
        return date;
      }

      case "currency": {
        const cleaned = value
          .replace(/[$€£¥,\s]/g, "")
          .replace(/\(([0-9.]+)\)/, "-$1");
        const num = parseFloat(cleaned);
        if (isNaN(num)) {
          throw new TypeError(
            `Cannot parse "${value}" as currency for column "${columnName}".`
          );
        }
        return num;
      }

      case "percent": {
        const cleaned = value.replace(/%$/, "").replace(/,/g, "");
        const num = parseFloat(cleaned);
        if (isNaN(num)) {
          throw new TypeError(
            `Cannot parse "${value}" as percent for column "${columnName}".`
          );
        }
        return num / 100;
      }

      default:
        return value;
    }
  }
}
