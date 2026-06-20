---
paths:
  - "**/*"
---

# Design Patterns

## Objetivo

Usar design patterns apenas quando reduzirem complexidade real, melhorarem extensibilidade ou diminuírem acoplamento.

## Faça

- Prefira código direto quando o problema for simples.
- Use patterns somente quando houver necessidade concreta.
- Justifique implicitamente o pattern pela estrutura do problema.
- Use Strategy quando houver variações intercambiáveis de comportamento.
- Use Factory quando a criação de objetos tiver regra, variação ou complexidade.
- Use Adapter quando precisar isolar uma API externa, SDK, framework ou serviço.
- Use Repository para abstrair persistência, não para esconder regra de negócio.
- Use Dependency Injection para reduzir acoplamento e melhorar testabilidade.
- Use Observer ou eventos quando várias partes precisarem reagir a um acontecimento.
- Use Specification quando regras combináveis ficarem complexas.
- Use Decorator quando precisar adicionar comportamento sem alterar o objeto original.
- Use Facade quando precisar simplificar uma integração complexa.
- Use Command quando uma ação precisar ser representada, validada, enfileirada ou auditada.
- Mantenha a implementação do pattern simples e legível.
- Use nomes explícitos que revelem a intenção do pattern.
- Prefira composição em vez de herança quando possível.
- Preserve consistência com os patterns já usados no projeto.
- Remova patterns que não entregam mais benefício.

## Não faça

- Não aplique pattern por antecipação.
- Não use pattern apenas para deixar o código “mais arquitetural”.
- Não crie interfaces com uma única implementação sem motivo claro.
- Não crie factories para construtores simples.
- Não crie abstrações genéricas antes de existir variação real.
- Não use herança profunda para resolver problemas simples.
- Não esconda fluxo de execução atrás de muitas camadas.
- Não use Repository como lugar para regra de negócio.
- Não use Service como depósito genérico de qualquer lógica.
- Não crie managers, helpers ou utils genéricos sem responsabilidade clara.
- Não use eventos quando uma chamada direta for mais clara.
- Não use Strategy quando um simples condicional for suficiente e estável.
- Não complique testes por causa de pattern desnecessário.
- Não modifique a arquitetura inteira para encaixar um pattern.
- Não misture vários patterns sem necessidade.
- Não sacrifique legibilidade para seguir uma estrutura teórica.

## Critérios de aceitação

- O pattern resolve um problema real do código atual.
- A solução ficou mais simples de manter, testar ou estender.
- O fluxo continua fácil de entender.
- Não foram criadas camadas, interfaces ou classes desnecessárias.
- Existe consistência com o restante do projeto.
