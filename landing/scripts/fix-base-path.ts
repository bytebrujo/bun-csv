// Post-build script to fix base paths for GitHub Pages deployment
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const BASE_PATH = "/bun-csv";
const OUTPUT_DIR = ".output/public";

function fixPaths(content: string): string {
  // Fix paths that start with /_build but don't have the base path
  return content
    .replace(/href="\/_build/g, `href="${BASE_PATH}/_build`)
    .replace(/src="\/_build/g, `src="${BASE_PATH}/_build`)
    .replace(/"output":"\/_build/g, `"output":"${BASE_PATH}/_build`)
    .replace(/"href":"\/_build/g, `"href":"${BASE_PATH}/_build`)
    .replace(/"key":"\/_build/g, `"key":"${BASE_PATH}/_build`);
}

function processFile(filePath: string) {
  if (filePath.endsWith(".html")) {
    const content = readFileSync(filePath, "utf-8");
    const fixed = fixPaths(content);
    if (content !== fixed) {
      writeFileSync(filePath, fixed);
      console.log(`Fixed: ${filePath}`);
    }
  }
}

function processDirectory(dir: string) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else {
      processFile(fullPath);
    }
  }
}

console.log("Fixing base paths for GitHub Pages...");
processDirectory(OUTPUT_DIR);
console.log("Done!");
