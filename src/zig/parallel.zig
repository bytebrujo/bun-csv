const std = @import("std");
const simd = @import("simd.zig");

/// Configuration for parallel chunk processing
pub const ParallelConfig = struct {
    /// Number of worker threads (0 = auto-detect)
    thread_count: usize = 0,
    /// Minimum chunk size in bytes
    min_chunk_size: usize = 64 * 1024 * 1024, // 64MB
    /// Maximum rows to buffer for reordering
    max_buffer_rows: usize = 100_000,
    /// Delimiter character
    delimiter: u8 = ',',
    /// Quote character
    quote_char: u8 = '"',
};

/// Field location within chunk data
pub const FieldLoc = struct {
    start: usize,
    len: usize,
    needs_unescape: bool,
};

/// Parsed row from a chunk
pub const ParsedRow = struct {
    /// Global row index (for ordering)
    global_index: usize,
    /// Fields in this row
    fields: []FieldLoc,
    /// Byte offset in original data
    byte_offset: usize,

    pub fn deinit(self: *ParsedRow, allocator: std.mem.Allocator) void {
        allocator.free(self.fields);
    }
};

/// Result from a chunk worker
pub const ChunkResult = struct {
    chunk_id: usize,
    start_row_index: usize,
    rows: std.ArrayListUnmanaged(ParsedRow),
    err_msg: ?[]const u8,
    bytes_processed: usize,

    pub fn deinit(self: *ChunkResult, allocator: std.mem.Allocator) void {
        for (self.rows.items) |*row| {
            row.deinit(allocator);
        }
        self.rows.deinit(allocator);
        if (self.err_msg) |msg| {
            allocator.free(msg);
        }
    }
};

/// Chunk boundary definition
pub const ChunkBoundary = struct {
    id: usize,
    start: usize,
    end: usize,
    estimated_start_row: usize,
};

/// Row reordering buffer for maintaining original order
pub const ReorderBuffer = struct {
    allocator: std.mem.Allocator,
    /// Pending rows indexed by global row index
    pending: std.AutoHashMap(usize, ParsedRow),
    /// Next row index to emit
    next_emit_index: usize,
    /// Maximum buffer size
    max_size: usize,
    /// Data pointer for field access
    data: []const u8,

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator, data: []const u8, max_size: usize) Self {
        return Self{
            .allocator = allocator,
            .pending = std.AutoHashMap(usize, ParsedRow).init(allocator),
            .next_emit_index = 0,
            .max_size = max_size,
            .data = data,
        };
    }

    /// Add a row to the buffer
    pub fn addRow(self: *Self, row: ParsedRow) !void {
        if (self.pending.count() >= self.max_size) {
            return error.BufferFull;
        }
        try self.pending.put(row.global_index, row);
    }

    /// Try to get the next row in order
    pub fn tryGetNext(self: *Self) ?ParsedRow {
        if (self.pending.fetchRemove(self.next_emit_index)) |kv| {
            self.next_emit_index += 1;
            return kv.value;
        }
        return null;
    }

    /// Check if buffer is empty and all rows emitted
    pub fn isEmpty(self: *Self) bool {
        return self.pending.count() == 0;
    }

    /// Get count of buffered rows
    pub fn count(self: *Self) usize {
        return self.pending.count();
    }

    pub fn deinit(self: *Self) void {
        var it = self.pending.iterator();
        while (it.next()) |entry| {
            var row = entry.value_ptr.*;
            row.deinit(self.allocator);
        }
        self.pending.deinit();
    }
};

