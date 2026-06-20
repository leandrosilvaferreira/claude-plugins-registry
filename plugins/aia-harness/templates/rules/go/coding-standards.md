---
description: Go coding standards and anti-patterns
paths:
  - "**/*.go"
---

# Go — Coding Standards

**Fontes:** uber-go/guide · Google Go Style Guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `panic` em código de negócio | Retornar `error` |
| Erros sem contexto (`return err`) | `fmt.Errorf("operation X: %w", err)` |
| Ponteiro quando valor zero tem semântica útil | Tipo por valor; ponteiro apenas quando nil tem significado |
| Mutex sem os campos que protege | Agrupar mutex + campos em struct dedicada |
| Goroutine sem rastreamento de lifecycle | `sync.WaitGroup` ou canal de sinalização |
| `init()` com lógica complexa ou efeitos colaterais | Injeção de dependência explícita |
| Nomes abreviados ilegíveis (`rdr`, `mgr`) | Nomes claros; abreviações padrão OK (`buf`, `err`, `id`) |
| `interface{}` / `any` onde tipo concreto serve | Tipo concreto; `any` só em boundaries genéricos reais |
| Copiar struct com Mutex | Passar ponteiro para struct com Mutex |
| Goroutine leak (goroutine sem forma de parar) | Context com cancel; select com done channel |

## Convenções

- Erros: valores sentinela (`var ErrNotFound = errors.New(...)`) para erros esperados; tipos de erro para contexto rico
- Nomeação: `MixedCaps`; interfaces de um método: sufixo `-er` (`Reader`, `Stringer`)
- Pacotes: nome curto, singular, sem underscore (`userservice` não `user_service`)
- Testes em mesmo pacote com sufixo `_test.go`; testes de integração em `_test` package separado
- `defer` para cleanup de recursos sempre
- Estrutura de projeto: `cmd/` binários · `internal/` código não-exportável · `pkg/` biblioteca pública

## Tooling

- `gofmt` / `goimports` obrigatório (sem exceção)
- `golangci-lint` com configuração de equipe
- `go vet` na pipeline
- `go test -race ./...` para detectar race conditions
