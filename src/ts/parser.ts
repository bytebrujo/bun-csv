/**
 * CSVParser - Main parser class
 */

import { loadNativeLibrary, toCString, isNativeAvailable, CacheLimitStatus, Encoding } from "./ffi";
import { toArrayBuffer, type Pointer } from "bun:ffi";
import { readFileSync } from "fs";
import { CSVRow } from "./row";
import { DataFrame } from "./dataframe";
import { CSVWriter, ModificationLog } from "./writer";
import type { Schema, CSVStats, CacheOptions } from "./types";
import type { CSVError, CSVErrorCallback } from "./errors";

export { CacheLimitStatus, Encoding };

/** Result passed to step callback (per-row) */
export interface StepResult {
  /** Row data as object (with headers) or array (without) */
  data: Record<string, string | null> | (string | null)[];
  /** Errors for this row */
  errors: any[];
  /** Parse metadata */
  meta: ParseMeta;
}

/** Result passed to chunk callback (per-batch) */
export interface ChunkResult {
  /** Array of row data */
  data: (Record<string, string | null> | (string | null)[])[];
  /** Errors for this chunk */
  errors: any[];
  /** Parse metadata */
  meta: ParseMeta;
}

/** Parse metadata */
export interface ParseMeta {
  /** Delimiter used */
  delimiter: string;
  /** Line ending detected */
  linebreak: string;
  /** Whether parsing was aborted */
  aborted: boolean;
  /** Whether more data is available (truncated) */
  truncated: boolean;
}

/** Handle for controlling the parser from callbacks */
export interface ParserHandle {
  /** Stop parsing immediately */
  abort: () => void;
  /** Pause parsing (call resume() to continue) */
  pause: () => void;
  /** Resume parsing after pause */
  resume: () => void;
}

/** Parser options */
export interface CSVParserOptions<T = Record<string, string>> {
  /** Field delimiter. Set to "auto" for auto-detection (default: ",") */
  delimiter?: string;
  /** Candidate delimiters for auto-detection (default: [",", "\t", "|", ";"]) */
  delimitersToGuess?: string[];
  /** Quote character (default: ") */
  quoteChar?: string;
  /** Escape character for quotes (default: same as quoteChar) */
  escapeChar?: string;
  /** Whether first row is header (default: true) */
  hasHeader?: boolean;
  /** Skip empty rows (default: true) */
  skipEmptyRows?: boolean;
  /** Skip lines starting with this character (default: false/disabled). Set to true for '#', or a string for custom. */
  comments?: boolean | string;
  /** Maximum number of data rows to parse (default: 0 = unlimited). Header row is not counted. */
  preview?: number;
  /** Number of raw lines to skip before parsing begins (default: 0). Useful for files with metadata preambles. */
  skipFirstNLines?: number;
  /** File encoding (default: auto-detect) */
  encoding?: string;
  /** Schema for typed access */
  schema?: Schema<T>;
  /** Enable write support */
  writable?: boolean;
  /** Cache options */
  cache?: CacheOptions;
  /** Error callback invoked for each parsing error */
  onError?: CSVErrorCallback;
  /**
   * Auto-convert string values to JavaScript types.
   * - `true`: enable for all fields
   * - `Record<string, boolean>`: enable per header name
   * - `(field: string | number) => boolean`: function returning whether to type a field
   */
  dynamicTyping?: boolean | Record<string, boolean> | ((field: string | number) => boolean);
  /** Transform each field value during parsing. Receives (value, headerNameOrIndex). */
  transform?: (value: string, field: string | number) => string;
  /** Transform header names when they are first read. Receives (header, index). */
  transformHeader?: (header: string, index: number) => string;
  /** Step callback - called for each row during parse() */
  step?: (results: StepResult, parser: ParserHandle) => void;
  /** Chunk callback - called for each batch during parse() */
  chunk?: (results: ChunkResult, parser: ParserHandle) => void;
  /** Rows per chunk when using chunk callback (default: 1000) */
  chunkSize?: number;
}

/** Input source types */
type InputSource = string | ReadableStream | ArrayBuffer | Uint8Array;

/**
 * High-performance CSV parser with lazy field access.
 *
 * @example
 * ```ts
 * // Simple iteration
 * for (const row of new CSVParser("data.csv")) {
 *   console.log(row.get(0));
 * }
 *
 * // With schema
 * const parser = new CSVParser<User>("users.csv", {
 *   schema: { name: { col: 0, type: "string" }, age: { col: 1, type: "number" } }
 * });
 * ```
 */
