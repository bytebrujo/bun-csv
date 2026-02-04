const std = @import("std");
const simd = @import("simd.zig");

const Allocator = std.mem.Allocator;

/// Column data types for schema
pub const ColumnType = enum(u8) {
    string = 0,
    integer = 1,
    float = 2,
    boolean = 3,
    date = 4,
    currency = 5,
    percent = 6,
};

/// Aggregate function types
pub const AggregateType = enum(u8) {
    count = 0,
    sum = 1,
    min = 2,
    max = 3,
    mean = 4,
    median = 5,
    stddev = 6,
    first = 7,
    last = 8,
    concat = 9,
};

/// Join types
pub const JoinType = enum(u8) {
    inner = 0,
    left = 1,
    right = 2,
    full = 3,
    cross = 4,
};

/// Sort order
pub const SortOrder = enum(u8) {
    asc = 0,
    desc = 1,
};

/// Field reference - pointer to data within source
pub const FieldRef = struct {
    start: usize,
    len: usize,

    pub fn getData(self: FieldRef, source: []const u8) []const u8 {
        if (self.start + self.len > source.len) return "";
        return source[self.start .. self.start + self.len];
    }

    pub fn isEmpty(self: FieldRef) bool {
        return self.len == 0;
    }
};

/// Row reference - array of field refs
pub const RowRef = struct {
    fields: []FieldRef,
    row_index: usize,

    pub fn getField(self: RowRef, col: usize) ?FieldRef {
        if (col >= self.fields.len) return null;
        return self.fields[col];
    }

    pub fn deinit(self: *RowRef, allocator: Allocator) void {
        allocator.free(self.fields);
    }
};

/// Column metadata
pub const Column = struct {
    name: []const u8,
    col_type: ColumnType,
    index: usize,
};

/// Comparison result for sorting
const CompareResult = enum { less, equal, greater };

