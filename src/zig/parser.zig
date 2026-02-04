const std = @import("std");
const simd = @import("simd.zig");
const parallel = @import("parallel.zig");
const iconv = @import("iconv.zig");
pub const dataframe = @import("dataframe.zig");

const Allocator = std.mem.Allocator;

/// Opaque handle for FFI - hides internal Parser struct from JS
pub const ParserHandle = *anyopaque;

/// Cache limit status
pub const CacheLimitStatus = enum(u8) {
    ok = 0,
    soft_limit_exceeded = 1,
    hard_limit_exceeded = 2,
};

/// Cache warning callback type (for FFI)
pub const CacheWarningCallback = ?*const fn (cache_bytes: usize, limit: usize, status: CacheLimitStatus) void;

/// Parser configuration options
pub const ParserConfig = struct {
    delimiter: u8 = ',',
    quote_char: u8 = '"',
    escape_char: u8 = '"',
    has_header: bool = true,
    skip_empty_rows: bool = true,
    max_field_size: usize = 0, // 0 = unlimited
    soft_cache_limit: usize = 256 * 1024 * 1024, // 256MB
    hard_cache_limit: usize = 1024 * 1024 * 1024, // 1GB
    encoding: iconv.Encoding = .utf8, // Source encoding
};

/// Field location within the memory-mapped file
pub const FieldLocation = struct {
    start: usize,
    len: usize,
    needs_unescape: bool,
};

/// Row containing field locations
pub const Row = struct {
    fields: []FieldLocation,
    field_count: usize,
};

/// Statistics for progress tracking
pub const Stats = extern struct {
    bytes_processed: u64,
    total_bytes: u64,
    rows_emitted: u64,
    error_count: u64,
    cache_bytes: u64,
};

