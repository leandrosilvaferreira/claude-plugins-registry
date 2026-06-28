---
name: publish-registry-command
description: Como fazer bump de versão e publicar o plugin aia-harness no registry
metadata: 
  node_type: memory
  type: reference
  originSessionId: b286d3f0-0173-4d1f-81b8-e52251689ed3
---

Comando para bump de versão e publicar o plugin:

```bash
BUMP=patch PUSH=Y TAG=Y REGISTRY_DIR=/Users/leandrosilvaferreira/Projetos/consultoria_harness/claude-plugins-registry npm run publish-registry
```

- `npm run publish-registry` → `node scripts/publish-to-registry.mjs`
- `BUMP` aceita: `patch` | `minor` | `major` | `skip` (sem env = interativo)
- `PUSH=Y` → push automático dos dois repos (aia_harness + claude-plugins-registry)
- `TAG=Y` → cria tag git no plugin repo
- `REGISTRY_DIR` → path absoluto do repo local do registry

**Why:** Script é interativo por padrão; sem env vars fecha stdin e usa "skip". Passar as vars evita prompts quebrados.

**How to apply:** Sempre que precisar publicar nova versão do plugin após merge na main.