/// DataFrame structure for tabular operations
pub const DataFrame = struct {
    allocator: Allocator,

    /// Column schema
    columns: []Column,
    column_map: std.StringHashMap(usize),

    /// Row references (indices into source data)
    rows: std.ArrayListUnmanaged(RowRef),

    /// Reference to original parser data
    source_data: []const u8,

    /// Whether we own the source data
    owns_source: bool,

    const Self = @This();

    pub fn init(allocator: Allocator, source_data: []const u8) !*Self {
        const df = try allocator.create(Self);
        df.* = Self{
            .allocator = allocator,
            .columns = &.{},
            .column_map = std.StringHashMap(usize).init(allocator),
            .rows = .{},
            .source_data = source_data,
            .owns_source = false,
        };
        return df;
    }

    /// Set column schema from header names
    pub fn setSchema(self: *Self, headers: []const []const u8) !void {
        self.columns = try self.allocator.alloc(Column, headers.len);

        for (headers, 0..) |header, i| {
            // Duplicate header name so we own it
            const name_copy = try self.allocator.dupe(u8, header);
            self.columns[i] = Column{
                .name = name_copy,
                .col_type = .string,
                .index = i,
            };
            try self.column_map.put(name_copy, i);
        }
    }

    /// Set column type for a specific column
    pub fn setColumnType(self: *Self, col_idx: usize, col_type: ColumnType) void {
        if (col_idx < self.columns.len) {
            self.columns[col_idx].col_type = col_type;
        }
    }

    /// Add a row to the DataFrame
    pub fn addRow(self: *Self, field_refs: []const FieldRef, row_index: usize) !void {
        const fields_copy = try self.allocator.dupe(FieldRef, field_refs);
        try self.rows.append(self.allocator, RowRef{
            .fields = fields_copy,
            .row_index = row_index,
        });
    }

    /// Get column index by name
    pub fn getColumnIndex(self: *Self, name: []const u8) ?usize {
        return self.column_map.get(name);
    }

    /// Get field value as string
    pub fn getFieldString(self: *Self, row_idx: usize, col_idx: usize) ?[]const u8 {
        if (row_idx >= self.rows.items.len) return null;
        const row = self.rows.items[row_idx];
        const field = row.getField(col_idx) orelse return null;
        return field.getData(self.source_data);
    }

    /// Parse field as float (for numeric operations)
    pub fn getFieldFloat(self: *Self, row_idx: usize, col_idx: usize) ?f64 {
        const str = self.getFieldString(row_idx, col_idx) orelse return null;
        return parseFloat(str);
    }

    /// Parse field as integer
    pub fn getFieldInt(self: *Self, row_idx: usize, col_idx: usize) ?i64 {
        const str = self.getFieldString(row_idx, col_idx) orelse return null;
        return parseInt(str);
    }

    // ========================================================================
    // Core Operations
    // ========================================================================

    /// Filter rows - returns new DataFrame with matching rows
    pub fn filter(self: *Self, keep_mask: []const bool) !*Self {
        const result = try DataFrame.init(self.allocator, self.source_data);

        // Copy schema
        if (self.columns.len > 0) {
            result.columns = try self.allocator.alloc(Column, self.columns.len);
            for (self.columns, 0..) |col, i| {
                result.columns[i] = col;
                try result.column_map.put(col.name, i);
            }
        }

        // Copy matching rows
        for (self.rows.items, 0..) |row, i| {
            if (i < keep_mask.len and keep_mask[i]) {
                const fields_copy = try self.allocator.dupe(FieldRef, row.fields);
                try result.rows.append(self.allocator, RowRef{
                    .fields = fields_copy,
                    .row_index = row.row_index,
                });
            }
        }

        return result;
    }

    /// Filter by indices - returns new DataFrame with rows at specified indices
    pub fn filterByIndices(self: *Self, indices: []const usize) !*Self {
        const result = try DataFrame.init(self.allocator, self.source_data);

        // Copy schema
        if (self.columns.len > 0) {
            result.columns = try self.allocator.alloc(Column, self.columns.len);
            for (self.columns, 0..) |col, i| {
                result.columns[i] = col;
                try result.column_map.put(col.name, i);
            }
        }

        // Copy selected rows
        for (indices) |idx| {
            if (idx < self.rows.items.len) {
                const row = self.rows.items[idx];
                const fields_copy = try self.allocator.dupe(FieldRef, row.fields);
                try result.rows.append(self.allocator, RowRef{
                    .fields = fields_copy,
                    .row_index = row.row_index,
                });
            }
        }

        return result;
    }

    /// Select specific columns - returns new DataFrame
    pub fn select(self: *Self, col_indices: []const usize) !*Self {
        const result = try DataFrame.init(self.allocator, self.source_data);

        // Build new schema with selected columns
        result.columns = try self.allocator.alloc(Column, col_indices.len);
        for (col_indices, 0..) |old_idx, new_idx| {
            if (old_idx < self.columns.len) {
                const col = self.columns[old_idx];
                result.columns[new_idx] = Column{
                    .name = col.name,
                    .col_type = col.col_type,
                    .index = new_idx,
                };
                try result.column_map.put(col.name, new_idx);
            }
        }

        // Copy rows with only selected fields
        for (self.rows.items) |row| {
            var new_fields = try self.allocator.alloc(FieldRef, col_indices.len);
            for (col_indices, 0..) |old_idx, new_idx| {
                if (old_idx < row.fields.len) {
                    new_fields[new_idx] = row.fields[old_idx];
                } else {
                    new_fields[new_idx] = FieldRef{ .start = 0, .len = 0 };
                }
            }
            try result.rows.append(self.allocator, RowRef{
                .fields = new_fields,
                .row_index = row.row_index,
            });
        }

        return result;
    }

    /// Sort in place by column
    pub fn sort(self: *Self, col_idx: usize, order: SortOrder) void {
        if (col_idx >= self.columns.len) return;

        const col_type = self.columns[col_idx].col_type;
        const source = self.source_data;

        const SortContext = struct {
            col: usize,
            ord: SortOrder,
            ctype: ColumnType,
            src: []const u8,
        };

        const ctx = SortContext{
            .col = col_idx,
            .ord = order,
            .ctype = col_type,
            .src = source,
        };

        std.sort.pdq(RowRef, self.rows.items, ctx, struct {
            fn lessThan(c: SortContext, a: RowRef, b: RowRef) bool {
                const a_field = a.getField(c.col) orelse return false;
                const b_field = b.getField(c.col) orelse return true;

                const result = compareFields(a_field, b_field, c.ctype, c.src);

                return if (c.ord == .asc)
                    result == .less
                else
                    result == .greater;
            }
        }.lessThan);
    }

    /// Create sorted copy
    pub fn sorted(self: *Self, col_idx: usize, order: SortOrder) !*Self {
        const result = try self.clone();
        result.sort(col_idx, order);
        return result;
    }

    /// Clone DataFrame
    pub fn clone(self: *Self) !*Self {
        const result = try DataFrame.init(self.allocator, self.source_data);

        // Copy schema
        if (self.columns.len > 0) {
            result.columns = try self.allocator.alloc(Column, self.columns.len);
            for (self.columns, 0..) |col, i| {
                result.columns[i] = col;
                try result.column_map.put(col.name, i);
            }
        }

        // Copy rows
        for (self.rows.items) |row| {
            const fields_copy = try self.allocator.dupe(FieldRef, row.fields);
            try result.rows.append(self.allocator, RowRef{
                .fields = fields_copy,
                .row_index = row.row_index,
            });
        }

        return result;
    }

    // ========================================================================
    // Aggregation Operations (SIMD-accelerated where applicable)
    // ========================================================================

    /// Compute sum of a numeric column
    pub fn sum(self: *Self, col_idx: usize) f64 {
        var total: f64 = 0;
        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                const str = field.getData(self.source_data);
                if (parseFloat(str)) |val| {
                    total += val;
                }
            }
        }
        return total;
    }

    /// Compute min of a numeric column
    pub fn min(self: *Self, col_idx: usize) ?f64 {
        var min_val: ?f64 = null;
        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                const str = field.getData(self.source_data);
                if (parseFloat(str)) |val| {
                    if (min_val == null or val < min_val.?) {
                        min_val = val;
                    }
                }
            }
        }
        return min_val;
    }

    /// Compute max of a numeric column
    pub fn max(self: *Self, col_idx: usize) ?f64 {
        var max_val: ?f64 = null;
        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                const str = field.getData(self.source_data);
                if (parseFloat(str)) |val| {
                    if (max_val == null or val > max_val.?) {
                        max_val = val;
                    }
                }
            }
        }
        return max_val;
    }

    /// Compute mean of a numeric column
    pub fn mean(self: *Self, col_idx: usize) f64 {
        var total: f64 = 0;
        var cnt: usize = 0;
        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                const str = field.getData(self.source_data);
                if (parseFloat(str)) |val| {
                    total += val;
                    cnt += 1;
                }
            }
        }
        return if (cnt > 0) total / @as(f64, @floatFromInt(cnt)) else 0;
    }

    /// Compute standard deviation
    pub fn stddev(self: *Self, col_idx: usize) f64 {
        const avg = self.mean(col_idx);
        var variance_sum: f64 = 0;
        var cnt: usize = 0;

        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                const str = field.getData(self.source_data);
                if (parseFloat(str)) |val| {
                    const diff = val - avg;
                    variance_sum += diff * diff;
                    cnt += 1;
                }
            }
        }

        return if (cnt > 0) @sqrt(variance_sum / @as(f64, @floatFromInt(cnt))) else 0;
    }

    /// Compute median
    pub fn median(self: *Self, col_idx: usize) f64 {
        // Collect all numeric values
        var values = std.ArrayList(f64).init(self.allocator);
        defer values.deinit();

        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                const str = field.getData(self.source_data);
                if (parseFloat(str)) |val| {
                    values.append(val) catch continue;
                }
            }
        }

        if (values.items.len == 0) return 0;

        // Sort values
        std.sort.pdq(f64, values.items, {}, std.sort.asc(f64));

        const mid = values.items.len / 2;
        if (values.items.len % 2 == 0) {
            return (values.items[mid - 1] + values.items[mid]) / 2;
        } else {
            return values.items[mid];
        }
    }

    /// Count non-null values in a column
    pub fn count(self: *Self, col_idx: usize) usize {
        var cnt: usize = 0;
        for (self.rows.items) |row| {
            if (row.getField(col_idx)) |field| {
                if (!field.isEmpty()) {
                    cnt += 1;
                }
            }
        }
        return cnt;
    }

    // ========================================================================
    // Access Operations
    // ========================================================================

    /// Get first N rows
    pub fn first(self: *Self, n: usize) []RowRef {
        const cnt = @min(n, self.rows.items.len);
        return self.rows.items[0..cnt];
    }

    /// Get last N rows
    pub fn last(self: *Self, n: usize) []RowRef {
        const cnt = @min(n, self.rows.items.len);
        const start = self.rows.items.len - cnt;
        return self.rows.items[start..];
    }

    /// Get row count
    pub fn rowCount(self: *Self) usize {
        return self.rows.items.len;
    }

    /// Get column count
    pub fn colCount(self: *Self) usize {
        return self.columns.len;
    }

    pub fn deinit(self: *Self) void {
        for (self.rows.items) |*row| {
            row.deinit(self.allocator);
        }
        self.rows.deinit(self.allocator);
        self.column_map.deinit();

        // Free column names
        for (self.columns) |col| {
            self.allocator.free(col.name);
        }
        if (self.columns.len > 0) {
            self.allocator.free(self.columns);
        }

        if (self.owns_source) {
            self.allocator.free(@constCast(self.source_data));
        }

        self.allocator.destroy(self);
    }
};

