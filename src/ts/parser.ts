/**
 * CSVParser - Main parser class
 */

import { loadNativeLibrary, toCString, isNativeAvailable, CacheLimitStatus, Encoding } from "./ffi";
import { CSVRow } from "./row";
import { DataFrame } from "./dataframe";
import { CSVWriter, ModificationLog } from "./writer";
import type { Schema, CSVStats, CacheOptions } from "./types";

export { CacheLimitStatus, Encoding };

/** Parser options */
export interface CSVParserOptions<T = Record<string, string>> {
  /** Field delimiter (default: auto-detect) */
  delimiter?: string;
  /** Quote character (default: ") */
  quoteChar?: string;
  /** Whether first row is header (default: true) */
  hasHeader?: boolean;
  /** File encoding (default: auto-detect) */
  encoding?: string;
  /** Schema for typed access */
  schema?: Schema<T>;
  /** Enable write support */
  writable?: boolean;
  /** Cache options */
  cache?: CacheOptions;
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

  // Copy-on-write modification tracking
  private modifications: ModificationLog | null = null;
  private cachedRows: Map<number, string[]> | null = null;
  private totalRowCount: number = 0;

  constructor(source: InputSource, options: CSVParserOptions<T> = {}) {
    this.source = source;
    this.options = {
      hasHeader: true,
      quoteChar: '"',
      ...options,
    };

    // Initialize modification tracking if writable
    if (options.writable) {
      this.modifications = new ModificationLog();
      this.cachedRows = new Map();
    }

    // Initialize immediately for file paths
    if (typeof source === "string" && !source.startsWith("http")) {
      this.sourcePath = source;
      this.initFromFile(source);
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

    this.handle = lib.csv_init(pathBytes) as number;

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
    this.handle = lib.csv_init_buffer(data, data.length) as number;

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
      const value = row.get(i) ?? `col${i}`;
      this.headers.set(value, i);
      this.headerRow.push(value);
    }
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

      // Re-open
      const pathBytes = toCString(this.sourcePath);
      this.handle = lib.csv_init(pathBytes) as number;

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

    while (lib.csv_next_row(this.handle)) {
      const fieldCount = lib.csv_get_field_count(this.handle);

      yield new CSVRow<T>(
        this.handle,
        fieldCount,
        this.headers,
        this.options.schema ?? null
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
    let rowCount = 0;

    while (lib.csv_next_row(this.handle)) {
      const fieldCount = lib.csv_get_field_count(this.handle);

      yield new CSVRow<T>(
        this.handle,
        fieldCount,
        this.headers,
        this.options.schema ?? null
      );

      // Yield to event loop periodically
      rowCount++;
      if (rowCount % 1000 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }
}
