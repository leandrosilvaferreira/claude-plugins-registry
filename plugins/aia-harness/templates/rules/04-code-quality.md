---
paths:
  - "**/*"
---

# Code Quality

## Objetivo

Garantir código legível, consistente, seguro para manutenção e pronto para revisão.

## Faça

- Use nomes claros, semânticos e específicos.
- Nomeie funções pelo que elas fazem.
- Nomeie variáveis pelo que elas representam.
- Prefira funções pequenas e focadas.
- Prefira retornos explícitos.
- Trate erros de forma clara e rastreável.
- Inclua contexto útil em mensagens de erro.
- Use logs para diagnosticar fluxos importantes.
- Logue eventos relevantes, falhas externas e decisões críticas.
- Mantenha comentários apenas quando explicarem intenção, decisão ou regra não óbvia.
- Remova comentários obsoletos.
- Remova código morto.
- Remova imports, dependências e variáveis não utilizados.
- Mantenha formatação consistente com o projeto.
- Mantenha arquivos organizados por responsabilidade.
- Evite funções com muitos parâmetros.
- Use objetos, tipos ou estruturas nomeadas quando parâmetros ficarem ambíguos.
- Prefira tipos explícitos quando melhorarem clareza.
- Valide entradas em fronteiras do sistema.
- Mantenha comportamento previsível e fácil de depurar.
- Atualize documentação próxima ao código quando alterar comportamento relevante.
- Garanta que o código esteja pronto para code review.

## Não faça

- Não use nomes genéricos como data, info, item, obj ou manager sem contexto claro.
- Não escreva código esperto demais.
- Não oculte erro com catch vazio.
- Não retorne null, false ou string vazia para erro sem contexto.
- Não use comentários para explicar código confuso que deveria ser reescrito.
- Não deixe TODOs vagos.
- Não deixe console logs, prints ou debugs temporários.
- Não misture formatação com alteração funcional.
- Não crie arquivos grandes com responsabilidades múltiplas.
- Não crie funções longas com muitos níveis de indentação.
- Não duplique blocos relevantes de lógica.
- Não introduza dependência pesada para resolver problema simples.
- Não faça parsing, validação ou transformação crítica de forma silenciosa.
- Não ignore warnings relevantes.
- Não altere estilo do projeto sem necessidade.
- Não deixe código em estado parcialmente migrado.
- Não deixe comportamento importante sem teste quando houver política de testes.

## Critérios de aceitação

- O código é legível e direto.
- Nomes revelam intenção.
- Erros são tratados de forma explícita.
- Logs ajudam a diagnosticar sem gerar ruído excessivo.
- Não há código morto, debug temporário ou comentário obsoleto.
- A alteração está pronta para revisão.