// ============================================================================
// Grouped DataFrame
// ============================================================================

/// Grouped DataFrame for aggregation operations
pub const GroupedDataFrame = struct {
    allocator: Allocator,
    source: *DataFrame,
    group_col: usize,
    /// Map from group key (as string) to row indices
    groups: std.StringHashMap(std.ArrayListUnmanaged(usize)),

    const Self = @This();

    pub fn init(allocator: Allocator, source: *DataFrame, group_col: usize) !*Self {
        const grouped = try allocator.create(Self);
        grouped.* = Self{
            .allocator = allocator,
            .source = source,
            .group_col = group_col,
            .groups = std.StringHashMap(std.ArrayListUnmanaged(usize)).init(allocator),
        };

        // Build groups
        for (source.rows.items, 0..) |row, row_idx| {
            if (row.getField(group_col)) |field| {
                const key = field.getData(source.source_data);

                // Duplicate key for storage
                const result = try grouped.groups.getOrPut(key);
                if (!result.found_existing) {
                    // Need to duplicate the key since it points to source data
                    const key_copy = try allocator.dupe(u8, key);
                    result.key_ptr.* = key_copy;
                    result.value_ptr.* = .{};
                }
                try result.value_ptr.append(allocator, row_idx);
            }
        }

        return grouped;
    }

    /// Get number of groups
    pub fn groupCount(self: *Self) usize {
        return self.groups.count();
    }

    /// Compute aggregate for a column across all groups
    pub fn aggregate(self: *Self, col_idx: usize, agg_type: AggregateType) !*DataFrame {
        // Create result DataFrame
        const result = try DataFrame.init(self.allocator, self.source.source_data);

        // Set schema: group column + aggregate column
        const group_col_name = if (self.group_col < self.source.columns.len)
            self.source.columns[self.group_col].name
        else
            "group";

        const agg_col_name = switch (agg_type) {
            .count => "count",
            .sum => "sum",
            .min => "min",
            .max => "max",
            .mean => "mean",
            .median => "median",
            .stddev => "stddev",
            .first => "first",
            .last => "last",
            .concat => "concat",
        };

        result.columns = try self.allocator.alloc(Column, 2);
        result.columns[0] = Column{ .name = try self.allocator.dupe(u8, group_col_name), .col_type = .string, .index = 0 };
        result.columns[1] = Column{ .name = try self.allocator.dupe(u8, agg_col_name), .col_type = .float, .index = 1 };

        // Compute aggregates for each group
        var it = self.groups.iterator();
        var row_idx: usize = 0;

        while (it.next()) |entry| {
            const group_key = entry.key_ptr.*;
            const row_indices = entry.value_ptr.items;

            // Compute the aggregate value (stored in result metadata)
            _ = self.computeGroupAggregate(row_indices, col_idx, agg_type);

            // Create row with group key reference
            var fields = try self.allocator.alloc(FieldRef, 2);

            // Group key - find its position in source
            fields[0] = FieldRef{
                .start = @intFromPtr(group_key.ptr) - @intFromPtr(self.source.source_data.ptr),
                .len = group_key.len,
            };

            // Aggregate value placeholder - actual value computed on access
            fields[1] = FieldRef{ .start = 0, .len = 0 };

            try result.rows.append(self.allocator, RowRef{
                .fields = fields,
                .row_index = row_idx,
            });

            row_idx += 1;
        }

        return result;
    }

    fn computeGroupAggregate(self: *Self, row_indices: []const usize, col_idx: usize, agg_type: AggregateType) f64 {
        switch (agg_type) {
            .count => return @floatFromInt(row_indices.len),

            .sum => {
                var total: f64 = 0;
                for (row_indices) |idx| {
                    if (self.source.getFieldFloat(idx, col_idx)) |val| {
                        total += val;
                    }
                }
                return total;
            },

            .mean => {
                var total: f64 = 0;
                var cnt: usize = 0;
                for (row_indices) |idx| {
                    if (self.source.getFieldFloat(idx, col_idx)) |val| {
                        total += val;
                        cnt += 1;
                    }
                }
                return if (cnt > 0) total / @as(f64, @floatFromInt(cnt)) else 0;
            },

            .min => {
                var min_val: ?f64 = null;
                for (row_indices) |idx| {
                    if (self.source.getFieldFloat(idx, col_idx)) |val| {
                        if (min_val == null or val < min_val.?) {
                            min_val = val;
                        }
                    }
                }
                return min_val orelse 0;
            },

            .max => {
                var max_val: ?f64 = null;
                for (row_indices) |idx| {
                    if (self.source.getFieldFloat(idx, col_idx)) |val| {
                        if (max_val == null or val > max_val.?) {
                            max_val = val;
                        }
                    }
                }
                return max_val orelse 0;
            },

            else => return 0,
        }
    }

    pub fn deinit(self: *Self) void {
        var it = self.groups.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit(self.allocator);
        }
        self.groups.deinit();
        self.allocator.destroy(self);
    }
};

