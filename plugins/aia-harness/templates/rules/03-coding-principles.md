---
paths:
  - "**/*"
---

# Coding Principles

## Objetivo

Manter o código simples, coeso, testável, previsível e fácil de evoluir.

## Faça

- Prefira a solução mais simples que resolva o problema atual.
- Faça a menor alteração possível para atender ao pedido.
- Preserve comportamento existente quando não houver pedido explícito de mudança.
- Aplique KISS como padrão.
- Aplique YAGNI como padrão.
- Aplique DRY apenas para duplicação real de regra ou conceito.
- Aplique Single Responsibility Principle em funções, classes, módulos e arquivos.
- Mantenha baixo acoplamento e alta coesão.
- Separe responsabilidades de domínio, aplicação, infraestrutura e interface.
- Prefira composição em vez de herança.
- Escreva código explícito em vez de código implícito ou mágico.
- Use abstrações apenas quando elas reduzirem complexidade.
- Siga os padrões já existentes no projeto.
- Mantenha mudanças pequenas e fáceis de revisar.
- Refatore apenas o necessário para resolver o problema.
- Ao refatorar, preserve comportamento observável.
- Prefira dependências direcionadas para dentro, não para frameworks externos.
- Centralize regras de negócio que representam o mesmo conceito.
- Remova código morto relacionado à alteração.
- Mantenha compatibilidade com contratos públicos existentes, salvo instrução contrária.

## Não faça

- Não implemente funcionalidades futuras não solicitadas.
- Não crie camadas, interfaces, adapters ou factories sem necessidade concreta.
- Não aplique DRY em códigos apenas parecidos, mas com intenções diferentes.
- Não misture refatoração grande com mudança funcional.
- Não reescreva partes não relacionadas ao problema.
- Não introduza novo padrão quando o projeto já tiver solução consistente.
- Não crie funções, classes ou módulos com múltiplas responsabilidades.
- Não aumente acoplamento entre domínio e infraestrutura.
- Não transforme código simples em estrutura genérica demais.
- Não esconda dependências importantes.
- Não use variáveis globais ou estado compartilhado sem necessidade clara.
- Não duplique regra de negócio em múltiplas camadas.
- Não altere contratos públicos sem necessidade ou sem atualizar usos.
- Não ignore convenções do projeto.
- Não faça otimizações prematuras.
- Não deixe comportamento importante implícito ou difícil de rastrear.

## Critérios de aceitação

- A mudança é pequena, objetiva e fácil de revisar.
- O código segue o estilo e a arquitetura atual do projeto.
- A solução não adiciona complexidade sem benefício claro.
- Cada unidade de código tem responsabilidade clara.
- O comportamento existente foi preservado.
- O código pode ser entendido por outro desenvolvedor sem explicação externa.
