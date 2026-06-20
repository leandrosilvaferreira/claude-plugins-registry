---
paths:
  - "**/*"
---

# Testing

## Objetivo

Manter uma política forte de testes, garantindo segurança para evoluir o sistema sem quebrar comportamento existente.

## Faça

- Escreva testes para toda regra de negócio relevante.
- Escreva testes para todo bug corrigido.
- Escreva testes antes ou junto da alteração funcional.
- Priorize testes unitários para regras puras e decisões de domínio.
- Use testes de integração para banco, filas, cache, APIs externas simuladas e módulos conectados.
- Use testes end-to-end apenas para fluxos críticos do usuário ou negócio.
- Mantenha testes rápidos, determinísticos e fáceis de rodar.
- Teste comportamento, não detalhes internos de implementação.
- Cubra casos de sucesso, erro e borda.
- Cubra validações, permissões, estados inválidos e regras condicionais.
- Use nomes de testes que descrevam o comportamento esperado.
- Use fixtures, builders ou factories de teste quando reduzirem repetição.
- Use mocks apenas para fronteiras externas ou dependências lentas.
- Prefira dados de teste explícitos e fáceis de entender.
- Garanta isolamento entre testes.
- Evite dependência de ordem de execução.
- Evite dependência de horário atual, rede real ou serviços externos reais.
- Quando precisar de tempo atual, use clock injetável ou mecanismo equivalente.
- Quando precisar de serviços externos, use fake, stub, mock ou ambiente controlado.
- Atualize testes existentes quando o comportamento esperado mudar.
- Remova ou corrija testes obsoletos.
- Rode a suíte relevante antes de considerar a tarefa concluída.
- Se não for possível rodar testes, informe claramente o motivo e o risco.
- Para código crítico, inclua testes de regressão.
- Para integrações, teste falhas, timeouts, respostas inválidas e retries quando aplicável.

## Não faça

- Não entregue mudança funcional sem teste quando o projeto permitir testar.
- Não crie testes frágeis acoplados à implementação interna.
- Não teste apenas o caminho feliz.
- Não use mocks para tudo.
- Não faça testes dependerem de banco, rede ou filesystem real sem necessidade.
- Não deixe testes lentos na camada errada.
- Não ignore testes falhando.
- Não apague teste falhando sem entender o comportamento protegido.
- Não reduza cobertura de regra de negócio.
- Não crie asserts genéricos que não validam comportamento real.
- Não compartilhe estado mutável entre testes.
- Não deixe testes intermitentes.
- Não dependa de datas fixas que quebram com o tempo.
- Não use sleeps em testes salvo extrema necessidade.
- Não adicione snapshots grandes sem valor claro.
- Não esconda complexidade de setup que dificulta manutenção.

## Critérios de aceitação

- Toda regra de negócio alterada tem teste.
- Todo bug corrigido tem teste de regressão.
- Testes cobrem sucesso, erro e casos de borda relevantes.
- Testes são determinísticos e podem rodar repetidamente.
- A suíte relevante passa.
- Os testes validam comportamento observável, não detalhes internos.