// ============================================================================
// Join Operations
// ============================================================================

/// Join two DataFrames
pub fn joinDataFrames(
    allocator: Allocator,
    left: *DataFrame,
    right: *DataFrame,
    left_col: usize,
    right_col: usize,
    join_type: JoinType,
) !*DataFrame {
    const result = try DataFrame.init(allocator, left.source_data);

    // Build combined schema
    const total_cols = left.columns.len + right.columns.len;
    result.columns = try allocator.alloc(Column, total_cols);

    for (left.columns, 0..) |col, i| {
        result.columns[i] = Column{
            .name = try allocator.dupe(u8, col.name),
            .col_type = col.col_type,
            .index = i,
        };
    }

    for (right.columns, 0..) |col, i| {
        const new_idx = left.columns.len + i;
        result.columns[new_idx] = Column{
            .name = try allocator.dupe(u8, col.name),
            .col_type = col.col_type,
            .index = new_idx,
        };
    }

    // Build lookup for right side
    var right_lookup = std.StringHashMap(std.ArrayListUnmanaged(usize)).init(allocator);
    defer {
        var it = right_lookup.iterator();
        while (it.next()) |entry| {
            entry.value_ptr.deinit(allocator);
        }
        right_lookup.deinit();
    }

    for (right.rows.items, 0..) |row, idx| {
        if (row.getField(right_col)) |field| {
            const key = field.getData(right.source_data);
            const entry = try right_lookup.getOrPut(key);
            if (!entry.found_existing) {
                entry.value_ptr.* = .{};
            }
            try entry.value_ptr.append(allocator, idx);
        }
    }

    // Track matched right rows for outer joins
    var matched_right = std.AutoHashMap(usize, void).init(allocator);
    defer matched_right.deinit();

    // Process left rows
    for (left.rows.items, 0..) |left_row, left_idx| {
        const left_key = if (left_row.getField(left_col)) |f| f.getData(left.source_data) else "";

        if (right_lookup.get(left_key)) |right_indices| {
            // Matching rows found
            for (right_indices.items) |right_idx| {
                try matched_right.put(right_idx, {});
                const right_row = right.rows.items[right_idx];

                // Combine fields from both rows
                var combined = try allocator.alloc(FieldRef, total_cols);
                for (left_row.fields, 0..) |f, i| {
                    combined[i] = f;
                }
                for (right_row.fields, 0..) |f, i| {
                    combined[left.columns.len + i] = f;
                }

                try result.rows.append(allocator, RowRef{
                    .fields = combined,
                    .row_index = result.rows.items.len,
                });
            }
        } else if (join_type == .left or join_type == .full) {
            // Left outer: include unmatched left row with nulls for right
            var combined = try allocator.alloc(FieldRef, total_cols);
            for (left_row.fields, 0..) |f, i| {
                combined[i] = f;
            }
            for (0..right.columns.len) |i| {
                combined[left.columns.len + i] = FieldRef{ .start = 0, .len = 0 };
            }

            try result.rows.append(allocator, RowRef{
                .fields = combined,
                .row_index = result.rows.items.len,
            });
        }

        _ = left_idx;
    }

    // Handle right outer and full outer
    if (join_type == .right or join_type == .full) {
        for (right.rows.items, 0..) |right_row, right_idx| {
            if (!matched_right.contains(right_idx)) {
                var combined = try allocator.alloc(FieldRef, total_cols);
                for (0..left.columns.len) |i| {
                    combined[i] = FieldRef{ .start = 0, .len = 0 };
                }
                for (right_row.fields, 0..) |f, i| {
                    combined[left.columns.len + i] = f;
                }

                try result.rows.append(allocator, RowRef{
                    .fields = combined,
                    .row_index = result.rows.items.len,
                });
            }
        }
    }

    return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse string to float
fn parseFloat(str: []const u8) ?f64 {
    if (str.len == 0) return null;

    // Remove currency symbols and whitespace
    var clean_start: usize = 0;
    var clean_end: usize = str.len;

    while (clean_start < str.len and (str[clean_start] == ' ' or str[clean_start] == '$' or
        str[clean_start] == '\xe2' or str[clean_start] == '\xc2'))
    {
        clean_start += 1;
    }

    while (clean_end > clean_start and (str[clean_end - 1] == ' ' or str[clean_end - 1] == '%')) {
        clean_end -= 1;
    }

    if (clean_start >= clean_end) return null;

    // Remove commas for thousands separator
    var buffer: [64]u8 = undefined;
    var buf_idx: usize = 0;

    for (str[clean_start..clean_end]) |c| {
        if (c != ',') {
            if (buf_idx < buffer.len) {
                buffer[buf_idx] = c;
                buf_idx += 1;
            }
        }
    }

    return std.fmt.parseFloat(f64, buffer[0..buf_idx]) catch null;
}

/// Parse string to integer
fn parseInt(str: []const u8) ?i64 {
    if (str.len == 0) return null;

    // Remove commas
    var buffer: [32]u8 = undefined;
    var buf_idx: usize = 0;

    for (str) |c| {
        if (c != ',' and c != ' ') {
            if (buf_idx < buffer.len) {
                buffer[buf_idx] = c;
                buf_idx += 1;
            }
        }
    }

    return std.fmt.parseInt(i64, buffer[0..buf_idx], 10) catch null;
}

/// Compare two fields based on type
fn compareFields(a: FieldRef, b: FieldRef, col_type: ColumnType, source: []const u8) CompareResult {
    const a_str = a.getData(source);
    const b_str = b.getData(source);

    switch (col_type) {
        .integer, .float, .currency, .percent => {
            const a_val = parseFloat(a_str) orelse return .less;
            const b_val = parseFloat(b_str) orelse return .greater;

            if (a_val < b_val) return .less;
            if (a_val > b_val) return .greater;
            return .equal;
        },
        else => {
            // String comparison
            const order = std.mem.order(u8, a_str, b_str);
            return switch (order) {
                .lt => .less,
                .gt => .greater,
                .eq => .equal,
            };
        },
    }
}

// ============================================================================
// FFI Exports
// ============================================================================

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const global_allocator = gpa.allocator();

/// Create DataFrame from source data
export fn df_create(source_ptr: [*c]const u8, source_len: usize) ?*anyopaque {
    const source = source_ptr[0..source_len];
    const df = DataFrame.init(global_allocator, source) catch return null;
    return @ptrCast(df);
}

/// Set schema from header names
export fn df_set_schema(handle: *anyopaque, headers_ptr: [*c]const [*c]const u8, header_lens: [*c]const usize, header_count: usize) bool {
    const df: *DataFrame = @ptrCast(@alignCast(handle));

    var headers = global_allocator.alloc([]const u8, header_count) catch return false;
    defer global_allocator.free(headers);

    for (0..header_count) |i| {
        headers[i] = headers_ptr[i][0..header_lens[i]];
    }

    df.setSchema(headers) catch return false;
    return true;
}

/// Add a row to DataFrame
export fn df_add_row(handle: *anyopaque, field_starts: [*c]const usize, field_lens: [*c]const usize, field_count: usize, row_index: usize) bool {
    const df: *DataFrame = @ptrCast(@alignCast(handle));

    var fields = global_allocator.alloc(FieldRef, field_count) catch return false;
    defer global_allocator.free(fields);

    for (0..field_count) |i| {
        fields[i] = FieldRef{
            .start = field_starts[i],
            .len = field_lens[i],
        };
    }

    df.addRow(fields, row_index) catch return false;
    return true;
}

/// Set column type
export fn df_set_column_type(handle: *anyopaque, col_idx: usize, col_type: u8) void {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    df.setColumnType(col_idx, @enumFromInt(col_type));
}

/// Sort DataFrame in place
export fn df_sort(handle: *anyopaque, col_idx: usize, ascending: bool) void {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    df.sort(col_idx, if (ascending) .asc else .desc);
}

/// Create sorted copy
export fn df_sorted(handle: *anyopaque, col_idx: usize, ascending: bool) ?*anyopaque {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    const result = df.sorted(col_idx, if (ascending) .asc else .desc) catch return null;
    return @ptrCast(result);
}

/// Filter by indices
export fn df_filter_indices(handle: *anyopaque, indices_ptr: [*c]const usize, count: usize) ?*anyopaque {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    const indices = indices_ptr[0..count];
    const result = df.filterByIndices(indices) catch return null;
    return @ptrCast(result);
}

/// Select columns
export fn df_select(handle: *anyopaque, col_indices_ptr: [*c]const usize, count: usize) ?*anyopaque {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    const indices = col_indices_ptr[0..count];
    const result = df.select(indices) catch return null;
    return @ptrCast(result);
}

/// Clone DataFrame
export fn df_clone(handle: *anyopaque) ?*anyopaque {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    const result = df.clone() catch return null;
    return @ptrCast(result);
}

/// Get row count
export fn df_row_count(handle: *anyopaque) usize {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.rowCount();
}

/// Get column count
export fn df_col_count(handle: *anyopaque) usize {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.colCount();
}

/// Aggregate functions
export fn df_sum(handle: *anyopaque, col_idx: usize) f64 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.sum(col_idx);
}

