# TurboCSV - High-Performance CSV Parser

## Technical Specification v1.0

---

## 1. Executive Summary

TurboCSV is a high-performance CSV parsing library built with Zig and Bun, featuring SIMD-accelerated parsing, full DataFrame operations, and a comprehensive CLI. The library targets 500MB/s+ throughput while providing a complete data manipulation toolkit.

**Package Name:** `turbocsv`
**Platforms:** macOS (x64, ARM64), Linux (x64, ARM64), Windows (x64)
**Runtime:** Bun (native), Node.js/Browser (WASM fallback)

---

## 2. Architecture Overview

### 2.1 Dual-Mode Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript API Layer                      │
│  CSVParser<T> │ DataFrame │ CSVWriter │ CLI                 │
├─────────────────────────────────────────────────────────────┤
│                    Unified Parser Core                       │
│         (Adapts internally to input type)                   │
├──────────────────────┬──────────────────────────────────────┤
│   mmap File Mode     │     Streaming Mode                   │
│   (files < 50% RAM)  │     (stdin, HTTP, large files)       │
├──────────────────────┴──────────────────────────────────────┤
│                    Zig Engine (libturbocsv)                 │
│  SIMD Scanner │ Parallel Chunks │ DataFrame Ops │ iconv    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Distribution Strategy

**Chosen: Optional Native with WASM Fallback**

- npm package includes WASM build (works everywhere)
- On first run, attempts to download platform-specific native binary
- Native binary provides full SIMD acceleration
- WASM uses SIMD128 instructions where supported

*Advantages:* Zero build dependencies for users, works on any platform, native speed when available
*Trade-offs:* Larger initial package, first-run download delay, requires hosting binaries

---

## 3. Memory Management

### 3.1 Memory-Mapped File Strategy

**Chosen: Hybrid Auto-detect**

```typescript
// Internal logic
if (fileSize < availableRAM * 0.5) {
  // Full mmap - let OS handle paging
  mode = "full_mmap";
} else {
  // Chunked mmap with sliding 256MB windows
  mode = "chunked_mmap";
}
```

*Advantages:* Optimal performance for typical files, graceful handling of huge files
*Trade-offs:* Requires runtime memory detection, adds complexity for rows spanning chunk boundaries

### 3.2 String Cache Pool

**Chosen: Parser-Global Pool with Soft + Hard Limits**

| Setting | Default | Description |
|---------|---------|-------------|
| Soft Limit | 256MB | Triggers warning callback |
| Hard Limit | 1GB | Throws error, user must clear or close |

```typescript
const parser = new CSVParser("data.csv", {
  cache: {
    softLimit: 256 * 1024 * 1024,
    hardLimit: 1024 * 1024 * 1024,
    onWarning: (info) => {
      // info: { cache: { strings, rows }, mmap, buffers }
      console.warn(`Cache at ${info.cache.strings} bytes`);
    }
  }
});
```

*Advantages:* Cached strings persist for repeated access, configurable limits prevent OOM
*Trade-offs:* Memory grows with unique field access, requires user awareness for large files

### 3.3 Unescape Strategy

**Chosen: Lazy Zig Cache**

- First access returns raw pointer (zero-copy)
- If field contains escaped quotes, Zig allocates and caches unescaped version
- Subsequent accesses return cached version

*Advantages:* True zero-copy for clean fields, fast repeated access to escaped fields
*Trade-offs:* Complex memory ownership, cache contributes to pool limits

---

## 4. SIMD Implementation

### 4.1 Vector Processing

**Target:** 32 bytes (AVX2) on x64, 16 bytes (NEON) on ARM64, 16 bytes (SIMD128) in WASM

### 4.2 Boundary Handling

**Chosen: Row Batching with Adaptive Count**

- Buffer rows until batch contains ~100 rows OR buffer exceeds 64KB
- Process entire batch with SIMD
- Emit rows to iterator

*Advantages:* Consistent iteration latency regardless of row size, amortizes SIMD overhead
*Trade-offs:* Adds latency before first row emitted, memory for row buffer

### 4.3 Quote State Machine

**Chosen: Hybrid SIMD + Scalar Verify**

