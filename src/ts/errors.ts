/**
 * Structured error types for CSV parsing
 */

/** Error type categories */
export type CSVErrorType = "Quotes" | "Delimiter" | "FieldMismatch";

/** Error codes */
export type CSVErrorCode =
  | "MissingQuotes"
  | "InvalidQuotes"
  | "UndetectableDelimiter"
  | "TooFewFields"
  | "TooManyFields";

/** Structured CSV parsing error */
export interface CSVError {
  /** Error category */
  type: CSVErrorType;
  /** Specific error code */
  code: CSVErrorCode;
  /** Human-readable error message */
  message: string;
  /** Row number where the error occurred (0-based data row index, not counting header) */
  row: number;
  /** Character index within the row (if applicable) */
  index?: number;
}

/** Error callback function type */
export type CSVErrorCallback = (error: CSVError) => void;
