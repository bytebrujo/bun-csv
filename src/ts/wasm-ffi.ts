/**
 * WASM FFI bindings for TurboCSV
 * Provides fallback when native library is not available
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";

/** WASM module instance */
let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

/** Find the WASM file path */
function findWasmPath(): string | null {
  const wasmName = "turbocsv.wasm";

  const searchPaths = [
    // Development: wasm directory in project root
    join(process.cwd(), "wasm", wasmName),
    // Relative to this file
    join(dirname(import.meta.dir), "..", "..", "wasm", wasmName),
    // npm package location
    join(dirname(import.meta.dir), "..", "wasm", wasmName),
    // Node modules location
    join(process.cwd(), "node_modules", "turbocsv", "wasm", wasmName),
  ];

  for (const searchPath of searchPaths) {
    if (existsSync(searchPath)) {
      return searchPath;
    }
  }

  return null;
}

/** Check if WASM module is available */
export function isWasmAvailable(): boolean {
  if (wasmInstance !== null) return true;
  return findWasmPath() !== null;
}

/** Load the WASM module */
export async function loadWasmModule(): Promise<WebAssembly.Instance> {
  if (wasmInstance !== null) {
    return wasmInstance;
  }

  const wasmPath = findWasmPath();
  if (!wasmPath) {
    throw new Error(
      "TurboCSV WASM module not found. Ensure the wasm/ directory contains turbocsv.wasm"
    );
  }

  // Create memory (initial 16MB, max 1GB)
  wasmMemory = new WebAssembly.Memory({
    initial: 256, // 256 * 64KB = 16MB
    maximum: 16384, // 16384 * 64KB = 1GB
  });

  // Load and instantiate WASM
  const wasmBuffer = readFileSync(wasmPath);
  const wasmModule = await WebAssembly.instantiate(wasmBuffer, {
    env: {
      memory: wasmMemory,
      // Stub functions for any imports the WASM might need
      abort: () => {
        throw new Error("WASM abort called");
      },
    },
  });

  wasmInstance = wasmModule.instance;
  return wasmInstance;
}

/** Get WASM memory buffer */
export function getWasmMemory(): Uint8Array {
  if (!wasmMemory) {
    throw new Error("WASM module not loaded");
  }
  return new Uint8Array(wasmMemory.buffer);
}

/** Allocate memory in WASM heap */
export function wasmAlloc(size: number): number {
  if (!wasmInstance) {
    throw new Error("WASM module not loaded");
  }

  const alloc = wasmInstance.exports.wasm_alloc as (size: number) => number;
  if (!alloc) {
    throw new Error("WASM module does not export wasm_alloc");
  }

  return alloc(size);
}

/** Free memory in WASM heap */
export function wasmFree(ptr: number): void {
  if (!wasmInstance) {
    throw new Error("WASM module not loaded");
  }

  const free = wasmInstance.exports.wasm_free as (ptr: number) => void;
  if (free) {
    free(ptr);
  }
}

/** Copy data to WASM memory */
export function copyToWasm(data: Uint8Array): number {
  const ptr = wasmAlloc(data.length);
  const memory = getWasmMemory();
  memory.set(data, ptr);
  return ptr;
}

/** Read string from WASM memory */
export function readWasmString(ptr: number, length: number): string {
  if (!ptr || length === 0) {
    return "";
  }

  const memory = getWasmMemory();
  const bytes = memory.slice(ptr, ptr + length);
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/** WASM-based parser wrapper */
export interface WasmParser {
  handle: number;
  nextRow(): boolean;
  getFieldCount(): number;
  getFieldPtr(col: number): number;
  getFieldLen(col: number): number;
  close(): void;
}

/** Create parser from buffer using WASM */
export async function createWasmParser(data: Uint8Array): Promise<WasmParser> {
  const instance = await loadWasmModule();
  const exports = instance.exports as Record<string, Function>;

  // Copy data to WASM memory
  const dataPtr = copyToWasm(data);

  // Initialize parser
  const initBuffer = exports.csv_init_buffer as (
    ptr: number,
    len: number
  ) => number;
  if (!initBuffer) {
    throw new Error("WASM module does not export csv_init_buffer");
  }

  const handle = initBuffer(dataPtr, data.length);
  if (!handle) {
    throw new Error("Failed to initialize WASM parser");
  }

  return {
    handle,

    nextRow(): boolean {
      const fn = exports.csv_next_row as (handle: number) => boolean;
      return fn(handle);
    },

    getFieldCount(): number {
      const fn = exports.csv_get_field_count as (handle: number) => number;
      return fn(handle);
    },

    getFieldPtr(col: number): number {
      const fn = exports.csv_get_field_ptr as (
        handle: number,
        col: number
      ) => number;
      return fn(handle, col);
    },

    getFieldLen(col: number): number {
      const fn = exports.csv_get_field_len as (
        handle: number,
        col: number
      ) => number;
      return fn(handle, col);
    },

    close(): void {
      const fn = exports.csv_close as (handle: number) => void;
      fn(handle);
      // Note: dataPtr memory should also be freed
      wasmFree(dataPtr);
    },
  };
}

/** Get WASM module path for debugging */
export function getWasmPath(): string | null {
  return findWasmPath();
}