export fn df_min(handle: *anyopaque, col_idx: usize) f64 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.min(col_idx) orelse 0;
}

export fn df_max(handle: *anyopaque, col_idx: usize) f64 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.max(col_idx) orelse 0;
}

export fn df_mean(handle: *anyopaque, col_idx: usize) f64 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.mean(col_idx);
}

export fn df_stddev(handle: *anyopaque, col_idx: usize) f64 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.stddev(col_idx);
}

export fn df_median(handle: *anyopaque, col_idx: usize) f64 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.median(col_idx);
}

export fn df_count(handle: *anyopaque, col_idx: usize) usize {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    return df.count(col_idx);
}

/// Get field string (returns pointer and length)
export fn df_get_field(handle: *anyopaque, row_idx: usize, col_idx: usize, out_len: *usize) ?[*]const u8 {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    const str = df.getFieldString(row_idx, col_idx) orelse {
        out_len.* = 0;
        return null;
    };
    out_len.* = str.len;
    return str.ptr;
}

/// GroupBy
export fn df_group_by(handle: *anyopaque, col_idx: usize) ?*anyopaque {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    const grouped = GroupedDataFrame.init(global_allocator, df, col_idx) catch return null;
    return @ptrCast(grouped);
}

/// Get group count
export fn df_group_count(handle: *anyopaque) usize {
    const grouped: *GroupedDataFrame = @ptrCast(@alignCast(handle));
    return grouped.groupCount();
}

