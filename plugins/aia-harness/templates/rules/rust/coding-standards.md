---
description: Rust coding standards and anti-patterns
paths:
  - "**/*.rs"
---

# Rust — Coding Standards

**Fontes:** mre/idiomatic-rust · Rust API Guidelines · Rust RFC 2436

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `unwrap()` / `expect()` em código de produção | `?` operator + tratamento explícito de erro |
| `clone()` desnecessário | Referências / lifetimes corretos |
| `String` em parâmetros que não precisam de ownership | `&str` — mais flexível e sem alocação |
| Loops manuais onde iterators resolvem | Iterators + combinators (`map`, `filter`, `collect`) |
| `match` com braço `_` cobrindo variantes não examinadas | Cobrir variantes explicitamente; `_` apenas com comentário |
| `pub` em campos de struct sem invariante clara | Métodos de acesso; `pub` em campos apenas em data structs simples |
| Panic em bibliotecas | `Result<T, E>` em toda função que pode falhar em lib |
| `Box<dyn Error>` para erros em biblioteca | Tipo de erro customizado ou `thiserror` |
| Tipos `Arc<Mutex<T>>` em código single-thread | `Rc<RefCell<T>>` ou reestruturar para evitar interior mutability |

## Convenções

- Nomeação: `snake_case` funções/variáveis · `PascalCase` tipos/traits · `UPPER_SNAKE_CASE` constantes
- `clippy` é a lei — warnings do clippy são erros na pipeline
- Erros: `thiserror` para bibliotecas · `anyhow` para binários/aplicações
- Traits: implementar `Debug`, `Display`, `Clone`, `PartialEq` onde faz sentido
- Lifetimes: nomear lifetimes descritivamente em APIs públicas complexas (`'a` apenas em casos simples)
- Documentação: `///` em toda função pública; exemplos que compilam em `/// # Examples`
- `#[must_use]` em funções que retornam `Result` ou valores que não devem ser ignorados

## Tooling

- `rustfmt` obrigatório (sem exceção — config em `rustfmt.toml`)
- `clippy -- -D warnings` na pipeline
- `cargo test` + `cargo test --doc` (testa exemplos de documentação)
- `cargo audit` para CVEs nas dependências
