---
name: cross-platform-artifacts
description: Todos os artefatos gerados/distribuídos pelo plugin devem ser .mjs e cross-platform (Windows/Mac/Linux) — nunca .sh
metadata:
  type: feedback
---

Todo artefato gerado pelo harness e distribuído a projetos-alvo deve ser `.mjs` (Node ESM), nunca `.sh` ou qualquer shell script.

**Why:** Shell scripts (`.sh`, `.bash`) não funcionam no Windows sem WSL. O plugin deve ser 100% cross-platform: Windows, macOS e Linux.

**How to apply:** Ao criar ou revisar qualquer artifact em `lib/plan.mjs`, `lib/generate/`, ou `templates/`: se o conteúdo é um script executável, ele deve ser `.mjs` usando `node`. Scripts `.sh` existentes (ex: `scripts/harness-install.sh`) devem ser removidos ou migrados para `.mjs`.
