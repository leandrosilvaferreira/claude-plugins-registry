---
description: PHP coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP — Coding Standards

**Fonte:** PSR-12 (PHP-FIG) · PHP 8.x official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Tag de fechamento `?>` em arquivo PHP puro | Omitir — evita whitespace acidental |
| Mix de tabs e espaços | 4 espaços (PSR-12) |
| `array()` syntax | Sintaxe curta `[]` (PHP 5.4+) |
| Funções sem type hints | Type hints em parâmetros e retorno (PHP 8+) |
| `isset()` para verificar array key em loop | `array_key_exists()` quando `null` é valor válido |
| `@` para suprimir erros | Tratar o erro corretamente |
| String concatenation em loop (`$s .= $x`) | `implode()` ou array + join final |
| `extract()` | Desestruturação explícita ou acesso por chave |
| `global $var` | Injeção de dependência |
| Funções longas (> 30 linhas) sem extração | Métodos menores com responsabilidade única |

## Convenções

- PSR-12: `PascalCase` classes · `camelCase` métodos · `snake_case` variáveis · `UPPER_SNAKE_CASE` constantes
- `declare(strict_types=1)` no topo de todo arquivo
- `readonly` para propriedades imutáveis (PHP 8.1+)
- Named arguments para clareza em chamadas com muitos parâmetros
- `match` em vez de `switch` para expressões (PHP 8.0+)
- Enums nativos (PHP 8.1+) em vez de classes de constantes

## Tooling

- PHP-CS-Fixer ou Pint (Laravel) para formatação
- PHPStan (nível 8+) ou Psalm para análise estática
- Composer para gerenciamento de dependências
