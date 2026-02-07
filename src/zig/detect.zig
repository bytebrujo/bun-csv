const std = @import("std");

/// Default candidate delimiters to test
pub const DEFAULT_CANDIDATES = [_]u8{ ',', '\t', '|', ';' };

/// Maximum number of rows to sample for detection
const MAX_SAMPLE_ROWS = 10;

/// Maximum number of candidate delimiters
pub const MAX_CANDIDATES = 16;

/// Result of delimiter detection
pub const DetectResult = struct {
    delimiter: u8,
    confidence: f32, // 0.0 to 1.0
};

/// Detect the most likely delimiter in CSV data by sampling the first few rows.
///
/// Algorithm: For each candidate delimiter, count how many fields each sample
/// row produces. The best delimiter is the one that gives the most consistent
/// field count across rows AND produces more than 1 field on average.
///
/// Parameters:
///   data: the raw CSV bytes
///   data_len: length of data
///   candidates: array of delimiter bytes to test
///   num_candidates: how many candidates to test
///   quote_char: the quote character (to handle quoted fields correctly)
///
/// Returns the detected delimiter byte, or ',' as fallback.
pub fn detectDelimiter(
    data: []const u8,
    candidates: []const u8,
    quote_char: u8,
) DetectResult {
    if (data.len == 0) {
        return .{ .delimiter = ',', .confidence = 0.0 };
    }

    var best_delimiter: u8 = ',';
    var best_score: f32 = -1.0;

    for (candidates) |candidate| {
        const score = scoreCandidate(data, candidate, quote_char);
        if (score > best_score) {
            best_score = score;
            best_delimiter = candidate;
        }
    }

    return .{
        .delimiter = best_delimiter,
        .confidence = if (best_score > 0) @min(best_score / 10.0, 1.0) else 0.0,
    };
}

/// Score a candidate delimiter. Higher is better.
/// Score = average_fields * consistency_factor
/// consistency_factor = 1.0 if all rows have the same field count, lower otherwise
fn scoreCandidate(data: []const u8, delimiter: u8, quote_char: u8) f32 {
    var field_counts: [MAX_SAMPLE_ROWS]usize = undefined;
    var row_count: usize = 0;

    var cursor: usize = 0;

    while (row_count < MAX_SAMPLE_ROWS and cursor < data.len) {
        // Count fields in this row
        var fields: usize = 1; // At least one field per row
        var in_quote = false;


        while (cursor < data.len) {
            const ch = data[cursor];

            if (in_quote) {
                if (ch == quote_char) {
                    // Check for escaped quote (doubled)
                    if (cursor + 1 < data.len and data[cursor + 1] == quote_char) {
                        cursor += 2;
                        continue;
                    }
                    in_quote = false;
                }
            } else {
                if (ch == quote_char) {
                    in_quote = true;
                } else if (ch == delimiter) {
                    fields += 1;
                } else if (ch == '\n') {
                    cursor += 1;
                    break;
                } else if (ch == '\r') {
                    cursor += 1;
                    if (cursor < data.len and data[cursor] == '\n') {
                        cursor += 1;
                    }
                    break;
                }
            }
            cursor += 1;
        }

        field_counts[row_count] = fields;
        row_count += 1;
    }

    if (row_count == 0) {
        return 0.0;
    }

    // Calculate average field count
    var total_fields: usize = 0;
    for (0..row_count) |i| {
        total_fields += field_counts[i];
    }
    const avg_fields: f32 = @as(f32, @floatFromInt(total_fields)) / @as(f32, @floatFromInt(row_count));

    // If average is <= 1.0, this delimiter doesn't split anything useful
    if (avg_fields <= 1.0) {
        return 0.0;
    }

    // Calculate consistency: what fraction of rows match the most common field count
    // Find mode (most common field count)
    var mode_count: usize = 0;
    for (0..row_count) |i| {
        var count: usize = 0;
        for (0..row_count) |j| {
            if (field_counts[j] == field_counts[i]) {
                count += 1;
            }
        }
        if (count > mode_count) {
            mode_count = count;
        }
    }

    const consistency: f32 = @as(f32, @floatFromInt(mode_count)) / @as(f32, @floatFromInt(row_count));

    // Score = avg_fields * consistency
    // This rewards delimiters that produce many fields consistently
    return avg_fields * consistency;
}

test "detect comma delimiter" {
    const data = "name,age,city\nAlice,30,NYC\nBob,25,LA\n";
    const result = detectDelimiter(data, &DEFAULT_CANDIDATES, '"');
    try std.testing.expectEqual(@as(u8, ','), result.delimiter);
}

test "detect tab delimiter" {
    const data = "name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA\n";
    const result = detectDelimiter(data, &DEFAULT_CANDIDATES, '"');
    try std.testing.expectEqual(@as(u8, '\t'), result.delimiter);
}

test "detect pipe delimiter" {
    const data = "name|age|city\nAlice|30|NYC\nBob|25|LA\n";
    const result = detectDelimiter(data, &DEFAULT_CANDIDATES, '"');
    try std.testing.expectEqual(@as(u8, '|'), result.delimiter);
}

test "detect semicolon delimiter" {
    const data = "name;age;city\nAlice;30;NYC\nBob;25;LA\n";
    const result = detectDelimiter(data, &DEFAULT_CANDIDATES, '"');
    try std.testing.expectEqual(@as(u8, ';'), result.delimiter);
}

test "single column falls back to comma" {
    const data = "name\nAlice\nBob\n";
    const result = detectDelimiter(data, &DEFAULT_CANDIDATES, '"');
    // With single column, no delimiter produces >1 field, so score is 0 for all.
    // Fallback is comma (first tested, or initial best).
    try std.testing.expectEqual(@as(u8, ','), result.delimiter);
}
