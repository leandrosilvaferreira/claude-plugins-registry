---
description: Laravel coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP + Laravel — Coding Standards

**Sources:** Laravel official docs · laravel-best-practices community

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Business logic in Route closure | Dedicated Controller |
| `DB::table()` directly where Eloquent suffices | Eloquent Model |
| Fat controller with inline validation | Form Request (`php artisan make:request`) for validation |
| Inline authorization in the controller | Policies (`php artisan make:policy`) |
| Hard-coded SQL in a string | Query Builder or Eloquent |
| `dd()` / `dump()` committed | Never commit debug helpers |
| `->get()` without eager loading in a loop | `->with('relation')` before `->get()` |
| Hard-coded config in code | `config('app.value')` + `.env` |
| No Factory for test models | `php artisan make:factory` for all models |
| `User::all()` in a paginated context | `User::paginate()` |

## Conventions

- Artisan: use make commands for everything — never create a class manually
- Eloquent: explicit `$fillable` or `$guarded` on every model
- Relationships: name methods in camelCase (`hasMany`, `belongsTo`)
- Observers for logic reactive to model events
- Jobs for async work; Queues for background processing
- Events + Listeners for decoupling between domains
- `__()` / `trans()` for all user-visible strings (i18n from the start)

## Tooling

- Laravel Pint (zero-config) for formatting
- Larastan (PHPStan for Laravel) level 8+ in the pipeline
- `php artisan test` or Pest for tests
