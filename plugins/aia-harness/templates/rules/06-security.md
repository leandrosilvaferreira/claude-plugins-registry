---
paths:
  - "**/*"
---

# Security

## Objetivo

Aplicar segurança por padrão em toda alteração, evitando vazamento de dados, falhas de autorização, validação insuficiente e exposição de segredos.

## Faça

- Valide entradas em todas as fronteiras do sistema.
- Trate toda entrada externa como não confiável.
- Use allowlist quando possível.
- Normalize e valide dados antes de processar.
- Faça encoding ou escaping adequado ao contexto de saída.
- Use queries parametrizadas ou mecanismos seguros do ORM.
- Verifique autenticação antes de acessar recursos protegidos.
- Verifique autorização no backend, não apenas na interface.
- Valide permissões por usuário, organização, tenant, papel ou escopo quando aplicável.
- Aplique menor privilégio em acessos, tokens, credenciais e serviços.
- Proteja dados sensíveis em logs, erros e respostas.
- Nunca exponha segredos, tokens, chaves privadas ou credenciais.
- Use variáveis de ambiente ou secret manager para segredos.
- Use mensagens de erro seguras para usuário final.
- Inclua contexto suficiente em logs internos sem vazar dados sensíveis.
- Proteja endpoints contra acesso indevido entre tenants.
- Valide ownership de recursos antes de ler, alterar ou excluir.
- Considere rate limit, idempotência e proteção contra abuso em endpoints críticos.
- Use criptografia adequada para dados sensíveis quando necessário.
- Não armazene senhas em texto puro.
- Use hashing de senha com algoritmo apropriado quando o projeto lidar com autenticação.
- Valide tamanho, tipo e conteúdo de uploads.
- Trate arquivos enviados como conteúdo não confiável.
- Evite execução dinâmica de código, comandos ou queries montadas por string.
- Revise dependências novas antes de adicioná-las.
- Prefira bibliotecas maduras e mantidas.
- Preserve trilhas de auditoria em ações sensíveis.
- Garanta que testes cubram autorização e isolamento de dados quando aplicável.

## Não faça

- Não confie em dados vindos do frontend.
- Não confie apenas em validação client-side.
- Não monte SQL, comandos shell, expressões ou paths com concatenação insegura.
- Não exponha stack trace para usuário final.
- Não logue senhas, tokens, documentos, chaves, cookies ou dados sensíveis.
- Não coloque segredos no código fonte.
- Não coloque segredos em arquivos versionados.
- Não ignore autorização porque o endpoint “já está escondido”.
- Não permita acesso a recurso apenas por ID sem validar ownership.
- Não use permissões amplas sem necessidade.
- Não adicione dependência desconhecida sem justificativa.
- Não desabilite validações de segurança para resolver erro rapidamente.
- Não ignore falhas de autenticação, autorização ou criptografia.
- Não salve dados sensíveis sem necessidade clara.
- Não retorne dados além do necessário.
- Não exponha detalhes internos de infraestrutura em mensagens públicas.
- Não aceite uploads sem limite e validação.
- Não use algoritmos criptográficos caseiros.
- Não trate segurança como etapa posterior.

## Critérios de aceitação

- Entradas externas são validadas.
- A autorização é verificada no backend.
- Não há vazamento de dados sensíveis em logs, erros ou respostas.
- Segredos não aparecem no código.
- Queries e comandos não são montados de forma insegura.
- Acesso entre tenants ou usuários é protegido.
- Mudanças críticas têm testes de permissão, validação e falha.
