/**
 * CSVRow - Lazy row accessor with batch FFI optimization
 */

import { loadNativeLibrary, MAX_BATCH_FIELDS, type NativeLib } from "./ffi";
import { toArrayBuffer, type Pointer } from "bun:ffi";
import type { Schema, SchemaField, ColumnType } from "./types";

/** Module-level cached library reference */
let cachedLib: NativeLib | null = null;

/** Module-level reusable TextDecoder */
const TEXT_DECODER = new TextDecoder();

/** Module-level length buffer for unescaped fields */
const LENGTH_BUFFER = new Uint8Array(8);

/** Get cached library reference */
function getLib(): NativeLib {
  if (!cachedLib) {
    cachedLib = loadNativeLibrary();
  }
  return cachedLib;
}

/** Batch row data loaded in one FFI call (old method with pointers) */
interface BatchData {
  fieldCount: number;
  ptrs: BigUint64Array;
  lens: Uint32Array;
  flags: Uint8Array;
}

/** Row data loaded directly with all strings (new optimized method) */
interface RowStringData {
  fieldCount: number;
  strings: string[];
}

/**
 * Represents a single row in the CSV file.
 * Fields are lazily decoded from the native parser only when accessed.
 * Uses batch FFI to load all field pointers in one call for efficiency.
 */
/** Dynamic typing configuration */
export type DynamicTypingConfig = boolean | Record<string, boolean> | ((field: string | number) => boolean);

/** Transform callback type */
export type TransformFn = (value: string, field: string | number) => string;

export class CSVRow<T = Record<string, string>> {
  private handle: number;
  private fieldCount: number;
  private headers: Map<string, number> | null;
  private schema: Schema<T> | null;
  private cache: Map<number, string>;
  private batchData: BatchData | null = null;
  private rowStringData: RowStringData | null = null;
  private dynamicTyping: DynamicTypingConfig;
  private transform: TransformFn | null;

  constructor(
    handle: number,
    fieldCount: number,
    headers: Map<string, number> | null = null,
    schema: Schema<T> | null = null,
    dynamicTyping: DynamicTypingConfig = false,
    transform: TransformFn | null = null,
  ) {
    this.handle = handle;
    this.fieldCount = fieldCount;
    this.headers = headers;
    this.schema = schema;
    this.cache = new Map();
    this.dynamicTyping = dynamicTyping;
    this.transform = transform;
  }

  /**
   * Load all field pointers in one FFI call (lazy, on first field access)
   */
  private loadBatch(): BatchData | null {
    if (this.batchData !== null) {
      return this.batchData;
    }

    const lib = getLib();
    const batchPtr = lib.csv_get_row_batch(this.handle);

    if (!batchPtr || batchPtr === 0) {
      return null;
    }

    // BatchRowResult layout:
    // - field_count: u32 (4 bytes)
    // - _pad: u32 (4 bytes)
    // - ptrs: [64]usize (64 * 8 = 512 bytes on 64-bit)
    // - lens: [64]u32 (64 * 4 = 256 bytes)
    // - flags: [64]u8 (64 bytes)
    // Total: 8 + 512 + 256 + 64 = 840 bytes

    const buffer = toArrayBuffer(batchPtr as Pointer, 0, 840);
    const view = new DataView(buffer);

    const fieldCount = view.getUint32(0, true);

    // Read pointer array (64 * 8 bytes starting at offset 8)
    const ptrs = new BigUint64Array(buffer, 8, MAX_BATCH_FIELDS);

    // Read length array (64 * 4 bytes starting at offset 8 + 512)
    const lens = new Uint32Array(buffer, 8 + MAX_BATCH_FIELDS * 8, MAX_BATCH_FIELDS);

    // Read flags array (64 bytes starting at offset 8 + 512 + 256)
    const flags = new Uint8Array(buffer, 8 + MAX_BATCH_FIELDS * 8 + MAX_BATCH_FIELDS * 4, MAX_BATCH_FIELDS);

    this.batchData = { fieldCount, ptrs, lens, flags };
    return this.batchData;
  }

  /**
   * Load all field strings in one FFI call (most efficient method)
   * Returns all strings already decoded, no additional FFI calls needed
   */
  private loadRowStrings(): RowStringData | null {
    if (this.rowStringData !== null) {
      return this.rowStringData;
    }

    const lib = getLib();
    const resultPtr = lib.csv_get_row_data(this.handle);

    if (!resultPtr || resultPtr === 0) {
      return null;
    }

    // RowDataResult layout:
    // - data_ptr: usize (8 bytes)
    // - total_size: u32 (4 bytes)
    // - field_count: u32 (4 bytes)
    // Total: 16 bytes
    const resultBuffer = toArrayBuffer(resultPtr as Pointer, 0, 16);
    const resultView = new DataView(resultBuffer);

    const dataPtr = resultView.getBigUint64(0, true);
    const totalSize = resultView.getUint32(8, true);
    const fieldCount = resultView.getUint32(12, true);

    if (totalSize === 0 || fieldCount === 0) {
      return null;
    }

    // Read the data buffer containing all field strings
    const dataBuffer = toArrayBuffer(Number(dataPtr) as unknown as Pointer, 0, totalSize);
    const dataView = new DataView(dataBuffer);
    const dataBytes = new Uint8Array(dataBuffer);

    // Parse fields: [u32 len][bytes][u32 len][bytes]...
    const strings: string[] = [];
    let offset = 0;

    for (let i = 0; i < fieldCount && offset < totalSize; i++) {
      const len = dataView.getUint32(offset, true);
      offset += 4;

      if (len === 0) {
        strings.push("");
      } else {
        const strBytes = dataBytes.subarray(offset, offset + len);
        strings.push(TEXT_DECODER.decode(strBytes));
        offset += len;
      }
    }

    this.rowStringData = { fieldCount, strings };
    return this.rowStringData;
  }