/// Main CSV Parser struct
pub const Parser = struct {
    allocator: Allocator,
    config: ParserConfig,

    // Memory mapped file data
    data: []const u8,
    data_len: usize,
    file_handle: ?std.fs.File,

    // Current parsing state
    cursor: usize,
    current_row: usize,
    in_quote: bool,

    // Field index for current row
    field_offsets: std.ArrayListUnmanaged(FieldLocation),

    // SIMD scanner for accelerated parsing
    simd_scanner: simd.SimdScanner,

    // String cache pool with limit enforcement
    string_cache: std.StringHashMap([]const u8),
    cache_size: usize,
    cache_status: CacheLimitStatus,
    soft_limit_warned: bool,
    cache_warning_callback: CacheWarningCallback,

    // Encoding transcoder (if needed)
    transcoder: ?*iconv.Transcoder,
    transcoded_data: ?[]u8, // Owned buffer if transcoded

    // Statistics
    stats: Stats,

    // State flags
    is_paused: bool,
    is_closed: bool,
    file_mtime: i128,
    file_size: u64,

    const Self = @This();

    /// Initialize parser from file path
    pub fn initFromFile(allocator: Allocator, path: []const u8, config: ParserConfig) !*Self {
        const file = try std.fs.cwd().openFile(path, .{ .mode = .read_only });
        errdefer file.close();

        const stat = try file.stat();
        const file_size = stat.size;
        const mtime = stat.mtime;

        // Memory map the file
        const mapped_data = try std.posix.mmap(
            null,
            file_size,
            std.posix.PROT.READ,
            .{ .TYPE = .PRIVATE },
            file.handle,
            0,
        );

        // Detect or use specified encoding
        var actual_encoding = config.encoding;
        var bom_offset: usize = 0;

        if (config.encoding == .utf8) {
            // Auto-detect encoding if UTF-8 specified (default)
            if (iconv.BOM.detect(mapped_data)) |detected| {
                actual_encoding = detected.encoding;
                bom_offset = detected.bom_len;
            } else {
                actual_encoding = iconv.detectEncoding(mapped_data);
            }
        }

        // Transcode if not UTF-8
        var final_data: []const u8 = mapped_data;
        var transcoder: ?*iconv.Transcoder = null;
        var transcoded_data: ?[]u8 = null;

        if (actual_encoding != .utf8) {
            transcoder = iconv.Transcoder.init(allocator, actual_encoding, .utf8) catch null;
            if (transcoder) |t| {
                const source_data = mapped_data[bom_offset..];
                transcoded_data = t.transcode(source_data) catch null;
                if (transcoded_data) |td| {
                    final_data = td;
                }
            }
        } else if (bom_offset > 0) {
            // UTF-8 with BOM - skip BOM
            final_data = mapped_data[bom_offset..];
        }

        const parser = try allocator.create(Self);
        parser.* = Self{
            .allocator = allocator,
            .config = config,
            .data = final_data,
            .data_len = final_data.len,
            .file_handle = file,
            .cursor = 0,
            .current_row = 0,
            .in_quote = false,
            .field_offsets = .{},
            .simd_scanner = simd.SimdScanner.init(config.delimiter, config.quote_char),
            .string_cache = std.StringHashMap([]const u8).init(allocator),
            .cache_size = 0,
            .cache_status = .ok,
            .soft_limit_warned = false,
            .cache_warning_callback = null,
            .transcoder = transcoder,
            .transcoded_data = transcoded_data,
            .stats = Stats{
                .bytes_processed = 0,
                .total_bytes = file_size,
                .rows_emitted = 0,
                .error_count = 0,
                .cache_bytes = 0,
            },
            .is_paused = false,
            .is_closed = false,
            .file_mtime = mtime,
            .file_size = file_size,
        };

        return parser;
    }

    /// Initialize parser from memory buffer
    pub fn initFromBuffer(allocator: Allocator, data: []const u8, config: ParserConfig) !*Self {
        // Detect encoding and handle BOM
        var actual_encoding = config.encoding;
        var bom_offset: usize = 0;

        if (config.encoding == .utf8) {
            if (iconv.BOM.detect(data)) |detected| {
                actual_encoding = detected.encoding;
                bom_offset = detected.bom_len;
            } else {
                actual_encoding = iconv.detectEncoding(data);
            }
        }

        // Transcode if not UTF-8
        var final_data: []const u8 = data;
        var transcoder: ?*iconv.Transcoder = null;
        var transcoded_data: ?[]u8 = null;

        if (actual_encoding != .utf8) {
            transcoder = iconv.Transcoder.init(allocator, actual_encoding, .utf8) catch null;
            if (transcoder) |t| {
                const source_data = data[bom_offset..];
                transcoded_data = t.transcode(source_data) catch null;
                if (transcoded_data) |td| {
                    final_data = td;
                }
            }
        } else if (bom_offset > 0) {
            final_data = data[bom_offset..];
        }

        const parser = try allocator.create(Self);
        parser.* = Self{
            .allocator = allocator,
            .config = config,
            .data = final_data,
            .data_len = final_data.len,
            .file_handle = null,
            .cursor = 0,
            .current_row = 0,
            .in_quote = false,
            .field_offsets = .{},
            .simd_scanner = simd.SimdScanner.init(config.delimiter, config.quote_char),
            .string_cache = std.StringHashMap([]const u8).init(allocator),
            .cache_size = 0,
            .cache_status = .ok,
            .soft_limit_warned = false,
            .cache_warning_callback = null,
            .transcoder = transcoder,
            .transcoded_data = transcoded_data,
            .stats = Stats{
                .bytes_processed = 0,
                .total_bytes = data.len,
                .rows_emitted = 0,
                .error_count = 0,
                .cache_bytes = 0,
            },
            .is_paused = false,
            .is_closed = false,
            .file_mtime = 0,
            .file_size = data.len,
        };

        return parser;
    }

    /// Advance to next row, parsing field boundaries
    /// Uses SIMD-accelerated scanning with O(1) quote tracking
    /// Handles RFC 4180 compliant parsing including escaped quotes ("")
    pub fn nextRow(self: *Self) bool {
        if (self.is_closed or self.is_paused) return false;
        if (self.cursor >= self.data_len) return false;

        // Clear previous row's field offsets
        self.field_offsets.clearRetainingCapacity();

        // Use SIMD scanner for fast row parsing
        const scan = self.simd_scanner.scanRowFast(self.data, self.cursor);

        if (scan.field_count == 0 and !scan.found_row) {
            return false;
        }

        // Convert scan result to field offsets
        var field_start = self.cursor;
        for (0..scan.field_count) |i| {
            const field_end = scan.field_ends[i];
            const field = FieldLocation{
                .start = field_start,
                .len = field_end - field_start,
                .needs_unescape = scan.needs_unescape[i],
            };
            self.field_offsets.append(self.allocator, field) catch return false;
            field_start = field_end + 1;
        }

        self.cursor = scan.row_end;
        self.current_row += 1;
        self.stats.rows_emitted += 1;
        self.stats.bytes_processed = self.cursor;
        self.in_quote = false; // Reset for next row

        return true;
    }

    /// Check if field contains quotes that need unescaping
    fn fieldNeedsUnescape(self: *Self, start: usize, end: usize) bool {
        if (start >= end) return false;
        // Check if field starts with quote
        return self.data[start] == self.config.quote_char;
    }

    /// Get number of fields in current row
    pub fn getFieldCount(self: *Self) usize {
        return self.field_offsets.items.len;
    }

    /// Get raw pointer to field data
    pub fn getFieldPtr(self: *Self, col_idx: usize) ?[*]const u8 {
        if (col_idx >= self.field_offsets.items.len) return null;
        const field = self.field_offsets.items[col_idx];
        return self.data.ptr + field.start;
    }

    /// Get field length
    pub fn getFieldLen(self: *Self, col_idx: usize) usize {
        if (col_idx >= self.field_offsets.items.len) return 0;
        return self.field_offsets.items[col_idx].len;
    }

    /// Get field as slice (internal use)
    pub fn getFieldSlice(self: *Self, col_idx: usize) ?[]const u8 {
        if (col_idx >= self.field_offsets.items.len) return null;
        const field = self.field_offsets.items[col_idx];
        return self.data[field.start .. field.start + field.len];
    }

    /// Pause parsing
    pub fn pause(self: *Self) void {
        self.is_paused = true;
    }

    /// Resume parsing
    pub fn unpause(self: *Self) void {
        self.is_paused = false;
    }

    /// Get current statistics
    pub fn getStats(self: *Self) *Stats {
        return &self.stats;
    }

    /// Check if file was modified externally
    pub fn checkFileModified(self: *Self) bool {
        if (self.file_handle) |file| {
            const stat = file.stat() catch return true;
            return stat.mtime != self.file_mtime or stat.size != self.file_size;
        }
        return false;
    }

    /// Clean up and release resources
    pub fn close(self: *Self) void {
        if (self.is_closed) return;

        // Free cached strings
        var it = self.string_cache.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.value_ptr.*);
        }
        self.string_cache.deinit();

        // Free field offsets
        self.field_offsets.deinit(self.allocator);

        // Free transcoded data if any
        if (self.transcoded_data) |td| {
            self.allocator.free(td);
        }

        // Close transcoder
        if (self.transcoder) |t| {
            t.deinit();
        }

        // Unmap memory if from file
        if (self.file_handle) |file| {
            // We need to unmap using the original file size
            // The data pointer might have been adjusted for BOM or transcoding
            // but we stored the original file_size
            const map_size = self.file_size;
            if (map_size > 0) {
                // Calculate the original mmap base address
                // If transcoded, data points to transcoded buffer (already freed above)
                // If BOM skipped, data points into mmap + offset
                // We need to unmap from the file start
                if (self.transcoded_data == null) {
                    // Data is still mmap'd (possibly with BOM offset)
                    // Need to find original base
                    const bom_offset = self.file_size - self.data_len;
                    const base_ptr = self.data.ptr - bom_offset;
                    const aligned_data: []align(std.heap.page_size_min) const u8 = @alignCast(@as([*]const u8, @ptrCast(base_ptr))[0..self.file_size]);
                    std.posix.munmap(aligned_data);
                }
            }
            file.close();
        }

        self.is_closed = true;
    }

    /// Set cache warning callback
    pub fn setCacheWarningCallback(self: *Self, callback: CacheWarningCallback) void {
        self.cache_warning_callback = callback;
    }

    /// Check cache limits and trigger warnings
    fn checkCacheLimits(self: *Self) CacheLimitStatus {
        if (self.cache_size >= self.config.hard_cache_limit) {
            self.cache_status = .hard_limit_exceeded;
            if (self.cache_warning_callback) |cb| {
                cb(self.cache_size, self.config.hard_cache_limit, .hard_limit_exceeded);
            }
            return .hard_limit_exceeded;
        }

        if (self.cache_size >= self.config.soft_cache_limit and !self.soft_limit_warned) {
            self.soft_limit_warned = true;
            self.cache_status = .soft_limit_exceeded;
            if (self.cache_warning_callback) |cb| {
                cb(self.cache_size, self.config.soft_cache_limit, .soft_limit_exceeded);
            }
            return .soft_limit_exceeded;
        }

        return self.cache_status;
    }

    /// Clear the string cache to free memory
    pub fn clearCache(self: *Self) void {
        var it = self.string_cache.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.value_ptr.*);
        }
        self.string_cache.clearRetainingCapacity();
        self.cache_size = 0;
        self.cache_status = .ok;
        self.soft_limit_warned = false;
        self.stats.cache_bytes = 0;
    }

    /// Get current cache status
    pub fn getCacheStatus(self: *Self) CacheLimitStatus {
        return self.cache_status;
    }

    /// Destroy parser and free memory
    pub fn deinit(self: *Self) void {
        self.close();
        self.allocator.destroy(self);
    }
};

