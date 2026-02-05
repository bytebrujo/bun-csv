# TurboCSV

High-performance CSV parser with SIMD acceleration, DataFrame operations, and CLI.

Built with Zig for native performance and Bun FFI for seamless JavaScript integration.

## Features

- **SIMD-Accelerated Parsing** - Uses ARM64 NEON/x86 SSE2 vector instructions for parallel character scanning
- **RFC 4180 Compliant** - Full support for quoted fields, escaped quotes, and multi-line values
- **Memory-Mapped Files** - Efficient handling of large files without loading everything into memory
- **DataFrame API** - Pandas-like operations: select, filter, sort, groupBy, join
- **Copy-on-Write Modifications** - Edit CSV data in-place with lazy writes
- **Full-Featured CLI** - 11 commands for data exploration and transformation
- **Cross-Platform** - Native binaries for macOS, Linux, Windows + WASM fallback

## Installation

```bash
bun add turbocsv
# or
npm install turbocsv
```

The package automatically downloads platform-specific native binaries. Falls back to WASM on unsupported platforms.

## Quick Start

### TypeScript API

```typescript
import { CSVParser, DataFrame } from "turbocsv";

// Basic parsing
const parser = new CSVParser("data.csv");

for (const row of parser) {
  console.log(row.get("name"), row.get("email"));
}

parser.close();
```

### CLI

```bash
# Count rows
turbocsv count data.csv

# Preview data
turbocsv head -n 10 data.csv
turbocsv tail -n 5 --format table data.csv

# Filter and transform
turbocsv filter "age > 21" data.csv
turbocsv sort -c name --order asc data.csv
turbocsv select "name,email,phone" data.csv

# Convert formats
turbocsv convert --to json data.csv -o data.json

# Performance testing
turbocsv benchmark data.csv
```

## API Reference

### CSVParser

```typescript
import { CSVParser } from "turbocsv";

// Basic usage
const parser = new CSVParser("file.csv");

// With options
const parser = new CSVParser("file.csv", {
  delimiter: ",",        // Field delimiter (default: auto-detect)
  hasHeader: true,       // First row is header (default: true)
  quote: '"',            // Quote character (default: ")
  escape: '"',           // Escape character (default: ")
  skipRows: 0,           // Skip N rows at start
  maxRows: 1000,         // Limit rows parsed
  writable: false,       // Enable copy-on-write modifications
});

// Iterate rows
for (const row of parser) {
  row.get(0);            // By index
  row.get("column");     // By name
  row.toArray();         // As string[]
  row.toObject();        // As Record<string, string>
}

// Get headers
const headers = parser.getHeaders(); // string[] | null

// Convert to DataFrame
const df = parser.toDataFrame();

// Always close when done
parser.close();
```

### Copy-on-Write Modifications

```typescript
const parser = new CSVParser("file.csv", { writable: true });

// Modify cells
parser.setCell(0, "name", "New Name");
parser.setCell(5, 2, "Updated Value");

// Insert/delete rows
parser.insertRow(10, ["col1", "col2", "col3"]);
parser.deleteRow(3);

// Save changes to new file
parser.save("modified.csv");

// Or discard changes
parser.discardChanges();

parser.close();
```

### DataFrame

```typescript
import { CSVParser, DataFrame } from "turbocsv";

const parser = new CSVParser("data.csv");
const df = parser.toDataFrame();

// Chain operations
const result = df
  .filter(row => row.age > 18)
  .select("name", "email", "age")
  .sorted("name", "asc")
  .first(100);

// Aggregation
const grouped = df.groupBy("department", [
  { col: "salary", fn: "mean" },
  { col: "id", fn: "count" },
]);

// Joins
const joined = df1.join(df2, {
  on: "user_id",
  type: "inner", // inner, left, right, full, cross
});

// Available aggregate functions
// count, sum, min, max, mean, median, stddev, first, last, concat
```

### CSVWriter

```typescript
import { CSVWriter } from "turbocsv";

const writer = new CSVWriter("output.csv", {
  delimiter: ",",
  quote: '"',
  lineEnding: "\n",
  includeHeader: true,
});

// Write header
writer.writeHeader(["name", "email", "age"]);

// Write rows
writer.writeRow(["Alice", "alice@example.com", "30"]);
writer.writeRows([
  ["Bob", "bob@example.com", "25"],
  ["Charlie", "charlie@example.com", "35"],
]);

writer.close();
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `count` | Count rows in CSV file |
| `head` | Show first N rows |
| `tail` | Show last N rows |
| `select` | Select specific columns |
| `filter` | Filter rows by expression |
| `sort` | Sort by column |
| `stats` | Show column statistics |
| `validate` | Validate CSV format (RFC 4180) |
| `convert` | Convert to JSON, TSV, JSONL |
| `benchmark` | Measure parsing performance |
| `completions` | Generate shell completions |

### Filter Expressions

```bash
# Comparison operators
turbocsv filter "age > 21" data.csv
turbocsv filter "status == active" data.csv
turbocsv filter "price <= 100" data.csv

