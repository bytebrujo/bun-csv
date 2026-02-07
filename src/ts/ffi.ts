/**
 * FFI bindings for the native Zig library
 */

import { dlopen, FFIType, toArrayBuffer, type Pointer } from "bun:ffi";
import { existsSync } from "fs";
import { join, dirname } from "path";

/** Cache limit status */
export enum CacheLimitStatus {
  OK = 0,
  SOFT_LIMIT_EXCEEDED = 1,
  HARD_LIMIT_EXCEEDED = 2,
}

/** Encoding types */
export enum Encoding {
  UTF8 = 0,
  UTF16LE = 1,
  UTF16BE = 2,
  UTF32LE = 3,
  UTF32BE = 4,
  LATIN1 = 5,
  WINDOWS1252 = 6,
  SHIFT_JIS = 7,
}

/** Maximum fields in batch result (must match Zig MAX_BATCH_FIELDS) */
export const MAX_BATCH_FIELDS = 64;

/** Native library symbols */
export interface NativeLib {
  csv_init: (path: Uint8Array) => number | null;
  csv_init_with_config: (
    path: Uint8Array,
    delimiter: number,
    quoteChar: number,
    escapeChar: number,
    hasHeader: boolean,
    skipEmptyRows: boolean,
    commentChar: number,
    preview: number,
    skipFirstNLines: number,
  ) => number | null;
  csv_init_buffer: (data: Uint8Array, len: number) => number | null;
  csv_init_buffer_with_config: (
    data: Uint8Array,
    len: number,
    delimiter: number,
    quoteChar: number,
    escapeChar: number,
    hasHeader: boolean,
    skipEmptyRows: boolean,
    commentChar: number,
    preview: number,
    skipFirstNLines: number,
  ) => number | null;
  csv_next_row: (handle: number) => boolean;
  csv_get_field_count: (handle: number) => number;
  csv_get_field_ptr: (handle: number, col: number) => number | null;
  csv_get_field_len: (handle: number, col: number) => number;
  csv_get_stats: (handle: number) => number;
  csv_pause: (handle: number) => void;
  csv_resume: (handle: number) => void;
  csv_check_modified: (handle: number) => boolean;
  csv_close: (handle: number) => void;
  csv_field_needs_unescape: (handle: number, col: number) => boolean;
  csv_get_field_unescaped: (handle: number, col: number, outLen: Uint8Array) => number | null;
  csv_get_simd_width: () => number;
  csv_get_row_batch: (handle: number) => number | null;
  csv_get_row_data: (handle: number) => number | null;
  // Batch parsing
  csv_parse_batch: (handle: number, maxRows: number) => number | null;
  csv_get_batch_rows: () => number;
  csv_get_batch_fields: () => number;
  // Full parse
  csv_parse_all: (handle: number) => number | null;
  csv_get_full_parse_buffer: () => number | null;
  csv_free_full_parse: () => void;
  // JSON parse - returns JSON string for single JSON.parse() call
  csv_parse_all_json: (handle: number) => number | null;
  csv_get_json_len: () => number;
  csv_free_json_parse: () => void;
  // Fast parse - returns delimited string
  csv_parse_all_fast: (handle: number) => number | null;
  csv_get_fast_parse_len: () => number;
  csv_get_fast_parse_rows: () => number;
  csv_free_fast_parse: () => void;
  // Position parse - returns field positions for slicing
  csv_parse_positions: (handle: number) => boolean;
  csv_get_positions_ptr: () => number | null;
  csv_get_row_counts_ptr: () => number | null;
  csv_get_positions_row_count: () => number;
  csv_get_positions_field_count: () => number;
  csv_free_positions: () => void;
  // Cache management
  csv_get_cache_size: (handle: number) => number;
  csv_get_cache_status: (handle: number) => number;
  csv_clear_cache: (handle: number) => void;
  csv_set_soft_cache_limit: (handle: number, limit: number) => void;
  csv_set_hard_cache_limit: (handle: number, limit: number) => void;
  // Parallel processing
  csv_get_optimal_thread_count: (dataLen: number) => number;
  csv_parallel_init: (data: Uint8Array, len: number, threadCount: number) => number | null;
  csv_parallel_process: (handle: number) => boolean;
  csv_parallel_get_row_count: (handle: number) => number;
  csv_parallel_get_bytes_processed: (handle: number) => number;
  csv_parallel_get_chunk_count: (handle: number) => number;
  csv_parallel_close: (handle: number) => void;
  // Encoding
  csv_detect_encoding: (data: Uint8Array, len: number) => number;
  csv_detect_bom: (data: Uint8Array, len: number) => number;
  // Delimiter detection
  csv_detect_delimiter: (data: Uint8Array, len: number, candidates: Uint8Array | null, numCandidates: number, quoteChar: number) => number;
}