// ============================================================================
// FFI Exports (C ABI)
// ============================================================================

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const global_allocator = gpa.allocator();

/// Initialize parser from file path
export fn csv_init(file_path_ptr: [*c]const u8) ?ParserHandle {
    const path = std.mem.span(file_path_ptr);
    const parser = Parser.initFromFile(global_allocator, path, .{}) catch return null;
    return @ptrCast(parser);
}

/// Initialize parser from memory buffer
export fn csv_init_buffer(data_ptr: [*c]const u8, data_len: usize) ?ParserHandle {
    const data = data_ptr[0..data_len];
    const parser = Parser.initFromBuffer(global_allocator, data, .{}) catch return null;
    return @ptrCast(parser);
}

/// Advance to next row
export fn csv_next_row(handle: ParserHandle) bool {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.nextRow();
}

/// Get field count for current row
export fn csv_get_field_count(handle: ParserHandle) usize {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.getFieldCount();
}

/// Get pointer to field data
export fn csv_get_field_ptr(handle: ParserHandle, col_idx: usize) ?[*]const u8 {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.getFieldPtr(col_idx);
}

/// Get field length
export fn csv_get_field_len(handle: ParserHandle, col_idx: usize) usize {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.getFieldLen(col_idx);
}

/// Get statistics pointer
export fn csv_get_stats(handle: ParserHandle) *Stats {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.getStats();
}

/// Pause parsing
export fn csv_pause(handle: ParserHandle) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.pause();
}

/// Resume parsing
export fn csv_resume(handle: ParserHandle) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.unpause();
}

/// Check if file was modified
export fn csv_check_modified(handle: ParserHandle) bool {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.checkFileModified();
}

/// Close and release resources
export fn csv_close(handle: ParserHandle) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.deinit();
}

/// Check if field needs unescaping (starts with quote)
export fn csv_field_needs_unescape(handle: ParserHandle, col_idx: usize) bool {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    if (col_idx >= parser.field_offsets.items.len) return false;
    return parser.field_offsets.items[col_idx].needs_unescape;
}

/// Unescape a field - returns pointer to unescaped string (cached)
/// Caller should NOT free this memory - it's managed by the parser
/// Returns null if hard cache limit is exceeded
export fn csv_get_field_unescaped(handle: ParserHandle, col_idx: usize, out_len: *usize) ?[*]const u8 {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    const field_slice = parser.getFieldSlice(col_idx) orelse {
        out_len.* = 0;
        return null;
    };

    // If doesn't need unescaping, return raw pointer
    if (col_idx < parser.field_offsets.items.len and !parser.field_offsets.items[col_idx].needs_unescape) {
        out_len.* = field_slice.len;
        return field_slice.ptr;
    }

    // Check cache first
    if (parser.string_cache.get(field_slice)) |cached| {
        out_len.* = cached.len;
        return cached.ptr;
    }

    // Check if hard limit would be exceeded
    if (parser.cache_status == .hard_limit_exceeded) {
        // Return raw data instead of caching
        out_len.* = field_slice.len;
        return field_slice.ptr;
    }

    // Unescape and cache
    const unescaped = simd.unescapeField(field_slice, parser.allocator) catch {
        out_len.* = field_slice.len;
        return field_slice.ptr;
    };

    // Check if this would exceed hard limit
    if (parser.cache_size + unescaped.len > parser.config.hard_cache_limit) {
        parser.allocator.free(unescaped);
        _ = parser.checkCacheLimits();
        out_len.* = field_slice.len;
        return field_slice.ptr;
    }

    // Add to cache
    parser.string_cache.put(field_slice, unescaped) catch {
        parser.allocator.free(unescaped);
        out_len.* = field_slice.len;
        return field_slice.ptr;
    };

    parser.cache_size += unescaped.len;
    parser.stats.cache_bytes = parser.cache_size;

    // Check limits and trigger callbacks
    _ = parser.checkCacheLimits();

    out_len.* = unescaped.len;
    return unescaped.ptr;
}

/// Get SIMD vector width (for debugging/info)
export fn csv_get_simd_width() usize {
    return simd.VECTOR_WIDTH;
}

/// Maximum fields in batch result (must match TypeScript)
pub const MAX_BATCH_FIELDS: usize = 64;

/// Batch row result structure for efficient FFI
/// Packed for minimal FFI overhead - returns all field info in one call
pub const BatchRowResult = extern struct {
    field_count: u32,
    _pad: u32 = 0,
    /// Pointers to field data (absolute memory addresses)
    ptrs: [MAX_BATCH_FIELDS]usize,
    /// Length of each field
    lens: [MAX_BATCH_FIELDS]u32,
    /// Flags: bit 0 = needs_unescape
    flags: [MAX_BATCH_FIELDS]u8,
};

/// Static batch result buffer (avoid allocation per call)
var batch_result_buffer: BatchRowResult = undefined;

