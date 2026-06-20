---
name: setup-testing
description: Semeia testes unitários num projeto que não tem nenhum — instala o framework recomendado para a stack, escreve um teste real num módulo existente, fia o script `test` e roda até passar verde. Use quando o projeto não tem testes, ao "configurar testes", "setup tests", "adicionar testes" ou "criar suíte de testes".
---

# Setup unit testing

Semeia a infraestrutura de testes unitários e prova que roda. **Nunca alegue verde sem ter rodado e visto a saída.**

## 1. Determinar o framework

Leia o framework recomendado no `CLAUDE.md` (linha "recomendado: ..."). Se ausente, use a tabela pela stack detectada. **Confirme com o usuário** — ele pode escolher uma alternativa.

| Stack | Framework | Instalar | Config |
| --- | --- | --- | --- |
| JS/TS + React/Next | Vitest + Testing Library + jsdom | `npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom` (use o PM do projeto) | `vitest.config.ts` |
| JS/TS + Vue/Nuxt | Vitest + @vue/test-utils + jsdom | `npm i -D vitest @vue/test-utils jsdom` | `vitest.config.ts` |
| JS/TS + Vite | Vitest | `npm i -D vitest` | `vitest.config.ts` |
| JS/TS Node puro | node:test | — (nativo desde Node 18) | — |
| PHP + Laravel | Pest | `composer require --dev pestphp/pest && php artisan pest:install` | scaffold do Pest |
| PHP outros | PHPUnit | `composer require --dev phpunit/phpunit` | `phpunit.xml` |
| Python | pytest (+ pytest-django / pytest-asyncio / httpx) | `pip install -U pytest ...` | `pytest.ini` |
| Go | testing (stdlib) | — | — |
| Rust | `#[test]` | — | — |
| JVM Spring Boot | JUnit 5 (spring-boot-starter-test) | normalmente já incluso — verificar `pom.xml`/`build.gradle` | — |
| JVM Quarkus | JUnit 5 + @QuarkusTest | normalmente já incluso — verificar | — |
| JVM genérico | JUnit 5 | adicionar `org.junit.jupiter:junit-jupiter` ao build file | — |
| .NET | xUnit | `dotnet add package xunit xunit.runner.visualstudio Microsoft.NET.Test.Sdk` | — |

## 2. Instalar (se necessário)

Para frameworks não-nativos: **confirme com o usuário antes de rodar o install** (ação de máquina). Rode o comando de install. Se built-in (Go, Rust, node:test), pule este passo.

## 3. Escrever o arquivo de config

Escreva o arquivo de config adaptado ao projeto real: caminhos corretos, ESM/CJS conforme o projeto, `environment: jsdom` para componentes de UI. Não coloque configuração genérica — leia a estrutura do projeto primeiro.

## 4. Escrever 1 teste REAL

Escolha **um módulo puro/determinístico** existente (util, helper, função de domínio — poucos imports, sem IO/rede/DB). Leia o código, entenda o comportamento e escreva 1 teste unitário genuíno cobrindo o caminho feliz + 1 caso de borda.

- Se nenhum módulo adequado existir, escreva um smoke test mínimo (piso garantido) e **diga explicitamente ao usuário** que é placeholder a ser substituído.

## 5. Fiar o script de teste

Garanta que o script de teste está declarado no manifesto do projeto (`package.json` `"test"`, `composer.json` `"scripts"."test"`, `Makefile` `test:`, etc.). Não duplique se já existir.

## 6. Rodar até verde

Rode o comando de teste. Corrija erros de config, paths e imports até a saída mostrar verde. **Mostre a saída real** (contagem de pass/fail) ao usuário. Se a instalação falhar (rede/permissão), reporte o comando exato para o usuário rodar manualmente e **não** alegue verde.

## 7. Reportar

Resuma o que foi feito: framework instalado, arquivo de config criado, arquivo de teste criado, saída verde. Lembre o usuário de revisar o teste gerado e expandir a cobertura para casos reais do projeto.
