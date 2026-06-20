---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
---
<!-- Vendored from ECC (github.com/affaan-m/ECC) @ ceca28852e5b31edbbf66ebccc8fd163dd14208e :: rules/rust/hooks.md. MIT (c) Affaan Mustafa. -->

# Rust Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Rust-specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **cargo fmt**: Auto-format `.rs` files after edit
- **cargo clippy**: Run lint checks after editing Rust files
- **cargo check**: Verify compilation after changes (faster than `cargo build`)