/// Get all field data for current row in a single FFI call
/// Returns pointer to static BatchRowResult, valid until next call
/// This reduces FFI overhead from 3-5 calls per field to 1 call per row
export fn csv_get_row_batch(handle: ParserHandle) ?*const BatchRowResult {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    const field_count = parser.field_offsets.items.len;
    if (field_count == 0) return null;

    // Clamp to max fields
    const actual_count = @min(field_count, MAX_BATCH_FIELDS);

    batch_result_buffer.field_count = @intCast(actual_count);

    for (0..actual_count) |i| {
        const field = parser.field_offsets.items[i];
        batch_result_buffer.ptrs[i] = @intFromPtr(parser.data.ptr + field.start);
        batch_result_buffer.lens[i] = @intCast(field.len);
        batch_result_buffer.flags[i] = if (field.needs_unescape) 1 else 0;
    }

    return &batch_result_buffer;
}

/// Maximum size for row data buffer (64KB should handle most rows)
const ROW_DATA_BUFFER_SIZE: usize = 64 * 1024;

/// Static buffer for returning all row data in one call
var row_data_buffer: [ROW_DATA_BUFFER_SIZE]u8 = undefined;

/// Result structure for row data buffer
pub const RowDataResult = extern struct {
    /// Pointer to buffer containing all field data
    data_ptr: [*]const u8,
    /// Total size of data in buffer
    total_size: u32,
    /// Number of fields
    field_count: u32,
};

var row_data_result: RowDataResult = undefined;

/// Get all field strings for current row in a single buffer
/// Format: [u32 len1][bytes1][u32 len2][bytes2]...
/// Fields that need unescaping are processed inline
/// Returns pointer to RowDataResult, valid until next call
export fn csv_get_row_data(handle: ParserHandle) ?*const RowDataResult {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    const field_count = parser.field_offsets.items.len;
    if (field_count == 0) return null;

    var write_pos: usize = 0;
    const max_fields = @min(field_count, MAX_BATCH_FIELDS);

    for (0..max_fields) |i| {
        const field = parser.field_offsets.items[i];
        const field_data = parser.data[field.start .. field.start + field.len];

        if (field.needs_unescape and field_data.len >= 2 and field_data[0] == parser.config.quote_char) {
            // Unescape inline: remove quotes and handle ""
            const inner = field_data[1 .. field_data.len - 1];

            // Calculate unescaped length first
            var unesc_len: u32 = 0;
            var j: usize = 0;
            while (j < inner.len) {
                if (inner[j] == parser.config.quote_char and j + 1 < inner.len and inner[j + 1] == parser.config.quote_char) {
                    unesc_len += 1;
                    j += 2;
                } else {
                    unesc_len += 1;
                    j += 1;
                }
            }

            // Check buffer space
            if (write_pos + 4 + unesc_len > ROW_DATA_BUFFER_SIZE) return null;

            // Write length
            const len_bytes: *[4]u8 = @ptrCast(row_data_buffer[write_pos..][0..4]);
            len_bytes.* = @bitCast(unesc_len);
            write_pos += 4;

            // Write unescaped data
            j = 0;
            while (j < inner.len) {
                if (inner[j] == parser.config.quote_char and j + 1 < inner.len and inner[j + 1] == parser.config.quote_char) {
                    row_data_buffer[write_pos] = parser.config.quote_char;
                    write_pos += 1;
                    j += 2;
                } else {
                    row_data_buffer[write_pos] = inner[j];
                    write_pos += 1;
                    j += 1;
                }
            }
        } else {
            // No unescaping needed - copy directly
            const len: u32 = @intCast(field_data.len);

            // Check buffer space
            if (write_pos + 4 + len > ROW_DATA_BUFFER_SIZE) return null;

            // Write length
            const len_bytes: *[4]u8 = @ptrCast(row_data_buffer[write_pos..][0..4]);
            len_bytes.* = @bitCast(len);
            write_pos += 4;

            // Write data
            @memcpy(row_data_buffer[write_pos..][0..len], field_data);
            write_pos += len;
        }
    }

    row_data_result = RowDataResult{
        .data_ptr = &row_data_buffer,
        .total_size = @intCast(write_pos),
        .field_count = @intCast(max_fields),
    };

    return &row_data_result;
}

// ============================================================================
// Batch Row Parsing API (Option 2)
// Parse multiple rows at once to reduce FFI overhead
// ============================================================================

/// Maximum rows in a batch
pub const MAX_BATCH_ROWS: usize = 1000;

/// Maximum total fields across all batch rows
pub const MAX_BATCH_TOTAL_FIELDS: usize = MAX_BATCH_ROWS * 32; // Assume avg 32 fields max

/// Field info in batch result
pub const BatchFieldInfo = extern struct {
    ptr: usize, // Pointer to field data
    len: u32, // Field length
    flags: u8, // bit 0 = needs_unescape
    _pad: [3]u8 = .{ 0, 0, 0 },
};

/// Row info in batch result
pub const BatchRowInfo = extern struct {
    field_start_idx: u32, // Index into fields array
    field_count: u16, // Number of fields in this row
    _pad: u16 = 0,
};

/// Batch parsing result
pub const BatchParseResult = extern struct {
    rows_parsed: u32,
    total_fields: u32,
    has_more: u8,
    _pad: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },
};

/// Static buffers for batch results
var batch_rows: [MAX_BATCH_ROWS]BatchRowInfo = undefined;
var batch_fields: [MAX_BATCH_TOTAL_FIELDS]BatchFieldInfo = undefined;
var batch_parse_result: BatchParseResult = undefined;

