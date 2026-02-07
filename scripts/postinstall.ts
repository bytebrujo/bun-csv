#!/usr/bin/env bun
/**
 * Post-install script for TurboCSV
 * Downloads platform-specific native binary if available
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";

const REPO = "bytebrujo/bun-csv";
const VERSION = process.env.npm_package_version ?? "0.1.0";

interface PlatformConfig {
  os: string;
  arch: string;
  libName: string;
  tarName: string;
}

function getPlatformConfig(): PlatformConfig | null {
  const platform = process.platform;
  const arch = process.arch;

  const configs: Record<string, Record<string, PlatformConfig>> = {
    darwin: {
      x64: {
        os: "macos",
        arch: "x64",
        libName: "libturbocsv.dylib",
        tarName: "turbocsv-macos-x64.tar.gz",
      },
      arm64: {
        os: "macos",
        arch: "arm64",
        libName: "libturbocsv.dylib",
        tarName: "turbocsv-macos-arm64.tar.gz",
      },
    },
    linux: {
      x64: {
        os: "linux",
        arch: "x64",
        libName: "libturbocsv.so",
        tarName: "turbocsv-linux-x64.tar.gz",
      },
      arm64: {
        os: "linux",
        arch: "arm64",
        libName: "libturbocsv.so",
        tarName: "turbocsv-linux-arm64.tar.gz",
      },
    },
    win32: {
      x64: {
        os: "windows",
        arch: "x64",
        libName: "turbocsv.dll",
        tarName: "turbocsv-windows-x64.tar.gz",
      },
    },
  };

  return configs[platform]?.[arch] ?? null;
}

async function downloadBinary(): Promise<boolean> {
  const config = getPlatformConfig();

  if (!config) {
    console.log(
      `[turbocsv] No native binary available for ${process.platform}-${process.arch}`
    );
    console.log("[turbocsv] Will use WASM fallback");
    return false;
  }

  const binaryDir = join(
    process.cwd(),
    "binaries",
    `${config.os}-${config.arch}`
  );
  const binaryPath = join(binaryDir, config.libName);

  // Check if already exists
  if (existsSync(binaryPath)) {
    console.log(`[turbocsv] Native binary already exists: ${binaryPath}`);
    return true;
  }

  // Download URL
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${config.tarName}`;

  console.log(`[turbocsv] Downloading native binary from ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(
        `[turbocsv] Binary not found (${response.status}), will use WASM fallback`
      );
      return false;
    }

    const buffer = await response.arrayBuffer();

    // Create directory
    mkdirSync(binaryDir, { recursive: true });

    // Extract tarball
    if (config.tarName.endsWith(".tar.gz")) {
      // Use tar command
      const tempFile = join(binaryDir, config.tarName);
      writeFileSync(tempFile, new Uint8Array(buffer));

      const { execSync } = await import("child_process");
      execSync(`tar -xzf "${tempFile}" -C "${binaryDir}"`, { stdio: "inherit" });

      // Remove temp file
      const { unlinkSync } = await import("fs");
      unlinkSync(tempFile);
    } else if (config.tarName.endsWith(".zip")) {
      // Use unzip command
      const tempFile = join(binaryDir, config.tarName);
      writeFileSync(tempFile, new Uint8Array(buffer));

      const { execSync } = await import("child_process");
      execSync(`unzip -o "${tempFile}" -d "${binaryDir}"`, { stdio: "inherit" });

      // Remove temp file
      const { unlinkSync } = await import("fs");
      unlinkSync(tempFile);
    }

    // Make executable on Unix
    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 0o755);
    }

    console.log(`[turbocsv] Successfully installed native binary`);
    return true;
  } catch (error) {
    console.log(
      `[turbocsv] Failed to download binary: ${(error as Error).message}`
    );
    console.log("[turbocsv] Will use WASM fallback");
    return false;
  }
}

async function main() {
  // Skip in CI or if explicitly disabled
  if (process.env.TURBOCSV_SKIP_BINARY === "1" || process.env.CI) {
    console.log("[turbocsv] Skipping binary download");
    return;
  }

  await downloadBinary();
}

main().catch(console.error);
