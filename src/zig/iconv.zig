const std = @import("std");
const builtin = @import("builtin");

// Only import iconv on platforms that support it (POSIX systems)
const has_iconv = switch (builtin.os.tag) {
    .macos, .linux, .freebsd, .netbsd, .openbsd => true,
    else => false,
};

const c = if (has_iconv) @cImport({
    @cInclude("iconv.h");
}) else struct {
    pub const iconv_t = *anyopaque;
};

/// Supported encodings
pub const Encoding = enum {
    utf8,
    utf16le,
    utf16be,
    utf32le,
    utf32be,
    latin1,
    windows1252,
    shift_jis,

    pub fn toIconvName(self: Encoding) [:0]const u8 {
        return switch (self) {
            .utf8 => "UTF-8",
            .utf16le => "UTF-16LE",
            .utf16be => "UTF-16BE",
            .utf32le => "UTF-32LE",
            .utf32be => "UTF-32BE",
            .latin1 => "ISO-8859-1",
            .windows1252 => "WINDOWS-1252",
            .shift_jis => "SHIFT_JIS",
        };
    }
};

/// BOM (Byte Order Mark) detection
pub const BOM = struct {
    pub const UTF8 = "\xEF\xBB\xBF";
    pub const UTF16_LE = "\xFF\xFE";
    pub const UTF16_BE = "\xFE\xFF";
    pub const UTF32_LE = "\xFF\xFE\x00\x00";
    pub const UTF32_BE = "\x00\x00\xFE\xFF";

    /// Detect encoding from BOM
    pub fn detect(data: []const u8) ?struct { encoding: Encoding, bom_len: usize } {
        if (data.len >= 4) {
            if (std.mem.startsWith(u8, data, UTF32_LE)) {
                return .{ .encoding = .utf32le, .bom_len = 4 };
            }
            if (std.mem.startsWith(u8, data, UTF32_BE)) {
                return .{ .encoding = .utf32be, .bom_len = 4 };
            }
        }
        if (data.len >= 3) {
            if (std.mem.startsWith(u8, data, UTF8)) {
                return .{ .encoding = .utf8, .bom_len = 3 };
            }
        }
        if (data.len >= 2) {
            if (std.mem.startsWith(u8, data, UTF16_LE)) {
                return .{ .encoding = .utf16le, .bom_len = 2 };
            }
            if (std.mem.startsWith(u8, data, UTF16_BE)) {
                return .{ .encoding = .utf16be, .bom_len = 2 };
            }
        }
        return null;
    }
};

/// Transcoder using system iconv
pub const Transcoder = struct {
    allocator: std.mem.Allocator,
    handle: c.iconv_t,
    from_encoding: Encoding,
    to_encoding: Encoding,

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator, from: Encoding, to: Encoding) !*Self {
        if (!has_iconv) {
            return error.IconvNotAvailable;
        }

        const handle = c.iconv_open(to.toIconvName(), from.toIconvName());
        if (handle == @as(c.iconv_t, @ptrFromInt(@as(usize, @bitCast(@as(isize, -1)))))) {
            return error.IconvOpenFailed;
        }

        const transcoder = try allocator.create(Self);
        transcoder.* = Self{
            .allocator = allocator,
            .handle = handle,
            .from_encoding = from,
            .to_encoding = to,
        };

        return transcoder;
    }

    /// Transcode data from source to target encoding
    pub fn transcode(self: *Self, input: []const u8) ![]u8 {
        if (!has_iconv) {
            return error.IconvNotAvailable;
        }

        // Estimate output size (UTF-8 can be up to 4x the input for some encodings)
        const max_output = input.len * 4;
        var output = try self.allocator.alloc(u8, max_output);
        errdefer self.allocator.free(output);

        var in_ptr: [*c]u8 = @constCast(input.ptr);
        var in_left: usize = input.len;
        var out_ptr: [*c]u8 = output.ptr;
        var out_left: usize = max_output;

        const result = c.iconv(self.handle, &in_ptr, &in_left, &out_ptr, &out_left);

        if (result == @as(usize, @bitCast(@as(isize, -1)))) {
            return error.TranscodeFailed;
        }

        const actual_len = max_output - out_left;

        // Just return the slice - don't try to shrink (avoid allocation complexity)
        return output[0..actual_len];
    }

    /// Reset transcoder state for new input
    pub fn reset(self: *Self) void {
        if (has_iconv) {
            _ = c.iconv(self.handle, null, null, null, null);
        }
    }

    pub fn deinit(self: *Self) void {
        if (has_iconv) {
            _ = c.iconv_close(self.handle);
        }
        self.allocator.destroy(self);
    }
};