/** Library handle singleton */
let nativeLib: NativeLib | null = null;
let libraryPath: string | null = null;

/** Find the native library path */
function findLibraryPath(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  // Library name by platform
  const libName =
    platform === "darwin"
      ? "libturbocsv.dylib"
      : platform === "win32"
        ? "turbocsv.dll"
        : "libturbocsv.so";

  // Search paths - try multiple strategies
  const searchPaths = [
    // Development: zig-out in project root (from cwd)
    join(process.cwd(), "zig-out", "lib", libName),
    // Development: zig-out relative to this file's location
    join(dirname(import.meta.dir), "..", "..", "zig-out", "lib", libName),
    // Development: zig-out relative to src/ts
    join(dirname(import.meta.dir), "..", "zig-out", "lib", libName),
    // Installed: binaries directory from cwd
    join(process.cwd(), "binaries", `${platform}-${arch}`, libName),
    // Installed: binaries directory relative to file
    join(dirname(import.meta.dir), "..", "..", "binaries", `${platform}-${arch}`, libName),
    // Node modules location
    join(dirname(import.meta.dir), "..", "binaries", `${platform}-${arch}`, libName),
  ];

  for (const searchPath of searchPaths) {
    if (existsSync(searchPath)) {
      return searchPath;
    }
  }

  return null;
}

/** Check if native library is available */
export function isNativeAvailable(): boolean {
  if (nativeLib !== null) return true;

  libraryPath = findLibraryPath();
  return libraryPath !== null;
}

