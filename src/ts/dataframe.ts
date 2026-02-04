/**
 * DataFrame - Tabular data operations
 */

import type { CSVParser } from "./parser";

/** DataFrame options */
export interface DataFrameOptions {
  /** Column to use as index */
  indexColumn?: string | number;
}

/** Sort order */
export type SortOrder = "asc" | "desc";

/** Join type */
export type JoinType = "inner" | "left" | "right" | "full" | "cross";

/** Join options */
export interface JoinOptions<T, U> {
  /** Column(s) to join on */
  on: keyof T | { left: keyof T; right: keyof U };
  /** Type of join */
  type: JoinType;
}

/** Aggregate function */
export type AggregateFunction =
  | "count"
  | "sum"
  | "min"
  | "max"
  | "mean"
  | "median"
  | "stddev"
  | "first"
  | "last"
  | "concat";

/** Aggregate specification */
export interface AggregateSpec {
  col: string;
  fn: AggregateFunction | ((values: unknown[]) => unknown);
}

/**
 * DataFrame for tabular data operations.
 *
 * @example
 * ```ts
 * const df = parser.toDataFrame()
 *   .filter(row => row.age > 18)
 *   .sorted("name");
 *
 * console.log(df.first(10));
 * ```
 */
export class DataFrame<T = Record<string, unknown>> {
  private data: T[];
  private columns: string[];

  constructor(source: CSVParser<T> | T[]) {
    if (Array.isArray(source)) {
      this.data = source;
      this.columns =
        source.length > 0 ? (Object.keys(source[0] as object) as string[]) : [];
    } else {
      // Load from parser
      this.data = [];
      this.columns = source.getHeaders() ?? [];

      for (const row of source) {
        this.data.push(row.toObject() as T);
      }
    }
  }

  /**
   * Get number of rows.
   */
  get length(): number {
    return this.data.length;
  }

  /**
   * Get column names.
   */
  getColumns(): string[] {
    return [...this.columns];
  }

  /**
   * Select specific columns.
   */
  select<K extends keyof T>(...columns: K[]): DataFrame<Pick<T, K>> {
    const selected = this.data.map((row) => {
      const newRow: Partial<T> = {};
      for (const col of columns) {
        newRow[col] = row[col];
      }
      return newRow as Pick<T, K>;
    });

    return new DataFrame(selected);
  }

  /**
   * Filter rows by predicate.
   */
  filter(predicate: (row: T, index: number) => boolean): DataFrame<T> {
    return new DataFrame(this.data.filter(predicate));
  }

  /**
   * Transform rows.
   */
  map<U>(fn: (row: T, index: number) => U): DataFrame<U> {
    return new DataFrame(this.data.map(fn));
  }

  /**
   * Sort in place by column.
   */
  sort(column: keyof T, order: SortOrder = "asc"): this {
    this.data.sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];

      let cmp = 0;
      if (aVal < bVal) cmp = -1;
      else if (aVal > bVal) cmp = 1;