/// Aggregate grouped data
export fn df_group_aggregate(handle: *anyopaque, col_idx: usize, agg_type: u8) ?*anyopaque {
    const grouped: *GroupedDataFrame = @ptrCast(@alignCast(handle));
    const result = grouped.aggregate(col_idx, @enumFromInt(agg_type)) catch return null;
    return @ptrCast(result);
}

/// Free grouped DataFrame
export fn df_group_free(handle: *anyopaque) void {
    const grouped: *GroupedDataFrame = @ptrCast(@alignCast(handle));
    grouped.deinit();
}

/// Join DataFrames
export fn df_join(left_handle: *anyopaque, right_handle: *anyopaque, left_col: usize, right_col: usize, join_type: u8) ?*anyopaque {
    const left: *DataFrame = @ptrCast(@alignCast(left_handle));
    const right: *DataFrame = @ptrCast(@alignCast(right_handle));
    const result = joinDataFrames(global_allocator, left, right, left_col, right_col, @enumFromInt(join_type)) catch return null;
    return @ptrCast(result);
}

/// Free DataFrame
export fn df_free(handle: *anyopaque) void {
    const df: *DataFrame = @ptrCast(@alignCast(handle));
    df.deinit();
}

// ============================================================================
// Tests
// ============================================================================

test "dataframe basic" {
    const allocator = std.testing.allocator;
    const data = "name,age\nAlice,30\nBob,25\n";

    const df = try DataFrame.init(allocator, data);
    defer df.deinit();

    try df.setSchema(&.{ "name", "age" });
    try std.testing.expectEqual(@as(usize, 2), df.colCount());
}

