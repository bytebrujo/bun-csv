/**
 * CSVWriter - Write CSV files
 */

import { writeFileSync, appendFileSync, existsSync, unlinkSync } from "fs";

/** Writer options */
export interface CSVWriterOptions {
  /** Field delimiter (default: ,) */
  delimiter?: string;
  /** Quote character (default: ") */
  quoteChar?: string;
  /** Line ending (default: \n) */
  lineEnding?: "\n" | "\r\n";
  /** Quote style */
  quoteStyle?: "minimal" | "all" | "non-numeric";
  /** Rows to buffer before auto-flush */
  flushEvery?: number;
  /** Append to existing file */
  append?: boolean;
}

/**
 * Buffered CSV writer with configurable flushing.
 *
 * @example
 * ```ts
 * const writer = new CSVWriter("output.csv");
 * writer.writeRow(["name", "age"]);
 * writer.writeRow(["Alice", 30]);
 * writer.close();
 * ```
 */
export class CSVWriter {
  private path: string;
  private options: Required<CSVWriterOptions>;
  private buffer: string[] = [];
  private rowsWritten: number = 0;
  private rowsInBuffer: number = 0;
  private closed: boolean = false;

  constructor(path: string, options: CSVWriterOptions = {}) {
    this.path = path;
    this.options = {
      delimiter: options.delimiter ?? ",",
      quoteChar: options.quoteChar ?? '"',
      lineEnding: options.lineEnding ?? "\n",
      quoteStyle: options.quoteStyle ?? "minimal",
      flushEvery: options.flushEvery ?? 1000,
      append: options.append ?? false,
    };

    // Clear file if not appending
    if (!this.options.append && existsSync(path)) {
      unlinkSync(path);
    }
  }

  /**
   * Write a single row.
   */
  writeRow(values: (string | number | boolean | null | undefined)[]): void {
    if (this.closed) {
      throw new Error("Writer is closed");
    }

    const fields = values.map((v) => this.formatField(v));
    const line = fields.join(this.options.delimiter) + this.options.lineEnding;

    this.buffer.push(line);
    this.rowsInBuffer++;

    // Auto-flush if threshold reached
    if (this.rowsInBuffer >= this.options.flushEvery) {
      this.flush();
    }
  }

  /**
   * Write multiple rows.
   */
  writeRows(rows: (string | number | boolean | null | undefined)[][]): void {
    for (const row of rows) {
      this.writeRow(row);
    }
  }

  /**
   * Write header row with column names.
   */
  writeHeader(columns: string[]): void {
    this.writeRow(columns);
  }

  /**
   * Write object as row using column order.
   */
  writeObject<T extends Record<string, unknown>>(
    obj: T,
    columns: (keyof T)[]
  ): void {
    const values = columns.map((col) => obj[col] as string | number | null);
    this.writeRow(values);
  }

  /**
   * Flush buffer to file.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const content = this.buffer.join("");

    if (this.rowsWritten === 0 && !this.options.append) {
      writeFileSync(this.path, content);
    } else {
      appendFileSync(this.path, content);
    }

    this.rowsWritten += this.rowsInBuffer;
    this.rowsInBuffer = 0;
    this.buffer = [];
  }

  /**
   * Get total rows written (including buffered).
   */
  getRowCount(): number {
    return this.rowsWritten + this.rowsInBuffer;
  }

  /**
   * Close writer and flush remaining buffer.
   */
  close(): void {
    if (this.closed) return;

    this.flush();
    this.closed = true;
  }

  /**
   * Format a field value, quoting if necessary.
   */
  private formatField(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    const str = String(value);

    const needsQuote =
      this.options.quoteStyle === "all" ||
      (this.options.quoteStyle === "non-numeric" && typeof value !== "number") ||
      this.fieldNeedsQuoting(str);

    if (needsQuote) {
      // Escape quotes by doubling
      const escaped = str.replace(
        new RegExp(this.options.quoteChar, "g"),
        this.options.quoteChar + this.options.quoteChar
      );
      return this.options.quoteChar + escaped + this.options.quoteChar;
    }

    return str;
  }

  /**
   * Check if field needs quoting (contains delimiter, quote, or newline).
   */
  private fieldNeedsQuoting(value: string): boolean {
    return (
      value.includes(this.options.delimiter) ||
      value.includes(this.options.quoteChar) ||
      value.includes("\n") ||
      value.includes("\r")
    );
  }
}

/**
 * Modification tracker for copy-on-write operations.
 */
export class ModificationLog {
  private cellEdits: Map<string, string> = new Map();
  private deletedRows: Set<number> = new Set();
  private insertedRows: Map<number, (string | null)[]> = new Map();

  /**
   * Record a cell edit.
   */
  setCell(row: number, col: number | string, value: string): void {
    this.cellEdits.set(`${row}:${col}`, value);
  }

  /**
   * Record a row deletion.
   */
  deleteRow(row: number): void {
    this.deletedRows.add(row);
  }

  /**
   * Record a row insertion.
   */
  insertRow(position: number, values: (string | null)[]): void {
    this.insertedRows.set(position, values);
  }

  /**
   * Check if row is deleted.
   */
  isDeleted(row: number): boolean {
    return this.deletedRows.has(row);
  }

  /**
   * Get modified cell value if exists.
   */
  getCellEdit(row: number, col: number | string): string | undefined {
    return this.cellEdits.get(`${row}:${col}`);
  }

  /**
   * Get number of modifications.
   */
  get modificationCount(): number {
    return this.cellEdits.size + this.deletedRows.size + this.insertedRows.size;
  }

  /**
   * Check if there are any modifications.
   */
  get hasModifications(): boolean {
    return this.modificationCount > 0;
  }

  /**
   * Get inserted row at position if exists.
   */
  getInsertedRow(position: number): (string | null)[] | undefined {
    return this.insertedRows.get(position);
  }

  /**
   * Get all deleted row indices.
   */
  getDeletedRows(): Set<number> {
    return new Set(this.deletedRows);
  }

  /**
   * Get all inserted row positions.
   */
  getInsertedPositions(): number[] {
    return Array.from(this.insertedRows.keys()).sort((a, b) => a - b);
  }

  /**
   * Clear all modifications.
   */
  clear(): void {
    this.cellEdits.clear();
    this.deletedRows.clear();
    this.insertedRows.clear();
  }
}