# String operations
turbocsv filter "name contains John" data.csv
turbocsv filter "email startswith admin" data.csv
turbocsv filter "domain endswith .com" data.csv

# Pattern matching
turbocsv filter "phone matches ^\\+1" data.csv
```

### Output Formats

```bash
# Table (default for head/tail)
turbocsv head --format table data.csv

# CSV
turbocsv head --format csv data.csv

# JSON array
turbocsv head --format json data.csv

# JSON Lines (one object per line)
turbocsv head --format jsonl data.csv
```

### Shell Completions

```bash
# Bash
turbocsv completions bash >> ~/.bashrc

# Zsh
turbocsv completions zsh >> ~/.zshrc

# Fish
turbocsv completions fish > ~/.config/fish/completions/turbocsv.fish
```

## Configuration

Create a `.turbocsvrc` file in your project or home directory:

```json
{
  "delimiter": ",",
  "quote": "\"",
  "hasHeader": true,
  "format": "table",
  "maxRows": 1000
}
```

## Performance

### Benchmark Comparison

TurboCSV vs popular CSV libraries (Apple M1 Pro):

| File | TurboCSV | PapaParse | csv-parse | fast-csv |
|------|----------|-----------|-----------|----------|
| 1K rows (98 KB) | **122.6 MB/s** | 84.0 MB/s | 25.2 MB/s | 24.8 MB/s |
| 10K rows (1 MB) | **165.3 MB/s** | 109.3 MB/s | 34.9 MB/s | 28.7 MB/s |
| 100K rows (10 MB) | **176.1 MB/s** | 112.0 MB/s | 35.3 MB/s | 30.2 MB/s |
| 100K rows (16.5 MB) | **269.3 MB/s** | 224.6 MB/s | 40.3 MB/s | 38.1 MB/s |

**Average speedup:**
- **1.65x faster** than PapaParse
- **6.35x faster** than csv-parse
- **5.71x faster** than fast-csv

Run the benchmark yourself:

```bash
bun run benchmark:compare
```

### Why TurboCSV is Fast

- **SIMD acceleration** - ARM64 NEON/x86 SSE2 vector instructions for parallel character scanning
- **Native Zig code** - Zero-overhead FFI bindings via Bun
- **Memory-mapped files** - No copying data into JavaScript heap
- **Streaming architecture** - Process files larger than available RAM

## Building from Source

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Zig](https://ziglang.org) >= 0.11.0

### Build Commands

```bash
# Install dependencies
bun install

# Build native library
bun run build:zig

# Build TypeScript
bun run build:ts

# Build CLI
bun run build:cli

# Build everything (native + TS + CLI)
bun run build

# Build WASM fallback
bun run build:wasm

# Build all targets
bun run build:all

# Run tests
bun test

# Run benchmarks
bun run benchmark
```

### Project Structure

```
turbocsv/
├── src/
│   ├── zig/           # Zig SIMD parser
│   │   ├── parser.zig     # Main CSV parser
│   │   ├── simd.zig       # SIMD vectorized scanning
│   │   ├── mmap.zig       # Cross-platform memory mapping
│   │   ├── iconv.zig      # Character encoding support
│   │   └── dataframe.zig  # DataFrame operations
│   ├── ts/            # TypeScript bindings
│   │   ├── parser.ts
│   │   ├── dataframe.ts
│   │   ├── writer.ts
│   │   ├── ffi.ts
│   │   └── wasm-ffi.ts
│   └── cli/           # CLI application
│       ├── index.ts
│       └── commands/
├── test/              # Test files
├── wasm/              # WASM output
└── binaries/          # Native binaries (downloaded)
```

### Cross-Platform Memory Mapping

The parser uses memory-mapped files for efficient large file handling. Platform-specific implementations are abstracted in `src/zig/mmap.zig`:

| Platform | Implementation |
|----------|----------------|
| Linux/macOS | `std.posix.mmap` / `munmap` |
| Windows | `CreateFileMappingW` / `MapViewOfFile` via kernel32 externs |

This allows zero-copy file access across all supported platforms while maintaining a unified API.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