1. SIMD pass identifies candidate delimiter positions (commas, newlines)
2. SIMD pass identifies quote positions
3. Scalar loop verifies candidates against quote state
4. Invalid candidates (inside quotes) are filtered

*Advantages:* Robust handling of all quote edge cases, good SIMD utilization
*Trade-offs:* Scalar verification reduces theoretical maximum throughput

---

## 5. Parallel Processing

### 5.1 Thread Strategy

**Chosen: Built-in Chunked Parallel with Auto-tuning**

| File Size | Thread Count |
|-----------|--------------|
| < 100MB | 1 (sequential) |
| 100MB - 500MB | 2 |
| 500MB - 2GB | CPU count / 2 |
| > 2GB | CPU count - 1 |

### 5.2 Chunk Splitting

**Chosen: Speculative + Repair**

1. Split file at arbitrary byte offsets (e.g., every 64MB)
2. Each worker scans backward from split point to find valid row start
3. Workers process their chunks independently
4. Results merged in original row order

*Advantages:* No serial pre-scan overhead, fast parallel startup
*Trade-offs:* Complex reconciliation logic, workers may parse same row boundary

### 5.3 Row Ordering

**Chosen: Preserve Original Order with Unbounded Buffer**

- Results buffered and reordered before emission
- User sees rows 1, 2, 3... as in file
- No backpressure - parser races ahead

*Advantages:* Simple mental model, rows appear in file order
*Trade-offs:* Can consume significant memory if consumer iterates slowly

---

## 6. Input/Output

### 6.1 Input Sources

**Chosen: Full Streaming (Unified Parser)**

| Source | Implementation |
|--------|----------------|
| File path | mmap (hybrid auto-detect) |
| stdin | Streaming with 64KB minimum buffer |
| HTTP URL | Fetch to streaming buffer |
| ArrayBuffer | Direct memory reference |

```typescript
// All use same CSVParser API
const fromFile = new CSVParser("data.csv");
const fromStdin = new CSVParser(process.stdin);
const fromURL = new CSVParser("https://example.com/data.csv");
const fromBuffer = new CSVParser(arrayBuffer);
```

*Advantages:* Single unified API, maximum flexibility
*Trade-offs:* Complex internal adaptation, streaming mode can't use full mmap optimizations

### 6.2 Streaming Buffer

**Chosen: Fixed 64KB Minimum**

- Accumulate at least 64KB before processing
- Maximizes SIMD efficiency
- Adds latency for small/slow streams

### 6.3 Encoding Support

**Chosen: Full Transcoding via System iconv**

Supported encodings:
- UTF-8 (native, fastest)
- UTF-16 LE/BE (with BOM detection)
- Latin-1 / ISO-8859-1
- Windows-1252
- Shift-JIS
- And all other iconv-supported encodings

```typescript
const parser = new CSVParser("data.csv", {
  encoding: "windows-1252"  // Auto-detected if not specified
});
```

*Advantages:* Handles real-world files from any source
*Trade-offs:* Platform-dependent iconv availability, transcoding overhead

### 6.4 Delimiter Handling

**Chosen: Auto-detect + Override**

Auto-detected delimiters (in priority order):
1. `,` (comma)
2. `\t` (tab)
3. `|` (pipe)
4. `;` (semicolon)

Detection analyzes first 1KB of file. User can override:

```typescript
const parser = new CSVParser("data.csv", {
  delimiter: "\t"  // Force tab-separated
});
```

*Advantages:* Works out-of-box for most files, explicit control when needed
*Trade-offs:* Auto-detection can guess wrong on ambiguous files

---

## 7. Error Handling

### 7.1 Parse Error Strategy

**Chosen: Lenient (Best Effort)**

| Error Type | Behavior |
|------------|----------|
| Unclosed quote | Close at end of line |
| Unexpected EOF | Emit partial row |
| Inconsistent columns | First row defines count; truncate extras, pad missing with empty |

### 7.2 Error Messages

**Chosen: Human Readable**

```
Unclosed quote starting at line 45, column 12.
The quote begins here: "New York, NY
                        ^
Did you mean to escape it with ""?
```