/** Load the native library */
export function loadNativeLibrary(): NativeLib {
  if (nativeLib !== null) {
    return nativeLib;
  }

  libraryPath = findLibraryPath();

  if (!libraryPath) {
    throw new Error(
      "TurboCSV native library not found. Ensure the library is built (bun run build:zig) " +
        "or WASM fallback will be used."
    );
  }

  const lib = dlopen(libraryPath, {
    csv_init: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_init_with_config: {
      args: [FFIType.ptr, FFIType.u8, FFIType.u8, FFIType.u8, FFIType.bool, FFIType.bool, FFIType.u8, FFIType.u64, FFIType.u64],
      returns: FFIType.ptr,
    },
    csv_init_buffer: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.ptr,
    },
    csv_init_buffer_with_config: {
      args: [FFIType.ptr, FFIType.u64, FFIType.u8, FFIType.u8, FFIType.u8, FFIType.bool, FFIType.bool, FFIType.u8, FFIType.u64, FFIType.u64],
      returns: FFIType.ptr,
    },
    csv_next_row: {
      args: [FFIType.ptr],
      returns: FFIType.bool,
    },
    csv_get_field_count: {
      args: [FFIType.ptr],
      returns: FFIType.u64,
    },
    csv_get_field_ptr: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.ptr,
    },
    csv_get_field_len: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.u64,
    },
    csv_get_stats: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_pause: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    csv_resume: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    csv_check_modified: {
      args: [FFIType.ptr],
      returns: FFIType.bool,
    },
    csv_close: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    csv_field_needs_unescape: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.bool,
    },
    csv_get_field_unescaped: {
      args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_get_simd_width: {
      args: [],
      returns: FFIType.u64,
    },
    csv_get_row_batch: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_get_row_data: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    // Batch parsing
    csv_parse_batch: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.ptr,
    },
    csv_get_batch_rows: {
      args: [],
      returns: FFIType.ptr,
    },
    csv_get_batch_fields: {
      args: [],
      returns: FFIType.ptr,
    },
    // Full parse
    csv_parse_all: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_get_full_parse_buffer: {
      args: [],
      returns: FFIType.ptr,
    },
    csv_free_full_parse: {
      args: [],
      returns: FFIType.void,
    },
    // JSON parse
    csv_parse_all_json: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_get_json_len: {
      args: [],
      returns: FFIType.u64,
    },
    csv_free_json_parse: {
      args: [],
      returns: FFIType.void,
    },
    // Fast parse
    csv_parse_all_fast: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    csv_get_fast_parse_len: {
      args: [],
      returns: FFIType.u64,
    },
    csv_get_fast_parse_rows: {
      args: [],
      returns: FFIType.u32,
    },
    csv_free_fast_parse: {
      args: [],
      returns: FFIType.void,
    },
    // Position parse
    csv_parse_positions: {
      args: [FFIType.ptr],
      returns: FFIType.bool,
    },
    csv_get_positions_ptr: {
      args: [],
      returns: FFIType.ptr,
    },
    csv_get_row_counts_ptr: {
      args: [],
      returns: FFIType.ptr,
    },
    csv_get_positions_row_count: {
      args: [],
      returns: FFIType.u32,
    },
    csv_get_positions_field_count: {
      args: [],
      returns: FFIType.u32,
    },
    csv_free_positions: {
      args: [],
      returns: FFIType.void,
    },
    // Cache management
    csv_get_cache_size: {
      args: [FFIType.ptr],
      returns: FFIType.u64,
    },
    csv_get_cache_status: {
      args: [FFIType.ptr],
      returns: FFIType.u8,
    },
    csv_clear_cache: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    csv_set_soft_cache_limit: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.void,
    },
    csv_set_hard_cache_limit: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.void,
    },
    // Parallel processing
    csv_get_optimal_thread_count: {
      args: [FFIType.u64],
      returns: FFIType.u64,
    },
    csv_parallel_init: {
      args: [FFIType.ptr, FFIType.u64, FFIType.u64],
      returns: FFIType.ptr,
    },
    csv_parallel_process: {
      args: [FFIType.ptr],
      returns: FFIType.bool,
    },
    csv_parallel_get_row_count: {
      args: [FFIType.ptr],
      returns: FFIType.u64,
    },
    csv_parallel_get_bytes_processed: {
      args: [FFIType.ptr],
      returns: FFIType.u64,
    },
    csv_parallel_get_chunk_count: {
      args: [FFIType.ptr],
      returns: FFIType.u64,
    },
    csv_parallel_close: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    // Encoding
    csv_detect_encoding: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.u8,
    },
    csv_detect_bom: {
      args: [FFIType.ptr, FFIType.u64],
      returns: FFIType.u64,
    },
    // Delimiter detection
    csv_detect_delimiter: {
      args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.u8],
      returns: FFIType.u8,
    },
  });

  nativeLib = lib.symbols as unknown as NativeLib;
  return nativeLib;
}

/** Module-level TextDecoder for efficiency (reused across calls) */
const SHARED_TEXT_DECODER = new TextDecoder();

/** Module-level TextEncoder for efficiency */
const SHARED_TEXT_ENCODER = new TextEncoder();

/** Convert string to null-terminated C string */
export function toCString(str: string): Uint8Array {
  const encoded = SHARED_TEXT_ENCODER.encode(str);
  const result = new Uint8Array(encoded.length + 1);
  result.set(encoded);
  result[encoded.length] = 0;
  return result;
}

/** Read string from pointer */
export function readString(pointer: Pointer | number, length: number | bigint): string {
  // Convert BigInt to number if needed (FFI may return BigInt for u64)
  const len = typeof length === 'bigint' ? Number(length) : length;

  if (!pointer || len === 0) {
    return "";
  }

  try {
    const buffer = toArrayBuffer(pointer as Pointer, 0, len);

    if (!buffer || !(buffer instanceof ArrayBuffer)) {
      return "";
    }

    return SHARED_TEXT_DECODER.decode(buffer);
  } catch (err) {
    return "";
  }
}

/** Get library path for debugging */
export function getLibraryPath(): string | null {
  return libraryPath;
}
