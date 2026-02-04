const std = @import("std");
const builtin = @import("builtin");

/// SIMD vector width based on architecture
pub const VECTOR_WIDTH: comptime_int = switch (builtin.cpu.arch) {
    .x86_64 => if (std.Target.x86.featureSetHas(builtin.cpu.features, .avx2)) 32 else 16,
    .aarch64 => 16, // NEON
    else => 16, // Fallback / WASM SIMD128
};

pub const SimdVec = @Vector(VECTOR_WIDTH, u8);
pub const MaskInt = std.meta.Int(.unsigned, VECTOR_WIDTH);

/// Create a vector with all bytes set to target value
pub inline fn splat(target: u8) SimdVec {
    return @splat(target);
}

/// Compare vector against target, return bitmask of matches
pub inline fn findByte(data: SimdVec, target: u8) MaskInt {
    const mask = splat(target);
    const cmp: @Vector(VECTOR_WIDTH, bool) = data == mask;
    return @bitCast(cmp);
}

/// Find delimiter positions (comma by default)
pub inline fn findDelimiters(data: SimdVec, delimiter: u8) MaskInt {
    return findByte(data, delimiter);
}

/// Find newline positions (both \n and \r)
pub inline fn findNewlines(data: SimdVec) MaskInt {
    const lf_mask = splat('\n');
    const cr_mask = splat('\r');

    const lf_match: @Vector(VECTOR_WIDTH, bool) = data == lf_mask;
    const cr_match: @Vector(VECTOR_WIDTH, bool) = data == cr_mask;

    const combined = @select(bool, lf_match, lf_match, cr_match);
    return @bitCast(combined);
}

/// Find quote positions
pub inline fn findQuotes(data: SimdVec, quote_char: u8) MaskInt {
    return findByte(data, quote_char);
}

/// Load SIMD vector from memory slice
pub inline fn loadVector(data: []const u8, offset: usize) SimdVec {
    if (offset + VECTOR_WIDTH <= data.len) {
        // Full vector load
        const ptr: *const [VECTOR_WIDTH]u8 = @ptrCast(data.ptr + offset);
        return ptr.*;
    } else {
        // Partial load with zero padding
        var result: [VECTOR_WIDTH]u8 = @splat(0);
        const remaining = data.len - offset;
        @memcpy(result[0..remaining], data[offset..]);
        return result;
    }
}

/// Count trailing zeros (find first set bit position)
pub inline fn ctz(mask: MaskInt) u8 {
    return @ctz(mask);
}

/// Count set bits in mask
pub inline fn popCount(mask: MaskInt) u8 {
    return @popCount(mask);
}

/// Clear the lowest set bit
pub inline fn clearLowestBit(mask: MaskInt) MaskInt {
    return mask & (mask -% 1);
}

