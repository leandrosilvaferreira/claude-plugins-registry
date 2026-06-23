---
description: Verifica dependências obrigatórias do sistema (Node, Python, Go, etc.) antes de operações do harness.
argument-hint: "[path]"
allowed-tools:
  - Bash
---

# Verificar dependências do sistema

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

1. Rodar o checker:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

2. Detectar a plataforma do usuário a partir do campo `process.platform` no JSON
   (ou via `node -e "console.log(process.platform)"`).

3. Apresentar o relatório em português:
   - **Plataforma detectada:** darwin / linux / win32
   - Para cada dep em `checks[]`:
     - `✓ <name>  v<version>   <resolvedPath>` se `found: true`
     - `✗ <name>  não encontrado  [<level>]` + hint de instalação para a plataforma se `found: false`
   - **Status geral:** ok / warn / block

4. Se `status === "block"`:
   - Destacar as deps em `missing[]` e seus `installHint[platform]`
   - Informar que **nenhuma operação do harness pode continuar** até que sejam instaladas
   - Não executar nenhum próximo passo

5. Se `status === "ok"` ou `"warn"`:
   - Confirmar que o ambiente está pronto
   - Se `warn`: mencionar as deps recommended ausentes com seus hints, mas sem bloquear
