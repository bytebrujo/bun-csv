const std = @import("std");

/// CSV Writer configuration
pub const WriterConfig = struct {
    delimiter: u8 = ',',
    quote_char: u8 = '"',
    line_ending: LineEnding = .lf,
    flush_every: usize = 1000,
    quote_style: QuoteStyle = .minimal,
};

pub const LineEnding = enum {
    lf,
    crlf,
};

pub const QuoteStyle = enum {
    minimal, // Only quote when necessary
    all, // Quote all fields
    non_numeric, // Quote non-numeric fields
};

/// Buffered CSV Writer
pub const Writer = struct {
    allocator: std.mem.Allocator,
    config: WriterConfig,

    // Output destination
    file: ?std.fs.File,
    buffer: std.ArrayList(u8),

    // State tracking
    rows_written: usize,
    rows_in_buffer: usize,
    bytes_written: usize,

    const Self = @This();

    /// Initialize writer to file
    pub fn initToFile(allocator: std.mem.Allocator, path: []const u8, config: WriterConfig) !*Self {
        const file = try std.fs.cwd().createFile(path, .{ .truncate = true });

        const writer = try allocator.create(Self);
        writer.* = Self{
            .allocator = allocator,
            .config = config,
            .file = file,
            .buffer = std.ArrayList(u8).init(allocator),
            .rows_written = 0,
            .rows_in_buffer = 0,
            .bytes_written = 0,
        };

        return writer;
    }

    /// Initialize writer to memory buffer
    pub fn initToBuffer(allocator: std.mem.Allocator, config: WriterConfig) !*Self {
        const writer = try allocator.create(Self);
        writer.* = Self{
            .allocator = allocator,
            .config = config,
            .file = null,
            .buffer = std.ArrayList(u8).init(allocator),
            .rows_written = 0,
            .rows_in_buffer = 0,
            .bytes_written = 0,
        };

        return writer;
    }

    /// Write a single row
    pub fn writeRow(self: *Self, fields: []const []const u8) !void {
        for (fields, 0..) |field, i| {
            if (i > 0) {
                try self.buffer.append(self.config.delimiter);
            }
            try self.writeField(field);
        }

        // Write line ending
        switch (self.config.line_ending) {
            .lf => try self.buffer.append('\n'),
            .crlf => try self.buffer.appendSlice("\r\n"),
        }

        self.rows_in_buffer += 1;

        // Auto-flush if threshold reached
        if (self.rows_in_buffer >= self.config.flush_every) {
            try self.flush();
        }
    }

    /// Write a field, quoting if necessary
    fn writeField(self: *Self, field: []const u8) !void {
        const needs_quote = self.fieldNeedsQuoting(field);

        if (needs_quote or self.config.quote_style == .all) {
            try self.buffer.append(self.config.quote_char);

            for (field) |byte| {
                if (byte == self.config.quote_char) {
                    // Escape quote by doubling
                    try self.buffer.append(self.config.quote_char);
                }
                try self.buffer.append(byte);
            }

            try self.buffer.append(self.config.quote_char);
        } else {
            try self.buffer.appendSlice(field);
        }
    }

    /// Check if field needs quoting
    fn fieldNeedsQuoting(self: *Self, field: []const u8) bool {
        for (field) |byte| {
            if (byte == self.config.delimiter or
                byte == self.config.quote_char or
                byte == '\n' or
                byte == '\r')
            {
                return true;
            }
        }
        return false;
    }

    /// Flush buffer to file
    pub fn flush(self: *Self) !void {
        if (self.file) |file| {
            try file.writeAll(self.buffer.items);
            self.bytes_written += self.buffer.items.len;
        }

        self.rows_written += self.rows_in_buffer;
        self.rows_in_buffer = 0;
        self.buffer.clearRetainingCapacity();
    }

    /// Get current buffer contents (for in-memory writing)
    pub fn getBuffer(self: *Self) []const u8 {
        return self.buffer.items;
    }

    /// Get total rows written
    pub fn getRowsWritten(self: *Self) usize {
        return self.rows_written + self.rows_in_buffer;
    }

    /// Close writer and release resources
    pub fn close(self: *Self) !void {
        // Flush any remaining data
        try self.flush();

        // Close file if writing to file
        if (self.file) |file| {
            file.close();
        }
    }

    pub fn deinit(self: *Self) void {
        self.close() catch {};
        self.buffer.deinit();
        self.allocator.destroy(self);
    }
};

