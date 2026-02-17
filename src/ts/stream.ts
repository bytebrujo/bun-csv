/**
 * Stream wrappers for CSVParser.
 *
 * Provides Node.js Readable stream and Web ReadableStream interfaces
 * for piping parsed CSV rows through stream pipelines.
 */

import { Readable } from "stream";
import { CSVParser, type CSVParserOptions } from "./parser";

/**
 * Node.js Readable stream that emits parsed CSV row objects.
 *
 * @example
 * ```ts
 * import { CSVReadStream } from "turbocsv";
 * import { createWriteStream } from "fs";
 * import { Transform } from "stream";
 *
 * const csvStream = new CSVReadStream("data.csv", { hasHeader: true });
 *
 * csvStream
 *   .pipe(new Transform({
 *     objectMode: true,
 *     transform(row, enc, cb) {
 *       cb(null, JSON.stringify(row) + "\n");
 *     }
 *   }))
 *   .pipe(createWriteStream("output.jsonl"));
 * ```
 */
export class CSVReadStream extends Readable {
  private parser: CSVParser;
  private _csvIterator: Iterator<any> | null = null;
  private outputMode: "object" | "array";

  constructor(
    source: string | ReadableStream | ArrayBuffer | Uint8Array,
    options?: CSVParserOptions & {
      /** Output mode: "object" for keyed objects, "array" for arrays (default: "object") */
      outputMode?: "object" | "array";
    },
  ) {
    super({ objectMode: true });

    const { outputMode, ...parserOpts } = options ?? {};
    this.outputMode = outputMode ?? "object";
    this.parser = new CSVParser(source, parserOpts);
  }

  override _read(): void {
    try {
      if (!this._csvIterator) {
        this._csvIterator = this.parser[Symbol.iterator]();
      }

      const { done, value } = this._csvIterator.next();

      if (done) {
        this.parser.close();
        this.push(null);
        return;
      }

      if (this.outputMode === "array") {
        this.push(value.toArray());
      } else {
        this.push(value.toObject());
      }
    } catch (err) {
      this.parser.close();
      this.destroy(err as Error);
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.parser.close();
    callback(error);
  }

  /**
   * Get parsing errors collected during streaming.
   */
  get errors() {
    return this.parser.errors;
  }

  /**
   * Get parse metadata.
   */
  get meta() {
    return this.parser.getMeta();
  }
}

/**
 * Create a Web ReadableStream from a CSV source.
 *
 * @example
 * ```ts
 * import { createCSVReadableStream } from "turbocsv";
 *
 * const stream = createCSVReadableStream("data.csv");
 * for await (const row of stream) {
 *   console.log(row);
 * }
 * ```
 */
export function createCSVReadableStream(
  source: string | ReadableStream | ArrayBuffer | Uint8Array,
  options?: CSVParserOptions & {
    outputMode?: "object" | "array";
  },
): ReadableStream<Record<string, any> | any[]> {
  const { outputMode, ...parserOpts } = options ?? {};
  const mode = outputMode ?? "object";
  const parser = new CSVParser(source, parserOpts);
  let csvIterator: Iterator<any> | null = null;

  return new ReadableStream({
    pull(controller) {
      if (!csvIterator) {
        csvIterator = parser[Symbol.iterator]();
      }

      try {
        const { done, value } = csvIterator.next();

        if (done) {
          parser.close();
          controller.close();
          return;
        }

        if (mode === "array") {
          controller.enqueue(value.toArray());
        } else {
          controller.enqueue(value.toObject());
        }
      } catch (err) {
        parser.close();
        controller.error(err);
      }
    },

    cancel() {
      parser.close();
    },
  });
}
