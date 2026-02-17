/**
 * Structured error types for CSV parsing
 */

/** Error type categories */
export type CSVErrorType =
  | "Quotes"
  | "Delimiter"
  | "FieldMismatch"
  | "InvalidArgument"
  | "RecordSize"
  | "Validation";

/** Error codes */
export type CSVErrorCode =
  // Quote errors
  | "MissingQuotes"
  | "InvalidQuotes"
  | "QuoteNotClosed"
  | "InvalidClosingQuote"
  | "NonTrimableCharAfterClosingQuote"
  // Delimiter errors
  | "UndetectableDelimiter"
  | "InvalidDelimiter"
  // Field mismatch errors
  | "TooFewFields"
  | "TooManyFields"
  | "InvalidColumnCount"
  // Argument errors
  | "InvalidArgument"
  | "InvalidOption"
  | "InvalidColumnHeader"
  // Record size errors
  | "MaxRecordSize"
  // Validation errors
  | "InvalidCast"
  | "ConstraintViolation";

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
  /** Column index or name (if applicable) */
  column?: number | string;
}

/** Error callback function type */
export type CSVErrorCallback = (error: CSVError) => void;

/** Helper to create a structured CSV error */
export function createCSVError(
  type: CSVErrorType,
  code: CSVErrorCode,
  message: string,
  row: number,
  options?: { index?: number; column?: number | string },
): CSVError {
  return {
    type,
    code,
    message,
    row,
    ...(options?.index !== undefined && { index: options.index }),
    ...(options?.column !== undefined && { column: options.column }),
  };
}
