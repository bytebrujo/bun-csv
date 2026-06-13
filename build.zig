const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Detect if building for WASM
    const is_wasm = target.result.cpu.arch == .wasm32;

    if (is_wasm) {
        // WASM library build
        buildWasm(b, target, optimize);
    } else {
        // Native library build
        buildNative(b, target, optimize);
    }

    // Unit tests (native only)
    if (!is_wasm) {
        const unit_tests_module = b.createModule(.{
            .root_source_file = b.path("src/zig/parser.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        const unit_tests = b.addTest(.{
            .root_module = unit_tests_module,
        });

        // Link iconv library - only needed on macOS when building natively
        // On Linux glibc, iconv is built into libc
        const is_native_macos = target.result.os.tag == .macos and target.query.isNative();
        if (is_native_macos) {
            unit_tests_module.linkSystemLibrary("iconv", .{});
        }

        const run_unit_tests = b.addRunArtifact(unit_tests);

        const test_step = b.step("test", "Run unit tests");
        test_step.dependOn(&run_unit_tests.step);
    }
}

/// Build native shared library
fn buildNative(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode) void {
    const lib_module = b.createModule(.{
        .root_source_file = b.path("src/zig/parser.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const lib = b.addLibrary(.{
        .name = "turbocsv",
        .root_module = lib_module,
        .linkage = .dynamic,
    });

    // Link iconv library on macOS (required for character encoding support)
    // On Linux (glibc), iconv is built into libc
    const target_os = target.result.os.tag;
    if (target_os == .macos) {
        lib_module.linkSystemLibrary("iconv", .{});
    }

    // Install the library
    b.installArtifact(lib);
}

/// Build WASM library
fn buildWasm(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode) void {
    // Create WASM-specific module with define for conditional compilation
    const wasm_module = b.createModule(.{
        .root_source_file = b.path("src/zig/parser.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Build as static library for WASM (will produce .wasm file)
    const wasm_lib = b.addExecutable(.{
        .name = "turbocsv",
        .root_module = wasm_module,
    });

    // WASM-specific settings
    wasm_lib.rdynamic = true; // Export all public symbols
    wasm_lib.entry = .disabled; // No entry point (library mode)

    // Install to wasm/ directory
    const wasm_install = b.addInstallArtifact(wasm_lib, .{
        .dest_dir = .{ .override = .{ .custom = "../wasm" } },
    });

    b.getInstallStep().dependOn(&wasm_install.step);
}