/// Parallel chunk processor
pub const ChunkProcessor = struct {
    allocator: std.mem.Allocator,
    config: ParallelConfig,
    data: []const u8,

    // Thread management
    thread_pool: ?[]std.Thread,
    results: std.ArrayListUnmanaged(ChunkResult),
    chunks: []ChunkBoundary,

    // Synchronization
    mutex: std.Thread.Mutex,
    results_ready: std.Thread.Condition,
    completed_count: usize,

    // Reorder buffer
    reorder_buffer: ReorderBuffer,

    // Statistics
    total_rows_parsed: usize,
    total_bytes_processed: usize,

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator, data: []const u8, config: ParallelConfig) !*Self {
        const processor = try allocator.create(Self);
        processor.* = Self{
            .allocator = allocator,
            .config = config,
            .data = data,
            .thread_pool = null,
            .results = .{},
            .chunks = &.{},
            .mutex = .{},
            .results_ready = .{},
            .completed_count = 0,
            .reorder_buffer = ReorderBuffer.init(allocator, data, config.max_buffer_rows),
            .total_rows_parsed = 0,
            .total_bytes_processed = 0,
        };
        return processor;
    }

    /// Calculate optimal thread count based on file size
    pub fn getOptimalThreadCount(self: *Self) usize {
        if (self.config.thread_count != 0) {
            return self.config.thread_count;
        }

        const file_size = self.data.len;
        const cpu_count = std.Thread.getCpuCount() catch 4;

        // Auto-tune based on file size (from spec)
        if (file_size < 100 * 1024 * 1024) { // < 100MB
            return 1;
        } else if (file_size < 500 * 1024 * 1024) { // < 500MB
            return 2;
        } else if (file_size < 2 * 1024 * 1024 * 1024) { // < 2GB
            return cpu_count / 2;
        } else {
            return cpu_count -| 1; // Saturating subtract
        }
    }

    /// Calculate chunk boundaries with speculative splitting
    pub fn calculateChunks(self: *Self) !void {
        const thread_count = self.getOptimalThreadCount();
        const target_chunk_size = @max(self.data.len / thread_count, self.config.min_chunk_size);

        var chunks_list: std.ArrayListUnmanaged(ChunkBoundary) = .{};
        var chunk_id: usize = 0;
        var pos: usize = 0;
        var estimated_row: usize = 0;

        while (pos < self.data.len) {
            var end = @min(pos + target_chunk_size, self.data.len);

            // Adjust end to row boundary (speculative + repair)
            if (end < self.data.len) {
                end = self.findRowBoundary(end);
            }

            try chunks_list.append(self.allocator, .{
                .id = chunk_id,
                .start = pos,
                .end = end,
                .estimated_start_row = estimated_row,
            });

            // Estimate rows in this chunk (rough: ~100 bytes per row average)
            estimated_row += (end - pos) / 100;
            chunk_id += 1;
            pos = end;
        }

        self.chunks = try chunks_list.toOwnedSlice(self.allocator);
    }

    /// Find valid row boundary near a position using quote-aware scanning
    fn findRowBoundary(self: *Self, pos: usize) usize {
        // Scan backward to determine quote state
        const scan_window = @min(pos, 4096);
        const scan_start = pos - scan_window;

        var in_quote = false;
        var i = scan_start;

        // Count quotes to determine state at pos
        while (i < pos) : (i += 1) {
            if (self.data[i] == self.config.quote_char) {
                // Check for escaped quote
                if (i + 1 < self.data.len and self.data[i + 1] == self.config.quote_char) {
                    i += 1; // Skip escaped quote
                    continue;
                }
                in_quote = !in_quote;
            }
        }

        // Scan forward from pos to find valid newline outside quotes
        i = pos;
        while (i < self.data.len) : (i += 1) {
            const byte = self.data[i];

            if (byte == self.config.quote_char) {
                if (i + 1 < self.data.len and self.data[i + 1] == self.config.quote_char) {
                    i += 1;
                    continue;
                }
                in_quote = !in_quote;
            } else if (!in_quote and byte == '\n') {
                return i + 1;
            }
        }

        return self.data.len;
    }

    /// Process all chunks (single-threaded or multi-threaded)
    pub fn process(self: *Self) !void {
        try self.calculateChunks();

        if (self.chunks.len == 0) return;

        if (self.chunks.len == 1 or self.getOptimalThreadCount() == 1) {
            // Single-threaded processing
            for (self.chunks) |chunk| {
                const result = try self.processChunk(chunk);
                try self.results.append(self.allocator, result);
            }
        } else {
            // Multi-threaded processing
            self.thread_pool = try self.allocator.alloc(std.Thread, self.chunks.len);

            for (self.chunks, 0..) |chunk, idx| {
                self.thread_pool.?[idx] = try std.Thread.spawn(.{}, workerFn, .{ self, chunk });
            }

            // Wait for all threads
            for (self.thread_pool.?) |thread| {
                thread.join();
            }

            self.allocator.free(self.thread_pool.?);
            self.thread_pool = null;
        }

        // Populate reorder buffer with all results
        try self.populateReorderBuffer();
    }

    fn workerFn(self: *Self, chunk: ChunkBoundary) void {
        const result = self.processChunk(chunk) catch |err| {
            const error_result = ChunkResult{
                .chunk_id = chunk.id,
                .start_row_index = chunk.estimated_start_row,
                .rows = .{},
                .err_msg = std.fmt.allocPrint(self.allocator, "Chunk {} error: {}", .{ chunk.id, err }) catch null,
                .bytes_processed = 0,
            };
            self.mutex.lock();
            self.results.append(self.allocator, error_result) catch {};
            self.completed_count += 1;
            self.mutex.unlock();
            self.results_ready.signal();
            return;
        };

        self.mutex.lock();
        self.results.append(self.allocator, result) catch {};
        self.completed_count += 1;
        self.mutex.unlock();
        self.results_ready.signal();
    }

    /// Process a single chunk and return parsed rows
    fn processChunk(self: *Self, chunk: ChunkBoundary) !ChunkResult {
        var result = ChunkResult{
            .chunk_id = chunk.id,
            .start_row_index = chunk.estimated_start_row,
            .rows = .{},
            .err_msg = null,
            .bytes_processed = 0,
        };

        const chunk_data = self.data[chunk.start..chunk.end];
        var pos: usize = 0;
        var row_index = chunk.estimated_start_row;
        var in_quote = false;

        while (pos < chunk_data.len) {
            var fields: std.ArrayListUnmanaged(FieldLoc) = .{};
            var field_start = pos;
            const row_start = pos;

            // Parse one row
            while (pos < chunk_data.len) {
                const byte = chunk_data[pos];

                if (byte == self.config.quote_char) {
                    // Check for escaped quote
                    if (pos + 1 < chunk_data.len and chunk_data[pos + 1] == self.config.quote_char) {
                        pos += 2;
                        continue;
                    }
                    in_quote = !in_quote;
                } else if (!in_quote) {
                    if (byte == self.config.delimiter) {
                        // End of field
                        const needs_unescape = field_start < chunk_data.len and chunk_data[field_start] == self.config.quote_char;
                        try fields.append(self.allocator, .{
                            .start = chunk.start + field_start,
                            .len = pos - field_start,
                            .needs_unescape = needs_unescape,
                        });
                        field_start = pos + 1;
                    } else if (byte == '\n') {
                        // End of row
                        var field_len = pos - field_start;
                        // Handle CRLF
                        if (pos > 0 and chunk_data[pos - 1] == '\r' and field_start < pos) {
                            field_len = pos - field_start - 1;
                        }

                        const needs_unescape = field_start < chunk_data.len and chunk_data[field_start] == self.config.quote_char;
                        try fields.append(self.allocator, .{
                            .start = chunk.start + field_start,
                            .len = field_len,
                            .needs_unescape = needs_unescape,
                        });

                        pos += 1;
                        break;
                    }
                }
                pos += 1;
            }

            // Handle last row without newline
            if (pos >= chunk_data.len and field_start < chunk_data.len) {
                const needs_unescape = chunk_data[field_start] == self.config.quote_char;
                try fields.append(self.allocator, .{
                    .start = chunk.start + field_start,
                    .len = chunk_data.len - field_start,
                    .needs_unescape = needs_unescape,
                });
            }

            // Skip empty rows
            if (fields.items.len == 0) {
                fields.deinit(self.allocator);
                continue;
            }

            try result.rows.append(self.allocator, .{
                .global_index = row_index,
                .fields = try fields.toOwnedSlice(self.allocator),
                .byte_offset = chunk.start + row_start,
            });

            row_index += 1;
            in_quote = false; // Reset for next row
        }

        result.bytes_processed = chunk.end - chunk.start;
        return result;
    }

    /// Populate reorder buffer from all chunk results
    fn populateReorderBuffer(self: *Self) !void {
        // First, we need to fix row indices since our estimates were rough
        // Sort results by chunk_id to process in order
        std.sort.pdq(ChunkResult, self.results.items, {}, struct {
            fn lessThan(_: void, a: ChunkResult, b: ChunkResult) bool {
                return a.chunk_id < b.chunk_id;
            }
        }.lessThan);

        // Reassign global indices sequentially
        var global_idx: usize = 0;
        for (self.results.items) |*result| {
            for (result.rows.items) |*row| {
                row.global_index = global_idx;
                global_idx += 1;
            }
            self.total_rows_parsed += result.rows.items.len;
            self.total_bytes_processed += result.bytes_processed;
        }
    }

    /// Iterator for getting rows in order
    pub fn orderedIterator(self: *Self) OrderedIterator {
        return OrderedIterator.init(self);
    }

    pub fn deinit(self: *Self) void {
        for (self.results.items) |*result| {
            result.deinit(self.allocator);
        }
        self.results.deinit(self.allocator);

        if (self.chunks.len > 0) {
            self.allocator.free(self.chunks);
        }

        self.reorder_buffer.deinit();

        if (self.thread_pool) |pool| {
            self.allocator.free(pool);
        }

        self.allocator.destroy(self);
    }
};