### 7.3 Error Location

**Chosen: Line + Column + Context**

All errors include:
- Line number (1-indexed)
- Column number (1-indexed)
- ~50 characters of surrounding context
- Suggestion when applicable

### 7.4 Bounds Checking

**Chosen: Throw RangeError**

```typescript
row.get(999);  // Throws RangeError if column doesn't exist
row.get("nonexistent");  // Throws RangeError
```

*Advantages:* Catches bugs early, explicit failures
*Trade-offs:* Requires try-catch or pre-checking field count

---

## 8. Type System & Schema

### 8.1 Schema Definition

**Chosen: Header + Typed Schema with CSVParser<T>**

```typescript
interface Person {
  name: string;
  age: number;
  salary: number;
  hired: Date;
}

const schema = {
  name: { col: 0, type: "string" },
  age: { col: 1, type: "number" },
  salary: { col: 2, type: "currency" },  // Handles $1,234.56
  hired: { col: 3, type: "date" }        // ISO 8601 only
};

const parser = new CSVParser<Person>("employees.csv", { schema });

for (const row of parser) {
  // row.get("name") returns string
  // row.getTyped("age") returns number (validated)
}
```

### 8.2 Type Coercion

**Chosen: Zig Native for Performance**

Zig natively parses:
- Integers (with thousands separators: `1,234`)
- Floats (`-45.67`, `1.2e10`)
- Currency (`$1,234.56`, `€99,99`, `(123)` for negative)
- Percentages (`45%` → `0.45`)
- Booleans (`true`, `false`, `1`, `0`, `yes`, `no`)
- Dates (ISO 8601 only: `2024-01-15`, `2024-01-15T10:30:00Z`)

*Advantages:* Maximum parsing speed, no JS overhead
*Trade-offs:* Limited date format support (ISO 8601 only), locale handling in Zig

### 8.3 Validation API

**Chosen: Separate Validated API**

```typescript
// Raw access (always works, returns string)
const rawAge = row.get("age");  // "abc"

// Validated access (throws on invalid)
const typedAge = row.getTyped("age");  // TypeError: Cannot parse "abc" as number
```

*Advantages:* User chooses validation level per-access
*Trade-offs:* More API surface, potential for misuse

### 8.4 Null Semantics

**Chosen: SQL-style NULL**

| Field Value | Result |
|-------------|--------|
| `` (empty unquoted) | `null` |
| `""` (quoted empty) | `""` (empty string) |
| Missing column | `null` |

*Advantages:* Matches SQL export conventions, distinguishes intentional empty from missing
*Trade-offs:* Subtle distinction may confuse users

---

## 9. Iterator API

### 9.1 Sync and Async Iteration

**Chosen: Both (User Choice)**

```typescript
// Synchronous (blocks event loop)
for (const row of parser) {
  console.log(row.get("name"));
}

// Asynchronous (yields to event loop)
for await (const row of parser) {
  console.log(row.get("name"));
}
```

*Advantages:* Maximum flexibility, async for server workloads
*Trade-offs:* More API surface, async adds overhead

### 9.2 Pause/Resume

**Chosen: Pause/Resume for Flow Control**

```typescript
parser.pause();   // Stop emitting rows
// ... do other work ...
parser.resume();  // Continue from where paused
```

*Advantages:* Fine-grained control, useful for throttling
*Trade-offs:* More complex than simple abort, state management

---

## 10. DataFrame Operations

### 10.1 Implementation Layer

**Chosen: Zig Core Ops**

All DataFrame operations implemented in Zig with SIMD where applicable:
- `filter()`, `map()`, `sort()`, `sorted()`
- `groupBy()`, `aggregate()`
- `join()` (inner, left, right, full outer, cross)
- `first()`, `last()`, `head()`, `tail()`
- `toArray()`

### 10.2 Sort Semantics

**Chosen: Both In-place and Return New**

```typescript
df.sort("age");        // Mutates df, returns df
df.sorted("age");      // Returns new DataFrame, df unchanged
```

*Advantages:* User chooses mutability semantics
*Trade-offs:* More methods to maintain

### 10.3 Join Operations

**Chosen: All SQL Joins**

