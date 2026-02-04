/**
 * Testing utilities for TurboCSV
 */

export interface GenerateCSVOptions {
  rows: number;
  columns: string[];
  seed?: number;
  includeHeader?: boolean;
}

export interface FuzzCSVOptions {
  includeUnicode?: boolean;
  includeNestedQuotes?: boolean;
  includeHugeFields?: boolean;
  maxFieldSize?: number;
  rows?: number;
}

/** Simple seeded random number generator */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)]!;
  }
}

/** Generate test CSV data */
export function generateCSV(options: GenerateCSVOptions): string {
  const rng = new SeededRandom(options.seed ?? Date.now());
  const lines: string[] = [];

  // Parse column definitions
  const columns = options.columns.map((col) => {
    const [name, type] = col.split(":");
    return { name: name!, type: type ?? "string" };
  });

  // Header
  if (options.includeHeader !== false) {
    lines.push(columns.map((c) => c.name).join(","));
  }

  // Data rows
  const firstNames = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank"];
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Davis"];
  const cities = ["NYC", "LA", "Chicago", "Houston", "Phoenix", "Philadelphia"];

  for (let i = 0; i < options.rows; i++) {
    const row = columns.map((col) => {
      switch (col.type) {
        case "number":
        case "integer":
          return String(rng.nextInt(1, 10000));
        case "float":
          return (rng.next() * 1000).toFixed(2);
        case "date":
          const year = rng.nextInt(1990, 2024);
          const month = String(rng.nextInt(1, 12)).padStart(2, "0");
          const day = String(rng.nextInt(1, 28)).padStart(2, "0");
          return `${year}-${month}-${day}`;
        case "boolean":
          return rng.next() > 0.5 ? "true" : "false";
        case "name":
          return `${rng.pick(firstNames)} ${rng.pick(lastNames)}`;
        case "city":
          return rng.pick(cities);
        case "email":
          return `${rng.pick(firstNames).toLowerCase()}${rng.nextInt(1, 999)}@example.com`;
        case "string":
        default:
          return `value_${rng.nextInt(1, 1000)}`;
      }
    });

    lines.push(row.join(","));
  }

  return lines.join("\n") + "\n";
}

/** Generate edge-case CSV for fuzz testing */
export function fuzzCSV(options: FuzzCSVOptions = {}): string {
  const rows = options.rows ?? 100;
  const lines: string[] = [];

  // Header
  lines.push("field1,field2,field3");

  // Generate various edge cases
  const edgeCases: string[] = [
    // Empty fields
    ",,",
    // Quoted empty
    '"","",""',
    // Quotes in fields
    '"hello ""world""",normal,test',
    // Commas in fields
    '"hello, world",normal,test',
    // Newlines in fields
    '"line1\nline2",normal,test',
    // Mixed quotes and commas
    '"say ""hello, world""",test,value',
    // Leading/trailing spaces
    "  spaced  , normal , value ",
    // Numbers with formatting
    '"1,234.56","$99.99","50%"',
  ];

  // Unicode edge cases
  if (options.includeUnicode) {
    edgeCases.push(
      "日本語,中文,한국어",
      "émoji: 😀,normal,test",
      "Ω≈ç√∫,math,symbols",
      "مرحبا,שלום,Привет"
    );
  }

  // Nested quotes
  if (options.includeNestedQuotes) {
    edgeCases.push(
      '"""deeply""nested""quotes""",test,value',
      '"He said ""She said """"Hello""""",complex,test'
    );
  }

  // Add edge cases
  for (const edgeCase of edgeCases) {
    lines.push(edgeCase);
  }

  // Fill remaining rows with random data
  const rng = new SeededRandom(12345);
  const remaining = rows - lines.length;

  for (let i = 0; i < remaining; i++) {
    // Occasionally generate huge fields
    if (options.includeHugeFields && rng.next() < 0.01) {
      const size = rng.nextInt(1000, options.maxFieldSize ?? 10000);
      const hugeField = "x".repeat(size);
      lines.push(`"${hugeField}",normal,test`);
    } else {
      lines.push(`field_${i},value_${rng.nextInt(1, 1000)},data_${rng.nextInt(1, 100)}`);
    }
  }

  return lines.join("\n") + "\n";
}

/** Benchmark helper */
export interface BenchmarkResult {
  name: string;
  rowsPerSecond: number;
  bytesPerSecond: number;
  totalRows: number;
  totalBytes: number;
  durationMs: number;
}

export async function benchmark(
  name: string,
  fn: () => Promise<{ rows: number; bytes: number }>
): Promise<BenchmarkResult> {
  const start = performance.now();
  const { rows, bytes } = await fn();
  const duration = performance.now() - start;

  return {
    name,
    rowsPerSecond: (rows / duration) * 1000,
    bytesPerSecond: (bytes / duration) * 1000,
    totalRows: rows,
    totalBytes: bytes,
    durationMs: duration,
  };
}