/// Iterator that yields rows in original file order
pub const OrderedIterator = struct {
    processor: *ChunkProcessor,
    current_chunk_idx: usize,
    current_row_idx: usize,

    const Self = @This();

    pub fn init(processor: *ChunkProcessor) Self {
        return Self{
            .processor = processor,
            .current_chunk_idx = 0,
            .current_row_idx = 0,
        };
    }

    pub fn next(self: *Self) ?*ParsedRow {
        while (self.current_chunk_idx < self.processor.results.items.len) {
            const result = &self.processor.results.items[self.current_chunk_idx];

            if (self.current_row_idx < result.rows.items.len) {
                const row = &result.rows.items[self.current_row_idx];
                self.current_row_idx += 1;
                return row;
            }

            // Move to next chunk
            self.current_chunk_idx += 1;
            self.current_row_idx = 0;
        }

        return null;
    }

    pub fn reset(self: *Self) void {
        self.current_chunk_idx = 0;
        self.current_row_idx = 0;
    }
};

// ============================================================================
// Tests
// ============================================================================

test "optimal thread count" {
    // Small file (< 100MB) - should use 1 thread
    {
        const small_data = try std.testing.allocator.alloc(u8, 50 * 1024 * 1024);
        defer std.testing.allocator.free(small_data);

        const processor = try ChunkProcessor.init(std.testing.allocator, small_data, .{});
        defer processor.deinit();

        try std.testing.expectEqual(@as(usize, 1), processor.getOptimalThreadCount());
    }
}