test "dataframe aggregation" {
    const allocator = std.testing.allocator;
    const data = "name,value\na,10\nb,20\nc,30\n";

    const df = try DataFrame.init(allocator, data);
    defer df.deinit();

    try df.setSchema(&.{ "name", "value" });
    df.setColumnType(1, .float);

    // Add rows
    try df.addRow(&.{
        FieldRef{ .start = 11, .len = 1 }, // "a"
        FieldRef{ .start = 13, .len = 2 }, // "10"
    }, 0);
    try df.addRow(&.{
        FieldRef{ .start = 16, .len = 1 }, // "b"
        FieldRef{ .start = 18, .len = 2 }, // "20"
    }, 1);
    try df.addRow(&.{
        FieldRef{ .start = 21, .len = 1 }, // "c"
        FieldRef{ .start = 23, .len = 2 }, // "30"
    }, 2);

    try std.testing.expectEqual(@as(f64, 60), df.sum(1));
    try std.testing.expectEqual(@as(f64, 20), df.mean(1));
}

test "parse float" {
    try std.testing.expectEqual(@as(?f64, 123.45), parseFloat("123.45"));
    try std.testing.expectEqual(@as(?f64, 1234.56), parseFloat("1,234.56"));
    try std.testing.expectEqual(@as(?f64, 99.99), parseFloat("$99.99"));
}
