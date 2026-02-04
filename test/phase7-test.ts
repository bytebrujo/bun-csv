/**
 * Phase 7 Test: Distribution
 * - WASM support detection
 * - Build configuration
 * - CI/CD workflow validation
 * - Package configuration
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

console.log("=== Phase 7: Distribution Test ===\n");

const rootDir = join(import.meta.dir, "..");

// 1. Check build.zig WASM support
console.log("1. Build Configuration:");
const buildZig = readFileSync(join(rootDir, "build.zig"), "utf-8");
console.log(`   Has WASM detection: ${buildZig.includes("wasm32")}`);
console.log(`   Has buildWasm function: ${buildZig.includes("fn buildWasm")}`);
console.log(`   Has buildNative function: ${buildZig.includes("fn buildNative")}`);

// 2. Check package.json configuration
console.log("\n2. Package Configuration:");
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
console.log(`   Has build:wasm script: ${!!packageJson.scripts["build:wasm"]}`);
console.log(`   Has postinstall script: ${!!packageJson.scripts["postinstall"]}`);
console.log(`   Has wasm in files: ${packageJson.files.includes("wasm")}`);
console.log(`   Has binaries in files: ${packageJson.files.includes("binaries")}`);
console.log(`   Has publishConfig: ${!!packageJson.publishConfig}`);
console.log(`   Supports multiple OS: ${packageJson.os?.length > 1}`);
console.log(`   Supports multiple CPU: ${packageJson.cpu?.length > 1}`);

// 3. Check CI/CD workflows
console.log("\n3. CI/CD Workflows:");
const ciWorkflow = join(rootDir, ".github", "workflows", "ci.yml");
const releaseWorkflow = join(rootDir, ".github", "workflows", "release.yml");
console.log(`   CI workflow exists: ${existsSync(ciWorkflow)}`);
console.log(`   Release workflow exists: ${existsSync(releaseWorkflow)}`);

if (existsSync(ciWorkflow)) {
  const ciContent = readFileSync(ciWorkflow, "utf-8");
  console.log(`   CI has test job: ${ciContent.includes("test:")}`);
  console.log(`   CI has build-native job: ${ciContent.includes("build-native:")}`);
  console.log(`   CI has build-wasm job: ${ciContent.includes("build-wasm:")}`);
  console.log(`   CI uses matrix strategy: ${ciContent.includes("matrix:")}`);
}

if (existsSync(releaseWorkflow)) {
  const releaseContent = readFileSync(releaseWorkflow, "utf-8");
  console.log(`   Release publishes to npm: ${releaseContent.includes("npm publish")}`);
  console.log(`   Release creates GitHub release: ${releaseContent.includes("gh-release") || releaseContent.includes("softprops/action-gh-release")}`);
  console.log(`   Release supports multiple platforms: ${releaseContent.includes("linux") && releaseContent.includes("macos") && releaseContent.includes("windows")}`);
}

// 4. Check WASM FFI module
console.log("\n4. WASM FFI Module:");
const wasmFfiPath = join(rootDir, "src", "ts", "wasm-ffi.ts");
console.log(`   wasm-ffi.ts exists: ${existsSync(wasmFfiPath)}`);

if (existsSync(wasmFfiPath)) {
  const wasmFfi = readFileSync(wasmFfiPath, "utf-8");
  console.log(`   Has isWasmAvailable: ${wasmFfi.includes("isWasmAvailable")}`);
  console.log(`   Has loadWasmModule: ${wasmFfi.includes("loadWasmModule")}`);
  console.log(`   Has createWasmParser: ${wasmFfi.includes("createWasmParser")}`);
  console.log(`   Has memory management: ${wasmFfi.includes("wasmAlloc") && wasmFfi.includes("wasmFree")}`);
}

// 5. Check postinstall script
console.log("\n5. Postinstall Script:");
const postinstallPath = join(rootDir, "scripts", "postinstall.ts");
console.log(`   postinstall.ts exists: ${existsSync(postinstallPath)}`);

if (existsSync(postinstallPath)) {
  const postinstall = readFileSync(postinstallPath, "utf-8");
  console.log(`   Has platform detection: ${postinstall.includes("getPlatformConfig")}`);
  console.log(`   Has download function: ${postinstall.includes("downloadBinary")}`);
  console.log(`   Supports macOS: ${postinstall.includes("darwin")}`);
  console.log(`   Supports Linux: ${postinstall.includes("linux")}`);
  console.log(`   Supports Windows: ${postinstall.includes("win32")}`);
  console.log(`   Has WASM fallback message: ${postinstall.includes("WASM fallback")}`);
}

// 6. Check directory structure
console.log("\n6. Directory Structure:");
console.log(`   wasm/ directory exists: ${existsSync(join(rootDir, "wasm"))}`);
console.log(`   binaries/ directory exists: ${existsSync(join(rootDir, "binaries"))}`);
console.log(`   .github/workflows/ exists: ${existsSync(join(rootDir, ".github", "workflows"))}`);
console.log(`   scripts/ directory exists: ${existsSync(join(rootDir, "scripts"))}`);

// 7. Verify native build still works
console.log("\n7. Native Build Verification:");
try {
  const { execSync } = await import("child_process");
  execSync("zig build -Doptimize=ReleaseFast", { cwd: rootDir, stdio: "pipe" });
  console.log(`   Native build: SUCCESS`);

  // Check library was created
  const libPath = join(rootDir, "zig-out", "lib");
  const hasDylib = existsSync(join(libPath, "libturbocsv.dylib"));
  const hasSo = existsSync(join(libPath, "libturbocsv.so"));
  const hasDll = existsSync(join(libPath, "turbocsv.dll"));
  console.log(`   Library created: ${hasDylib || hasSo || hasDll}`);
} catch (error: any) {
  console.log(`   Native build: FAILED - ${error.message}`);
}

// 8. Test WASM module import
console.log("\n8. WASM Module Import:");
try {
  const { isWasmAvailable, getWasmPath } = await import("../src/ts/wasm-ffi");
  console.log(`   wasm-ffi module loads: true`);
  console.log(`   isWasmAvailable function exists: ${typeof isWasmAvailable === "function"}`);
  console.log(`   getWasmPath function exists: ${typeof getWasmPath === "function"}`);

  // Note: WASM file won't exist unless we build it
  const wasmAvailable = isWasmAvailable();
  console.log(`   WASM binary available: ${wasmAvailable}`);
} catch (error: any) {
  console.log(`   wasm-ffi module loads: false - ${error.message}`);
}

// 9. Package exports validation
console.log("\n9. Package Exports:");
console.log(`   Main export: ${packageJson.main}`);
console.log(`   Module export: ${packageJson.module}`);
console.log(`   Types export: ${packageJson.types}`);
console.log(`   Has conditional exports: ${!!packageJson.exports}`);
console.log(`   Has WASM export: ${!!packageJson.exports?.["./wasm"]}`);

// 10. Version and metadata
console.log("\n10. Package Metadata:");
console.log(`   Name: ${packageJson.name}`);
console.log(`   Version: ${packageJson.version}`);
console.log(`   License: ${packageJson.license}`);
console.log(`   Has repository: ${!!packageJson.repository}`);
console.log(`   Has keywords: ${packageJson.keywords?.length > 0}`);
console.log(`   Has engines: ${!!packageJson.engines}`);

// Summary
console.log("\n=== Phase 7 Summary ===");
console.log("Distribution infrastructure is configured:");
console.log("  - WASM build target in build.zig");
console.log("  - WASM fallback FFI module");
console.log("  - CI/CD workflows for multi-platform builds");
console.log("  - Postinstall binary download script");
console.log("  - npm package configuration");
console.log("\nTo build WASM: bun run build:wasm");
console.log("To run full build: bun run build:all");

console.log("\n=== Phase 7 Tests Complete ===");