```typescript
const result = df1.join(df2, {
  on: "user_id",  // or { left: "id", right: "user_id" }
  type: "left"   // "inner" | "left" | "right" | "full" | "cross"
});
```

### 10.4 Aggregate Functions

**Chosen: Built-in + Custom Functions**

Built-in:
- `count`, `sum`, `min`, `max`, `mean`
- `median`, `stddev`, `first`, `last`, `concat`

Custom:
```typescript
df.groupBy("department").aggregate({
  avgSalary: { col: "salary", fn: "mean" },
  custom: {
    col: "bonus",
    fn: (values) => values.reduce((a, b) => a + b, 0) / values.length
  }
});
```

*Advantages:* Covers most use cases, extensible
*Trade-offs:* Custom callbacks have JS↔Zig overhead

---

## 11. Write Support

### 11.1 Writer Mode

**Chosen: Hybrid with Flush**

```typescript
const writer = new CSVWriter("output.csv", {
  flushEvery: 1000  // Rows before auto-flush
});

writer.writeRow(["name", "age"]);
writer.writeRow(["Alice", 30]);
writer.flush();  // Explicit flush
writer.close();
```

- Buffers configurable row count
- Auto-flushes when buffer full
- Allows modifications within current buffer

*Advantages:* Bounded memory, allows small modifications
*Trade-offs:* Can't modify already-flushed rows

### 11.2 Modify Mode

**Chosen: Copy-on-Write**

```typescript
const parser = new CSVParser("data.csv", { writable: true });

// Modifications tracked in memory
parser.setCell(5, "age", "31");
parser.deleteRow(10);
parser.insertRow(0, ["header1", "header2"]);

// Original unchanged until save
parser.save("modified.csv");  // Or parser.save() to overwrite
```

*Advantages:* Safe - original file preserved until explicit save
*Trade-offs:* Memory proportional to modifications, can't handle huge edit sets

---

## 12. CLI Specification

### 12.1 Commands

```bash
turbocsv <command> [options] [file]

Commands:
  count       Count rows in CSV
  head        Show first N rows
  tail        Show last N rows
  select      Select specific columns
  filter      Filter rows by condition
  sort        Sort rows
  convert     Convert between formats (CSV, TSV, JSON)
  validate    Check CSV validity
  stats       Show column statistics
  benchmark   Measure parsing performance
```

### 12.2 Input Sources

**Chosen: Files + Stdin + URLs**

```bash
turbocsv count data.csv
cat data.csv | turbocsv count
turbocsv count https://example.com/data.csv
```

### 12.3 Output Format

**Chosen: Auto-detect**

- TTY: Pretty-printed ASCII tables
- Piped: CSV format

```bash
turbocsv head data.csv          # Pretty table
turbocsv head data.csv | less   # CSV format
turbocsv head --format=json data.csv  # Explicit JSON
```

### 12.4 Column Selection

**Chosen: Name or Index**

```bash
turbocsv select name,age data.csv       # By name
turbocsv select 0,2,5 data.csv          # By index
turbocsv select name,0,age data.csv     # Mixed
```

### 12.5 Interactive Features

**Chosen: Interactive Prompts**

- Confirm destructive operations (overwrite files)
- Progress bars for large files
- Adaptive ETA with rolling average

### 12.6 Success Output

**Chosen: Summary Stats**

```
✓ Processed 1,234,567 rows in 2.3s (536 MB/s)
  Output: output.csv (45.2 MB)
```

### 12.7 Shell Completions

**Chosen: Bash + Zsh**

```bash
turbocsv completions bash >> ~/.bashrc
turbocsv completions zsh >> ~/.zshrc
```

### 12.8 Configuration File

**Chosen: Project-local .turbocsvrc**

```json
{
  "delimiter": ",",
  "encoding": "utf-8",
  "hasHeader": true,
  "schema": {
    "age": "number",
    "date": "date"
  }
}
```

---

## 13. Resource Management

### 13.1 Cleanup Model

**Chosen: Manual Only**

```typescript
const parser = new CSVParser("data.csv");
try {
  // ... use parser ...
} finally {
  parser.close();  // Required to release mmap and file handle
}
```

