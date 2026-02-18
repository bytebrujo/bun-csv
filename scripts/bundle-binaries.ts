#!/usr/bin/env bun
/**
 * Bundle platform-specific native binaries into the npm package.
 * Downloads prebuilt binaries from the GitHub release matching the current version
 * and places them in binaries/<platform>-<arch>/ so they ship with `npm publish`.
 *
 * Run before publishing: bun scripts/bundle-binaries.ts
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const REPO = "bytebrujo/bun-csv";
const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json();
const VERSION: string = pkg.version;

interface Target {
  /** process.platform value */
  platform: string;
  /** process.arch value */
  arch: string;
  /** Library filename */
  libName: string;
  /** GitHub release asset name */
  assetName: string;
}

const TARGETS: Target[] = [
  {
    platform: "darwin",
    arch: "arm64",
    libName: "libturbocsv.dylib",
    assetName: "turbocsv-macos-arm64.tar.gz",
  },
  {
    platform: "linux",
    arch: "x64",
    libName: "libturbocsv.so",
    assetName: "turbocsv-linux-x64.tar.gz",
  },
  {
    platform: "linux",
    arch: "arm64",
    libName: "libturbocsv.so",
    assetName: "turbocsv-linux-arm64.tar.gz",
  },
  {
    platform: "win32",
    arch: "x64",
    libName: "turbocsv.dll",
    assetName: "turbocsv-windows-x64.tar.gz",
  },
];

async function downloadTarget(target: Target): Promise<boolean> {
  const dir = join(import.meta.dir, "..", "binaries", `${target.platform}-${target.arch}`);
  const libPath = join(dir, target.libName);

  if (existsSync(libPath)) {
    console.log(`  ✓ ${target.platform}-${target.arch} (already exists)`);
    return true;
  }

  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${target.assetName}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  ✗ ${target.platform}-${target.arch}: HTTP ${response.status} from ${url}`);
      return false;
    }

    const buffer = await response.arrayBuffer();
    mkdirSync(dir, { recursive: true });

    const tempFile = join(dir, target.assetName);
    writeFileSync(tempFile, new Uint8Array(buffer));
    execSync(`tar -xzf "${tempFile}" --strip-components=2 -C "${dir}"`, { stdio: "pipe" });
    unlinkSync(tempFile);

    if (process.platform !== "win32" && existsSync(libPath)) {
      chmodSync(libPath, 0o755);
    }

    console.log(`  ✓ ${target.platform}-${target.arch}`);
    return true;
  } catch (error) {
    console.error(`  ✗ ${target.platform}-${target.arch}: ${(error as Error).message}`);
    return false;
  }
}

async function main() {
  console.log(`Bundling native binaries for turbocsv v${VERSION}\n`);

  const results = await Promise.all(TARGETS.map(downloadTarget));
  const succeeded = results.filter(Boolean).length;
  const failed = results.length - succeeded;

  console.log(`\n${succeeded}/${results.length} targets bundled`);

  if (failed > 0) {
    console.error(`\n${failed} target(s) failed. Make sure GitHub release v${VERSION} exists with all assets.`);
    process.exit(1);
  }
}

main();
