/**
 * benchmark command - Measure parsing performance
 */

import { CSVParser } from "../../ts/parser";
import { statSync } from "fs";

interface BenchmarkOptions {
  delimiter?: string;
  encoding?: string;
  hasHeader: boolean;
  format: "auto" | "table" | "csv" | "json";
  fileSize?: number;
  iterations?: number;
}

interface BenchmarkResult {
  iteration: number;
  rows: number;
  timeMs: number;
  throughputMBps: number;
}

export async function benchmark(
  filePath: string,
  options: BenchmarkOptions
): Promise<void> {
  const iterations = options.iterations ?? 3;
  const fileSize = options.fileSize ?? statSync(filePath).size;
  const fileSizeMB = fileSize / 1024 / 1024;

  console.error(`Benchmarking: ${filePath}`);
  console.error(`File size: ${fileSizeMB.toFixed(2)} MB`);
  console.error(`Iterations: ${iterations}`);
  console.error(`SIMD width: ${CSVParser.getSIMDWidth()} bytes`);
  console.error("");

  const results: BenchmarkResult[] = [];

  // Warmup run
  console.error("Warmup run...");
  {
    const parser = new CSVParser(filePath, {
      delimiter: options.delimiter,
      hasHeader: options.hasHeader,
    });
    let count = 0;
    for (const row of parser) {
      count++;
      // Access first field to ensure parsing happens
      row.get(0);
    }
    parser.close();
  }

  // Benchmark runs
  for (let i = 1; i <= iterations; i++) {
    console.error(`Run ${i}/${iterations}...`);

    const startTime = performance.now();

    const parser = new CSVParser(filePath, {
      delimiter: options.delimiter,
      hasHeader: options.hasHeader,
    });

    let rowCount = 0;
    for (const row of parser) {
      rowCount++;
      // Access first field to ensure parsing happens
      row.get(0);
    }

    parser.close();

    const elapsed = performance.now() - startTime;
    const throughput = fileSizeMB / (elapsed / 1000);

    results.push({
      iteration: i,
      rows: rowCount,
      timeMs: elapsed,
      throughputMBps: throughput,
    });
  }

  // Calculate statistics
  const times = results.map((r) => r.timeMs);
  const throughputs = results.map((r) => r.throughputMBps);

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minThroughput = Math.min(...throughputs);
  const maxThroughput = Math.max(...throughputs);

  // Output results
  console.error("");
  console.error("Results:");
  console.error("─".repeat(60));

  for (const result of results) {
    console.error(
      `  Run ${result.iteration}: ${result.timeMs.toFixed(1)}ms ` +
        `(${result.throughputMBps.toFixed(1)} MB/s) - ${result.rows.toLocaleString()} rows`
    );
  }

  console.error("─".repeat(60));
  console.error(`  Average: ${avgTime.toFixed(1)}ms (${avgThroughput.toFixed(1)} MB/s)`);
  console.error(`  Best:    ${minTime.toFixed(1)}ms (${maxThroughput.toFixed(1)} MB/s)`);
  console.error(`  Worst:   ${maxTime.toFixed(1)}ms (${minThroughput.toFixed(1)} MB/s)`);
  console.error("");

  // JSON output for piping
  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          file: filePath,
          fileSize,
          iterations,
          results,
          summary: {
            avgTimeMs: avgTime,
            avgThroughputMBps: avgThroughput,
            minTimeMs: minTime,
            maxTimeMs: maxTime,
          },
        },
        null,
        2
      )
    );
  }
}