      return order === "asc" ? cmp : -cmp;
    });

    return this;
  }

  /**
   * Return sorted copy.
   */
  sorted(column: keyof T, order: SortOrder = "asc"): DataFrame<T> {
    const copy = new DataFrame([...this.data]);
    return copy.sort(column, order);
  }

  /**
   * Group by column for aggregation.
   */
  groupBy<K extends keyof T>(column: K): GroupedDataFrame<T, K> {
    return new GroupedDataFrame(this.data, column);
  }

  /**
   * Join with another DataFrame.
   */
  join<U>(
    other: DataFrame<U>,
    options: JoinOptions<T, U>
  ): DataFrame<T & Partial<U>> {
    const results: (T & Partial<U>)[] = [];
    const { on, type } = options;

    // Resolve column names
    const leftCol = typeof on === "object" ? on.left : on;
    const rightCol = typeof on === "object" ? on.right : (on as unknown as keyof U);

    // Build lookup for right side
    const rightLookup = new Map<unknown, U[]>();
    for (const row of other.data) {
      const key = row[rightCol];
      if (!rightLookup.has(key)) {
        rightLookup.set(key, []);
      }
      rightLookup.get(key)!.push(row);
    }

    // Process join
    const matchedRight = new Set<U>();

    for (const leftRow of this.data) {
      const key = leftRow[leftCol];
      const rightRows = rightLookup.get(key);

      if (rightRows && rightRows.length > 0) {
        // Matching rows found
        for (const rightRow of rightRows) {
          matchedRight.add(rightRow);
          results.push({ ...leftRow, ...rightRow });
        }
      } else if (type === "left" || type === "full") {
        // Left/full outer: include unmatched left row
        results.push({ ...leftRow } as T & Partial<U>);
      }
    }

    // Handle right outer and full outer
    if (type === "right" || type === "full") {
      for (const rightRow of other.data) {
        if (!matchedRight.has(rightRow)) {
          results.push({ ...rightRow } as unknown as T & Partial<U>);
        }
      }
    }

    return new DataFrame(results);
  }

  /**
   * Get first N rows.
   */
  first(n: number = 1): T[] {
    return this.data.slice(0, n);
  }

  /**
   * Get last N rows.
   */
  last(n: number = 1): T[] {
    return this.data.slice(-n);
  }

  /**
   * Get row at index.
   */
  at(index: number): T | undefined {
    return this.data[index];
  }

  /**
   * Convert to array.
   */
  toArray(): T[] {
    return [...this.data];
  }

  /**
   * Iterate over rows.
   */
  *[Symbol.iterator](): Iterator<T> {
    yield* this.data;
  }
}

/**
 * Grouped DataFrame for aggregation operations.
 */
export class GroupedDataFrame<T, K extends keyof T> {
  private groups: Map<T[K], T[]>;
  private groupColumn: K;

  constructor(data: T[], column: K) {
    this.groupColumn = column;
    this.groups = new Map();

    for (const row of data) {
      const key = row[column];
      if (!this.groups.has(key)) {
        this.groups.set(key, []);
      }
      this.groups.get(key)!.push(row);
    }
  }

  /**
   * Apply aggregation functions.
   */
  aggregate(
    specs: Record<string, AggregateSpec>
  ): DataFrame<Record<string, unknown>> {
    const results: Record<string, unknown>[] = [];

    for (const [groupKey, rows] of this.groups) {
      const result: Record<string, unknown> = {
        [this.groupColumn as string]: groupKey,
      };

      for (const [name, spec] of Object.entries(specs)) {
        const values = rows.map((row) => row[spec.col as keyof T]);

        if (typeof spec.fn === "function") {
          result[name] = spec.fn(values as unknown[]);
        } else {
          result[name] = this.computeAggregate(values, spec.fn);
        }
      }

      results.push(result);
    }

    return new DataFrame(results);
  }

  /**
   * Compute built-in aggregate function.
   */
  private computeAggregate(values: unknown[], fn: AggregateFunction): unknown {
    const nums = values.filter((v) => typeof v === "number") as number[];

    switch (fn) {
      case "count":
        return values.length;

      case "sum":
        return nums.reduce((a, b) => a + b, 0);

      case "min":
        return Math.min(...nums);

      case "max":
        return Math.max(...nums);

      case "mean":
        return nums.length > 0
          ? nums.reduce((a, b) => a + b, 0) / nums.length
          : 0;

      case "median": {
        if (nums.length === 0) return 0;
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2
          ? sorted[mid]
          : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
      }

      case "stddev": {
        if (nums.length === 0) return 0;
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const variance =
          nums.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          nums.length;
        return Math.sqrt(variance);
      }

      case "first":
        return values[0];

      case "last":
        return values[values.length - 1];

      case "concat":
        return values.join(", ");

      default:
        return null;
    }
  }
}
