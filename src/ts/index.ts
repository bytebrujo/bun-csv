/**
 * TurboCSV - High-Performance CSV Parser
 *
 * @module turbocsv
 */

export { CSVParser, type CSVParserOptions, type StepResult, type ChunkResult, type ParseMeta, type ParserHandle, type CSVMeta } from "./parser";
export { CSVRow } from "./row";
export { DataFrame, type DataFrameOptions } from "./dataframe";
export { CSVWriter, ModificationLog, type CSVWriterOptions } from "./writer";
export { unparse, type UnparseConfig } from "./unparse";
export type { CSVError, CSVErrorType, CSVErrorCode, CSVErrorCallback } from "./errors";
export { loadNativeLibrary, isNativeAvailable } from "./ffi";
export type {
  Schema,
  SchemaField,
  ColumnType,
  CSVStats,
  CacheOptions,
} from "./types";
