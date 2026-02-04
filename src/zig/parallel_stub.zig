// Stub module for WASM builds where threading is not available
const std = @import("std");

pub const ParallelConfig = struct {
    thread_count: usize = 0,
    min_chunk_size: usize = 64 * 1024 * 1024,
    max_buffer_rows: usize = 100_000,
    delimiter: u8 = ',',
    quote_char: u8 = '"',
};

pub const ChunkBoundary = struct {
    id: usize,
    start: usize,
    end: usize,
    estimated_start_row: usize,
};

pub const ChunkProcessor = struct {
    total_rows_parsed: usize = 0,
    total_bytes_processed: usize = 0,
    chunks: []ChunkBoundary = &.{},

    pub fn init(_: std.mem.Allocator, _: []const u8, _: ParallelConfig) !*ChunkProcessor {
        return error.NotSupported;
    }

    pub fn process(_: *ChunkProcessor) !void {
        return error.NotSupported;
    }

    pub fn deinit(_: *ChunkProcessor) void {}
};
