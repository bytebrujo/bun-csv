# TurboCSV Architecture

Internal architecture documentation for contributors.

## Cross-Platform Memory Mapping

The parser uses memory-mapped files for efficient large file handling. Platform-specific implementations are abstracted in `src/zig/mmap.zig`.

### Platform Implementations

| Platform | API | Notes |
|----------|-----|-------|
| Linux | `mmap` / `munmap` via `std.posix` | iconv built into glibc |
| macOS | `mmap` / `munmap` via `std.posix` | Requires linking system iconv |
| Windows | `CreateFileMappingW` / `MapViewOfFile` | Kernel32 externs declared manually |

### Why Not Use Zig Stdlib for Windows?

Zig's standard library (`std.os.windows`) doesn't include memory mapping APIs. We declare the necessary kernel32 functions as externs:

```zig
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
```

### Usage

```zig
const mmap = @import("mmap.zig");

const file = try std.fs.cwd().openFile("data.csv", .{});
const stat = try file.stat();
const mapped = try mmap.MappedFile.init(file, stat.size);
defer mapped.deinit();

// Access file contents via mapped.data slice
for (mapped.data) |byte| {
    // process byte
}
```

### Build Considerations

- **macOS**: Must build natively (without `-Dtarget` flag) to link system iconv
- **Windows**: Uses `-Dtarget=x86_64-windows-gnu` for cross-compilation
- **Linux**: Can cross-compile with explicit target flags

## CI/CD Matrix

Current build matrix:

| Platform | Runner | Target Flag |
|----------|--------|-------------|
| linux-x64 | ubuntu-latest | x86_64-linux-gnu |
| linux-arm64 | ubuntu-24.04-arm | aarch64-linux-gnu |
| macos-arm64 | macos-latest | *(native)* |
| windows-x64 | windows-latest | x86_64-windows-gnu |