/// Parse up to max_rows rows and return all field info in one call
/// Returns pointer to BatchParseResult, with row and field info in static buffers
export fn csv_parse_batch(handle: ParserHandle, max_rows: u32) ?*const BatchParseResult {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    if (parser.is_closed or parser.is_paused) return null;
    if (parser.cursor >= parser.data_len) return null;

    const rows_to_parse = @min(max_rows, MAX_BATCH_ROWS);
    var rows_parsed: u32 = 0;
    var total_fields: u32 = 0;

    while (rows_parsed < rows_to_parse and parser.cursor < parser.data_len) {
        // Parse one row using existing nextRow logic
        if (!parser.nextRow()) break;

        const field_count = parser.field_offsets.items.len;
        if (total_fields + field_count > MAX_BATCH_TOTAL_FIELDS) {
            // Would overflow field buffer - stop here
            // Note: row was already parsed, so we include it
            break;
        }

        // Record row info
        batch_rows[rows_parsed] = BatchRowInfo{
            .field_start_idx = total_fields,
            .field_count = @intCast(@min(field_count, 65535)),
        };

        // Record field info
        for (parser.field_offsets.items) |field| {
            batch_fields[total_fields] = BatchFieldInfo{
                .ptr = @intFromPtr(parser.data.ptr + field.start),
                .len = @intCast(field.len),
                .flags = if (field.needs_unescape) 1 else 0,
            };
            total_fields += 1;
        }

        rows_parsed += 1;
    }

    if (rows_parsed == 0) return null;

    batch_parse_result = BatchParseResult{
        .rows_parsed = rows_parsed,
        .total_fields = total_fields,
        .has_more = if (parser.cursor < parser.data_len) 1 else 0,
    };

    return &batch_parse_result;
}

/// Get pointer to batch rows array (valid after csv_parse_batch)
export fn csv_get_batch_rows() [*]const BatchRowInfo {
    return &batch_rows;
}

/// Get pointer to batch fields array (valid after csv_parse_batch)
export fn csv_get_batch_fields() [*]const BatchFieldInfo {
    return &batch_fields;
}

// ============================================================================
// Full Parse API (Option 3)
// Parse everything at once and return all data in a single buffer
// ============================================================================

/// Result header for full parse
pub const FullParseHeader = extern struct {
    total_rows: u32,
    total_fields: u32,
    data_size: u32,
    _pad: u32 = 0,
};

/// Full parse result - all data in contiguous memory
/// Layout: [FullParseHeader][row_field_counts: u16 * total_rows][field_offsets: u32 * total_fields][data_buffer]
var full_parse_buffer: ?[]u8 = null;
var full_parse_header: FullParseHeader = undefined;

/// Parse entire file and return all data in one buffer
/// Returns pointer to FullParseHeader, followed by row info, field offsets, and data
export fn csv_parse_all(handle: ParserHandle) ?*const FullParseHeader {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    if (parser.is_closed) return null;

    // First pass: count rows and fields, calculate data size
    var total_rows: u32 = 0;
    var total_fields: u32 = 0;
    var data_size: u32 = 0;

    const start_cursor = parser.cursor;

    // Count phase
    while (parser.nextRow()) {
        total_rows += 1;
        const fc = parser.field_offsets.items.len;
        total_fields += @intCast(fc);

        for (parser.field_offsets.items) |field| {
            if (field.needs_unescape and field.len >= 2) {
                // Estimate unescaped size (remove outer quotes, "" -> ")
                // Worst case: same length, best case: len - 2
                data_size += @intCast(field.len);
            } else {
                data_size += @intCast(field.len);
            }
        }
    }

    if (total_rows == 0) return null;

    // Calculate buffer layout (all sections 4-byte aligned)
    // Header: 16 bytes
    // Row field counts: 4 * total_rows bytes (u32 per row for alignment)
    // Field offsets: 4 * total_fields bytes (u32 offset into data)
    // Field lengths: 4 * total_fields bytes (u32 length)
    // Data: data_size bytes
    const header_size: usize = 16;
    const row_counts_size: usize = @as(usize, total_rows) * 4; // Use u32 for alignment
    const field_offsets_size: usize = @as(usize, total_fields) * 4;
    const field_lengths_size: usize = @as(usize, total_fields) * 4;
    const total_size = header_size + row_counts_size + field_offsets_size + field_lengths_size + data_size;

    // Free previous buffer if any
    if (full_parse_buffer) |buf| {
        global_allocator.free(buf);
    }

    // Allocate buffer
    full_parse_buffer = global_allocator.alloc(u8, total_size) catch return null;
    const buf = full_parse_buffer.?;

    // Reset parser to beginning
    parser.cursor = start_cursor;
    parser.current_row = 0;
    parser.stats.rows_emitted = 0;
    parser.in_quote = false;

    // Write header
    const header_ptr: *FullParseHeader = @ptrCast(@alignCast(buf.ptr));
    header_ptr.* = FullParseHeader{
        .total_rows = total_rows,
        .total_fields = total_fields,
        .data_size = data_size,
    };

    // Pointers to sections
    const row_counts_ptr: [*]u32 = @ptrCast(@alignCast(buf.ptr + header_size));
    const field_offsets_ptr: [*]u32 = @ptrCast(@alignCast(buf.ptr + header_size + row_counts_size));
    const field_lengths_ptr: [*]u32 = @ptrCast(@alignCast(buf.ptr + header_size + row_counts_size + field_offsets_size));
    const data_ptr: [*]u8 = buf.ptr + header_size + row_counts_size + field_offsets_size + field_lengths_size;

    // Second pass: write data
    var row_idx: u32 = 0;
    var field_idx: u32 = 0;
    var data_offset: u32 = 0;

    while (parser.nextRow()) {
        const fc: u32 = @intCast(@min(parser.field_offsets.items.len, 0xFFFFFFFF));
        row_counts_ptr[row_idx] = fc;

        for (parser.field_offsets.items) |field| {
            const field_data = parser.data[field.start .. field.start + field.len];

            if (field.needs_unescape and field_data.len >= 2 and field_data[0] == parser.config.quote_char) {
                // Unescape: remove outer quotes, "" -> "
                const inner = field_data[1 .. field_data.len - 1];
                var write_len: u32 = 0;

                var j: usize = 0;
                while (j < inner.len) {
                    if (inner[j] == parser.config.quote_char and j + 1 < inner.len and inner[j + 1] == parser.config.quote_char) {
                        data_ptr[data_offset + write_len] = parser.config.quote_char;
                        write_len += 1;
                        j += 2;
                    } else {
                        data_ptr[data_offset + write_len] = inner[j];
                        write_len += 1;
                        j += 1;
                    }
                }

                field_offsets_ptr[field_idx] = data_offset;
                field_lengths_ptr[field_idx] = write_len;
                data_offset += write_len;
            } else {
                // Copy directly
                field_offsets_ptr[field_idx] = data_offset;
                field_lengths_ptr[field_idx] = @intCast(field_data.len);
                @memcpy(data_ptr[data_offset..][0..field_data.len], field_data);
                data_offset += @intCast(field_data.len);
            }

            field_idx += 1;
        }

        row_idx += 1;
    }

    // Update header with actual data size
    header_ptr.data_size = data_offset;

    return header_ptr;
}