/// Auto-detect encoding from content heuristics
pub fn detectEncoding(data: []const u8) Encoding {
    // First check for BOM
    if (BOM.detect(data)) |detected| {
        return detected.encoding;
    }

    // Heuristic: check for null bytes (indicates UTF-16/32)
    var null_count: usize = 0;
    var high_byte_count: usize = 0;

    const check_len = @min(data.len, 1024);
    for (data[0..check_len]) |byte| {
        if (byte == 0) null_count += 1;
        if (byte > 127) high_byte_count += 1;
    }

    // If ~50% nulls, likely UTF-16
    if (check_len > 0 and null_count * 3 > check_len) {
        // Check byte order
        if (data.len >= 2) {
            if (data[0] != 0 and data[1] == 0) return .utf16le;
            if (data[0] == 0 and data[1] != 0) return .utf16be;
        }
        return .utf16le; // Default to LE
    }

    // If many high bytes but valid UTF-8 sequences, it's UTF-8
    if (high_byte_count > 0) {
        if (isValidUtf8(data[0..check_len])) {
            return .utf8;
        }
        // Likely Latin-1 or Windows-1252
        return .windows1252;
    }

    // Default to UTF-8 for ASCII-compatible
    return .utf8;
}

/// Validate UTF-8 encoding
pub fn isValidUtf8(data: []const u8) bool {
    var i: usize = 0;
    while (i < data.len) {
        const byte = data[i];

        if (byte < 0x80) {
            // ASCII
            i += 1;
        } else if (byte & 0xE0 == 0xC0) {
            // 2-byte sequence
            if (i + 1 >= data.len) return false;
            if (data[i + 1] & 0xC0 != 0x80) return false;
            i += 2;
        } else if (byte & 0xF0 == 0xE0) {
            // 3-byte sequence
            if (i + 2 >= data.len) return false;
            if (data[i + 1] & 0xC0 != 0x80) return false;
            if (data[i + 2] & 0xC0 != 0x80) return false;
            i += 3;
        } else if (byte & 0xF8 == 0xF0) {
            // 4-byte sequence
            if (i + 3 >= data.len) return false;
            if (data[i + 1] & 0xC0 != 0x80) return false;
            if (data[i + 2] & 0xC0 != 0x80) return false;
            if (data[i + 3] & 0xC0 != 0x80) return false;
            i += 4;
        } else {
            return false;
        }
    }
    return true;
}

// ============================================================================
// Tests
// ============================================================================

test "bom detection utf8" {
    const data = "\xEF\xBB\xBFhello";
    const result = BOM.detect(data).?;
    try std.testing.expectEqual(Encoding.utf8, result.encoding);
    try std.testing.expectEqual(@as(usize, 3), result.bom_len);
}

test "bom detection utf16le" {
    const data = "\xFF\xFEh\x00e\x00l\x00l\x00o\x00";
    const result = BOM.detect(data).?;
    try std.testing.expectEqual(Encoding.utf16le, result.encoding);
    try std.testing.expectEqual(@as(usize, 2), result.bom_len);
}

test "valid utf8" {
    try std.testing.expect(isValidUtf8("hello world"));
    try std.testing.expect(isValidUtf8("héllo wörld")); // With accents
    try std.testing.expect(isValidUtf8("日本語")); // Japanese
    try std.testing.expect(!isValidUtf8("\xFF\xFE")); // Invalid sequence
}

test "detect ascii as utf8" {
    const ascii = "name,age,city\nAlice,30,NYC\n";
    try std.testing.expectEqual(Encoding.utf8, detectEncoding(ascii));
}