  /**
   * Get raw field value by column index or name.
   * Returns null for empty unquoted fields (SQL-style NULL).
   * Automatically unescapes quoted fields (removes quotes, handles "").
   * Uses batch FFI for efficiency - loads all field pointers in one call.
   */
  get(column: keyof T | number): string | null {
    const colIndex = this.resolveColumn(column);

    // Check cache first
    if (this.cache.has(colIndex)) {
      return this.cache.get(colIndex)!;
    }

    // Try batch path first (more efficient for multiple field access)
    const batch = this.loadBatch();

    if (batch && colIndex < batch.fieldCount) {
      const ptr = batch.ptrs[colIndex]!;
      const len = batch.lens[colIndex]!;
      const needsUnescape = (batch.flags[colIndex]! & 1) !== 0;

      if (ptr === 0n) {
        return null;
      }

      let value: string;

      if (needsUnescape) {
        // Need to call native unescape function for quoted fields
        const lib = getLib();
        const unescapedPtr = lib.csv_get_field_unescaped(this.handle, colIndex, LENGTH_BUFFER);

        if (unescapedPtr === null || unescapedPtr === 0) {
          return null;
        }

        const dataView = new DataView(LENGTH_BUFFER.buffer);
        const unescapedLen = Number(dataView.getBigUint64(0, true));

        if (unescapedLen === 0) {
          value = "";
        } else {
          const buffer = toArrayBuffer(unescapedPtr as Pointer, 0, unescapedLen);
          value = TEXT_DECODER.decode(buffer);
        }
      } else {
        // SQL-style NULL: empty unquoted field returns null
        if (len === 0) {
          return null;
        }

        const buffer = toArrayBuffer(Number(ptr) as unknown as Pointer, 0, len);
        value = TEXT_DECODER.decode(buffer);
      }

      if (this.transform) {
        value = this.transform(value, this.resolveFieldName(colIndex));
      }
      this.cache.set(colIndex, value);
      return value;
    }

    // Fallback to individual FFI calls (for fields beyond MAX_BATCH_FIELDS)
    const lib = getLib();
    const needsUnescape = lib.csv_field_needs_unescape(this.handle, colIndex);

    let value: string;

    if (needsUnescape) {
      const ptr = lib.csv_get_field_unescaped(this.handle, colIndex, LENGTH_BUFFER);

      if (ptr === null || ptr === 0) {
        return null;
      }

      const dataView = new DataView(LENGTH_BUFFER.buffer);
      const len = Number(dataView.getBigUint64(0, true));

      if (len === 0) {
        value = "";
      } else {
        const buffer = toArrayBuffer(ptr as Pointer, 0, len);
        value = TEXT_DECODER.decode(buffer);
      }
    } else {
      const ptr = lib.csv_get_field_ptr(this.handle, colIndex);
      const len = lib.csv_get_field_len(this.handle, colIndex);

      if (ptr === null || ptr === 0) {
        return null;
      }

      if (len === 0) {
        return null;
      }

      const buffer = toArrayBuffer(ptr as Pointer, 0, Number(len));
      value = TEXT_DECODER.decode(buffer);
    }

    if (this.transform) {
      value = this.transform(value, this.resolveFieldName(colIndex));
    }
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
   * Check whether dynamic typing is enabled for a given field.
   */
  private shouldDynamicType(field: string | number): boolean {
    if (this.dynamicTyping === true) return true;
    if (this.dynamicTyping === false || !this.dynamicTyping) return false;
    if (typeof this.dynamicTyping === "function") return this.dynamicTyping(field);
    // Record<string, boolean> — look up by header name
    if (typeof field === "string") return this.dynamicTyping[field] ?? false;
    // Numeric index — resolve to header name if possible
    if (this.headers) {
      for (const [name, idx] of this.headers) {
        if (idx === field) return this.dynamicTyping[name] ?? false;
      }
    }
    return false;
  }

  /**
   * Auto-coerce a string value to a JavaScript type.
   * Rules: "true"/"false" → boolean, numeric → number, "" → null.
   */
  private dynamicCoerce(value: string | null, field: string | number): unknown {
    if (value === null || value === "") return null;
    if (!this.shouldDynamicType(field)) return value;

    // Boolean
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;

    // Number (int, float, scientific notation)
    if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) {
      const num = Number(value);
      if (!isNaN(num)) return num;
    }

    return value;
  }

  /**
   * Convert row to plain object using headers.
   * When dynamicTyping is enabled, values are auto-coerced.
   */
  toObject(): Record<string, any> {
    const obj: Record<string, any> = {};

    if (this.headers) {
      for (const [name, index] of this.headers) {
        const raw = this.get(index as keyof T | number);
        obj[name] = this.dynamicTyping ? this.dynamicCoerce(raw, name) : raw;
      }
    } else {
      for (let i = 0; i < this.fieldCount; i++) {
        const raw = this.get(i);
        obj[`col${i}`] = this.dynamicTyping ? this.dynamicCoerce(raw, i) : raw;
      }
    }

    return obj;
  }

  /**
   * Convert row to array of values.
   * When dynamicTyping is enabled, values are auto-coerced.
   */
  toArray(): any[] {
    const arr: any[] = [];
    for (let i = 0; i < this.fieldCount; i++) {
      const raw = this.get(i);
      arr.push(this.dynamicTyping ? this.dynamicCoerce(raw, i) : raw);
    }
    return arr;
  }

  /**
   * Resolve column index to header name (or index if no headers).
   */
  private resolveFieldName(colIndex: number): string | number {
    if (this.headers) {
      for (const [name, idx] of this.headers) {
        if (idx === colIndex) return name;
      }
    }
    return colIndex;
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