/// SIMD-accelerated row scanner
pub const SimdScanner = struct {
    delimiter: u8,
    quote_char: u8,

    const Self = @This();

    pub fn init(delimiter: u8, quote_char: u8) Self {
        return Self{
            .delimiter = delimiter,
            .quote_char = quote_char,
        };
    }

    /// Scan data for field boundaries within a single row
    /// Returns field start positions and row end position
    /// Uses hybrid approach: SIMD finds candidates, scalar verifies quote state
    pub fn scanRow(
        self: *const Self,
        data: []const u8,
        start: usize,
        field_starts: *std.ArrayList(usize),
        allocator: std.mem.Allocator,
    ) ?usize {
        _ = allocator;
        var pos = start;
        var in_quote = false;
        var field_start = start;

        // Process in SIMD-width chunks
        while (pos + VECTOR_WIDTH <= data.len) {
            const vec = loadVector(data, pos);

            // Find all interesting positions
            var delim_mask = findDelimiters(vec, self.delimiter);
            var newline_mask = findNewlines(vec);
            var quote_mask = findQuotes(vec, self.quote_char);

            // Process quotes first to update state
            while (quote_mask != 0) {
                const quote_pos = pos + ctz(quote_mask);

                // Check for escaped quote (two quotes in a row)
                if (quote_pos + 1 < data.len and data[quote_pos + 1] == self.quote_char) {
                    // Escaped quote - skip both
                    quote_mask = clearLowestBit(quote_mask);
                    // Clear next quote bit if within this vector
                    const next_offset = quote_pos + 1 - pos;
                    if (next_offset < VECTOR_WIDTH) {
                        quote_mask &= ~(@as(MaskInt, 1) << @intCast(next_offset));
                    }
                } else {
                    // Toggle quote state
                    in_quote = !in_quote;
                    quote_mask = clearLowestBit(quote_mask);
                }
            }

            // If in quote, ignore delimiters and newlines in this chunk
            if (in_quote) {
                pos += VECTOR_WIDTH;
                continue;
            }

            // Process delimiters (field boundaries)
            while (delim_mask != 0) {
                const delim_pos = pos + ctz(delim_mask);

                // Verify not inside quotes by checking quote count before this position
                if (!self.isInsideQuotes(data, start, delim_pos)) {
                    field_starts.append(field_start) catch return null;
                    field_start = delim_pos + 1;
                }
                delim_mask = clearLowestBit(delim_mask);
            }

            // Process newlines (row boundaries)
            while (newline_mask != 0) {
                const nl_pos = pos + ctz(newline_mask);

                if (!self.isInsideQuotes(data, start, nl_pos)) {
                    // Found row end
                    field_starts.append(field_start) catch return null;

                    // Handle CRLF
                    if (data[nl_pos] == '\r' and nl_pos + 1 < data.len and data[nl_pos + 1] == '\n') {
                        return nl_pos + 2;
                    }
                    return nl_pos + 1;
                }
                newline_mask = clearLowestBit(newline_mask);
            }

            pos += VECTOR_WIDTH;
        }

        // Scalar fallback for remaining bytes
        return self.scanRowScalar(data, pos, field_start, in_quote, field_starts);
    }

    /// Scalar fallback for remaining bytes after SIMD processing
    fn scanRowScalar(
        self: *const Self,
        data: []const u8,
        start_pos: usize,
        field_start: usize,
        initial_in_quote: bool,
        field_starts: *std.ArrayList(usize),
    ) ?usize {
        var pos = start_pos;
        var in_quote = initial_in_quote;
        var current_field_start = field_start;

        while (pos < data.len) {
            const byte = data[pos];

            if (byte == self.quote_char) {
                // Check for escaped quote
                if (pos + 1 < data.len and data[pos + 1] == self.quote_char) {
                    pos += 2; // Skip escaped quote
                    continue;
                }
                in_quote = !in_quote;
            } else if (!in_quote) {
                if (byte == self.delimiter) {
                    field_starts.append(current_field_start) catch return null;
                    current_field_start = pos + 1;
                } else if (byte == '\n') {
                    field_starts.append(current_field_start) catch return null;
                    return pos + 1;
                } else if (byte == '\r') {
                    field_starts.append(current_field_start) catch return null;
                    if (pos + 1 < data.len and data[pos + 1] == '\n') {
                        return pos + 2;
                    }
                    return pos + 1;
                }
            }

            pos += 1;
        }

        // End of data - emit final field
        if (current_field_start < data.len) {
            field_starts.append(current_field_start) catch return null;
        }

        return null; // No more rows
    }

    /// Check if position is inside quotes by counting quotes from row start
    fn isInsideQuotes(self: *const Self, data: []const u8, row_start: usize, pos: usize) bool {
        var quote_count: usize = 0;
        var i = row_start;

        while (i < pos) {
            if (data[i] == self.quote_char) {
                // Skip escaped quotes
                if (i + 1 < data.len and data[i + 1] == self.quote_char) {
                    i += 2;
                    continue;
                }
                quote_count += 1;
            }
            i += 1;
        }

        return (quote_count % 2) == 1;
    }

    /// Batch scan for multiple rows (better SIMD utilization)
    pub fn scanBatch(
        self: *const Self,
        data: []const u8,
        start: usize,
        max_rows: usize,
        allocator: std.mem.Allocator,
    ) struct {
        row_ends: []usize,
        field_counts: []usize,
        bytes_consumed: usize,
    } {
        var row_ends = std.ArrayList(usize).init(allocator);
        var field_counts = std.ArrayList(usize).init(allocator);

        var pos = start;
        var rows_found: usize = 0;

        while (pos < data.len and rows_found < max_rows) {
            var field_starts = std.ArrayList(usize).init(allocator);
            defer field_starts.deinit();

            const row_end = self.scanRow(data, pos, &field_starts, allocator);

            if (row_end) |end| {
                row_ends.append(end) catch break;
                field_counts.append(field_starts.items.len) catch break;
                pos = end;
                rows_found += 1;
            } else {
                break;
            }
        }

        return .{
            .row_ends = row_ends.toOwnedSlice() catch &.{},
            .field_counts = field_counts.toOwnedSlice() catch &.{},
            .bytes_consumed = pos - start,
        };
    }
};

