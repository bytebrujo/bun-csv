const std = @import("std");
const builtin = @import("builtin");

//! Cross-Platform Memory Mapping
//!
//! Provides a unified API for memory-mapped file access across platforms:
//! - POSIX (Linux, macOS): Uses `mmap`/`munmap` via `std.posix`
//! - Windows: Uses `CreateFileMappingW`/`MapViewOfFile` via kernel32
//!
//! Usage:
//! ```zig
//! const file = try std.fs.cwd().openFile("data.csv", .{});
//! const stat = try file.stat();
//! const mapped = try MappedFile.init(file, stat.size);
//! defer mapped.deinit();
//!
//! // Access file contents via mapped.data slice
//! const first_byte = mapped.data[0];
//! ```

// Windows API declarations (not in Zig stdlib)
const win32 = if (builtin.os.tag == .windows) struct {
    const HANDLE = std.os.windows.HANDLE;
    const BOOL = std.os.windows.BOOL;
    const DWORD = std.os.windows.DWORD;
    const LPCWSTR = [*:0]const u16;
    const LPVOID = *anyopaque;
    const LPCVOID = *const anyopaque;
    const SIZE_T = usize;

    const PAGE_READONLY: DWORD = 0x02;
    const FILE_MAP_READ: DWORD = 0x04;

    const SECURITY_ATTRIBUTES = extern struct {
        nLength: DWORD,
        lpSecurityDescriptor: ?LPVOID,
        bInheritHandle: BOOL,
    };

    extern "kernel32" fn CreateFileMappingW(
        hFile: HANDLE,
        lpFileMappingAttributes: ?*SECURITY_ATTRIBUTES,
        flProtect: DWORD,
        dwMaximumSizeHigh: DWORD,
        dwMaximumSizeLow: DWORD,
        lpName: ?LPCWSTR,
    ) callconv(.winapi) ?HANDLE;

    extern "kernel32" fn MapViewOfFile(
        hFileMappingObject: HANDLE,
        dwDesiredAccess: DWORD,
        dwFileOffsetHigh: DWORD,
        dwFileOffsetLow: DWORD,
        dwNumberOfBytesToMap: SIZE_T,
    ) callconv(.winapi) ?LPVOID;

    extern "kernel32" fn UnmapViewOfFile(lpBaseAddress: LPCVOID) callconv(.winapi) BOOL;
    extern "kernel32" fn CloseHandle(hObject: HANDLE) callconv(.winapi) BOOL;
} else struct {};

/// Cross-platform memory-mapped file abstraction
pub const MappedFile = struct {
    data: []align(std.heap.page_size_min) const u8,
    handle: if (builtin.os.tag == .windows) HandleInfo else void,

    const HandleInfo = struct {
        file_mapping: std.os.windows.HANDLE,
    };

    const Self = @This();

    /// Memory map a file for reading
    pub fn init(file: std.fs.File, size: usize) !Self {
        if (size == 0) {
            return error.EmptyFile;
        }

        if (builtin.os.tag == .windows) {
            return initWindows(file, size);
        } else {
            return initPosix(file, size);
        }
    }

    fn initPosix(file: std.fs.File, size: usize) !Self {
        const mapped = try std.posix.mmap(
            null,
            size,
            std.posix.PROT.READ,
            .{ .TYPE = .PRIVATE },
            file.handle,
            0,
        );
        return Self{
            .data = mapped,
            .handle = {},
        };
    }

    fn initWindows(file: std.fs.File, size: usize) !Self {
        // Create file mapping
        const file_mapping = win32.CreateFileMappingW(
            file.handle,
            null,
            win32.PAGE_READONLY,
            0,
            0,
            null,
        ) orelse return error.CreateFileMappingFailed;
        errdefer _ = win32.CloseHandle(file_mapping);

        // Map view of file
        const view = win32.MapViewOfFile(
            file_mapping,
            win32.FILE_MAP_READ,
            0,
            0,
            0,
        ) orelse return error.MapViewOfFileFailed;

        const ptr: [*]align(std.heap.page_size_min) const u8 = @ptrCast(@alignCast(view));
        return Self{
            .data = ptr[0..size],
            .handle = .{ .file_mapping = file_mapping },
        };
    }

    /// Unmap the file from memory
    pub fn deinit(self: Self) void {
        if (builtin.os.tag == .windows) {
            _ = win32.UnmapViewOfFile(@ptrCast(self.data.ptr));
            _ = win32.CloseHandle(self.handle.file_mapping);
        } else {
            std.posix.munmap(self.data);
        }
    }
};
