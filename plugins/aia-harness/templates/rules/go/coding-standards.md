---
description: Go coding standards and anti-patterns
paths:
  - "**/*.go"
---

# Go — Coding Standards

**Sources:** uber-go/guide · Google Go Style Guide

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `panic` in business code | Return `error` |
| Errors without context (`return err`) | `fmt.Errorf("operation X: %w", err)` |
| Pointer when zero value has useful semantics | Value type; pointer only when nil has meaning |
| Mutex without the fields it protects | Group mutex + fields in a dedicated struct |
| Goroutine without lifecycle tracking | `sync.WaitGroup` or signaling channel |
| `init()` with complex logic or side effects | Explicit dependency injection |
| Unreadable abbreviated names (`rdr`, `mgr`) | Clear names; standard abbreviations OK (`buf`, `err`, `id`) |
| `interface{}` / `any` where a concrete type works | Concrete type; `any` only at real generic boundaries |
| Copying a struct with Mutex | Pass pointer to struct with Mutex |
| Goroutine leak (goroutine with no way to stop) | Context with cancel; select with done channel |

## Conventions

- Errors: sentinel values (`var ErrNotFound = errors.New(...)`) for expected errors; error types for rich context
- Naming: `MixedCaps`; single-method interfaces: `-er` suffix (`Reader`, `Stringer`)
- Packages: short, singular, no underscores (`userservice` not `user_service`)
- Tests in the same package with `_test.go` suffix; integration tests in a separate `_test` package
- `defer` for resource cleanup always
- Project structure: `cmd/` binaries · `internal/` non-exportable code · `pkg/` public library

## Tooling

- `gofmt` / `goimports` mandatory (no exceptions)
- `golangci-lint` with team configuration
- `go vet` in the pipeline
- `go test -race ./...` to detect race conditions
