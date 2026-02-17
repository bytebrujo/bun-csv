/**
 * unparse() - Convert data back to CSV string
 *
 * Compatible with PapaParse's Papa.unparse() API.
 */

import { flatten as flattenObj } from "./nested";

/** Configuration for unparse */
export interface UnparseConfig {
  /** Field delimiter (default: ",") */
  delimiter?: string;
  /** Quote character (default: '"') */
  quoteChar?: string;
  /** Escape character for quotes inside fields (default: same as quoteChar, i.e. doubled) */
  escapeChar?: string;
  /** Whether to quote all fields, or a per-column boolean array */
  quotes?: boolean | boolean[];
  /** Whether to include header row when input is array of objects (default: true) */
  header?: boolean;
  /** Line ending (default: "\r\n") */
  newline?: string;
  /** Column names to include and their order. Only applies to object input. */
  columns?: string[];
  /** Skip empty lines in output (default: false) */
  skipEmptyLines?: boolean;
  /**
   * Escape formula injection in field values.
   * When true, prefixes cells starting with =, +, -, @, \t, or \r with a single quote.
   * When a RegExp, uses that pattern to detect formula prefixes to escape.
   * (default: false)
   */
  escapeFormulae?: boolean | RegExp;
  /**
   * Flatten nested objects using dot-notation keys.
   * When true, { user: { name: "Alice" } } becomes "user.name" column.
   * When a string, uses that as the separator instead of ".".
   * (default: false)
   */
  flattenObjects?: boolean | string;
}

/** PapaParse-style result object: { fields: string[], data: unknown[][] } */
interface PapaResultShape {
  fields: string[];
  data: unknown[][];
}

/**
 * Convert data to a CSV string.
 *
 * Accepts:
 * - Array of arrays: `[["a","b"], [1,2]]`
 * - Array of objects: `[{name:"Alice", age:30}]`
 * - PapaParse result shape: `{ fields: ["name","age"], data: [["Alice",30]] }`
 * - JSON string (auto-parsed)
 */
export function unparse(
  data: unknown[][] | Record<string, unknown>[] | PapaResultShape | string,
  config?: UnparseConfig,
): string {
  const delimiter = config?.delimiter ?? ",";
  const quoteChar = config?.quoteChar ?? '"';
  const escapeChar = config?.escapeChar ?? quoteChar;
  const newline = config?.newline ?? "\r\n";
  const includeHeader = config?.header ?? true;
  const skipEmptyLines = config?.skipEmptyLines ?? false;
  const quotes = config?.quotes;
  const escapeFormulae = config?.escapeFormulae ?? false;

  // Parse JSON string input
  let parsed: unknown[][] | Record<string, unknown>[] | PapaResultShape = data as any;
  if (typeof data === "string") {
    parsed = JSON.parse(data);
  }

  // Determine format and extract headers + rows
  let headers: string[] | null = null;
  let rows: unknown[][];

  if (isPapaResult(parsed)) {
    // PapaParse result shape: { fields, data }
    headers = parsed.fields;
    rows = parsed.data;
  } else if (Array.isArray(parsed) && parsed.length > 0 && !Array.isArray(parsed[0]) && typeof parsed[0] === "object" && parsed[0] !== null) {
    // Array of objects
    let objects = parsed as Record<string, unknown>[];

    // Flatten nested objects if requested
    const flattenOpt = config?.flattenObjects;
    if (flattenOpt) {
      const sep = typeof flattenOpt === "string" ? flattenOpt : ".";
      objects = objects.map(obj => flattenObj(obj, sep));
    }

    if (config?.columns) {
      headers = config.columns;
    } else {
      // Collect all unique keys in order of appearance
      const keySet = new Set<string>();
      for (const obj of objects) {
        for (const key of Object.keys(obj)) {
          keySet.add(key);
        }
      }
      headers = Array.from(keySet);
    }
    rows = objects.map(obj => headers!.map(key => obj[key]));
  } else {
    // Array of arrays
    rows = parsed as unknown[][];
    headers = null;
  }

  const lines: string[] = [];

  // Write header row
  if (headers && includeHeader) {
    lines.push(headers.map((h, i) => formatField(h, delimiter, quoteChar, escapeChar, quotes, i, escapeFormulae)).join(delimiter));
  }

  // Write data rows
  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    if (skipEmptyLines) {
      const allEmpty = row.every(v => v === null || v === undefined || v === "");
      if (allEmpty) continue;
    }

    lines.push(
      row.map((val, i) => formatField(serializeValue(val), delimiter, quoteChar, escapeChar, quotes, i, escapeFormulae)).join(delimiter)
    );
  }

  return lines.join(newline);
}

/** Serialize a value to string */
function serializeValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/** Default pattern matching formula prefixes for CSV injection */
const DEFAULT_FORMULA_PATTERN = /^[=+\-@\t\r]/;

/** Escape formula injection by prefixing with a single quote */
function escapeFormulaValue(
  value: string,
  escapeFormulae: boolean | RegExp,
): string {
  if (!escapeFormulae || value.length === 0) return value;

  const pattern = escapeFormulae instanceof RegExp
    ? escapeFormulae
    : DEFAULT_FORMULA_PATTERN;

  if (pattern.test(value)) {
    return "'" + value;
  }

  return value;
}

/** Format a single field, quoting if necessary */
function formatField(
  value: string,
  delimiter: string,
  quoteChar: string,
  escapeChar: string,
  quotes: boolean | boolean[] | undefined,
  colIndex: number,
  escapeFormulae: boolean | RegExp = false,
): string {
  // Apply formula escaping before quoting
  const safeValue = escapeFormulaValue(value, escapeFormulae);

  // Determine if forced quoting is enabled for this column
  const forceQuote = typeof quotes === "boolean"
    ? quotes
    : Array.isArray(quotes)
      ? (quotes[colIndex] ?? false)
      : false;

  const needsQuote = forceQuote ||
    safeValue.includes(delimiter) ||
    safeValue.includes(quoteChar) ||
    safeValue.includes("\n") ||
    safeValue.includes("\r") ||
    (safeValue.length > 0 && (safeValue[0] === " " || safeValue[safeValue.length - 1] === " "));

  if (needsQuote) {
    // Escape quote characters inside the value
    const escaped = safeValue.replaceAll(quoteChar, escapeChar + quoteChar);
    return quoteChar + escaped + quoteChar;
  }

  return safeValue;
}

/** Type guard for PapaParse result shape */
function isPapaResult(data: unknown): data is PapaResultShape {
  return (
    typeof data === "object" &&
    data !== null &&
    "fields" in data &&
    "data" in data &&
    Array.isArray((data as PapaResultShape).fields) &&
    Array.isArray((data as PapaResultShape).data)
  );
}
