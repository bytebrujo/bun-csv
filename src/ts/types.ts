/**
 * Type definitions for TurboCSV
 */

/** Supported column types for schema validation */
export type ColumnType =
  | "string"
  | "number"
  | "integer"
  | "float"
  | "boolean"
  | "date"
  | "currency"
  | "percent";

/** Schema field definition */
export interface SchemaField {
  /** Column index (0-based) */
  col: number;
  /** Data type for validation/coercion */
  type: ColumnType;
  /** Whether field can be null */
  nullable?: boolean;
  /** Default value if field is empty */
  default?: unknown;
}

/** Full schema definition */
export type Schema<T> = {
  [K in keyof T]: SchemaField;
};

/** Parser statistics */
export interface CSVStats {
  bytesProcessed: number;
  totalBytes: number;
  rowsEmitted: number;
  errorCount: number;
  cacheBytes: number;
  elapsedMs: number;
  throughputMBps: number;
}

/** Memory cache options */
export interface CacheOptions {
  /** Soft limit - triggers warning callback (default 256MB) */
  softLimit?: number;
  /** Hard limit - throws error (default 1GB) */
  hardLimit?: number;
  /** Warning callback */
  onWarning?: (info: CacheInfo) => void;
}

/** Cache information for warning callback */
export interface CacheInfo {
  cache: {
    strings: number;
    rows: number;
  };
  mmap: number;
  buffers: number;
}

/** Error with location information */
export interface CSVError extends Error {
  line: number;
  column: number;
  context: string;
  suggestion?: string;
}

/** Parser configuration */
export interface ParserConfig {
  delimiter: string;
  quoteChar: string;
  escapeChar: string;
  hasHeader: boolean;
  encoding: string;
  skipEmptyRows: boolean;
}

/** Internal FFI stats structure (matches Zig extern struct) */
export interface FFIStats {
  bytes_processed: bigint;
  total_bytes: bigint;
  rows_emitted: bigint;
  error_count: bigint;
  cache_bytes: bigint;
}