/// Get the full parse buffer pointer (for reading data section)
export fn csv_get_full_parse_buffer() ?[*]const u8 {
    if (full_parse_buffer) |buf| {
        return buf.ptr;
    }
    return null;
}

/// Free the full parse buffer
export fn csv_free_full_parse() void {
    if (full_parse_buffer) |buf| {
        global_allocator.free(buf);
        full_parse_buffer = null;
    }
}

// ============================================================================
// JSON Parse API - Returns JSON string for single JSON.parse() call in JS
// ============================================================================

/// Buffer for JSON output
var json_parse_buffer: ?[]u8 = null;

/// Parse entire CSV and return as JSON string: [["f1","f2"],["f3","f4"],...]
/// This allows JS to use a single JSON.parse() call which is highly optimized
/// Returns pointer to null-terminated JSON string, or null on error
export fn csv_parse_all_json(handle: ParserHandle) ?[*]const u8 {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    if (parser.is_closed) return null;

    // Free previous buffer
    if (json_parse_buffer) |buf| {
        global_allocator.free(buf);
        json_parse_buffer = null;
    }

    // Use ArrayList for dynamic JSON building (Zig 0.15 API)
    var json: std.ArrayList(u8) = .empty;
    defer json.deinit(global_allocator);

    // Start array
    json.append(global_allocator, '[') catch return null;

    var first_row = true;
    while (parser.nextRow()) {
        if (!first_row) {
            json.append(global_allocator, ',') catch return null;
        }
        first_row = false;

        // Start row array
        json.append(global_allocator, '[') catch return null;

        var first_field = true;
        for (parser.field_offsets.items) |field| {
            if (!first_field) {
                json.append(global_allocator, ',') catch return null;
            }
            first_field = false;

            const field_data = parser.data[field.start .. field.start + field.len];

            if (field_data.len == 0) {
                // Empty field -> null
                json.appendSlice(global_allocator, "null") catch return null;
            } else if (field.needs_unescape and field_data.len >= 2 and field_data[0] == parser.config.quote_char) {
                // Quoted field - unescape and write as JSON string
                json.append(global_allocator, '"') catch return null;

                const inner = field_data[1 .. field_data.len - 1];
                var j: usize = 0;
                while (j < inner.len) {
                    const c = inner[j];
                    if (c == parser.config.quote_char and j + 1 < inner.len and inner[j + 1] == parser.config.quote_char) {
                        // Escaped quote "" -> "
                        json.append(global_allocator, '"') catch return null;
                        j += 2;
                    } else if (c == '"') {
                        // Escape quote for JSON
                        json.appendSlice(global_allocator, "\\\"") catch return null;
                        j += 1;
                    } else if (c == '\\') {
                        json.appendSlice(global_allocator, "\\\\") catch return null;
                        j += 1;
                    } else if (c == '\n') {
                        json.appendSlice(global_allocator, "\\n") catch return null;
                        j += 1;
                    } else if (c == '\r') {
                        json.appendSlice(global_allocator, "\\r") catch return null;
                        j += 1;
                    } else if (c == '\t') {
                        json.appendSlice(global_allocator, "\\t") catch return null;
                        j += 1;
                    } else if (c < 0x20) {
                        // Control character - use unicode escape
                        json.appendSlice(global_allocator, "\\u00") catch return null;
                        const hex = "0123456789abcdef";
                        json.append(global_allocator, hex[c >> 4]) catch return null;
                        json.append(global_allocator, hex[c & 0xf]) catch return null;
                        j += 1;
                    } else {
                        json.append(global_allocator, c) catch return null;
                        j += 1;
                    }
                }

                json.append(global_allocator, '"') catch return null;
            } else {
                // Unquoted field - write as JSON string with escaping
                json.append(global_allocator, '"') catch return null;

                for (field_data) |c| {
                    if (c == '"') {
                        json.appendSlice(global_allocator, "\\\"") catch return null;
                    } else if (c == '\\') {
                        json.appendSlice(global_allocator, "\\\\") catch return null;
                    } else if (c == '\n') {
                        json.appendSlice(global_allocator, "\\n") catch return null;
                    } else if (c == '\r') {
                        json.appendSlice(global_allocator, "\\r") catch return null;
                    } else if (c == '\t') {
                        json.appendSlice(global_allocator, "\\t") catch return null;
                    } else if (c < 0x20) {
                        json.appendSlice(global_allocator, "\\u00") catch return null;
                        const hex = "0123456789abcdef";
                        json.append(global_allocator, hex[c >> 4]) catch return null;
                        json.append(global_allocator, hex[c & 0xf]) catch return null;
                    } else {
                        json.append(global_allocator, c) catch return null;
                    }
                }

                json.append(global_allocator, '"') catch return null;
            }
        }

        // End row array
        json.append(global_allocator, ']') catch return null;
    }

    // End array and null terminate
    json.append(global_allocator, ']') catch return null;
    json.append(global_allocator, 0) catch return null;

    // Transfer ownership to static buffer
    json_parse_buffer = json.toOwnedSlice(global_allocator) catch return null;

    return json_parse_buffer.?.ptr;
}

/// Get length of JSON parse result (excluding null terminator)
export fn csv_get_json_len() usize {
    if (json_parse_buffer) |buf| {
        return buf.len - 1; // Exclude null terminator
    }
    return 0;
}

/// Free the JSON parse buffer
export fn csv_free_json_parse() void {
    if (json_parse_buffer) |buf| {
        global_allocator.free(buf);
        json_parse_buffer = null;
    }
}

// ============================================================================
// Fast Parse API - Returns delimited string for minimal JS processing
// Format: field\x00field\x00\x01field\x00field\x00\x01...
// \x00 = field separator, \x01 = row separator
// ============================================================================

var fast_parse_buffer: ?[]u8 = null;
var fast_parse_row_count: u32 = 0;

