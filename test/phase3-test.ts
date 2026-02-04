/**
 * Phase 3 Test: Performance Features
 * - Cache management with limits
 * - Parallel processing info
 * - Encoding detection
 */

import { CSVParser, CacheLimitStatus, Encoding } from "../src/ts/parser";
import { loadNativeLibrary, isNativeAvailable } from "../src/ts/ffi";

console.log("=== Phase 3: Performance Features Test ===\n");

// Check native library
if (!isNativeAvailable()) {
  console.error("Native library not available!");
  process.exit(1);
}

const lib = loadNativeLibrary();

// 1. Test SIMD width
console.log("1. SIMD Configuration:");
const simdWidth = CSVParser.getSIMDWidth();
console.log(`   SIMD vector width: ${simdWidth} bytes`);

// 2. Test optimal thread count calculation
console.log("\n2. Optimal Thread Count (based on data size):");
const sizes = [
  { size: 50 * 1024 * 1024, label: "50MB" },
  { size: 100 * 1024 * 1024, label: "100MB" },
  { size: 500 * 1024 * 1024, label: "500MB" },
  { size: 1024 * 1024 * 1024, label: "1GB" },
  { size: 3 * 1024 * 1024 * 1024, label: "3GB" },
];

for (const { size, label } of sizes) {
  const threads = CSVParser.getOptimalThreadCount(size);
  console.log(`   ${label.padEnd(6)} -> ${threads} thread(s)`);
}

// 3. Test encoding detection
console.log("\n3. Encoding Detection:");

// UTF-8 (ASCII subset)
const asciiData = new TextEncoder().encode("name,age\nAlice,30\n");
const asciiEncoding = CSVParser.detectEncoding(asciiData);
console.log(`   ASCII text: Encoding ${Encoding[asciiEncoding]} (${asciiEncoding})`);

// UTF-8 with BOM
const utf8BomData = new Uint8Array([0xEF, 0xBB, 0xBF, 0x68, 0x65, 0x6C, 0x6C, 0x6F]);
const utf8BomLen = CSVParser.detectBOM(utf8BomData);
console.log(`   UTF-8 BOM detected: ${utf8BomLen} bytes`);

// UTF-16 LE with BOM
const utf16LeData = new Uint8Array([0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00]);
const utf16BomLen = CSVParser.detectBOM(utf16LeData);
const utf16Encoding = CSVParser.detectEncoding(utf16LeData);
console.log(`   UTF-16 LE BOM: ${utf16BomLen} bytes, Encoding: ${Encoding[utf16Encoding]}`);

// 4. Test cache management
console.log("\n4. Cache Management:");

const parser = new CSVParser("samples/customers-100.csv");
let rowCount = 0;

// Process some rows to populate cache
for (const row of parser) {
  // Access fields to trigger caching
  for (let i = 0; i < row.length; i++) {
    row.get(i);
  }
  rowCount++;
  if (rowCount > 50) break;
}

const cacheSize = parser.getCacheSize();
const cacheStatus = parser.getCacheStatus();
console.log(`   After 50 rows:`);
console.log(`   - Cache size: ${cacheSize} bytes`);
console.log(`   - Cache status: ${CacheLimitStatus[cacheStatus]} (${cacheStatus})`);

// Test setting limits
parser.setSoftCacheLimit(128 * 1024 * 1024); // 128MB
parser.setHardCacheLimit(512 * 1024 * 1024); // 512MB
console.log(`   - Soft limit set to: 128MB`);
console.log(`   - Hard limit set to: 512MB`);

// Test clearing cache
parser.clearCache();
const cacheSizeAfterClear = parser.getCacheSize();
console.log(`   - Cache size after clear: ${cacheSizeAfterClear} bytes`);

parser.close();

// 5. Test parallel processing FFI exports
console.log("\n5. Parallel Processing FFI:");

// Create a test buffer
const testCsv = "id,name,value\n" +
  Array.from({ length: 1000 }, (_, i) => `${i},item${i},${i * 10}`).join("\n");
const testBuffer = new TextEncoder().encode(testCsv);

// Get optimal thread count for this data
const optimalThreads = lib.csv_get_optimal_thread_count(testBuffer.length);
console.log(`   Test data size: ${testBuffer.length} bytes`);
console.log(`   Optimal threads: ${optimalThreads}`);

// Initialize parallel processor
const parallelHandle = lib.csv_parallel_init(testBuffer, testBuffer.length, 0); // 0 = auto
if (parallelHandle) {
  console.log(`   Parallel processor initialized`);

  // Process
  const success = lib.csv_parallel_process(parallelHandle);
  console.log(`   Processing: ${success ? "SUCCESS" : "FAILED"}`);

  if (success) {
    const rowsParsed = lib.csv_parallel_get_row_count(parallelHandle);
    const bytesProcessed = lib.csv_parallel_get_bytes_processed(parallelHandle);
    const chunkCount = lib.csv_parallel_get_chunk_count(parallelHandle);

    console.log(`   - Rows parsed: ${rowsParsed}`);
    console.log(`   - Bytes processed: ${bytesProcessed}`);
    console.log(`   - Chunks used: ${chunkCount}`);
  }

  lib.csv_parallel_close(parallelHandle);
} else {
  console.log(`   Failed to initialize parallel processor`);
}

console.log("\n=== Phase 3 Tests Complete ===");