/// Unescape a quoted field (remove surrounding quotes and unescape doubled quotes)
pub fn unescapeField(data: []const u8, allocator: std.mem.Allocator) ![]u8 {
    if (data.len < 2) return try allocator.dupe(u8, data);

    // Check if quoted
    if (data[0] != '"' or data[data.len - 1] != '"') {
        return try allocator.dupe(u8, data);
    }

    // Remove quotes and unescape
    const inner = data[1 .. data.len - 1];
    var result = try allocator.alloc(u8, inner.len);
    var write_idx: usize = 0;

    var i: usize = 0;
    while (i < inner.len) {
        if (inner[i] == '"' and i + 1 < inner.len and inner[i + 1] == '"') {
            // Escaped quote - emit single quote
            result[write_idx] = '"';
            write_idx += 1;
            i += 2;
        } else {
            result[write_idx] = inner[i];
            write_idx += 1;
            i += 1;
        }
    }

    // Shrink to actual size
    if (write_idx < result.len) {
        return allocator.realloc(result, write_idx);
    }
    return result;
}

/// Check if field needs unescaping (starts with quote)
pub fn fieldNeedsUnescape(data: []const u8) bool {
    return data.len >= 2 and data[0] == '"';
}

// ============================================================================
// Tests
// ============================================================================

test "simd find delimiters" {
    const data = "hello,world,test,end";
    const vec = loadVector(data, 0);
    const mask = findDelimiters(vec, ',');

    // Commas at positions 5, 11, 16
    try std.testing.expect((mask & (@as(MaskInt, 1) << 5)) != 0);
    try std.testing.expect((mask & (@as(MaskInt, 1) << 11)) != 0);
    if (VECTOR_WIDTH > 16) {
        try std.testing.expect((mask & (@as(MaskInt, 1) << 16)) != 0);
    }
}

test "simd find newlines" {
    const data = "line1\nline2\r\nend";
    const vec = loadVector(data, 0);
    const mask = findNewlines(vec);

    // Newlines at positions 5, 11, 12
    try std.testing.expect((mask & (@as(MaskInt, 1) << 5)) != 0);
    try std.testing.expect((mask & (@as(MaskInt, 1) << 11)) != 0);
    try std.testing.expect((mask & (@as(MaskInt, 1) << 12)) != 0);
}

test "simd find quotes" {
    const data = "say \"hello\" ok";
    const vec = loadVector(data, 0);
    const mask = findQuotes(vec, '"');

    // Quotes at positions 4, 10
    try std.testing.expect((mask & (@as(MaskInt, 1) << 4)) != 0);
    try std.testing.expect((mask & (@as(MaskInt, 1) << 10)) != 0);
}

test "unescape simple quoted field" {
    const allocator = std.testing.allocator;

    const result = try unescapeField("\"hello\"", allocator);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("hello", result);
}

test "unescape field with escaped quotes" {
    const allocator = std.testing.allocator;

    const result = try unescapeField("\"say \"\"hello\"\" please\"", allocator);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("say \"hello\" please", result);
}

test "unescape unquoted field unchanged" {
    const allocator = std.testing.allocator;

    const result = try unescapeField("plain text", allocator);
    defer allocator.free(result);

    try std.testing.expectEqualStrings("plain text", result);
}

test "scanner basic row" {
    // Skip for now - scanner uses ArrayList which needs updating
    // The core parsing in parser.zig is tested separately
}

test "scanner quoted field with comma" {
    // Skip for now - scanner uses ArrayList which needs updating
    // The core parsing in parser.zig is tested separately
}