/// Parse entire CSV and return as delimited string
/// Much faster than JSON - no escaping needed, just concatenation
/// Returns pointer to buffer, use csv_get_fast_parse_len() for length
export fn csv_parse_all_fast(handle: ParserHandle) ?[*]const u8 {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    if (parser.is_closed) return null;

    // Free previous buffer
    if (fast_parse_buffer) |buf| {
        global_allocator.free(buf);
        fast_parse_buffer = null;
    }

    // Build output buffer
    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(global_allocator);

    var row_count: u32 = 0;
    var first_row = true;

    while (parser.nextRow()) {
        if (!first_row) {
            // Row separator
            output.append(global_allocator, 0x01) catch return null;
        }
        first_row = false;
        row_count += 1;

        var first_field = true;
        for (parser.field_offsets.items) |field| {
            if (!first_field) {
                // Field separator
                output.append(global_allocator, 0x00) catch return null;
            }
            first_field = false;

            const field_data = parser.data[field.start .. field.start + field.len];

            if (field.needs_unescape and field_data.len >= 2 and field_data[0] == parser.config.quote_char) {
                // Unescape: remove outer quotes, "" -> "
                const inner = field_data[1 .. field_data.len - 1];
                var j: usize = 0;
                while (j < inner.len) {
                    const c = inner[j];
                    if (c == parser.config.quote_char and j + 1 < inner.len and inner[j + 1] == parser.config.quote_char) {
                        output.append(global_allocator, parser.config.quote_char) catch return null;
                        j += 2;
                    } else {
                        output.append(global_allocator, c) catch return null;
                        j += 1;
                    }
                }
            } else {
                // Copy directly
                output.appendSlice(global_allocator, field_data) catch return null;
            }
        }
    }

    fast_parse_row_count = row_count;
    fast_parse_buffer = output.toOwnedSlice(global_allocator) catch return null;

    return fast_parse_buffer.?.ptr;
}

/// Get length of fast parse buffer
export fn csv_get_fast_parse_len() usize {
    if (fast_parse_buffer) |buf| {
        return buf.len;
    }
    return 0;
}

/// Get row count from fast parse
export fn csv_get_fast_parse_rows() u32 {
    return fast_parse_row_count;
}

/// Free the fast parse buffer
export fn csv_free_fast_parse() void {
    if (fast_parse_buffer) |buf| {
        global_allocator.free(buf);
        fast_parse_buffer = null;
    }
    fast_parse_row_count = 0;
}

// ============================================================================
// Position-based Parse API - Returns field positions for direct slicing
// JS can slice the original file content using these positions
// ============================================================================

/// Field position info
const FieldPos = extern struct {
    start: u32,
    len: u16,
    needs_unescape: u8,
    _pad: u8 = 0,
};

var pos_parse_field_positions: ?[]FieldPos = null;
var pos_parse_row_field_counts: ?[]u16 = null;
var pos_parse_row_count: u32 = 0;
var pos_parse_field_count: u32 = 0;

/// Parse and return field positions (no string copying)
/// Returns true on success
export fn csv_parse_positions(handle: ParserHandle) bool {
    const parser: *Parser = @ptrCast(@alignCast(handle));

    if (parser.is_closed) return false;

    // Free previous
    if (pos_parse_field_positions) |p| global_allocator.free(p);
    if (pos_parse_row_field_counts) |p| global_allocator.free(p);
    pos_parse_field_positions = null;
    pos_parse_row_field_counts = null;

    // First pass: count
    var total_rows: u32 = 0;
    var total_fields: u32 = 0;
    const start_cursor = parser.cursor;

    while (parser.nextRow()) {
        total_rows += 1;
        total_fields += @intCast(parser.field_offsets.items.len);
    }

    if (total_rows == 0) return false;

    // Allocate
    pos_parse_field_positions = global_allocator.alloc(FieldPos, total_fields) catch return false;
    pos_parse_row_field_counts = global_allocator.alloc(u16, total_rows) catch {
        global_allocator.free(pos_parse_field_positions.?);
        pos_parse_field_positions = null;
        return false;
    };

    // Reset and second pass
    parser.cursor = start_cursor;
    parser.current_row = 0;
    parser.stats.rows_emitted = 0;

    var row_idx: u32 = 0;
    var field_idx: u32 = 0;

    while (parser.nextRow()) {
        pos_parse_row_field_counts.?[row_idx] = @intCast(@min(parser.field_offsets.items.len, 65535));

        for (parser.field_offsets.items) |field| {
            pos_parse_field_positions.?[field_idx] = FieldPos{
                .start = @intCast(field.start),
                .len = @intCast(@min(field.len, 65535)),
                .needs_unescape = if (field.needs_unescape) 1 else 0,
            };
            field_idx += 1;
        }
        row_idx += 1;
    }

    pos_parse_row_count = total_rows;
    pos_parse_field_count = total_fields;

    return true;
}

export fn csv_get_positions_ptr() ?[*]const FieldPos {
    if (pos_parse_field_positions) |p| return p.ptr;
    return null;
}

export fn csv_get_row_counts_ptr() ?[*]const u16 {
    if (pos_parse_row_field_counts) |p| return p.ptr;
    return null;
}

export fn csv_get_positions_row_count() u32 {
    return pos_parse_row_count;
}

export fn csv_get_positions_field_count() u32 {
    return pos_parse_field_count;
}

export fn csv_free_positions() void {
    if (pos_parse_field_positions) |p| global_allocator.free(p);
    if (pos_parse_row_field_counts) |p| global_allocator.free(p);
    pos_parse_field_positions = null;
    pos_parse_row_field_counts = null;
    pos_parse_row_count = 0;
    pos_parse_field_count = 0;
}

/// Get current cache size in bytes
export fn csv_get_cache_size(handle: ParserHandle) usize {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return parser.cache_size;
}

/// Get cache limit status (0=ok, 1=soft exceeded, 2=hard exceeded)
export fn csv_get_cache_status(handle: ParserHandle) u8 {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    return @intFromEnum(parser.getCacheStatus());
}

/// Clear the string cache
export fn csv_clear_cache(handle: ParserHandle) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.clearCache();
}

/// Set soft cache limit
export fn csv_set_soft_cache_limit(handle: ParserHandle, limit: usize) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.config.soft_cache_limit = limit;
}