*Advantages:* Predictable resource release, matches system programming patterns
*Trade-offs:* Leaks if user forgets close()

### 13.2 Concurrent Modification Detection

**Chosen: Detect + Error**

- Periodically checks file mtime/size during parsing
- Throws error if file modified externally
- User must handle by reopening parser

*Advantages:* Catches accidental concurrent writes
*Trade-offs:* Adds syscall overhead

---

## 14. Performance Optimizations

### 14.1 Wide File Handling

**Chosen: Column Index Optimization**

- First named column access builds hash map
- Subsequent named accesses are O(1)
- Index-based access always O(1)

### 14.2 Progress API

**Chosen: Full Stats Object**

```typescript
const stats = parser.stats;
// {
//   bytesProcessed: 104857600,
//   totalBytes: 1073741824,
//   rowsEmitted: 1234567,
//   errorCount: 0,
//   elapsedMs: 1956,
//   throughputMBps: 53.6
// }
```

---

## 15. RFC 4180 Compliance

### 15.1 Standard Support

**Chosen: Common Extensions**

Fully supported:
- RFC 4180 base specification
- CRLF and LF line endings
- Quoted fields with embedded delimiters
- Escaped quotes (`""`)

Extensions accepted:
- Backslash escapes (`\n`, `\"`, `\\`)
- Unquoted fields containing spaces
- UTF-8 and other encodings

### 15.2 Excel Formulas

**Chosen: Pass Through**

- Formula strings (`=SUM(A1:A10)`) returned as-is
- No evaluation or interpretation
- User handles formula data as needed

*Advantages:* No Excel dependency, no security concerns
*Trade-offs:* User must handle formula strings if they need values

---

## 16. Testing & Quality

### 16.1 Test Utilities

**Chosen: Fuzzer + Generator**

```typescript
import { generateCSV, fuzzCSV } from "turbocsv/testing";

// Generate test data
const csv = generateCSV({
  rows: 1000000,
  columns: ["name:string", "age:number", "date:date"],
  seed: 12345  // Reproducible
});

// Generate edge cases
const edgeCases = fuzzCSV({
  includeUnicode: true,
  includeNestedQuotes: true,
  includeHugeFields: true,
  maxFieldSize: 1024 * 1024
});
```

*Advantages:* Easy benchmarking, comprehensive edge case testing
*Trade-offs:* Larger package size

### 16.2 Debug Mode

**Chosen: Bundled Debug Mode**

```bash
CSV_DEBUG=1 node script.js
```

Outputs:
- Memory allocation traces
- SIMD path selection
- Chunk splitting decisions
- Cache hit/miss rates

---

## 17. API Reference

### 17.1 CSVParser<T>

```typescript
class CSVParser<T = Record<string, string>> implements Iterable<CSVRow<T>>, AsyncIterable<CSVRow<T>> {
  constructor(
    source: string | ReadableStream | ArrayBuffer,
    options?: CSVParserOptions<T>
  );

  // Iteration
  [Symbol.iterator](): Iterator<CSVRow<T>>;
  [Symbol.asyncIterator](): AsyncIterator<CSVRow<T>>;

  // Control
  pause(): void;
  resume(): void;
  close(): void;

  // Stats
  readonly stats: CSVStats;

  // DataFrame conversion
  toDataFrame(): DataFrame<T>;
}

interface CSVParserOptions<T> {
  delimiter?: string;
  encoding?: string;
  hasHeader?: boolean;
  schema?: Schema<T>;
  writable?: boolean;
  cache?: CacheOptions;
}
```

### 17.2 CSVRow<T>

```typescript
class CSVRow<T> {
  get(column: keyof T | number): string | null;
  getTyped<K extends keyof T>(column: K): T[K];
  readonly fieldCount: number;
}
```

### 17.3 DataFrame<T>