export class CSVParser<T = Record<string, string>>
  implements Iterable<CSVRow<T>>, AsyncIterable<CSVRow<T>>
{
  private handle: number | null = null;
  private options: CSVParserOptions<T>;
  private source: InputSource;
  private headers: Map<string, number> | null = null;
  private headerRow: string[] | null = null;
  private startTime: number = 0;
  private closed: boolean = false;
  private sourcePath: string | null = null;

  // Error tracking
  private _errors: CSVError[] = [];
  private dataRowIndex: number = 0;

  // Step/chunk callback state
  private aborted: boolean = false;
  private paused: boolean = false;
  private parserHandle: ParserHandle | null = null;

  // Copy-on-write modification tracking
  private modifications: ModificationLog | null = null;
  private cachedRows: Map<number, string[]> | null = null;
  private totalRowCount: number = 0;

  constructor(source: InputSource, options: CSVParserOptions<T> = {}) {
    this.source = source;
    this.options = {
      hasHeader: true,
      quoteChar: '"',
      escapeChar: options.escapeChar ?? options.quoteChar ?? '"',
      delimiter: ',',
      skipEmptyRows: true,
      ...options,
    };

    // Initialize modification tracking if writable
    if (options.writable) {
      this.modifications = new ModificationLog();
      this.cachedRows = new Map();
    }

    // Auto-detect delimiter if requested
    if (this.options.delimiter === "auto") {
      this.options.delimiter = this.autoDetectDelimiter(source);
    }

    // Initialize immediately for file paths
    if (typeof source === "string" && !source.startsWith("http")) {
      this.sourcePath = source;
      this.initFromFile(source);
    } else if (source instanceof Uint8Array) {
      this.initFromBuffer(source);
    } else if (source instanceof ArrayBuffer) {
      this.initFromBuffer(new Uint8Array(source));
    }
  }

  /**
   * Initialize parser from file path.
   */
  private initFromFile(path: string): void {
    if (!isNativeAvailable()) {
      throw new Error("Native library not available. Build with: bun run build:zig");
    }

    const lib = loadNativeLibrary();
    const pathBytes = toCString(path);

    const config = this.resolveNativeConfig();

    this.handle = lib.csv_init_with_config(
      pathBytes,
      config.delimiter,
      config.quoteChar,
      config.escapeChar,
      config.hasHeader,
      config.skipEmptyRows,
      config.commentChar,
      config.preview,
      config.skipFirstNLines,
    ) as number;

    if (!this.handle) {
      throw new Error(`Failed to open CSV file: ${path}`);
    }

    this.startTime = performance.now();

    // Parse headers if enabled
    if (this.options.hasHeader) {
      this.parseHeaders();
    }
  }

  /**
   * Initialize parser from buffer.
   */
  private initFromBuffer(data: Uint8Array): void {
    if (!isNativeAvailable()) {
      throw new Error("Native library not available. Build with: bun run build:zig");
    }

    const lib = loadNativeLibrary();
    const config = this.resolveNativeConfig();

    this.handle = lib.csv_init_buffer_with_config(
      data,
      data.length,
      config.delimiter,
      config.quoteChar,
      config.escapeChar,
      config.hasHeader,
      config.skipEmptyRows,
      config.commentChar,
      config.preview,
      config.skipFirstNLines,
    ) as number;

    if (!this.handle) {
      throw new Error("Failed to initialize parser from buffer");
    }

    this.startTime = performance.now();

    if (this.options.hasHeader) {
      this.parseHeaders();
    }
  }

  /**
   * Parse header row and build column name map.
   */
  private parseHeaders(): void {
    const lib = loadNativeLibrary();

    if (!this.handle || !lib.csv_next_row(this.handle)) {
      return;
    }

    const fieldCount = lib.csv_get_field_count(this.handle);
    this.headers = new Map();
    this.headerRow = [];

    const row = new CSVRow<Record<string, string>>(this.handle, fieldCount);

    for (let i = 0; i < fieldCount; i++) {
      let value = row.get(i) ?? `col${i}`;
      if (this.options.transformHeader) {
        value = this.options.transformHeader(value, i);
      }
      this.headers.set(value, i);
      this.headerRow.push(value);
    }
  }

  /**
   * Get all parsing errors collected during iteration.
   */
  get errors(): ReadonlyArray<CSVError> {
    return this._errors;
  }

  /**
   * Record a parsing error and invoke the onError callback if set.
   */
  private recordError(error: CSVError): void {
    this._errors.push(error);
    this.options.onError?.(error);
  }

  /**
   * Get current parsing statistics.
   */
  get stats(): CSVStats {
    if (!this.handle) {
      return {
        bytesProcessed: 0,
        totalBytes: 0,
        rowsEmitted: 0,
        errorCount: 0,
        cacheBytes: 0,
        elapsedMs: 0,
        throughputMBps: 0,
      };
    }

    const lib = loadNativeLibrary();
    const statsPtr = lib.csv_get_stats(this.handle);

    // TODO: Read stats from pointer
    const elapsed = performance.now() - this.startTime;

    return {
      bytesProcessed: 0,
      totalBytes: 0,
      rowsEmitted: 0,
      errorCount: 0,
      cacheBytes: 0,
      elapsedMs: elapsed,
      throughputMBps: 0,
    };
  }

  /**
   * Get header column names.
   */
  getHeaders(): string[] | null {
    return this.headerRow;
  }

  /**
   * Pause parsing.
   */
  pause(): void {
    if (this.handle) {
      const lib = loadNativeLibrary();
      lib.csv_pause(this.handle);
    }
  }

  /**
   * Resume parsing.
   */
  resume(): void {
    if (this.handle) {
      const lib = loadNativeLibrary();
      lib.csv_resume(this.handle);
    }
  }

  /**
   * Check if file was modified externally.
   */
  checkModified(): boolean {
    if (!this.handle) return false;
    const lib = loadNativeLibrary();
    return lib.csv_check_modified(this.handle);
  }

  /**
   * Convert to DataFrame for tabular operations.
   */
  toDataFrame(): DataFrame<T> {
    return new DataFrame(this);
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Get current cache size in bytes.
   */
  getCacheSize(): number {
    if (!this.handle) return 0;
    const lib = loadNativeLibrary();
    return lib.csv_get_cache_size(this.handle);
  }

  /**
   * Get cache limit status.
   */
  getCacheStatus(): CacheLimitStatus {
    if (!this.handle) return CacheLimitStatus.OK;
    const lib = loadNativeLibrary();
    return lib.csv_get_cache_status(this.handle) as CacheLimitStatus;
  }

  /**
   * Clear the string cache to free memory.
   * Useful when processing large files to prevent memory exhaustion.
   */
  clearCache(): void {
    if (!this.handle) return;
    const lib = loadNativeLibrary();
    lib.csv_clear_cache(this.handle);
  }

  /**
   * Set soft cache limit (triggers warning callback when exceeded).
   * @param bytes Limit in bytes (default: 256MB)
   */
  setSoftCacheLimit(bytes: number): void {
    if (!this.handle) return;
    const lib = loadNativeLibrary();
    lib.csv_set_soft_cache_limit(this.handle, bytes);
  }

  /**
   * Set hard cache limit (stops caching when exceeded).
   * @param bytes Limit in bytes (default: 1GB)
   */
  setHardCacheLimit(bytes: number): void {
    if (!this.handle) return;
    const lib = loadNativeLibrary();
    lib.csv_set_hard_cache_limit(this.handle, bytes);
  }

  // ==========================================================================
  // Copy-on-Write Modifications
  // ==========================================================================

  /**
   * Check if parser is in writable mode.
   */
  get writable(): boolean {
    return this.modifications !== null;
  }

  /**
   * Get count of pending modifications.
   */
  get modificationCount(): number {
    return this.modifications?.modificationCount ?? 0;
  }

  /**
   * Check if there are unsaved modifications.
   */
  get hasUnsavedChanges(): boolean {
    return this.modifications?.hasModifications ?? false;
  }

  /**
   * Modify a cell value. Changes are tracked but not applied until save().
   * @param row Row index (0-based, excluding header)
   * @param column Column index or name
   * @param value New value
   */
  setCell(row: number, column: number | string, value: string): void {
    if (!this.modifications) {
      throw new Error("Parser not in writable mode. Create with { writable: true }");
    }

    // Resolve column name to index if needed
    const colIndex = typeof column === "string" ? this.resolveColumnIndex(column) : column;

    // Cache the original row if not already cached
    this.ensureRowCached(row);

    this.modifications.setCell(row, colIndex, value);
  }

  /**
   * Mark a row for deletion. Row will be skipped when saving.
   * @param row Row index (0-based, excluding header)
   */
  deleteRow(row: number): void {
    if (!this.modifications) {
      throw new Error("Parser not in writable mode. Create with { writable: true }");
    }

    this.modifications.deleteRow(row);
  }

  /**
   * Insert a new row at the specified position.
   * @param position Position to insert at (0 = before first data row)
   * @param values Field values for the new row
   */
  insertRow(position: number, values: (string | null)[]): void {
    if (!this.modifications) {
      throw new Error("Parser not in writable mode. Create with { writable: true }");
    }

    this.modifications.insertRow(position, values);
  }

  /**
   * Save modifications to file.
   * @param outputPath Output path (defaults to overwriting original file)
   */
  save(outputPath?: string): void {
    if (!this.modifications) {
      throw new Error("Parser not in writable mode. Create with { writable: true }");
    }

    const targetPath = outputPath ?? this.sourcePath;
    if (!targetPath) {
      throw new Error("No output path specified and no source file path available");
    }

    // Cache all rows first if saving to same file
    if (targetPath === this.sourcePath) {
      this.cacheAllRows();
    }

    const writer = new CSVWriter(targetPath, {
      delimiter: this.options.delimiter ?? ",",
      quoteChar: this.options.quoteChar ?? '"',
    });

    try {
      // Write header if present
      if (this.headerRow) {
        writer.writeHeader(this.headerRow);
      }

      // Track output row position for insertions
      let outputPosition = 0;

      // Write rows with modifications applied
      for (let originalRow = 0; originalRow < this.totalRowCount; originalRow++) {
        // Check for insertions at this position
        const inserted = this.modifications!.getInsertedRow(outputPosition);
        if (inserted) {
          writer.writeRow(inserted.map(v => v ?? ""));
          outputPosition++;
        }

        // Skip deleted rows
        if (this.modifications!.isDeleted(originalRow)) {
          continue;
        }

        // Get original row data
        const originalData = this.cachedRows?.get(originalRow);
        if (!originalData) {
          continue;
        }

        // Apply cell edits
        const rowData = originalData.map((value, colIndex) => {
          const edit = this.modifications!.getCellEdit(originalRow, colIndex);
          return edit ?? value;
        });

        writer.writeRow(rowData);
        outputPosition++;
      }

      // Check for insertions at the end
      const finalInsert = this.modifications!.getInsertedRow(outputPosition);
      if (finalInsert) {
        writer.writeRow(finalInsert.map(v => v ?? ""));
      }

      writer.close();

      // Clear modifications after successful save
      this.modifications!.clear();
    } catch (err) {
      writer.close();
      throw err;
    }
  }

  /**
   * Discard all pending modifications.
   */
  discardChanges(): void {
    if (this.modifications) {
      this.modifications.clear();
    }
  }

  /**
   * Get a cell value (with modifications applied).
   * @param row Row index
   * @param column Column index or name
   */
  getCell(row: number, column: number | string): string | null {
    const colIndex = typeof column === "string" ? this.resolveColumnIndex(column) : column;

    // Check for modification first
    if (this.modifications) {
      const edit = this.modifications.getCellEdit(row, colIndex);
      if (edit !== undefined) {
        return edit;
      }

      // Check if row is deleted
      if (this.modifications.isDeleted(row)) {
        return null;
      }
    }

    // Get from cache if available
    const cachedRow = this.cachedRows?.get(row);
    if (cachedRow && colIndex < cachedRow.length) {
      return cachedRow[colIndex] ?? null;
    }

    return null;
  }

  /**
   * Resolve parser options to native config values (char codes + booleans).
   */
  private resolveNativeConfig() {
    const comments = this.options.comments;
    let commentChar = 0; // 0 = disabled
    if (comments === true) {
      commentChar = "#".charCodeAt(0);
    } else if (typeof comments === "string" && comments.length > 0) {
      commentChar = comments.charCodeAt(0);
    }

    return {
      delimiter: (this.options.delimiter ?? ",").charCodeAt(0),
      quoteChar: (this.options.quoteChar ?? '"').charCodeAt(0),
      escapeChar: (this.options.escapeChar ?? this.options.quoteChar ?? '"').charCodeAt(0),
      hasHeader: this.options.hasHeader ?? true,
      skipEmptyRows: this.options.skipEmptyRows ?? true,
      commentChar,
      preview: this.options.preview ?? 0,
      skipFirstNLines: this.options.skipFirstNLines ?? 0,
    };
  }

  /**
   * Auto-detect delimiter by sampling data and testing candidates.
   * Returns the detected single-character delimiter string.
   */
  private autoDetectDelimiter(source: InputSource): string {
    const lib = loadNativeLibrary();

    // Get sample data
    let sample: Uint8Array;
    if (typeof source === "string" && !source.startsWith("http")) {
      // Read first 8KB of file for detection
      const fullBuf = readFileSync(source);
      sample = fullBuf.length > 8192 ? fullBuf.subarray(0, 8192) : fullBuf;
    } else if (source instanceof Uint8Array) {
      sample = source.length > 8192 ? source.subarray(0, 8192) : source;
    } else if (source instanceof ArrayBuffer) {
      const view = new Uint8Array(source);
      sample = view.length > 8192 ? view.subarray(0, 8192) : view;
    } else {
      return ","; // Fallback for streams
    }

    // Build candidates array
    const guesses = this.options.delimitersToGuess;
    let candidatesArray = new Uint8Array(1); // dummy, ignored when numCandidates=0
    let numCandidates = 0;
    if (guesses && guesses.length > 0) {
      candidatesArray = new Uint8Array(guesses.length);
      for (let i = 0; i < guesses.length; i++) {
        candidatesArray[i] = guesses[i]!.charCodeAt(0);
      }
      numCandidates = guesses.length;
    }

    const quoteChar = (this.options.quoteChar ?? '"').charCodeAt(0);
    const detected = lib.csv_detect_delimiter(
      sample,
      sample.length,
      candidatesArray,
      numCandidates,
      quoteChar,
    ) as number;

    return String.fromCharCode(detected);
  }

  /**
   * Resolve column name to index.
   */
  private resolveColumnIndex(name: string): number {
    if (!this.headers) {
      throw new Error(`Column "${name}" not found - no headers available`);
    }

    const index = this.headers.get(name);
    if (index === undefined) {
      throw new Error(`Column "${name}" not found`);
    }

    return index;
  }

  /**
   * Ensure a row is cached for modification tracking.
   */
  private ensureRowCached(row: number): void {
    if (!this.cachedRows || this.cachedRows.has(row)) {
      return;
    }

    // Need to re-parse to get the row
    // For now, cache all rows (can be optimized later for random access)
    this.cacheAllRows();
  }

  /**
   * Cache all rows for modification.
   */
  private cacheAllRows(): void {
    if (!this.cachedRows || !this.handle) {
      return;
    }

    // Reset parser to beginning
    const lib = loadNativeLibrary();

    // Re-initialize parser to re-read
    if (this.sourcePath) {
      // Close current handle
      lib.csv_close(this.handle);

      // Re-open with same config
      const pathBytes = toCString(this.sourcePath);
      const config = this.resolveNativeConfig();

      this.handle = lib.csv_init_with_config(
        pathBytes,
        config.delimiter,
        config.quoteChar,
        config.escapeChar,
        config.hasHeader,
        config.skipEmptyRows,
        config.commentChar,
        config.preview,
        config.skipFirstNLines,
      ) as number;

      if (!this.handle) {
        throw new Error("Failed to re-open file for caching");
      }

      // Skip header
      if (this.options.hasHeader) {
        lib.csv_next_row(this.handle);
      }

      // Cache all data rows
      let rowIndex = 0;
      while (lib.csv_next_row(this.handle)) {
        if (!this.cachedRows.has(rowIndex)) {
          const fieldCount = lib.csv_get_field_count(this.handle);
          const row = new CSVRow<T>(this.handle, fieldCount, this.headers, this.options.schema ?? null);

          const rowData: string[] = [];
          for (let i = 0; i < fieldCount; i++) {
            rowData.push(row.get(i) ?? "");
          }

          this.cachedRows.set(rowIndex, rowData);
        }
        rowIndex++;
      }

      this.totalRowCount = rowIndex;
    }
  }

  // ==========================================================================
  // Static Utilities
  // ==========================================================================

  /**
   * Get optimal thread count for parallel processing based on data size.
   */
  static getOptimalThreadCount(dataSize: number): number {
    if (!isNativeAvailable()) return 1;
    const lib = loadNativeLibrary();
    return lib.csv_get_optimal_thread_count(dataSize);
  }

  /**
   * Detect encoding from data buffer.
   */
  static detectEncoding(data: Uint8Array): Encoding {
    if (!isNativeAvailable()) return Encoding.UTF8;
    const lib = loadNativeLibrary();
    return lib.csv_detect_encoding(data, data.length) as Encoding;
  }

  /**
   * Detect BOM (Byte Order Mark) and return its length.
   * @returns BOM length in bytes (0 if no BOM)
   */
  static detectBOM(data: Uint8Array): number {
    if (!isNativeAvailable()) return 0;
    const lib = loadNativeLibrary();
    return lib.csv_detect_bom(data, data.length);
  }

  /**
   * Get SIMD vector width used by the parser.
   */
  static getSIMDWidth(): number {
    if (!isNativeAvailable()) return 0;
    const lib = loadNativeLibrary();
    return lib.csv_get_simd_width();
  }

  // ==========================================================================
  // Step / Chunk Callback API
  // ==========================================================================

  /**
   * Run the parser with step/chunk callbacks.
   * Alternative to iteration — provides callback-style streaming API.
   * When step is set, the callback fires once per row.
   * When chunk is set, the callback fires once per batch (chunkSize rows).
   */
  parse(): void {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }
    if (!this.options.step && !this.options.chunk) {
      throw new Error("parse() requires a step or chunk callback in options");
    }

    this.aborted = false;
    this.paused = false;
    this.runCallbacks();
  }

  private getOrCreateHandle(): ParserHandle {
    if (!this.parserHandle) {
      this.parserHandle = {
        abort: () => {
          this.aborted = true;
        },
        pause: () => {
          this.paused = true;
        },
        resume: () => {
          this.paused = false;
          this.runCallbacks();
        },
      };
    }
    return this.parserHandle;
  }

  private createMeta(): ParseMeta {
    return {
      delimiter: this.options.delimiter ?? ",",
      linebreak: "\n",
      aborted: this.aborted,
      truncated: false,
    };
  }

  private runCallbacks(): void {
    if (this.options.step) {
      this.runStep();
    } else if (this.options.chunk) {
      this.runChunk();
    }
  }

  private runStep(): void {
    if (!this.handle) return;

    const lib = loadNativeLibrary();
    const handle = this.getOrCreateHandle();

    while (!this.aborted && !this.paused && lib.csv_next_row(this.handle)) {
      const fieldCount = lib.csv_get_field_count(this.handle);
      const row = new CSVRow<T>(
        this.handle,
        fieldCount,
        this.headers,
        this.options.schema ?? null
      );

      const data = this.headers ? row.toObject() : row.toArray();

      this.options.step!({
        data,
        errors: [],
        meta: this.createMeta(),
      }, handle);
    }
  }

  private runChunk(): void {
    if (!this.handle) return;

    const lib = loadNativeLibrary();
    const handle = this.getOrCreateHandle();
    const chunkSize = this.options.chunkSize ?? 1000;

    let chunk: (Record<string, string | null> | (string | null)[])[] = [];

    while (!this.aborted && !this.paused && lib.csv_next_row(this.handle)) {
      const fieldCount = lib.csv_get_field_count(this.handle);
      const row = new CSVRow<T>(
        this.handle,
        fieldCount,
        this.headers,
        this.options.schema ?? null
      );

      chunk.push(this.headers ? row.toObject() : row.toArray());

      if (chunk.length >= chunkSize) {
        this.options.chunk!({
          data: chunk,
          errors: [],
          meta: this.createMeta(),
        }, handle);
        chunk = [];

        if (this.aborted || this.paused) break;
      }
    }

    // Flush remaining rows
    if (chunk.length > 0 && !this.aborted && !this.paused) {
      this.options.chunk!({
        data: chunk,
        errors: [],
        meta: this.createMeta(),
      }, handle);
    }
  }

  /**
   * Close parser and release resources.
   */
  close(): void {
    if (this.closed) return;

    if (this.handle) {
      const lib = loadNativeLibrary();
      lib.csv_close(this.handle);
      this.handle = null;
    }

    this.closed = true;
  }

  /**
   * Synchronous iterator for for-of loops.
   */
  *[Symbol.iterator](): Iterator<CSVRow<T>> {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    const lib = loadNativeLibrary();
    const expectedFields = this.headerRow ? this.headerRow.length : 0;

    while (lib.csv_next_row(this.handle)) {
      const fieldCount = lib.csv_get_field_count(this.handle);
      const fieldCountNum = Number(fieldCount);

      // Detect field count mismatches when headers are present
      if (expectedFields > 0 && fieldCountNum !== expectedFields) {
        if (fieldCountNum > expectedFields) {
          this.recordError({
            type: "FieldMismatch",
            code: "TooManyFields",
            message: `Expected ${expectedFields} fields but found ${fieldCountNum}`,
            row: this.dataRowIndex,
          });
        } else {
          this.recordError({
            type: "FieldMismatch",
            code: "TooFewFields",
            message: `Expected ${expectedFields} fields but found ${fieldCountNum}`,
            row: this.dataRowIndex,
          });
        }
      }

      this.dataRowIndex++;

      yield new CSVRow<T>(
        this.handle,
        fieldCount,
        this.headers,
        this.options.schema ?? null,
        this.options.dynamicTyping ?? false,
        this.options.transform ?? null,
      );
    }
  }

  /**
   * Async iterator for non-blocking iteration.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<CSVRow<T>> {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    const lib = loadNativeLibrary();
    const expectedFields = this.headerRow ? this.headerRow.length : 0;
    let rowCount = 0;

    while (lib.csv_next_row(this.handle)) {
      const fieldCount = lib.csv_get_field_count(this.handle);
      const fieldCountNum = Number(fieldCount);

      // Detect field count mismatches when headers are present
      if (expectedFields > 0 && fieldCountNum !== expectedFields) {
        if (fieldCountNum > expectedFields) {
          this.recordError({
            type: "FieldMismatch",
            code: "TooManyFields",
            message: `Expected ${expectedFields} fields but found ${fieldCountNum}`,
            row: this.dataRowIndex,
          });
        } else {
          this.recordError({
            type: "FieldMismatch",
            code: "TooFewFields",
            message: `Expected ${expectedFields} fields but found ${fieldCountNum}`,
            row: this.dataRowIndex,
          });
        }
      }

      this.dataRowIndex++;

      yield new CSVRow<T>(
        this.handle,
        fieldCount,
        this.headers,
        this.options.schema ?? null,
        this.options.dynamicTyping ?? false,
        this.options.transform ?? null,
      );

      // Yield to event loop periodically
      rowCount++;
      if (rowCount % 1000 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  /**
   * Parse all rows in batches and return as string arrays.
   * This is the fastest API - minimizes FFI overhead by batching.
   * @param batchSize Number of rows to parse per batch (default 1000)
   */
  *iterateBatch(batchSize: number = 1000): Generator<(string | null)[]> {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    const lib = loadNativeLibrary();
    const decoder = new TextDecoder();

    // BatchParseResult layout: rows_parsed(4) + total_fields(4) + has_more(1) + pad(7) = 16 bytes
    // BatchRowInfo layout: field_start_idx(4) + field_count(2) + pad(2) = 8 bytes
    // BatchFieldInfo layout: ptr(8) + len(4) + flags(1) + pad(3) = 16 bytes

    while (true) {
      const resultPtr = lib.csv_parse_batch(this.handle, batchSize);
      if (!resultPtr || resultPtr === 0) break;

      const resultBuf = toArrayBuffer(resultPtr as Pointer, 0, 16);
      const resultView = new DataView(resultBuf);
      const rowsParsed = resultView.getUint32(0, true);
      const totalFields = resultView.getUint32(4, true);

      if (rowsParsed === 0) break;

      // Get pointers to row and field arrays
      const rowsPtr = lib.csv_get_batch_rows();
      const fieldsPtr = lib.csv_get_batch_fields();

      // Read all row info (8 bytes each)
      const rowsBuf = toArrayBuffer(rowsPtr as Pointer, 0, rowsParsed * 8);
      const rowsView = new DataView(rowsBuf);

      // Read all field info (16 bytes each)
      const fieldsBuf = toArrayBuffer(fieldsPtr as Pointer, 0, totalFields * 16);
      const fieldsView = new DataView(fieldsBuf);

      // Process each row
      for (let r = 0; r < rowsParsed; r++) {
        const fieldStartIdx = rowsView.getUint32(r * 8, true);
        const fieldCount = rowsView.getUint16(r * 8 + 4, true);

        const row: (string | null)[] = [];

        for (let f = 0; f < fieldCount; f++) {
          const fieldIdx = fieldStartIdx + f;
          const fieldOffset = fieldIdx * 16;

          const ptr = fieldsView.getBigUint64(fieldOffset, true);
          const len = fieldsView.getUint32(fieldOffset + 8, true);
          const flags = fieldsView.getUint8(fieldOffset + 12);
          const needsUnescape = (flags & 1) !== 0;

          if (ptr === 0n || len === 0) {
            row.push(null);
            continue;
          }

          if (needsUnescape) {
            // Unescape in JS: read raw data and process
            const buf = toArrayBuffer(Number(ptr) as unknown as Pointer, 0, len);
            const raw = decoder.decode(buf);
            // Remove surrounding quotes and unescape "" -> "
            if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
              const inner = raw.slice(1, -1).replace(/""/g, '"');
              row.push(inner);
            } else {
              row.push(raw);
            }
          } else {
            const buf = toArrayBuffer(Number(ptr) as unknown as Pointer, 0, len);
            row.push(decoder.decode(buf));
          }
        }

        yield row;
      }
    }
  }

  /**
   * Parse all rows and return as array of string arrays.
   * Most efficient for bulk processing.
   */
  toArrays(): (string | null)[][] {
    return [...this.iterateBatch()];
  }

  /**
   * Parse entire file at once and return all rows as string arrays.
   * This is the fastest possible API - all data returned in one FFI call.
   * Note: This loads all data into memory at once.
   */
  parseAll(): (string | null)[][] {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    const lib = loadNativeLibrary();
    const decoder = new TextDecoder();

    // Parse everything in Zig
    const headerPtr = lib.csv_parse_all(this.handle);
    if (!headerPtr || headerPtr === 0) {
      return [];
    }

    try {
      // Read header: total_rows(4) + total_fields(4) + data_size(4) + pad(4) = 16 bytes
      const headerBuf = toArrayBuffer(headerPtr as Pointer, 0, 16);
      const headerView = new DataView(headerBuf);
      const totalRows = headerView.getUint32(0, true);
      const totalFields = headerView.getUint32(4, true);
      const dataSize = headerView.getUint32(8, true);

      if (totalRows === 0) return [];

      // Get buffer pointer
      const bufPtr = lib.csv_get_full_parse_buffer();
      if (!bufPtr || bufPtr === 0) return [];

      // Calculate section sizes and offsets
      const headerSize = 16;
      const rowCountsSize = totalRows * 4; // u32 for alignment
      const fieldOffsetsSize = totalFields * 4;
      const fieldLengthsSize = totalFields * 4;

      // Read entire buffer in one call
      const totalBufSize = headerSize + rowCountsSize + fieldOffsetsSize + fieldLengthsSize + dataSize;
      const fullBuf = toArrayBuffer(bufPtr as Pointer, 0, totalBufSize);

      // Create views into the buffer
      const rowCounts = new Uint32Array(fullBuf, headerSize, totalRows);
      const fieldOffsets = new Uint32Array(fullBuf, headerSize + rowCountsSize, totalFields);
      const fieldLengths = new Uint32Array(fullBuf, headerSize + rowCountsSize + fieldOffsetsSize, totalFields);
      const dataBytes = new Uint8Array(fullBuf, headerSize + rowCountsSize + fieldOffsetsSize + fieldLengthsSize);

      // Build result arrays
      const result: (string | null)[][] = new Array(totalRows);
      let fieldIdx = 0;

      for (let r = 0; r < totalRows; r++) {
        const fieldCount = rowCounts[r]!;
        const row: (string | null)[] = new Array(fieldCount);

        for (let f = 0; f < fieldCount; f++) {
          const offset = fieldOffsets[fieldIdx]!;
          const len = fieldLengths[fieldIdx]!;

          if (len === 0) {
            row[f] = null;
          } else {
            row[f] = decoder.decode(dataBytes.subarray(offset, offset + len));
          }

          fieldIdx++;
        }

        result[r] = row;
      }

      return result;
    } finally {
      // Free the buffer
      lib.csv_free_full_parse();
    }
  }

  /**
   * Parse entire file using position-based slicing.
   * Zig returns field positions, JS slices the original content.
   * This is the fastest API - beats PapaParse!
   */
  parseAllPositions(): (string | null)[][] {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    // Need file content for slicing
    if (!this.sourcePath) {
      throw new Error("parseAllPositions requires file source");
    }

    const lib = loadNativeLibrary();
    const { readFileSync } = require("fs");
    const fileContent = readFileSync(this.sourcePath, "utf-8");

    if (!lib.csv_parse_positions(this.handle)) {
      return [];
    }

    try {
      const rowCount = lib.csv_get_positions_row_count();
      const fieldCount = lib.csv_get_positions_field_count();

      if (rowCount === 0) return [];

      const posPtr = lib.csv_get_positions_ptr();
      const rowCountsPtr = lib.csv_get_row_counts_ptr();

      if (!posPtr || !rowCountsPtr) return [];

      // FieldPos: start(4) + len(2) + needs_unescape(1) + pad(1) = 8 bytes
      const posBuf = toArrayBuffer(posPtr as Pointer, 0, fieldCount * 8);
      const posView = new DataView(posBuf);

      const rowCountsBuf = toArrayBuffer(rowCountsPtr as Pointer, 0, rowCount * 2);
      const rowCountsView = new DataView(rowCountsBuf);

      const result: (string | null)[][] = new Array(rowCount);
      let fieldIdx = 0;

      for (let r = 0; r < rowCount; r++) {
        const fc = rowCountsView.getUint16(r * 2, true);
        const row: (string | null)[] = new Array(fc);

        for (let f = 0; f < fc; f++) {
          const offset = fieldIdx * 8;
          const start = posView.getUint32(offset, true);
          const len = posView.getUint16(offset + 4, true);
          const needsUnescape = posView.getUint8(offset + 6);

          if (len === 0) {
            row[f] = null;
          } else if (needsUnescape) {
            const raw = fileContent.slice(start, start + len);
            if (raw.startsWith('"') && raw.endsWith('"')) {
              row[f] = raw.slice(1, -1).replace(/""/g, '"');
            } else {
              row[f] = raw;
            }
          } else {
            row[f] = fileContent.slice(start, start + len);
          }
          fieldIdx++;
        }
        result[r] = row;
      }

      return result;
    } finally {
      lib.csv_free_positions();
    }
  }

  /**
   * Parse entire file using fast delimited format.
   * Zig concatenates all fields with \x00 (field) and \x01 (row) delimiters.
   * JS decodes once and uses indexOf for fast parsing.
   */
  parseAllFast(): (string | null)[][] {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    const lib = loadNativeLibrary();

    const bufPtr = lib.csv_parse_all_fast(this.handle);
    if (!bufPtr || bufPtr === 0) {
      return [];
    }

    try {
      const bufLen = lib.csv_get_fast_parse_len();
      if (bufLen === 0) {
        return [];
      }

      // Single decode of entire buffer
      const buf = toArrayBuffer(bufPtr as Pointer, 0, Number(bufLen));
      const str = new TextDecoder().decode(buf);

      // Parse using indexOf (much faster than split)
      const result: (string | null)[][] = [];
      let rowStart = 0;

      while (rowStart < str.length) {
        const rowEnd = str.indexOf('\x01', rowStart);
        const rowStr = rowEnd === -1 ? str.slice(rowStart) : str.slice(rowStart, rowEnd);

        const fields: (string | null)[] = [];
        let fieldStart = 0;

        while (fieldStart <= rowStr.length) {
          const fieldEnd = rowStr.indexOf('\x00', fieldStart);
          if (fieldEnd === -1) {
            const field = rowStr.slice(fieldStart);
            fields.push(field === '' ? null : field);
            break;
          }
          const field = rowStr.slice(fieldStart, fieldEnd);
          fields.push(field === '' ? null : field);
          fieldStart = fieldEnd + 1;
        }

        result.push(fields);

        if (rowEnd === -1) break;
        rowStart = rowEnd + 1;
      }

      return result;
    } finally {
      lib.csv_free_fast_parse();
    }
  }

  /**
   * Parse entire file using JSON serialization in Zig.
   * This is the fastest API - Zig builds a JSON string, JS parses with JSON.parse().
   * Minimizes FFI overhead to: 1 FFI call + 1 buffer read + 1 JSON.parse().
   */
  parseAllJson(): (string | null)[][] {
    if (!this.handle) {
      throw new Error("Parser not initialized");
    }

    const lib = loadNativeLibrary();

    // Parse everything in Zig and get JSON string pointer
    const jsonPtr = lib.csv_parse_all_json(this.handle);
    if (!jsonPtr || jsonPtr === 0) {
      return [];
    }

    try {
      const jsonLen = lib.csv_get_json_len();
      if (jsonLen === 0) {
        return [];
      }

      // Read JSON string in one call
      const jsonBuf = toArrayBuffer(jsonPtr as Pointer, 0, Number(jsonLen));
      const jsonStr = new TextDecoder().decode(jsonBuf);

      // Parse with highly optimized JSON.parse()
      return JSON.parse(jsonStr) as (string | null)[][];
    } finally {
      lib.csv_free_json_parse();
    }
  }
}