/// Set hard cache limit
export fn csv_set_hard_cache_limit(handle: ParserHandle, limit: usize) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.config.hard_cache_limit = limit;
}

/// Set cache warning callback
export fn csv_set_cache_callback(handle: ParserHandle, callback: CacheWarningCallback) void {
    const parser: *Parser = @ptrCast(@alignCast(handle));
    parser.setCacheWarningCallback(callback);
}

/// Get optimal thread count for parallel processing
export fn csv_get_optimal_thread_count(data_len: usize) usize {
    const cpu_count = std.Thread.getCpuCount() catch 4;

    if (data_len < 100 * 1024 * 1024) return 1;
    if (data_len < 500 * 1024 * 1024) return 2;
    if (data_len < 2 * 1024 * 1024 * 1024) return cpu_count / 2;
    return cpu_count -| 1;
}

/// Detect encoding from data (returns encoding enum value)
export fn csv_detect_encoding(data_ptr: [*c]const u8, data_len: usize) u8 {
    const data = data_ptr[0..data_len];
    const encoding = iconv.detectEncoding(data);
    return @intFromEnum(encoding);
}

/// Check if data has BOM and return its length (0 if no BOM)
export fn csv_detect_bom(data_ptr: [*c]const u8, data_len: usize) usize {
    const data = data_ptr[0..data_len];
    if (iconv.BOM.detect(data)) |detected| {
        return detected.bom_len;
    }
    return 0;
}

// ============================================================================
// Re-export Parallel Processing Functions
// ============================================================================

/// Initialize parallel processor
export fn csv_parallel_init(data_ptr: [*c]const u8, data_len: usize, thread_count: usize) ?*anyopaque {
    const data = data_ptr[0..data_len];
    const config = parallel.ParallelConfig{
        .thread_count = thread_count,
    };

    const processor = parallel.ChunkProcessor.init(global_allocator, data, config) catch return null;
    return @ptrCast(processor);
}

/// Process all chunks
export fn csv_parallel_process(handle: *anyopaque) bool {
    const processor: *parallel.ChunkProcessor = @ptrCast(@alignCast(handle));
    processor.process() catch return false;
    return true;
}

/// Get total rows parsed
export fn csv_parallel_get_row_count(handle: *anyopaque) usize {
    const processor: *parallel.ChunkProcessor = @ptrCast(@alignCast(handle));
    return processor.total_rows_parsed;
}

/// Get total bytes processed
export fn csv_parallel_get_bytes_processed(handle: *anyopaque) usize {
    const processor: *parallel.ChunkProcessor = @ptrCast(@alignCast(handle));
    return processor.total_bytes_processed;
}

/// Get number of chunks used
export fn csv_parallel_get_chunk_count(handle: *anyopaque) usize {
    const processor: *parallel.ChunkProcessor = @ptrCast(@alignCast(handle));
    return processor.chunks.len;
}

/// Close parallel processor
export fn csv_parallel_close(handle: *anyopaque) void {
    const processor: *parallel.ChunkProcessor = @ptrCast(@alignCast(handle));
    processor.deinit();
}

// ============================================================================
// Tests
// ============================================================================

test "basic csv parsing" {
    const test_allocator = std.testing.allocator;
    const csv_data = "name,age,city\nAlice,30,NYC\nBob,25,LA\n";

    const parser = try Parser.initFromBuffer(test_allocator, csv_data, .{});
    defer parser.deinit();

    // First row (header)
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqual(@as(usize, 3), parser.getFieldCount());

    // Second row
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqual(@as(usize, 3), parser.getFieldCount());
    try std.testing.expectEqualStrings("Alice", parser.getFieldSlice(0).?);
    try std.testing.expectEqualStrings("30", parser.getFieldSlice(1).?);
    try std.testing.expectEqualStrings("NYC", parser.getFieldSlice(2).?);

    // Third row
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqualStrings("Bob", parser.getFieldSlice(0).?);

    // No more rows
    try std.testing.expect(!parser.nextRow());
}

test "quoted fields" {
    const test_allocator = std.testing.allocator;
    const csv_data = "name,address\n\"Alice\",\"123 Main St, Apt 4\"\n";

    const parser = try Parser.initFromBuffer(test_allocator, csv_data, .{});
    defer parser.deinit();

    // Skip header
    try std.testing.expect(parser.nextRow());

    // Data row with quoted field containing comma
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqual(@as(usize, 2), parser.getFieldCount());
}

test "crlf line endings" {
    const test_allocator = std.testing.allocator;
    const csv_data = "a,b\r\n1,2\r\n3,4\r\n";

    const parser = try Parser.initFromBuffer(test_allocator, csv_data, .{});
    defer parser.deinit();

    try std.testing.expect(parser.nextRow());
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqualStrings("1", parser.getFieldSlice(0).?);
    try std.testing.expectEqualStrings("2", parser.getFieldSlice(1).?);
}

test "escaped quotes" {
    const test_allocator = std.testing.allocator;
    // CSV with escaped quotes: He said ""Hello""
    const csv_data = "name,quote\nBob,\"He said \"\"Hello\"\"\"\n";

    const parser = try Parser.initFromBuffer(test_allocator, csv_data, .{});
    defer parser.deinit();

    // Skip header
    try std.testing.expect(parser.nextRow());

    // Data row
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqual(@as(usize, 2), parser.getFieldCount());

    // Raw field includes quotes
    const raw = parser.getFieldSlice(1).?;
    try std.testing.expectEqualStrings("\"He said \"\"Hello\"\"\"", raw);
}

test "quoted field with newline" {
    const test_allocator = std.testing.allocator;
    const csv_data = "name,address\nAlice,\"123 Main St\nApt 4\"\nBob,Normal\n";

    const parser = try Parser.initFromBuffer(test_allocator, csv_data, .{});
    defer parser.deinit();

    // Header
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqual(@as(usize, 2), parser.getFieldCount());

    // Alice row (address contains newline)
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqual(@as(usize, 2), parser.getFieldCount());
    try std.testing.expectEqualStrings("Alice", parser.getFieldSlice(0).?);

    // Bob row
    try std.testing.expect(parser.nextRow());
    try std.testing.expectEqualStrings("Bob", parser.getFieldSlice(0).?);
}
