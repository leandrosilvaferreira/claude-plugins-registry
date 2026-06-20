---
description: Laravel coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP + Laravel — Coding Standards

**Fontes:** Laravel official docs · laravel-best-practices community

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Lógica de negócio em Route closure | Controller dedicado |
| `DB::table()` direto onde Eloquent resolve | Eloquent Model |
| Controller gordo com validação inline | Form Request (`php artisan make:request`) para validação |
| Autorização inline no controller | Policies (`php artisan make:policy`) |
| SQL hard-coded em string | Query Builder ou Eloquent |
| `dd()` / `dump()` commitado | Nunca commitar debug helpers |
| `->get()` sem eager loading em loop | `->with('relation')` antes do `->get()` |
| Config hard-coded no código | `config('app.valor')` + `.env` |
| Sem Factory para models de teste | `php artisan make:factory` para todos os models |
| `User::all()` em contexto paginado | `User::paginate()` |

## Convenções

- Artisan: usar make commands para tudo — nunca criar classe manualmente
- Eloquent: `$fillable` ou `$guarded` explícito em todo model
- Relacionamentos: nomear métodos em camelCase (`hasMany`, `belongsTo`)
- Observers para lógica reativa a eventos de model
- Jobs para trabalho assíncrono; Queues para processamento em background
- Events + Listeners para desacoplamento entre domínios
- `__()` / `trans()` para todas as strings visíveis ao usuário (i18n desde o início)

## Tooling

- Laravel Pint (zero-config) para formatação
- Larastan (PHPStan para Laravel) nível 8+ na pipeline
- `php artisan test` ou Pest para testes
