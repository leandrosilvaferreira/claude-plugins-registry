---
name: cross-platform-artifacts
description: Todos os artefatos gerados/distribuídos pelo plugin devem ser .mjs e cross-platform (Windows/Mac/Linux) — nunca .sh/.cmd/.bat/.ps1/.py
metadata:
  type: feedback
---

Premissa de arquitetura do plugin inteiro (não só hooks): todo artefato gerado pelo harness e distribuído a projetos-alvo deve ser `.mjs` (Node ESM), portável, exigindo apenas `node` instalado. Nunca arquivos nativos ou limitados a um SO — `.sh`/`.bash`, `.cmd`/`.bat`, `.ps1`, ou `.py`.

**Why:** Shell scripts (`.sh`) não funcionam no Windows nativo sem WSL/Git Bash; `.cmd`/`.bat`/`.ps1` são Windows-only e não rodam em macOS/Linux; `.py` tem armadilha de path (`python`/`python3`, App Execution Alias) no Windows. `.mjs` + `node` é o único runtime que roda idêntico nas três plataformas. O plugin deve ser 100% cross-platform: Windows, macOS e Linux.

**How to apply:** Ao criar ou revisar qualquer artifact em `lib/plan.mjs`, `lib/generate/`, `scripts/`, `bin/`, ou `templates/`: se o conteúdo é um script executável, ele deve ser `.mjs` usando `node`, nunca outro runtime. Regra completa (shebang, `windowsHide`, `node:os`/`node:path`, proibição de `jq`/shell wrapper em `package.json`) em [.claude/rules/scripts-cross-platform.md](../rules/scripts-cross-platform.md). Ver também [[node-resolution-target-machine]] para como esses `.mjs` devem localizar o binário `node` em tempo de execução na máquina-alvo.