```typescript
class DataFrame<T> {
  // Selection
  select(...columns: (keyof T)[]): DataFrame<Partial<T>>;
  filter(predicate: (row: T) => boolean): DataFrame<T>;

  // Transformation
  map<U>(fn: (row: T) => U): DataFrame<U>;
  sort(column: keyof T, order?: "asc" | "desc"): this;
  sorted(column: keyof T, order?: "asc" | "desc"): DataFrame<T>;

  // Aggregation
  groupBy<K extends keyof T>(column: K): GroupedDataFrame<T, K>;

  // Joins
  join<U>(other: DataFrame<U>, options: JoinOptions<T, U>): DataFrame<T & U>;

  // Output
  toArray(): T[];
  first(n?: number): T[];
  last(n?: number): T[];
}
```

### 17.4 CSVWriter

```typescript
class CSVWriter {
  constructor(path: string, options?: CSVWriterOptions);

  writeRow(values: (string | number | null)[]): void;
  writeRows(rows: (string | number | null)[][]): void;
  flush(): void;
  close(): void;
}
```

---

## 18. Implementation Roadmap

### Phase 1: Core Parser
- Zig mmap implementation
- Basic SIMD scanner (no quotes)
- Bun FFI bridge
- Sync iterator API

### Phase 2: Full RFC 4180
- Quote handling with SIMD
- Escape sequences
- Error recovery
- Async iterator

### Phase 3: Performance
- Parallel chunk processing
- Row reordering buffer
- Cache pool with limits
- Encoding transcoding

### Phase 4: DataFrame
- Filter, map, sort in Zig
- GroupBy with aggregates
- Join operations
- Custom aggregate callbacks

### Phase 5: Write Support
- CSVWriter with flush
- Copy-on-write modifications
- Transaction tracking

### Phase 6: CLI & Polish
- Full CLI implementation
- Shell completions
- Configuration file
- Documentation

### Phase 7: Distribution
- WASM build with SIMD128
- Platform binary hosting
- npm package automation
- CI/CD pipeline

---

## 19. Benchmarking Plan

### Targets
- **Throughput:** 500MB/s+ on modern hardware
- **Latency:** < 100ms to first row for streaming

### Comparisons
1. Node.js `csv-parser` (pure JS baseline)
2. Python `pandas.read_csv` (C-optimized baseline)
3. Rust `csv` crate (systems language baseline)
4. Go `encoding/csv` (concurrent baseline)

### Test Files
- 1GB generated CSV (5 million rows × 20 columns)
- Wide CSV (10,000 columns × 100,000 rows)
- Quoted CSV (heavy escaping, edge cases)
- Unicode CSV (multi-byte characters)

---

## 20. File Structure

```
turbocsv/
├── src/
│   ├── zig/
│   │   ├── parser.zig       # Core parser
│   │   ├── simd.zig         # SIMD implementations
│   │   ├── parallel.zig     # Chunk parallelism
│   │   ├── dataframe.zig    # DataFrame ops
│   │   ├── writer.zig       # CSV writer
│   │   └── iconv.zig        # Encoding bridge
│   ├── ts/
│   │   ├── index.ts         # Main exports
│   │   ├── parser.ts        # CSVParser class
│   │   ├── row.ts           # CSVRow class
│   │   ├── dataframe.ts     # DataFrame class
│   │   ├── writer.ts        # CSVWriter class
│   │   └── ffi.ts           # Bun FFI bindings
│   └── cli/
│       ├── index.ts         # CLI entry point
│       └── commands/        # Subcommands
├── wasm/
│   └── turbocsv.wasm        # WASM fallback build
├── binaries/                # Platform binaries (downloaded)
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── package.json
```

---

## 21. Getting Started

```bash
npm install turbocsv
```

```typescript
import { CSVParser } from "turbocsv";

// Simple iteration
for (const row of new CSVParser("data.csv")) {
  console.log(row.get(0), row.get("name"));
}

// With schema
interface User {
  name: string;
  age: number;
}

const parser = new CSVParser<User>("users.csv", {
  schema: {
    name: { col: 0, type: "string" },
    age: { col: 1, type: "number" }
  }
});

for (const row of parser) {
  const age: number = row.getTyped("age");
}

// DataFrame operations
const df = parser.toDataFrame()
  .filter(row => row.age > 18)
  .sorted("name");

console.log(df.first(10));
```

---

*Specification Version: 1.0*
*Last Updated: 2024*
