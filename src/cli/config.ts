/**
 * Config file loader for TurboCSV CLI
 * Supports .turbocsvrc (JSON) in current directory or parent directories
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface CLIConfig {
  delimiter?: string;
  encoding?: string;
  hasHeader?: boolean;
  format?: "table" | "csv" | "json";
  color?: boolean;
  schema?: Record<string, string>;
}

const CONFIG_FILENAMES = [".turbocsvrc", ".turbocsvrc.json", "turbocsv.config.json"];

/**
 * Search for config file starting from the given directory,
 * walking up to parent directories and finally home directory.
 */
function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;
  const root = dirname(currentDir);

  // Walk up directory tree
  while (currentDir !== root) {
    for (const filename of CONFIG_FILENAMES) {
      const configPath = join(currentDir, filename);
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  // Check home directory
  const homeConfig = join(homedir(), ".turbocsvrc");
  if (existsSync(homeConfig)) {
    return homeConfig;
  }

  return null;
}

/**
 * Load configuration from file.
 */
export function loadConfig(startDir?: string): { config: CLIConfig; path: string | null } {
  const configPath = findConfigFile(startDir);

  if (!configPath) {
    return { config: {}, path: null };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as CLIConfig;
    return { config, path: configPath };
  } catch (error) {
    console.error(`Warning: Failed to parse config file ${configPath}: ${(error as Error).message}`);
    return { config: {}, path: configPath };
  }
}

/**
 * Merge configuration sources with proper precedence.
 * CLI args > environment variables > config file > defaults
 */
export function mergeConfig(
  cliArgs: Partial<CLIConfig>,
  fileConfig: CLIConfig
): CLIConfig {
  // Environment variable overrides
  const envConfig: Partial<CLIConfig> = {};

  if (process.env.TURBOCSV_DELIMITER) {
    envConfig.delimiter = process.env.TURBOCSV_DELIMITER;
  }
  if (process.env.TURBOCSV_ENCODING) {
    envConfig.encoding = process.env.TURBOCSV_ENCODING;
  }
  if (process.env.TURBOCSV_FORMAT) {
    envConfig.format = process.env.TURBOCSV_FORMAT as CLIConfig["format"];
  }
  if (process.env.TURBOCSV_NO_HEADER === "1" || process.env.TURBOCSV_NO_HEADER === "true") {
    envConfig.hasHeader = false;
  }
  if (process.env.TURBOCSV_COLOR === "1" || process.env.TURBOCSV_COLOR === "true") {
    envConfig.color = true;
  }
  if (process.env.NO_COLOR === "1" || process.env.TURBOCSV_NO_COLOR === "1") {
    envConfig.color = false;
  }

  // Merge with precedence: CLI > env > file > defaults
  return {
    ...fileConfig,
    ...envConfig,
    ...cliArgs,
  };
}

/**
 * Get default configuration values.
 */
export function getDefaults(): CLIConfig {
  return {
    hasHeader: true,
    format: "table",
  };
}
