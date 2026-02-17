/**
 * TurboCSV - High-Performance CSV Parser
 *
 * @module turbocsv
 */

export { CSVParser, type CSVParserOptions, type StepResult, type ChunkResult, type ParseMeta, type ParserHandle, type CSVMeta } from "./parser";
export { CSVRow, type TrimConfig, type CastContext, type CastFunction, type CastConfig } from "./row";
export { DataFrame, type DataFrameOptions } from "./dataframe";
export { CSVWriter, ModificationLog, type CSVWriterOptions } from "./writer";
export { unparse, type UnparseConfig } from "./unparse";
export { createCSVError, type CSVError, type CSVErrorType, type CSVErrorCode, type CSVErrorCallback } from "./errors";
export { CSVReadStream, createCSVReadableStream } from "./stream";
export { flatten, unflatten, flattenObjects } from "./nested";
export { loadNativeLibrary, isNativeAvailable } from "./ffi";
export type {
  Schema,
  SchemaField,
  ColumnType,
  CSVStats,
  CacheOptions,
} from "./types";