/// Modifications tracker for copy-on-write
pub const ModificationLog = struct {
    allocator: std.mem.Allocator,

    /// Cell modifications: (row, col) -> new_value
    cell_edits: std.AutoHashMap(struct { row: usize, col: usize }, []const u8),

    /// Deleted row indices
    deleted_rows: std.AutoHashMap(usize, void),

    /// Inserted rows: position -> fields
    inserted_rows: std.AutoHashMap(usize, []const []const u8),

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator) !*Self {
        const log = try allocator.create(Self);
        log.* = Self{
            .allocator = allocator,
            .cell_edits = std.AutoHashMap(struct { row: usize, col: usize }, []const u8).init(allocator),
            .deleted_rows = std.AutoHashMap(usize, void).init(allocator),
            .inserted_rows = std.AutoHashMap(usize, []const []const u8).init(allocator),
        };
        return log;
    }

    /// Record a cell edit
    pub fn setCell(self: *Self, row: usize, col: usize, value: []const u8) !void {
        const value_copy = try self.allocator.dupe(u8, value);
        try self.cell_edits.put(.{ .row = row, .col = col }, value_copy);
    }

    /// Record a row deletion
    pub fn deleteRow(self: *Self, row: usize) !void {
        try self.deleted_rows.put(row, {});
    }

    /// Record a row insertion
    pub fn insertRow(self: *Self, position: usize, fields: []const []const u8) !void {
        const fields_copy = try self.allocator.alloc([]const u8, fields.len);
        for (fields, 0..) |field, i| {
            fields_copy[i] = try self.allocator.dupe(u8, field);
        }
        try self.inserted_rows.put(position, fields_copy);
    }

    /// Check if row is deleted
    pub fn isDeleted(self: *Self, row: usize) bool {
        return self.deleted_rows.contains(row);
    }

    /// Get modified cell value if exists
    pub fn getCellEdit(self: *Self, row: usize, col: usize) ?[]const u8 {
        return self.cell_edits.get(.{ .row = row, .col = col });
    }

    /// Get number of modifications
    pub fn modificationCount(self: *Self) usize {
        return self.cell_edits.count() + self.deleted_rows.count() + self.inserted_rows.count();
    }

    /// Clear all modifications
    pub fn clear(self: *Self) void {
        // Free cell edit values
        var cell_it = self.cell_edits.iterator();
        while (cell_it.next()) |entry| {
            self.allocator.free(entry.value_ptr.*);
        }
        self.cell_edits.clearRetainingCapacity();

        // Free inserted row values
        var insert_it = self.inserted_rows.iterator();
        while (insert_it.next()) |entry| {
            for (entry.value_ptr.*) |field| {
                self.allocator.free(field);
            }
            self.allocator.free(entry.value_ptr.*);
        }
        self.inserted_rows.clearRetainingCapacity();

        self.deleted_rows.clearRetainingCapacity();
    }

    pub fn deinit(self: *Self) void {
        self.clear();
        self.cell_edits.deinit();
        self.deleted_rows.deinit();
        self.inserted_rows.deinit();
        self.allocator.destroy(self);
    }
};

// ============================================================================
// FFI Exports
// ============================================================================

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();

/// Create writer to file
export fn csv_writer_create(path_ptr: [*c]const u8) ?*anyopaque {
    const path = std.mem.span(path_ptr);
    const writer = Writer.initToFile(allocator, path, .{}) catch return null;
    return @ptrCast(writer);
}

/// Write a row (fields separated by null bytes)
export fn csv_writer_write_row(handle: *anyopaque, data_ptr: [*c]const u8, data_len: usize, field_count: usize) bool {
    const writer: *Writer = @ptrCast(@alignCast(handle));
    _ = data_ptr;
    _ = data_len;
    _ = field_count;

    // TODO: Parse fields from data and write
    _ = writer;
    return true;
}

/// Flush writer buffer
export fn csv_writer_flush(handle: *anyopaque) bool {
    const writer: *Writer = @ptrCast(@alignCast(handle));
    writer.flush() catch return false;
    return true;
}

/// Close and free writer
export fn csv_writer_close(handle: *anyopaque) void {
    const writer: *Writer = @ptrCast(@alignCast(handle));
    writer.deinit();
}

// ============================================================================
// Tests
// ============================================================================

test "writer basic" {
    const test_allocator = std.testing.allocator;

    const writer = try Writer.initToBuffer(test_allocator, .{});
    defer writer.deinit();

    try writer.writeRow(&.{ "name", "age" });
    try writer.writeRow(&.{ "Alice", "30" });

    const output = writer.getBuffer();
    try std.testing.expectEqualStrings("name,age\nAlice,30\n", output);
}

test "writer quoting" {
    const test_allocator = std.testing.allocator;

    const writer = try Writer.initToBuffer(test_allocator, .{});
    defer writer.deinit();

    try writer.writeRow(&.{ "hello, world", "normal" });

    const output = writer.getBuffer();
    try std.testing.expectEqualStrings("\"hello, world\",normal\n", output);
}

test "writer quote escaping" {
    const test_allocator = std.testing.allocator;

    const writer = try Writer.initToBuffer(test_allocator, .{});
    defer writer.deinit();

    try writer.writeRow(&.{ "say \"hello\"", "test" });

    const output = writer.getBuffer();
    try std.testing.expectEqualStrings("\"say \"\"hello\"\"\",test\n", output);
}

test "modification log" {
    const test_allocator = std.testing.allocator;

    const log = try ModificationLog.init(test_allocator);
    defer log.deinit();

    try log.setCell(0, 1, "modified");
    try log.deleteRow(5);

    try std.testing.expectEqual(@as(usize, 2), log.modificationCount());
    try std.testing.expect(log.isDeleted(5));
    try std.testing.expect(!log.isDeleted(0));
    try std.testing.expectEqualStrings("modified", log.getCellEdit(0, 1).?);
}
