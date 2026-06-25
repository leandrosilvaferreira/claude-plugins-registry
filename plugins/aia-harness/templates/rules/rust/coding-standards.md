---
description: Rust coding standards and anti-patterns
paths:
  - "**/*.rs"
---

# Rust — Coding Standards

**Sources:** mre/idiomatic-rust · Rust API Guidelines · Rust RFC 2436

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `unwrap()` / `expect()` in production code | `?` operator + explicit error handling |
| Unnecessary `clone()` | Correct references / lifetimes |
| `String` in parameters that do not need ownership | `&str` — more flexible and allocation-free |
| Manual loops where iterators suffice | Iterators + combinators (`map`, `filter`, `collect`) |
| `match` with `_` arm covering unexamined variants | Cover variants explicitly; `_` only with a comment |
| `pub` on struct fields without a clear invariant | Access methods; `pub` on fields only in simple data structs |
| Panic in libraries | `Result<T, E>` in every function that can fail in a lib |
| `Box<dyn Error>` for errors in a library | Custom error type or `thiserror` |
| `Arc<Mutex<T>>` types in single-threaded code | `Rc<RefCell<T>>` or restructure to avoid interior mutability |

## Conventions

- Naming: `snake_case` functions/variables · `PascalCase` types/traits · `UPPER_SNAKE_CASE` constants
- `clippy` is the law — clippy warnings are errors in the pipeline
- Errors: `thiserror` for libraries · `anyhow` for binaries/applications
- Traits: implement `Debug`, `Display`, `Clone`, `PartialEq` where it makes sense
- Lifetimes: name lifetimes descriptively in complex public APIs (`'a` only in simple cases)
- Documentation: `///` on every public function; examples that compile in `/// # Examples`
- `#[must_use]` on functions that return `Result` or values that should not be ignored

## Tooling

- `rustfmt` mandatory (no exceptions — config in `rustfmt.toml`)
- `clippy -- -D warnings` in the pipeline
- `cargo test` + `cargo test --doc` (tests documentation examples)
- `cargo audit` for CVEs in dependencies
