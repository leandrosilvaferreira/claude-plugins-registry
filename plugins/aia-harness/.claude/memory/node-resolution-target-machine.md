---
name: node-resolution-target-machine
description: Arquivos .mjs distribuídos ao projeto-alvo não podem assumir um único jeito de achar node — nativo, nvm ou fnm
metadata:
  type: architecture
---

Qualquer artifact `.mjs` que o harness escreve num projeto-alvo (hooks, `bin/`, scripts gerados) roda numa máquina que Claude não controla. Node ali pode estar instalado nativamente (no PATH do sistema), gerenciado via `nvm`, ou via `fnm` — os três são comuns e nenhum pode ser assumido sozinho.

**Why:** Cada gerenciador resolve o binário de forma diferente (nvm usa `~/.nvm/versions/node/*/bin`, fnm usa `~/.local/share/fnm` ou `%APPDATA%\fnm\...\node.exe` no Windows, nativo só está no PATH direto). Um hook que hardcoda um desses caminhos funciona na máquina de quem escreveu e falha silenciosamente — ou trava — na do usuário final.

**How to apply:** O padrão já usado no código é a referência — seguir, não reinventar:
- `lib/generate/verify.mjs` resolve o dir do node ativo via `path.dirname(process.execPath)` — funciona com qualquer gerenciador porque é o binário realmente em execução, não um caminho adivinhado.
- `lib/detect/system-deps.mjs` inclui candidatos de path específicos de `fnm` (inclusive `.exe` no Windows) na varredura de sistema.
- `lib/data/deps-catalog.mjs` (`INSTALL_HINTS`) oferece instruções tanto para instalação nativa quanto via `fnm`, por plataforma (`win32`/`darwin`/`linux`).

Ao criar um novo artifact `.mjs` que precisa localizar `node` em runtime na máquina-alvo: preferir `process.execPath` quando o próprio script já roda sob node; quando o artifact precisa descobrir node de fora (ex: outro hook invocando um binário), seguir a ordem de resolução já estabelecida em vez de hardcodar um único gerenciador. Ver [[cross-platform-artifacts]] para a regra irmã (formato do artifact) e [[node-runtime-nvm]] para a especificidade da máquina de dev atual (não confundir os dois: aquele é sobre esta máquina local, este é sobre a máquina-alvo onde o plugin é aplicado).
