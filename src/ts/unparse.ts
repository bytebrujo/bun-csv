/**
 * unparse() - Convert data back to CSV string
 *
 * Compatible with PapaParse's Papa.unparse() API.
 */

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
    const objects = parsed as Record<string, unknown>[];
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
    lines.push(headers.map((h, i) => formatField(h, delimiter, quoteChar, escapeChar, quotes, i)).join(delimiter));
  }

  // Write data rows
  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    if (skipEmptyLines) {
      const allEmpty = row.every(v => v === null || v === undefined || v === "");
      if (allEmpty) continue;
    }

    lines.push(
      row.map((val, i) => formatField(serializeValue(val), delimiter, quoteChar, escapeChar, quotes, i)).join(delimiter)
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

/** Format a single field, quoting if necessary */
function formatField(
  value: string,
  delimiter: string,
  quoteChar: string,
  escapeChar: string,
  quotes: boolean | boolean[] | undefined,
  colIndex: number,
): string {
  // Determine if forced quoting is enabled for this column
  const forceQuote = typeof quotes === "boolean"
    ? quotes
    : Array.isArray(quotes)
      ? (quotes[colIndex] ?? false)
      : false;

  const needsQuote = forceQuote ||
    value.includes(delimiter) ||
    value.includes(quoteChar) ||
    value.includes("\n") ||
    value.includes("\r") ||
    (value.length > 0 && (value[0] === " " || value[value.length - 1] === " "));

  if (needsQuote) {
    // Escape quote characters inside the value
    const escaped = value.replaceAll(quoteChar, escapeChar + quoteChar);
    return quoteChar + escaped + quoteChar;
  }

  return value;
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