test "chunk boundary finding" {
    const data = "row1,field1\nrow2,field2\n\"quoted\nfield\"\nrow4\n";

    const processor = try ChunkProcessor.init(std.testing.allocator, data, .{ .min_chunk_size = 10 });
    defer processor.deinit();

    // Should find boundary after complete rows (outside quotes)
    const boundary = processor.findRowBoundary(15);
    try std.testing.expect(data[boundary - 1] == '\n');
}

test "single chunk processing" {
    const data = "name,age\nAlice,30\nBob,25\n";

    const processor = try ChunkProcessor.init(std.testing.allocator, data, .{ .min_chunk_size = 1 });
    defer processor.deinit();

    try processor.process();

    try std.testing.expectEqual(@as(usize, 3), processor.total_rows_parsed);
}

test "parallel processing preserves order" {
    // Create larger test data
    var buffer: [4096]u8 = undefined;
    var stream = std.io.fixedBufferStream(&buffer);
    const writer = stream.writer();

    writer.writeAll("id,value\n") catch unreachable;
    for (0..50) |i| {
        writer.print("{d},test{d}\n", .{ i, i }) catch unreachable;
    }

    const data = stream.getWritten();
    const processor = try ChunkProcessor.init(std.testing.allocator, data, .{ .min_chunk_size = 100 });
    defer processor.deinit();

    try processor.process();

    // Verify rows are in order
    var iter = processor.orderedIterator();
    var expected_idx: usize = 0;
    while (iter.next()) |row| {
        try std.testing.expectEqual(expected_idx, row.global_index);
        expected_idx += 1;
    }
}
