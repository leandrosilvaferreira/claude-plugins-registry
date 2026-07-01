# Artefatos Next/Drizzle/shadcn extraídos do swapo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao `aia-harness` 6 rules path-scoped, 1 hook de guarda e 3 skills agênticas (migração Drizzle, regras ESLint, logging pino), destiladas e genéricas a partir do harness do projeto swapo, instaladas condicionalmente por stack detectada.

**Architecture:** Segue o pipeline `scan → plan → apply`. A detecção ganha o framework Drizzle e duas stack-keys novas (`drizzle`, `shadcn`). Os artefatos são registrados em `project-catalog.mjs` (catálogo first-party) e copiados por `copyFrom`. Skills são agênticas (rodadas como `/<name>`), sugeridas via `notes[]` do plano.

**Tech Stack:** Node ≥18, ESM puro (.mjs), JSDoc + `tsc --checkJs`, `node --test`, ESLint flat config. Conteúdo distribuído sob `templates/` (excluído de lint/typecheck).

## Global Constraints

- Toda fonte do engine é `.mjs` ESM com JSDoc — sem arquivos `.ts`, sem build step. (Arquivos `.ts` sob `templates/skills/*/reference/` são conteúdo scaffold, não engine — OK.)
- `lib/` é puro; IO só nas bordas (`detect` lê, `apply` escreve).
- **Asset catalog — manutenção obrigatória:** todo skill/hook/rule sob `templates/` que é distribuído DEVE ser registrado em `project-catalog.mjs` na mesma mudança.
- **Hook output schema compliance — obrigatório:** todo hook sob `templates/hooks/` precisa de teste `tests/hook-<name>.test.mjs` cobrindo TODOS os caminhos de saída, validado por `lib/validate/hook-schema.mjs`. Exit codes válidos: 0 e 2.
- **Erros de compilação/lint/typecheck:** corrigir TODOS antes de encerrar. `npm test` (typecheck + lint + unit) verde é o gate final.
- Um path registrado em `PROJECT_BY_STACK`/`PROJECT_HOOK_BY_STACK` exige arquivo existente no disco, senão `applyPlan` falha. **Criar arquivos antes de registrar.**
- Limite de tamanho de arquivo do harness: 350 linhas (alinhado ao large-file guard).
- Spec de referência: `docs/superpowers/specs/2026-06-21-swapo-nextjs-drizzle-artifacts-design.md`.

---

## File Structure

**Novos:**
- `templates/rules/next/api-security.md` — segurança de rotas API (rule, stack `next`)
- `templates/rules/drizzle/db-schema.md` — convenções de schema Drizzle (rule, stack `drizzle`)
- `templates/rules/drizzle/db-access.md` — acesso ao DB via repository (rule, stack `drizzle`)
- `templates/rules/shadcn/tsx-screen.md` — padrões de tela shadcn (rule, stack `shadcn`)
- `templates/rules/shadcn/mobile-first.md` — UI mobile-first (rule, stack `shadcn`)
- `templates/rules/react/form-validation.md` — formulários Zod+RHF (rule, stack `react`)
- `templates/hooks/block-drizzle-direct.mjs` — bloqueia push/drop diretos (hook, stack `drizzle`)
- `templates/skills/drizzle-migration-system/{SKILL.md, reference/{migrate.ts, migration-runner.ts, patch-migrations.ts}}`
- `templates/skills/nextjs-eslint-rules/{SKILL.md, reference/eslint-plugin-harness.mjs, reference/eslint.config.snippet.js}`
- `templates/skills/structured-logging-pino/{SKILL.md, reference/logger.ts}`
- `tests/hook-block-drizzle-direct.test.mjs` — compliance do hook

**Editados:**
- `lib/data/frameworks.mjs` — + entrada Drizzle
- `lib/data/stack-keys.mjs` — + keys `drizzle`, `shadcn`
- `lib/data/project-catalog.mjs` — registrar rules (T2), hook (T3), skills (T4/T5/T6)
- `lib/plan.mjs` — notes de sugestão (T7)
- `tests/detect-stacks.test.mjs` — casos drizzle/shadcn (T1)
- `tests/project-catalog.test.mjs` — casos rules (T2) + hook (T3)
- `tests/plan-apply.test.mjs` — caso de sugestão (T7), se aplicável
- `CLAUDE.md` — nota sobre nova stack-key drizzle no PROJECT_HOOK_BY_STACK (T8)

---

## Task 1: Detecção — framework Drizzle + stack-keys `drizzle`/`shadcn`

**Files:**
- Modify: `lib/data/frameworks.mjs` (após a linha do `node-postgres`, fim do array)
- Modify: `lib/data/stack-keys.mjs:30-33` (dentro do case TypeScript/JavaScript)
- Test: `tests/detect-stacks.test.mjs`

**Interfaces:**
- Consumes: `stackKeys(profile)` de `lib/data/stack-keys.mjs`; `profile.frameworks[].name`.
- Produces: stack-keys `"drizzle"` e `"shadcn"` retornadas por `stackKeys()` quando os frameworks `"Drizzle"` / `"shadcn/ui"` estão presentes. `FRAMEWORKS` passa a detectar `"Drizzle"` via deps `drizzle-orm`/`drizzle-kit`.

- [ ] **Step 1: Ler o teste de detecção existente para o padrão**

Run: `sed -n '1,40p' tests/detect-stacks.test.mjs`
Objetivo: confirmar como o teste monta profiles e chama `stackKeys`. (Se o arquivo importar de `lib/data/stack-keys.mjs` ou `asset-catalog.mjs`, manter o mesmo import.)

- [ ] **Step 2: Escrever os testes que falham**

Adicione ao fim de `tests/detect-stacks.test.mjs` (ajuste o `import { stackKeys }` se já existir no topo — não duplicar):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { stackKeys } from "../lib/data/stack-keys.mjs";

/** @param {string} lang @param {string[]} fws */
function prof(lang, fws = []) {
  return /** @type {any} */ ({ primaryLanguage: lang, frameworks: fws.map((n) => ({ name: n })) });
}

test("stackKeys: Drizzle present → 'drizzle' key", () => {
  const keys = stackKeys(prof("TypeScript", ["Next.js", "React", "Drizzle"]));
  assert.ok(keys.includes("drizzle"), `keys: ${keys}`);
});

test("stackKeys: no Drizzle → no 'drizzle' key", () => {
  const keys = stackKeys(prof("TypeScript", ["Next.js", "React"]));
  assert.ok(!keys.includes("drizzle"), `keys: ${keys}`);
});

test("stackKeys: shadcn/ui present → 'shadcn' key", () => {
  const keys = stackKeys(prof("TypeScript", ["React", "shadcn/ui"]));
  assert.ok(keys.includes("shadcn"), `keys: ${keys}`);
});

test("stackKeys: no shadcn → no 'shadcn' key", () => {
  const keys = stackKeys(prof("TypeScript", ["React"]));
  assert.ok(!keys.includes("shadcn"), `keys: ${keys}`);
});

test("stackKeys: Drizzle/shadcn only apply to JS/TS, not Go", () => {
  const keys = stackKeys(prof("Go", []));
  assert.ok(!keys.includes("drizzle") && !keys.includes("shadcn"), `keys: ${keys}`);
});
```

> Nota: se `tests/detect-stacks.test.mjs` já tem `import { test }`/`assert`, não redeclare — apenas acrescente os 5 `test(...)` e o helper `prof` (renomeie se colidir).

- [ ] **Step 3: Rodar os testes — devem falhar**

Run: `node --test tests/detect-stacks.test.mjs`
Expected: FAIL — `'drizzle'`/`'shadcn'` não estão nas keys (framework Drizzle não detectado; keys não emitidas).

- [ ] **Step 4: Adicionar o framework Drizzle ao catálogo**

Em `lib/data/frameworks.mjs`, ao final do array `FRAMEWORKS` (após a entrada `node-postgres`), adicione:

```js
  { name: "Drizzle", category: "meta", ecosystem: "js", deps: ["drizzle-orm", "drizzle-kit"] },
```

- [ ] **Step 5: Emitir as stack-keys**

Em `lib/data/stack-keys.mjs`, no case `"TypeScript"`/`"JavaScript"`, logo após a linha `if (has("Vue") || has("Nuxt")) keys.push("vue");`:

```js
      if (has("Drizzle")) keys.push("drizzle");
      if (has("shadcn/ui")) keys.push("shadcn");
```

- [ ] **Step 6: Rodar os testes — devem passar**

Run: `node --test tests/detect-stacks.test.mjs`
Expected: PASS (todos).

- [ ] **Step 7: Typecheck + lint dos arquivos editados**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add lib/data/frameworks.mjs lib/data/stack-keys.mjs tests/detect-stacks.test.mjs
git commit -m "feat(detect): add Drizzle framework + drizzle/shadcn stack-keys"
```

---

## Task 2: 6 rules path-scoped + registro no catálogo

**Files:**
- Create: `templates/rules/next/api-security.md`
- Create: `templates/rules/drizzle/db-schema.md`
- Create: `templates/rules/drizzle/db-access.md`
- Create: `templates/rules/shadcn/tsx-screen.md`
- Create: `templates/rules/shadcn/mobile-first.md`
- Create: `templates/rules/react/form-validation.md`
- Modify: `lib/data/project-catalog.mjs` (`PROJECT_BY_STACK`: react, next + novas keys drizzle, shadcn)
- Test: `tests/project-catalog.test.mjs`

**Interfaces:**
- Consumes: `selectProjectAssets(profile).rules` (lista de paths relativos a `templates/rules/`).
- Produces: rules instaladas em `.claude/rules/<path>` quando a stack casa. Registros novos em `PROJECT_BY_STACK`: `react.rules += "react/form-validation.md"`, `next.rules += "next/api-security.md"`, `drizzle = { rules: ["drizzle/db-schema.md","drizzle/db-access.md"] }`, `shadcn = { rules: ["shadcn/tsx-screen.md","shadcn/mobile-first.md"] }`.

- [ ] **Step 1: Criar `templates/rules/next/api-security.md`**

```markdown
---
description: Segurança de rotas de API Next.js — validação, autorização, anti over-fetch
paths:
  - "**/app/api/**/*.ts"
  - "**/pages/api/**/*.ts"
  - "**/middleware.ts"
---

# API Security — Validação e Autorização

Aplica-se a toda rota de API. Violações = risco de segurança.

## 1. Anti mass assignment — valide com Zod, campo por campo

Nunca passe o corpo cru da request direto ao banco.

```ts
// ❌ mass assignment
const body = await request.json();
await db.update(users).set(body).where(eq(users.id, id));

// ✅ valide e extraia campo por campo
const schema = z.object({ name: z.string().min(1), email: z.string().email() });
const parsed = schema.safeParse(await request.json());
if (!parsed.success) {
  return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
}
await db.update(users)
  .set({ name: parsed.data.name, email: parsed.data.email })
  .where(eq(users.id, id));
```

## 2. Anti over-fetching — Response só com os campos da view

A resposta da API é um DTO da tela, não o modelo rico do banco.

```ts
// ❌ vaza passwordHash, tokens, campos sensíveis
const user = await db.query.users.findFirst({ where: eq(users.id, id) });
return Response.json({ user });

// ✅ selecione só o necessário na fronteira da API
const user = await db.query.users.findFirst({
  where: eq(users.id, id),
  columns: { id: true, name: true, email: true },
});
return Response.json({ user });
```

O repository pode retornar o modelo completo; o route handler filtra antes de responder. Nunca envie `passwordHash`, tokens ou segredos ao cliente.

## 3. Autorização em toda rota protegida

Use um wrapper de auth (ex: `withAuth`/`withRole`) ou cheque a sessão no início do handler. Rotas de admin exigem verificação de papel.

```ts
export const POST = withAuth(async (request, { auth }) => { /* ... */ });
export const DELETE = withRole('admin')(async (request, { auth }) => { /* ... */ });

// ou check manual no topo
const session = await auth();
if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
```

Handler sem auth em rota protegida = falha crítica. Marque rotas públicas explicitamente.

## 4. Sem segredos hardcoded

```ts
// ❌ const apiKey = 'sk_live_...';
// ✅ const apiKey = process.env.PAYMENT_API_KEY;
```

Segredos em `.env.local` (dev) ou variáveis da plataforma (prod). Nunca commitar.

## 5. Valide query params e path params

```ts
// ❌ const id = params.id;
// ✅ const id = z.string().uuid().parse(params.id);
```

## 6. Acesso ao banco via repository

Route handlers chamam funções de repository, não montam queries acopladas à infra inline — preserva a fronteira de segurança e facilita auditoria. Ver a rule `db-access`.
```

- [ ] **Step 2: Criar `templates/rules/drizzle/db-schema.md`**

```markdown
---
description: Convenções de schema Drizzle + disciplina de migration idempotente
paths:
  - "**/db/schema/**/*.ts"
  - "**/schema.ts"
  - "**/schema/**/*.ts"
---

# DB Schema — Drizzle

## Design de schema

| Regra | Obrigatório |
|-------|-------------|
| Valores monetários | `integer` (centavos) ou `numeric(precision, scale)` — nunca `real`/`float` |
| Chave primária | UUID (`uuid().defaultRandom()`) para entidades de negócio; `serial` aceitável para tabelas internas |
| Timestamps | `createdAt` + `updatedAt` (`timestamp`) em toda tabela de domínio |
| Enums | `pgEnum` com valores em `SCREAMING_SNAKE_CASE` |
| Tipos TypeScript | `table.$inferSelect` / `table.$inferInsert` — nunca interface manual duplicada |
| Índices | declare em colunas usadas em `WHERE`/`JOIN`/`ORDER BY` |
| Relações | declare `relations()` para todo FK — habilita joins type-safe via `with` |

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  status: userStatus('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('users_email_idx').on(t.email)]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

## Antes de gerar migration

- **Aditivo primeiro**: adicione coluna/tabela nova antes de alterar ou remover existente.
- Mudança destrutiva (drop/alter de coluna): avalie o raio de impacto — quem lê essa coluna?
- Gere e torne idempotente: `npm run db:generate`.

## SQL idempotente (obrigatório)

Migrations são imutáveis após commit (hash verificado no deploy). DDL não-idempotente = erro de produção. Toda migration deve sobreviver a re-execução:

| Padrão | Status |
|--------|--------|
| `CREATE TABLE IF NOT EXISTS` | ✅ |
| `ADD COLUMN IF NOT EXISTS` | ✅ |
| `CREATE [UNIQUE] INDEX IF NOT EXISTS` | ✅ |
| `DROP ... IF EXISTS` | ✅ |
| `CREATE TYPE ... AS ENUM` dentro de `DO $$ ... EXCEPTION WHEN duplicate_object` | ✅ |
| `ALTER TYPE ... ADD VALUE IF NOT EXISTS` | ✅ |
| `ALTER COLUMN ... SET DATA TYPE` | ⚠️ sem `IF EXISTS` — revisar manualmente |

A skill `/drizzle-migration-system` instala um runner que aplica essas garantias automaticamente.

## Nunca commitar migration sem validar

Inspecione cada `.sql` gerado antes de commitar. Migration não-commitada pode ser regerada; commitada é imutável.
```

- [ ] **Step 3: Criar `templates/rules/drizzle/db-access.md`**

```markdown
---
description: Acesso ao banco via repository — SELECT explícito, paginação, transações por driver
paths:
  - "**/*-repository.ts"
  - "**/repositories/**/*.ts"
  - "**/db/**/*.ts"
---

# DB Access — Repository

Acesso ao banco fica em arquivos de repository (`*-repository.ts` ou `repositories/`). Componentes, páginas e route handlers chamam o repository — nunca montam queries acopladas à infra.

## Queries

| Regra | Proibido | Correto |
|-------|----------|---------|
| Colunas | `db.select()` sem `columns` | `db.select({ id: t.id, name: t.name })` ou `columns: { id: true }` |
| Tipos | interface manual duplicada | `$inferSelect` / `$inferInsert` |
| Joins | queries em loop (N+1) | Drizzle relations (`with: {}`) |

## Paginação

```ts
const [rows, [{ count }]] = await Promise.all([
  db.select({ id: t.id, name: t.name }).from(t).limit(limit).offset(offset),
  db.select({ count: sql<number>`count(*)` }).from(t),
]);
```

## Transações — depende do driver

- **Driver TCP** (`postgres.js`, `node-postgres`): use `db.transaction()` para agrupar escritas que precisam ser atômicas.
- **Neon HTTP serverless** (`drizzle-orm/neon-http`): NÃO suporta transações (`No transactions support in neon-http driver`). Use execução sequencial — mutação primária primeiro; secundária (audit/log) em `try/catch` isolado que não reverte a primária. Atomicidade complexa: saga com compensação explícita.

```ts
// Neon HTTP — execução sequencial
await db.update(t).set({ field }).where(eq(t.id, id)); // primária (propaga se falhar)
try {
  await db.insert(auditLog).values({ /* ... */ });     // secundária (falha isolada)
} catch (err) {
  log.error({ err }, 'audit log falhou — mutação primária já persistida');
}
```

## Acesso de camada

`db` importado apenas em repositories — nunca em componentes/páginas/services. A rule `no-direct-db-access` da skill `/nextjs-eslint-rules` força isso.
```

- [ ] **Step 4: Criar `templates/rules/shadcn/tsx-screen.md`**

```markdown
---
description: Padrões de tela React/Next com shadcn/ui — componentes, estados, estrutura
paths:
  - "**/app/**/page.tsx"
  - "**/*.tsx"
---

# Tela TSX — Padrões com shadcn/ui

## 1. shadcn/ui primeiro

| Decisão | Ação |
|---------|------|
| Componente existe em `components/ui/` | use via alias (ex: `@/components/ui/*`) |
| Existe no registry, não instalado | `npx shadcn@latest add <name>` |
| Tabela de dados | `<Table>` do shadcn — nunca `<table>` nativo |
| Overlay | `<Dialog>`/`<Drawer>` do shadcn, responsivo |

Não recrie do zero o que o shadcn oferece. Se houver MCP do shadcn disponível, use o fluxo search → view → examples → add → audit antes de implementar UI.

## 2. Acesso ao backend

```tsx
// ❌ fetch direto espalhado
const res = await fetch('/api/users');

// ✅ cliente centralizado + React Query
const { data, isLoading, error } = useQuery({
  queryKey: ['users', id],
  queryFn: () => api.get(`/users/${id}`).then((r) => r.data),
});
```

Query keys: constantes, nunca string literal espalhada.

## 3. Quatro estados em toda tela com dados

```tsx
if (error) return <ErrorState onRetry={refetch} />;
if (isLoading) return <FeatureSkeleton />;   // Skeleton, não null/spinner
if (data.length === 0) return <EmptyState />;
return <DataView data={data} />;
```

## 4. Design tokens — nunca cores hardcoded

```tsx
// ❌ <div className="bg-red-500 text-white">
// ✅ <div className="bg-destructive text-destructive-foreground">
```

Use os tokens do tema (CSS variables do shadcn/Tailwind): `background`, `foreground`, `primary`, `muted`, `destructive`, etc.

## 5. Tabelas

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
```

- Paginação server-side — nunca carregar tudo e paginar no cliente.
- Empty state dentro de `<TableBody>` com `<TableCell colSpan={n}>`.
- Responsiva: tabela no desktop (`hidden lg:block`), cards no mobile (`lg:hidden`).

## 6. Estrutura de feature

```
app/{section}/{feature}/
├── page.tsx          ← wrapper fino (sem lógica)
└── _components/      ← componentes da feature
```

```tsx
// page.tsx — fino
import FeaturePage from './_components/feature-page';
export default function Page() { return <FeaturePage />; }
```

- Máx ~350 linhas por arquivo — extraia componentes ao ultrapassar.
- Schemas Zod fora do `.tsx` (arquivo de validação co-localizado ou `lib/validators/`).
- Componentes não importam a camada de DB/infra diretamente.

## 7. Interatividade e mobile

- `cursor-pointer` em elementos clicáveis; `hover:` com `transition-colors`.
- Mobile-first (ver rule `mobile-first`): base mobile, escale com `md:`/`lg:`.
- i18n: sem strings hardcoded se o projeto usa i18n.
```

- [ ] **Step 5: Criar `templates/rules/shadcn/mobile-first.md`**

```markdown
---
description: UI mobile-first com Tailwind/shadcn — breakpoints, tap targets, responsivo
paths:
  - "**/*.tsx"
---

# Mobile-First — UI/UX

Parta do mobile e escale para desktop.

## Princípio

```tsx
// ✅ mobile base, escala com md:/lg:
<div className="flex flex-col gap-4 md:flex-row md:gap-6">

// ❌ desktop-first com max-md: para sobrescrever
<div className="flex flex-row gap-6 max-md:flex-col">
```

Nunca use `max-md:`/`max-sm:` — use `sm:`/`md:`/`lg:` para escalar a partir do mobile.

## Breakpoints (Tailwind)

| Prefixo | Largura | Uso |
|---------|---------|-----|
| (base) | < 640px | mobile |
| `sm:` | ≥ 640px | mobile grande |
| `md:` | ≥ 768px | tablet |
| `lg:` | ≥ 1024px | desktop |
| `xl:` | ≥ 1280px | desktop grande |

## Tap targets

```tsx
// ✅ mínimo 44×44px em interativos
<Button className="h-11 px-6">Confirmar</Button>
// ❌ pequeno demais no touch
<Button className="h-8 px-3">Confirmar</Button>
```

## Padrões responsivos

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">  {/* cards */}
<h1 className="text-xl md:text-3xl font-bold">                          {/* texto */}
<div className="px-4 md:px-6 lg:px-8">                                  {/* padding */}
```

## Overlays no mobile

`<Tooltip>`/`<HoverCard>` não funcionam no touch. Prefira drawer/sheet do shadcn no mobile e dialog no desktop (padrão responsivo). Evite `<ContextMenu>` (requer right-click).

## Verificar em

320px (menor), 768px (`md:`), 1280px (desktop). Use o responsive mode do DevTools.
```

- [ ] **Step 6: Criar `templates/rules/react/form-validation.md`**

```markdown
---
description: Formulários React — Zod + React Hook Form ou Server Actions, validação front+back
paths:
  - "**/*.tsx"
---

# Form Validation — React

## Dois padrões

| Padrão | Quando | Validação |
|--------|--------|-----------|
| A — Server Action + `useActionState` | mutações simples | servidor (Zod na action) |
| B — Client + React Hook Form | máscaras, preview, lógica condicional | cliente (Zod + zodResolver) + servidor (Zod na API) |

## Padrão A — Server Action

```tsx
// page.tsx
'use client';
const [state, action, isPending] = useActionState(registerUser, null);
<form action={action}>
  {state?.error && <p className="text-destructive text-xs">{state.error}</p>}
  <Input name="email" type="email" maxLength={120} required />
  <Button type="submit" disabled={isPending}>{isPending ? 'Enviando…' : 'Enviar'}</Button>
</form>
```

```ts
// actions.ts
'use server';
export async function registerUser(_prev: unknown, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // ...
  return { success: true };
}
```

## Padrão B — React Hook Form + Zod

```ts
// feature.validation.ts (co-localizado, fora do .tsx)
export const featureSchema = z.object({
  amount: z.number().positive(),
  description: z.string().min(3).max(100),
});
export type FeatureFormData = z.infer<typeof featureSchema>;
```

```tsx
const form = useForm<FeatureFormData>({
  resolver: zodResolver(featureSchema),
  mode: 'onBlur', // valida ao sair do campo
});
const mutation = useMutation({
  mutationFn: (data: FeatureFormData) => api.post('/feature', data),
  onSuccess: () => { toast.success('Salvo'); queryClient.invalidateQueries({ queryKey: ['feature'] }); },
  onError: () => toast.error('Erro ao salvar'),
});
```

## Regras

- Erro de **campo** (validação) → inline, abaixo do campo (`<FormMessage />`). Nunca toast.
- Erro de **API/rede** → toast.
- Schema Zod nunca dentro do `.tsx` — arquivo de validação co-localizado ou `lib/validators/`.
- `mode: 'onBlur'` — valida ao sair do campo, não a cada tecla.
- Submit: `disabled={isPending}` + feedback (texto/spinner).
- Sucesso: toast + `invalidateQueries` para refrescar.
- Valide no cliente E no servidor — cliente é UX, servidor é segurança.
```

- [ ] **Step 7: Registrar as rules no `PROJECT_BY_STACK`**

Em `lib/data/project-catalog.mjs`, atualize as linhas `react` e `next`, e adicione `drizzle` e `shadcn`. Substitua:

```js
  "react":        { agents: [], skills: [],                    rules: ["react/coding-standards.md"] },
  "next":         { agents: [], skills: [],                    rules: ["next/coding-standards.md"] },
```

por:

```js
  "react":        { agents: [], skills: [],                    rules: ["react/coding-standards.md", "react/form-validation.md"] },
  "next":         { agents: [], skills: [],                    rules: ["next/coding-standards.md", "next/api-security.md"] },
  "drizzle":      { agents: [], skills: [],                    rules: ["drizzle/db-schema.md", "drizzle/db-access.md"] },
  "shadcn":       { agents: [], skills: [],                    rules: ["shadcn/tsx-screen.md", "shadcn/mobile-first.md"] },
```

> As skills dessas keys serão preenchidas nas tasks 4/5/6. Não adicione skills agora (os diretórios ainda não existem).

- [ ] **Step 8: Escrever os testes de catálogo (rules)**

Adicione ao fim de `tests/project-catalog.test.mjs`:

```js
test("Drizzle stack includes db-schema and db-access rules", () => {
  const a = selectProjectAssets(profile("TypeScript", ["Next.js", "React", "Drizzle"]));
  assert.ok(a.rules.includes("drizzle/db-schema.md"), `rules: ${a.rules}`);
  assert.ok(a.rules.includes("drizzle/db-access.md"), `rules: ${a.rules}`);
});

test("shadcn stack includes tsx-screen and mobile-first rules", () => {
  const a = selectProjectAssets(profile("TypeScript", ["React", "shadcn/ui"]));
  assert.ok(a.rules.includes("shadcn/tsx-screen.md"), `rules: ${a.rules}`);
  assert.ok(a.rules.includes("shadcn/mobile-first.md"), `rules: ${a.rules}`);
});

test("Next.js stack includes api-security rule", () => {
  const a = selectProjectAssets(profile("TypeScript", ["Next.js"]));
  assert.ok(a.rules.includes("next/api-security.md"), `rules: ${a.rules}`);
});

test("React stack includes form-validation rule", () => {
  const a = selectProjectAssets(profile("TypeScript", ["React"]));
  assert.ok(a.rules.includes("react/form-validation.md"), `rules: ${a.rules}`);
});

test("plain Next.js without Drizzle/shadcn does NOT include their rules", () => {
  const a = selectProjectAssets(profile("TypeScript", ["Next.js", "React"]));
  assert.ok(!a.rules.includes("drizzle/db-schema.md"), `rules: ${a.rules}`);
  assert.ok(!a.rules.includes("shadcn/tsx-screen.md"), `rules: ${a.rules}`);
});

test("every catalogued first-party rule file exists on disk", () => {
  const all = allProjectAssets();
  for (const r of all.rules) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "templates", "rules", r)), `missing templates/rules/${r}`);
  }
});
```

> `profile`, `selectProjectAssets`, `allProjectAssets`, `fs`, `path`, `REPO_ROOT` já estão importados/definidos no topo de `tests/project-catalog.test.mjs` (confirmado). Não reimporte.

- [ ] **Step 9: Rodar os testes — devem passar**

Run: `node --test tests/project-catalog.test.mjs`
Expected: PASS (novos + existentes).

- [ ] **Step 10: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros. (`templates/` é ignorado pelo lint/typecheck — os `.md` não são checados.)

- [ ] **Step 11: Commit**

```bash
git add templates/rules/ lib/data/project-catalog.mjs tests/project-catalog.test.mjs
git commit -m "feat(rules): add next/drizzle/shadcn/react path-scoped rules from swapo"
```

---

## Task 3: Hook `block-drizzle-direct` + compliance test + registro

**Files:**
- Create: `templates/hooks/block-drizzle-direct.mjs`
- Create: `tests/hook-block-drizzle-direct.test.mjs`
- Modify: `lib/data/project-catalog.mjs` (`PROJECT_HOOK_BY_STACK` + const `DRIZZLE_HOOKS`)
- Test: `tests/project-catalog.test.mjs` (wiring)

**Interfaces:**
- Consumes: `event.tool_input.command` (stdin JSON); `selectProjectHooks(profile)`.
- Produces: hook que faz exit 2 (block) em `drizzle-kit push|drop` / `db:push|db:drop`, exit 0 caso contrário. `PROJECT_HOOK_BY_STACK["drizzle"]` wira o hook em `PreToolUse`/matcher `Bash` via `node-run.sh`.

- [ ] **Step 1: Escrever o hook**

Criar `templates/hooks/block-drizzle-direct.mjs`:

```js
#!/usr/bin/env node
/**
 * PreToolUse guard: hard-blocks (exit 2) destructive Drizzle schema operations
 * run directly against the database — `drizzle-kit push` / `drizzle-kit drop`
 * and their npm/pnpm/yarn script equivalents (`db:push`, `db:drop`).
 *
 * These bypass versioned migration files: `push` syncs the schema straight to
 * the DB with no migration history (data-loss risk in production); `drop` deletes
 * objects. The safe migration-file workflow (`db:generate` → `db:migrate`) is
 * NOT blocked.
 *
 * Shipped by aia-harness to Drizzle projects. Wire under PreToolUse / matcher
 * "Bash". Fail-open on any I/O or parse error (exit 0).
 */
import fs from "node:fs";

/** @returns {string} */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @type {any} */
let event = {};
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}

const command = /** @type {string} */ (event?.tool_input?.command ?? "");
if (!command || typeof command !== "string") process.exit(0);

// `drizzle-kit push|drop` (any flags) OR a package script named db:push / db:drop.
const dangerous =
  /\bdrizzle-kit\s+(push|drop)\b/.test(command) || /\bdb:(push|drop)\b/.test(command);
if (!dangerous) process.exit(0);

process.stderr.write(
  `block-drizzle-direct: blocked a direct Drizzle schema operation.\n` +
    `\n` +
    `Command: ${command}\n` +
    `\n` +
    `\`drizzle-kit push\`/\`drop\` change the database schema directly, bypassing\n` +
    `versioned migration files — no history, data-loss risk in production.\n` +
    `\n` +
    `Use the migration-file workflow instead:\n` +
    `  1. Edit the schema, then generate a migration:  npm run db:generate\n` +
    `  2. Review the generated SQL under drizzle/\n` +
    `  3. Apply it:                                    npm run db:migrate\n` +
    `\n` +
    `If you truly need to push (throwaway/local DB only), run it in a terminal\n` +
    `outside the agent.\n`,
);
process.exit(2);
```

- [ ] **Step 2: Escrever o teste de compliance que falha**

Criar `tests/hook-block-drizzle-direct.test.mjs`:

```js
/**
 * Schema compliance tests for templates/hooks/block-drizzle-direct.mjs
 *
 * Exercises EVERY output path and validates stdout + exit code against the
 * PreToolUse schema in lib/validate/hook-schema.mjs.
 *
 * Run: node --test tests/hook-block-drizzle-direct.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw } from "./hook-runner.mjs";
import { validatePreToolUseOutput } from "../lib/validate/hook-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "templates", "hooks", "block-drizzle-direct.mjs");

/** Allowed → exit 0, schema-valid, empty stdout (pass through). */
function assertAllow(/** @type {import("./hook-runner.mjs").HookResult} */ { stdout, exitCode }) {
  const r = validatePreToolUseOutput(stdout, exitCode);
  assert.equal(r.valid, true, `Schema invalid: ${r.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), "", "expected empty stdout (pass through)");
}

/** Blocked → exit 2, schema-valid. */
function assertBlock(/** @type {import("./hook-runner.mjs").HookResult} */ { stdout, exitCode }) {
  const r = validatePreToolUseOutput(stdout, exitCode);
  assert.equal(r.valid, true, `Schema invalid: ${r.errors.join("; ")}`);
  assert.equal(exitCode, 2);
}

// Path 1: invalid / empty stdin → pass through (fail-open)
test("empty stdin → allow", () => assertAllow(runHookRaw(HOOK, "")));
test("invalid JSON stdin → allow", () => assertAllow(runHookRaw(HOOK, "not-json{{{")));

// Path 2: no command / non-dangerous commands → pass through
test("missing command → allow", () => assertAllow(runHook(HOOK, { tool_input: {} })));
test("npm run build → allow", () => assertAllow(runHook(HOOK, { tool_input: { command: "npm run build" } })));

// Path 3: SAFE migration commands → pass through
test("drizzle-kit migrate → allow", () =>
  assertAllow(runHook(HOOK, { tool_input: { command: "npx drizzle-kit migrate" } })));
test("npm run db:migrate → allow", () =>
  assertAllow(runHook(HOOK, { tool_input: { command: "npm run db:migrate" } })));
test("npm run db:generate → allow", () =>
  assertAllow(runHook(HOOK, { tool_input: { command: "npm run db:generate" } })));

// Path 4: DANGEROUS direct ops → block (exit 2)
test("drizzle-kit push → block", () =>
  assertBlock(runHook(HOOK, { tool_input: { command: "npx drizzle-kit push" } })));
test("drizzle-kit push --force → block", () =>
  assertBlock(runHook(HOOK, { tool_input: { command: "npx drizzle-kit push --force" } })));
test("drizzle-kit drop → block", () =>
  assertBlock(runHook(HOOK, { tool_input: { command: "npx drizzle-kit drop" } })));
test("npm run db:push → block", () =>
  assertBlock(runHook(HOOK, { tool_input: { command: "npm run db:push" } })));
test("pnpm db:push → block", () =>
  assertBlock(runHook(HOOK, { tool_input: { command: "pnpm db:push" } })));
test("yarn db:drop → block", () =>
  assertBlock(runHook(HOOK, { tool_input: { command: "yarn db:drop" } })));
```

- [ ] **Step 3: Rodar o teste — deve passar (hook já existe)**

Run: `node --test tests/hook-block-drizzle-direct.test.mjs`
Expected: PASS. (Se algum FAIL, ajustar o hook — não os testes — até verde.)

- [ ] **Step 4: Registrar o hook no `PROJECT_HOOK_BY_STACK`**

Em `lib/data/project-catalog.mjs`, após a const `PHP_HOOKS` (antes de `PROJECT_HOOK_BY_STACK`), adicione:

```js
/** Block direct `drizzle-kit push`/`drop` — force the migration-file workflow. */
const DRIZZLE_HOOKS = /** @type {ProjectHookDef[]} */ ([
  { file: "block-drizzle-direct.mjs", event: "PreToolUse", matcher: "Bash", timeout: 10 },
]);
```

e atualize o objeto `PROJECT_HOOK_BY_STACK`:

```js
export const PROJECT_HOOK_BY_STACK = {
  "php": PHP_HOOKS,
  "php-laravel": PHP_HOOKS,
  "php-adianti": PHP_HOOKS,
  "drizzle": DRIZZLE_HOOKS,
};
```

- [ ] **Step 5: Escrever o teste de wiring do hook**

Adicione ao fim de `tests/project-catalog.test.mjs`:

```js
test("selectProjectHooks wires block-drizzle-direct on a Drizzle stack", () => {
  const h = selectProjectHooks(profile("TypeScript", ["Next.js", "React", "Drizzle"]));
  assert.ok(h.files.includes("block-drizzle-direct.mjs"), `files: ${h.files}`);
  const cmds = (h.settings.PreToolUse ?? []).flatMap((/** @type {any} */ e) =>
    e.hooks.map((/** @type {any} */ x) => x.command),
  );
  assert.ok(cmds.some((c) => /block-drizzle-direct\.mjs/.test(c)), "PreToolUse must wire the hook");
  assert.ok(cmds.some((c) => /node-run\.sh/.test(c)), "must run through the node-run wrapper");
  const entry = (h.settings.PreToolUse ?? [])[0];
  assert.equal(entry.matcher, "Bash");
});

test("selectProjectHooks: non-Drizzle TS stack gets no drizzle hook", () => {
  const h = selectProjectHooks(profile("TypeScript", ["Next.js", "React"]));
  assert.ok(!h.files.includes("block-drizzle-direct.mjs"), `files: ${h.files}`);
});
```

> `selectProjectHooks` já está importado no topo de `tests/project-catalog.test.mjs`. O teste existente "every PROJECT_HOOK_BY_STACK file exists under templates/hooks" passa a cobrir `block-drizzle-direct.mjs` automaticamente.

- [ ] **Step 6: Rodar os testes — devem passar**

Run: `node --test tests/project-catalog.test.mjs tests/hook-block-drizzle-direct.test.mjs`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add templates/hooks/block-drizzle-direct.mjs tests/hook-block-drizzle-direct.test.mjs lib/data/project-catalog.mjs tests/project-catalog.test.mjs
git commit -m "feat(hooks): add block-drizzle-direct guard for Drizzle stacks"
```

---

## Task 4: Skill `drizzle-migration-system`

**Files:**
- Create: `templates/skills/drizzle-migration-system/SKILL.md`
- Create: `templates/skills/drizzle-migration-system/reference/migrate.ts`
- Create: `templates/skills/drizzle-migration-system/reference/migration-runner.ts`
- Create: `templates/skills/drizzle-migration-system/reference/patch-migrations.ts`
- Modify: `lib/data/project-catalog.mjs` (`drizzle` key → skills)
- Test: `tests/skill-drizzle-migration-system.test.mjs` (novo)

**Interfaces:**
- Consumes: `selectProjectAssets(profile).skills`.
- Produces: skill instalada em `.claude/skills/drizzle-migration-system/`, registrada em `PROJECT_BY_STACK["drizzle"].skills`. Reference files são ports genéricos dos arquivos swapo.

**Fonte (disponível em disco agora):** `/Users/leandrosilvaferreira/Projetos/swapo/swapo-app/src/db/{migrate,migration-runner,patch-migrations}.ts`.

- [ ] **Step 1: Port `reference/migration-runner.ts`**

Copie verbatim de `swapo-app/src/db/migration-runner.ts` com 1 edição: remover o comentário `// eslint-disable-line swapo/no-direct-console` da linha do `console.log('  ✔ applied: ...')` (deixe só `console.log(...)`). Nenhum acoplamento swapo presente — o módulo é genérico (usa `drizzle-orm/migrator` + `postgres`). Conteúdo final:

```ts
/**
 * Hash-based migration runner — replaces Drizzle's default migrate().
 *
 * Drizzle's default migrate() decides what to apply by timestamp
 * (created_at DESC LIMIT 1), forever ignoring any migration whose folderMillis
 * is lower than the last applied one. This runner applies ANY migration whose
 * hash is not yet in drizzle.__drizzle_migrations, in journal order
 * (folderMillis asc) — independent of timestamp.
 *
 * NOTE: readMigrationFiles is a semi-internal API of drizzle-orm/migrator.
 * Re-validate its signature on drizzle-orm upgrades (currently: MigrationMeta[]).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

export type ReadMigrationFilesFn = (config: { migrationsFolder: string }) => MigrationMeta[];
export type LoadJournalTagsFn = (migrationsFolder: string) => Map<number, string>;

export type MigrationRunnerDeps = {
    readFiles?: ReadMigrationFilesFn;
    loadTags?: LoadJournalTagsFn;
};

export class MigrationApplyError extends Error {
    readonly tag: string;
    readonly hash: string;

    constructor(tag: string, hash: string, options: { cause: unknown }) {
        const causeMsg = options.cause instanceof Error ? options.cause.message : String(options.cause);
        super(`Migration "${tag}" failed: ${causeMsg}`);
        this.name = 'MigrationApplyError';
        this.tag = tag;
        this.hash = hash;
        this.cause = options.cause;
    }
}

type JournalEntry = { when: number; tag: string };
type Journal = { entries: JournalEntry[] };

function shortHash(hash: string): string {
    return hash.slice(0, 8);
}

export function loadJournalTags(migrationsFolder: string): Map<number, string> {
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    try {
        const raw = fs.readFileSync(journalPath, 'utf-8');
        const journal = JSON.parse(raw) as Journal;
        return new Map(journal.entries.map((e) => [e.when, e.tag]));
    } catch (err) {
        throw new MigrationApplyError('_journal', '', { cause: err });
    }
}

function resolveTag(migration: MigrationMeta, journalTags: Map<number, string>): string {
    return journalTags.get(migration.folderMillis) ?? shortHash(migration.hash);
}

export async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
    await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
    await sql`
        CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
            id      serial primary key,
            hash    text not null,
            created_at bigint
        )
    `;
}

export async function getAppliedHashes(sql: postgres.Sql): Promise<Set<string>> {
    const rows = await sql<{ hash: string }[]>`
        SELECT hash FROM drizzle."__drizzle_migrations"
    `;
    return new Set(rows.map((r) => r.hash));
}

export async function applyMigration(sql: postgres.Sql, migration: MigrationMeta): Promise<void> {
    await sql.begin(async (tx) => {
        for (const stmt of migration.sql) {
            await tx.unsafe(stmt);
        }
        await tx.unsafe(
            `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
            [migration.hash, migration.folderMillis],
        );
    });
}

export async function applyPendingMigrations(
    sql: postgres.Sql,
    migrationsFolder: string,
    deps: MigrationRunnerDeps = {},
): Promise<{ applied: number; skipped: number }> {
    const readFiles = deps.readFiles ?? readMigrationFiles;
    const getTags = deps.loadTags ?? loadJournalTags;

    await ensureMigrationsTable(sql);

    const migrations = readFiles({ migrationsFolder });
    const applied = await getAppliedHashes(sql);
    const journalTags = getTags(migrationsFolder);

    let appliedCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
        if (applied.has(migration.hash)) {
            skippedCount++;
            continue;
        }

        const tag = resolveTag(migration, journalTags);

        try {
            await applyMigration(sql, migration);
        } catch (err) {
            throw new MigrationApplyError(tag, migration.hash, { cause: err });
        }

        console.log(`  ✔ applied: ${tag} (${shortHash(migration.hash)})`);
        appliedCount++;
    }

    return { applied: appliedCount, skipped: skippedCount };
}
```

- [ ] **Step 2: Port `reference/migrate.ts` (genérico, sem pre-exec-enum)**

Versão genérica — remove o passo `preExecEnumValues` (a idempotência de enum é garantida pelo patch-migrations), remove o logging de Redis e os `eslint-disable` swapo:

```ts
/**
 * Hash-based migration entry point. Usage: npx tsx src/db/migrate.ts
 *
 * Loads .env, connects with retry, then applies any migration whose hash is not
 * yet recorded. Enum idempotency is handled at SQL level by patch-migrations.ts.
 */
import * as dotenv from 'dotenv';
import { expand } from 'dotenv-expand';
import postgres from 'postgres';
import { applyPendingMigrations, MigrationApplyError } from './migration-runner';

expand(dotenv.config({ path: '.env' }));

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;
const MIGRATIONS_FOLDER = './drizzle';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Prefer an unpooled/direct connection for migrations when available.
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
}
console.log(`📡 Connecting: ${connectionString.replace(/:[^:@]+@/, ':***@')}`);

const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

const runMigrations = async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const sql = postgres(connectionString, {
            max: 1,
            ssl: isLocal ? false : 'require',
            onnotice: (notice) => {
                if (notice.severity === 'NOTICE') return;
                console.log(`[PG ${notice.severity}] ${notice.message}`);
            },
        });

        try {
            console.log(`🔄 Running hash-based migrations... (attempt ${attempt}/${MAX_RETRIES})`);
            const { applied, skipped } = await applyPendingMigrations(sql, MIGRATIONS_FOLDER);
            console.log(`📊 Summary: ${applied} applied, ${skipped} already present`);
            console.log('✅ Migrations applied successfully');
            await sql.end();
            process.exit(0);
        } catch (err) {
            await sql.end();

            if (err instanceof MigrationApplyError) {
                console.error(`\n❌ MIGRATION "${err.tag}" FAILED`);
                console.error(`   Hash: ${err.hash}`);
                console.error(`   Error: ${err.message}`);
                if (err.cause instanceof Error) console.error(`   Cause: ${err.cause.message}`);
                console.error('\n   Fix the migration before deploying. Aborting.');
                process.exit(1);
            }

            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Migration attempt ${attempt} failed: ${errMsg}`);

            if (attempt < MAX_RETRIES) {
                console.warn(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
                await sleep(RETRY_DELAY_MS);
            } else {
                console.error('❌ Migration failed after all retries:', err);
                process.exit(1);
            }
        }
    }
};

runMigrations();
```

- [ ] **Step 3: Port `reference/patch-migrations.ts`**

Copie verbatim de `swapo-app/src/db/patch-migrations.ts` removendo apenas o comentário `/* eslint-disable swapo/no-direct-console */` do topo. O restante já é genérico (opera em `./drizzle`, usa git para detectar arquivos commitados, regex de idempotência). Conteúdo final = arquivo swapo sem aquela linha de comentário (linhas 24–116 verbatim, começando em `import { execSync } from 'child_process';`).

- [ ] **Step 4: Escrever o `SKILL.md`**

Criar `templates/skills/drizzle-migration-system/SKILL.md`:

```markdown
---
name: drizzle-migration-system
description: Instala um runner de migração Drizzle hash-based e idempotente (CREATE ... IF NOT EXISTS, retry de conexão, patch automático do SQL gerado). Use quando o projeto usa Drizzle + Postgres e precisa de migrações confiáveis em produção, ou ao pedir "configurar migrações", "setup migrations", "migração idempotente".
---

# Drizzle migration system

Substitui o `migrate()` padrão do Drizzle por um runner **hash-based** (aplica qualquer migration cujo hash ainda não foi registrado, não só a última por timestamp) e torna o SQL gerado **idempotente** (seguro para rodar múltiplas vezes em produção). **Nunca alegue verde sem ter rodado e visto a saída.**

## 1. Verificar pré-requisitos

Confirme que o projeto usa Drizzle + Postgres (`drizzle-orm`, `drizzle-kit` no manifesto; um `drizzle.config.ts`). Detecte o diretório de migrations (default `./drizzle`) e o diretório do schema/db (ex: `src/db/`, `db/`). Se não for Drizzle+Postgres, pare e explique.

## 2. Instalar dependências (confirme antes — ação de máquina)

O runner usa `postgres` (driver TCP para migrations), `tsx` (executar TS), `dotenv` + `dotenv-expand`. Instale o que faltar com o PM do projeto, ex:

```
npm i -D tsx
npm i postgres dotenv dotenv-expand
```

> O driver `postgres` é usado **apenas** para rodar migrations (conexão direta/unpooled). O driver de runtime da app (Neon HTTP, node-postgres, etc.) não muda.

## 3. Copiar e adaptar os 3 arquivos de referência

Copie de `reference/` para o diretório de db do projeto (ex: `src/db/`), adaptando:

- **`migration-runner.ts`** — lógica hash-based pura/testável. Em geral copia sem mudanças.
- **`migrate.ts`** — entry point. Ajuste `MIGRATIONS_FOLDER` se o projeto não usa `./drizzle`. Usa `DATABASE_URL_UNPOOLED ?? DATABASE_URL` — ajuste os nomes das env vars conforme o projeto. Lê `.env` (ajuste o path se necessário).
- **`patch-migrations.ts`** — pós-processa o SQL do `drizzle-kit generate` para idempotente. Opera em `./drizzle` — ajuste a const `DIR` se necessário.

Adapte imports relativos (`./migration-runner`) ao layout real.

## 4. Fiar os scripts no manifesto

Adicione (sem duplicar) ao `package.json`:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate && tsx src/db/patch-migrations.ts",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:patch": "tsx src/db/patch-migrations.ts"
  }
}
```

Ajuste os caminhos `src/db/...` ao layout real.

## 5. Validar — rode e veja verde

- Gere uma migration de teste (ou use uma existente): `npm run db:generate` e confirme que o SQL em `drizzle/` saiu idempotente (`CREATE TABLE IF NOT EXISTS`, etc.).
- Com um banco acessível (`DATABASE_URL`), rode `npm run db:migrate` e mostre a saída real (`X applied, Y already present`). Rode **de novo** para provar a idempotência (deve aplicar 0).
- Se não houver banco acessível no ambiente, **não** alegue verde — reporte os comandos exatos para o usuário rodar e diga que a validação ficou pendente.

## 6. (Opcional) Teste unitário do runner

`migration-runner.ts` expõe deps injetáveis (`readFiles`, `loadTags`) e funções puras — sugira ao usuário um teste cobrindo `applyPendingMigrations` (aplica hash novo, pula hash existente, lança `MigrationApplyError` em falha) usando um mock de `postgres.Sql`.

## 7. Limitação conhecida (enum em transação)

Postgres não enxerga um `ALTER TYPE ... ADD VALUE` recém-criado dentro da mesma transação. O `patch-migrations.ts` mitiga com `ADD VALUE IF NOT EXISTS` + `CREATE TYPE` em bloco `DO $$`. Se o projeto precisar usar um novo valor de enum **na mesma migration** que o cria, separe em duas migrations. Avise o usuário.

## 8. Reportar

Resuma: deps instaladas, arquivos copiados/adaptados, scripts fiados, saída do `db:migrate` (incluindo o re-run idempotente). Lembre que migrations commitadas são imutáveis (hash verificado).
```

- [ ] **Step 5: Registrar a skill na key `drizzle`**

Em `lib/data/project-catalog.mjs`, atualize a linha `drizzle` (criada na Task 2) para incluir a skill:

```js
  "drizzle":      { agents: [], skills: ["drizzle-migration-system"], rules: ["drizzle/db-schema.md", "drizzle/db-access.md"] },
```

- [ ] **Step 6: Escrever o teste da skill**

Criar `tests/skill-drizzle-migration-system.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectProjectAssets } from "../lib/data/project-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "templates", "skills", "drizzle-migration-system");

/** @param {string} lang @param {string[]} fws */
function profile(lang, fws = []) {
  return /** @type {any} */ ({ primaryLanguage: lang, frameworks: fws.map((n) => ({ name: n })) });
}

test("drizzle-migration-system installs on a Drizzle stack only", () => {
  const drizzle = selectProjectAssets(profile("TypeScript", ["Next.js", "Drizzle"]));
  assert.ok(drizzle.skills.includes("drizzle-migration-system"), `skills: ${drizzle.skills}`);
  const plain = selectProjectAssets(profile("TypeScript", ["Next.js"]));
  assert.ok(!plain.skills.includes("drizzle-migration-system"), `skills: ${plain.skills}`);
});

test("drizzle-migration-system SKILL.md + 3 reference files exist", () => {
  const md = path.join(SKILL, "SKILL.md");
  assert.ok(fs.existsSync(md), "missing SKILL.md");
  assert.match(fs.readFileSync(md, "utf8"), /name:\s*drizzle-migration-system/);
  for (const f of ["migrate.ts", "migration-runner.ts", "patch-migrations.ts"]) {
    assert.ok(fs.existsSync(path.join(SKILL, "reference", f)), `missing reference/${f}`);
  }
});

test("reference files carry no swapo coupling", () => {
  for (const f of ["migrate.ts", "migration-runner.ts", "patch-migrations.ts"]) {
    const src = fs.readFileSync(path.join(SKILL, "reference", f), "utf8");
    assert.ok(!/swapo|inngest|preExecEnumValues|brain-swapo/i.test(src), `${f} still has swapo coupling`);
  }
});
```

- [ ] **Step 7: Rodar os testes — devem passar**

Run: `node --test tests/skill-drizzle-migration-system.test.mjs tests/project-catalog.test.mjs`
Expected: PASS.

- [ ] **Step 8: Typecheck + lint + verificação de apply**

Run: `npm run typecheck && npm run lint && node --test tests/plan-apply.test.mjs`
Expected: sem erros. (Confirma que registrar a skill não quebrou o apply — o diretório existe.)

- [ ] **Step 9: Commit**

```bash
git add templates/skills/drizzle-migration-system/ lib/data/project-catalog.mjs tests/skill-drizzle-migration-system.test.mjs
git commit -m "feat(skills): add drizzle-migration-system skill (hash-based idempotent migrations)"
```

---

## Task 5: Skill `nextjs-eslint-rules`

**Files:**
- Create: `templates/skills/nextjs-eslint-rules/SKILL.md`
- Create: `templates/skills/nextjs-eslint-rules/reference/eslint-plugin-harness.mjs`
- Create: `templates/skills/nextjs-eslint-rules/reference/eslint.config.snippet.js`
- Modify: `lib/data/project-catalog.mjs` (`next` key → skills)
- Test: `tests/skill-nextjs-eslint-rules.test.mjs` (novo)

**Interfaces:**
- Consumes: `selectProjectAssets(profile).skills`.
- Produces: skill em `.claude/skills/nextjs-eslint-rules/`, registrada em `PROJECT_BY_STACK["next"].skills`. Plugin ESLint com 7 regras genéricas portadas do swapo.

**Fonte:** `/Users/leandrosilvaferreira/Projetos/swapo/swapo-app/eslint.config.js` (objeto `swapoPlugin`, linhas 8–700). Portar APENAS estas 7 regras (excluir `no-hardcoded-step-names`, `no-step-passthrough`, `no-magic-strings`, `no-db-transaction` — acoplamento Inngest/fintech).

- [ ] **Step 1: Escrever `reference/eslint-plugin-harness.mjs`**

Crie um plugin ESLint flat-config exportando `{ rules: { ... } }` com as 7 regras. Para cada regra, **porte o `create(context)` verbatim** do `swapoPlugin` correspondente em `swapo-app/eslint.config.js`, trocando só os textos de mensagem (remover tags `[SWAPO ...]` → `[HARNESS ...]`, remover refs a `docs/rules/*`, `CONVENTIONS.md`, `CurrencyMath`, paths swapo). Estrutura:

```js
/**
 * Harness ESLint plugin — generic boundary/quality rules ported from a
 * production Next.js + Drizzle + shadcn codebase. Flat-config compatible.
 *
 * Rules:
 *   require-types-filename     interfaces exportadas só em types.ts
 *   max-lines-clean-code       arquivo > 350 linhas → erro
 *   no-direct-console          proíbe console.* (use o logger estruturado)
 *   no-native-input-elements   proíbe <input>/<textarea> nativos (use shadcn)
 *   require-input-maxlength    Input/Textarea exigem maxLength
 *   no-direct-db-access         só *-repository.ts importa @/db
 *   require-auth-wrapper        rotas app/api exigem withAuth/withRole (ou // @public-route)
 */
const plugin = {
  rules: {
    'require-types-filename': {
      meta: {
        type: 'problem',
        docs: { description: 'Interfaces exportadas devem ficar em arquivos types.ts' },
        messages: {
          wrongFile:
            '[HARNESS] Interfaces exportadas ("export interface") devem ficar em arquivos "types.ts". Mova esta interface para o arquivo de tipos do domínio.',
        },
      },
      // create(context): PORTAR verbatim de swapo eslint.config.js (require-types-filename)
      create(context) { /* ...verbatim... */ },
    },

    'max-lines-clean-code': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Máximo de 350 linhas por arquivo' },
        schema: [],
        messages: {
          tooLong:
            '[HARNESS] Arquivo grande demais (atual: {{lines}} | máximo: 350). Extraia componentes/lógica em módulos menores (uma responsabilidade por arquivo).',
        },
      },
      create(context) { /* ...verbatim (threshold 350)... */ },
    },

    'no-direct-console': {
      meta: {
        type: 'problem',
        docs: { description: 'Proíbe console.* — use um logger estruturado' },
        schema: [],
        messages: {
          noConsole:
            '[HARNESS] Uso direto de "console.{{method}}()" é proibido. Use um logger estruturado (ex: createModuleLogger de @/lib/logger). Veja a skill /structured-logging-pino.',
        },
      },
      create(context) { /* ...verbatim (BANNED_METHODS)... */ },
    },

    'no-native-input-elements': {
      meta: {
        type: 'problem',
        docs: { description: 'Proíbe <input>/<textarea> nativos — use shadcn/ui' },
        schema: [],
        messages: {
          noNativeInput: '[HARNESS] <input> nativo é proibido. Use o componente <Input> de @/components/ui/input.',
          noNativeTextarea: '[HARNESS] <textarea> nativo é proibido. Use o componente <Textarea> de @/components/ui/textarea.',
        },
      },
      create(context) { /* ...verbatim (EXEMPT_INPUT_TYPES, components/ui/ skip)... */ },
    },

    'require-input-maxlength': {
      meta: {
        type: 'problem',
        docs: { description: 'Input/Textarea de texto exigem maxLength' },
        schema: [],
        messages: {
          missingMaxLength: '[HARNESS] <{{name}}> sem "maxLength". Todo campo de texto deve ter maxLength (integridade + anti buffer). Ex: <{{name}} maxLength={100} />.',
        },
      },
      create(context) { /* ...verbatim (INPUT_COMPONENTS, EXEMPT_TYPES)... */ },
    },

    'no-direct-db-access': {
      meta: {
        type: 'problem',
        docs: { description: 'Só *-repository.ts pode importar @/db' },
        schema: [],
        messages: {
          dbImportForbidden:
            '[HARNESS] Import direto de "@/db" é proibido aqui. Centralize o acesso ao banco num arquivo "*-repository.ts" (padrão Repository/DDD) e chame-o a partir daqui. Nenhum .tsx pode importar @/db.',
        },
      },
      create(context) { /* ...verbatim... */ },
    },

    'require-auth-wrapper': {
      meta: {
        type: 'problem',
        docs: { description: 'Rotas de API exigem wrapper de auth' },
        schema: [],
        messages: {
          missingAuthWrapper:
            '[HARNESS] Handler "{{name}}" exportado sem wrapper de autenticação. Rotas em app/api devem usar withAuth/withRole/withErrorHandler. Marque rotas públicas com um comentário "// @public-route" no topo do arquivo.',
        },
      },
      // create(context): versão GENÉRICA (ver Step 2) — NÃO copie a lista PUBLIC_PATH_SEGMENTS swapo
      create(context) { /* ...ver Step 2... */ },
    },
  },
};

export default plugin;
```

> Para os 6 primeiros `create()`, copie o corpo exato do swapo (a lógica AST é correta e genérica; `max-lines-clean-code` mantém 350). Apague qualquer `context.report` que referencie `messageId` removido. Os `messages` já estão genéricos acima.

- [ ] **Step 2: Escrever a versão genérica de `require-auth-wrapper` `create()`**

A regra swapo amarra a `/src/app/api/v1/` e tem `PUBLIC_PATH_SEGMENTS` swapo. Substitua o `create()` por esta versão genérica (aplica a route handlers do App Router `app/api/**/route.ts` e Pages API; exempta via marcador `// @public-route`; aceita withAuth/withRole/withErrorHandler):

```js
      create(context) {
        const fileName = context.filename ?? context.getFilename();
        const normalized = fileName.replace(/\\/g, '/');

        // App Router route handlers (app/api/**/route.ts) or Pages API (pages/api/**)
        const isApiRoute =
          (/\/app\/api\//.test(normalized) && /\/route\.[cm]?tsx?$/.test(normalized)) ||
          /\/pages\/api\//.test(normalized);
        if (!isApiRoute) return {};
        if (fileName.includes('__tests__') || fileName.includes('.test.')) return {};

        // Opt-out marker for intentionally public routes.
        const source = context.sourceCode?.getText?.() ?? '';
        if (source.includes('@public-route')) return {};

        const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

        /** @param {any} init */
        function hasAuthWrapper(init) {
          if (!init || init.type !== 'CallExpression') return false;
          const callee = init.callee;
          // withAuth(handler) | withErrorHandler(handler)
          if (callee.type === 'Identifier' && (callee.name === 'withAuth' || callee.name === 'withRole')) return true;
          if (callee.type === 'Identifier' && callee.name === 'withErrorHandler') {
            return init.arguments.length > 0 ? hasAuthWrapper(init.arguments[0]) : false;
          }
          // withRole('admin')(handler) — callee is itself a CallExpression
          if (callee.type === 'CallExpression') {
            const inner = callee.callee;
            if (inner.type === 'Identifier' && (inner.name === 'withRole' || inner.name === 'withAuth')) return true;
          }
          return false;
        }

        return {
          ExportNamedDeclaration(node) {
            if (!node.declaration) return;
            if (node.declaration.type === 'VariableDeclaration') {
              for (const d of node.declaration.declarations) {
                if (d.id.type === 'Identifier' && HTTP_METHODS.has(d.id.name) && !hasAuthWrapper(d.init)) {
                  context.report({ node: d, messageId: 'missingAuthWrapper', data: { name: d.id.name } });
                }
              }
            }
            if (
              node.declaration.type === 'FunctionDeclaration' &&
              node.declaration.id &&
              HTTP_METHODS.has(node.declaration.id.name)
            ) {
              context.report({
                node: node.declaration,
                messageId: 'missingAuthWrapper',
                data: { name: node.declaration.id.name },
              });
            }
          },
        };
      },
```

- [ ] **Step 3: Escrever `reference/eslint.config.snippet.js`**

```js
// Merge este bloco no seu eslint.config.js (flat config). Ajuste os aliases
// (@/db, @/components/ui, @/lib/auth) e o glob `files` ao seu projeto.
import harness from './eslint-rules/eslint-plugin-harness.mjs';

export default [
  // ...sua config existente...
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { harness },
    rules: {
      'harness/require-types-filename': 'error',
      'harness/max-lines-clean-code': 'warn',
      'harness/no-direct-console': 'error',
      'harness/no-native-input-elements': 'error',
      'harness/require-input-maxlength': 'error',
      'harness/no-direct-db-access': 'error',
      'harness/require-auth-wrapper': 'error',
    },
  },
  // Scripts/seeds onde console é intencional (DEPOIS do bloco acima para sobrescrever)
  {
    files: ['scripts/**/*.{ts,mjs}', '**/seed*.ts', '**/*.config.{js,ts,mjs}'],
    rules: { 'harness/no-direct-console': 'off' },
  },
];
```

- [ ] **Step 4: Escrever o `SKILL.md`**

Criar `templates/skills/nextjs-eslint-rules/SKILL.md`:

```markdown
---
name: nextjs-eslint-rules
description: Instala regras ESLint de fronteira/qualidade para projetos Next.js + Drizzle + shadcn (tamanho de arquivo, logging estruturado, DB só via repository, rotas com auth-wrapper, shadcn Input, maxLength, interfaces em types.ts). Use ao "configurar ESLint", "adicionar lint rules", "enforce arquitetura" num projeto Next/React/TS.
---

# Next.js ESLint rules

Instala um plugin ESLint local com 7 regras de fronteira e qualidade, portadas de um codebase Next.js + Drizzle + shadcn de produção. **Rode o ESLint ao final e mostre a saída real.**

## 1. Verificar pré-requisitos

Confirme ESLint flat config (`eslint.config.js`/`.mjs`/`.ts`) e projeto Next/React/TS. Identifique os aliases reais do projeto (em `tsconfig.json` `paths`): a regra `no-direct-db-access` assume `@/db`; `require-auth-wrapper` assume `withAuth`/`withRole`; `no-native-input-elements` assume `@/components/ui/*`. Ajuste as mensagens/lógica se o projeto usa aliases diferentes.

## 2. Copiar o plugin

Copie `reference/eslint-plugin-harness.mjs` para o projeto (ex: `eslint-rules/eslint-plugin-harness.mjs`).

## 3. Wirar no eslint.config

Use `reference/eslint.config.snippet.js` como guia para fazer merge do bloco de plugin/rules no `eslint.config.js` do projeto. Ajuste o glob `files` e os overrides (scripts/seeds com `no-direct-console: off`). Comece severidades em `warn` se o projeto tem muitas violações pré-existentes, depois suba para `error`.

## 4. As regras

| Regra | O que faz | Severidade sugerida |
|-------|-----------|---------------------|
| `require-types-filename` | `export interface` só em `types.ts` | error |
| `max-lines-clean-code` | arquivo > 350 linhas → avisa (alinha ao large-file guard) | warn |
| `no-direct-console` | proíbe `console.*` (use logger estruturado) | error |
| `no-native-input-elements` | `<input>`/`<textarea>` nativos → use shadcn `<Input>`/`<Textarea>` | error |
| `require-input-maxlength` | `Input`/`Textarea` de texto exigem `maxLength` | error |
| `no-direct-db-access` | só `*-repository.ts` importa `@/db` | error |
| `require-auth-wrapper` | rotas `app/api/**/route.ts` exigem `withAuth`/`withRole` (ou `// @public-route`) | error |

## 5. Rodar e reportar

Rode o lint do projeto (`npm run lint` ou `npx eslint .`) e mostre a saída real (contagem de erros/warnings). Não tente auto-corrigir violações em massa sem confirmar com o usuário — as regras são opinativas. Resuma o que foi instalado e quais violações pré-existentes apareceram.

## 6. Notas de portabilidade

As regras assumem convenções comuns (Next App Router, Drizzle com alias `@/db`, shadcn com `@/components/ui`). Se o projeto difere, ajuste os literais nas regras (nomes de import, paths). `require-auth-wrapper` exempta rotas com o comentário `// @public-route` no topo do arquivo.
```

- [ ] **Step 5: Registrar a skill na key `next`**

Em `lib/data/project-catalog.mjs`, atualize a linha `next`:

```js
  "next":         { agents: [], skills: ["nextjs-eslint-rules"], rules: ["next/coding-standards.md", "next/api-security.md"] },
```

- [ ] **Step 6: Validar o plugin ESLint carrega e funciona (smoke test)**

Crie um script de verificação temporário e rode (não commitar):

```bash
node --input-type=module -e "
import plugin from './templates/skills/nextjs-eslint-rules/reference/eslint-plugin-harness.mjs';
const names = Object.keys(plugin.rules);
const expected = ['require-types-filename','max-lines-clean-code','no-direct-console','no-native-input-elements','require-input-maxlength','no-direct-db-access','require-auth-wrapper'];
for (const e of expected) { if (!names.includes(e)) throw new Error('missing rule: ' + e); }
for (const n of names) { if (typeof plugin.rules[n].create !== 'function') throw new Error('no create(): ' + n); }
console.log('OK: ' + names.length + ' rules, all with create()');
"
```

Expected: `OK: 7 rules, all with create()`. (Confirma que o port não tem erro de sintaxe e todas as regras têm `create`.)

- [ ] **Step 7: Escrever o teste da skill**

Criar `tests/skill-nextjs-eslint-rules.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectProjectAssets } from "../lib/data/project-catalog.mjs";
import plugin from "../templates/skills/nextjs-eslint-rules/reference/eslint-plugin-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "templates", "skills", "nextjs-eslint-rules");

/** @param {string} lang @param {string[]} fws */
function profile(lang, fws = []) {
  return /** @type {any} */ ({ primaryLanguage: lang, frameworks: fws.map((n) => ({ name: n })) });
}

test("nextjs-eslint-rules installs on a Next.js stack only", () => {
  const next = selectProjectAssets(profile("TypeScript", ["Next.js", "React"]));
  assert.ok(next.skills.includes("nextjs-eslint-rules"), `skills: ${next.skills}`);
  const react = selectProjectAssets(profile("TypeScript", ["React"]));
  assert.ok(!react.skills.includes("nextjs-eslint-rules"), `skills: ${react.skills}`);
});

test("SKILL.md + plugin + snippet exist", () => {
  assert.ok(fs.existsSync(path.join(SKILL, "SKILL.md")));
  assert.match(fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8"), /name:\s*nextjs-eslint-rules/);
  assert.ok(fs.existsSync(path.join(SKILL, "reference", "eslint-plugin-harness.mjs")));
  assert.ok(fs.existsSync(path.join(SKILL, "reference", "eslint.config.snippet.js")));
});

test("plugin exports exactly the 7 generic rules, each with create()", () => {
  const names = Object.keys(plugin.rules).sort();
  assert.deepEqual(names, [
    "max-lines-clean-code",
    "no-direct-console",
    "no-direct-db-access",
    "no-native-input-elements",
    "require-auth-wrapper",
    "require-input-maxlength",
    "require-types-filename",
  ]);
  for (const n of names) assert.equal(typeof plugin.rules[n].create, "function", `${n} needs create()`);
});

test("plugin dropped the swapo/Inngest-coupled rules", () => {
  for (const banned of ["no-hardcoded-step-names", "no-step-passthrough", "no-magic-strings", "no-db-transaction"]) {
    assert.ok(!(banned in plugin.rules), `should not ship ${banned}`);
  }
});
```

- [ ] **Step 8: Rodar os testes — devem passar**

Run: `node --test tests/skill-nextjs-eslint-rules.test.mjs tests/project-catalog.test.mjs`
Expected: PASS.

- [ ] **Step 9: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros. (O plugin sob `templates/` é ignorado pelo lint do harness, mas o **teste** que o importa não é — garanta que o `.mjs` é ESM válido. O smoke test do Step 6 já cobriu sintaxe.)

- [ ] **Step 10: Commit**

```bash
git add templates/skills/nextjs-eslint-rules/ lib/data/project-catalog.mjs tests/skill-nextjs-eslint-rules.test.mjs
git commit -m "feat(skills): add nextjs-eslint-rules skill (7 generic boundary rules from swapo)"
```

---

## Task 6: Skill `structured-logging-pino`

**Files:**
- Create: `templates/skills/structured-logging-pino/SKILL.md`
- Create: `templates/skills/structured-logging-pino/reference/logger.ts`
- Modify: `lib/data/project-catalog.mjs` (`typescript` key → skills)
- Test: `tests/skill-structured-logging-pino.test.mjs` (novo)

**Interfaces:**
- Consumes: `selectProjectAssets(profile).skills`.
- Produces: skill em `.claude/skills/structured-logging-pino/`, registrada em `PROJECT_BY_STACK["typescript"].skills` (disponível em todo projeto JS/TS). Logger genérico (sem Discord/Inngest/Vercel).

- [ ] **Step 1: Escrever `reference/logger.ts` (genérico)**

```ts
/**
 * Structured logger (pino): pretty in dev, JSON in prod, with secret redaction.
 * Server + browser safe, singleton across hot reloads.
 *
 * Usage:
 *   import { createModuleLogger } from '@/lib/logger';
 *   const log = createModuleLogger('payments');
 *   log.info({ orderId }, 'order created');
 *   log.error({ err }, 'order failed');
 */
import pino from 'pino';

const isServer = typeof window === 'undefined';
const logLevel = process.env.LOG_LEVEL ?? 'info';

// Replace 'app' with your service name.
const SERVICE = 'app';

const globalForLogger = globalThis as unknown as { __pino?: pino.Logger };

function buildLogger(): pino.Logger {
  // Browser: lightweight console-based logger.
  if (!isServer) {
    return pino({
      level: logLevel,
      browser: { asObject: true },
      base: { service: SERVICE, env: process.env.NODE_ENV },
    });
  }

  const isDev = process.env.NODE_ENV !== 'production';

  return pino({
    level: logLevel,
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    }),
    serializers: { err: pino.stdSerializers.err },
    base: { service: SERVICE, env: process.env.NODE_ENV },
    redact: {
      paths: [
        'password', 'token', 'secret', 'apiKey', 'authorization',
        '*.password', '*.token', '*.secret', '*.apiKey', '*.authorization',
        'req.headers.authorization', 'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  });
}

export const logger = globalForLogger.__pino ?? buildLogger();
if (process.env.NODE_ENV !== 'production') globalForLogger.__pino = logger;

/** Child logger tagged with a module name (and optional extra bindings). */
export function createModuleLogger(
  module: string,
  bindings: Record<string, unknown> = {},
): pino.Logger {
  return logger.child({ module, ...bindings });
}
```

- [ ] **Step 2: Escrever o `SKILL.md`**

Criar `templates/skills/structured-logging-pino/SKILL.md`:

```markdown
---
name: structured-logging-pino
description: Instala logging estruturado com pino (pretty em dev, JSON em prod, redação automática de password/token/secret/authorization) e um helper createModuleLogger. Use ao "configurar logging", "adicionar logger", "structured logging", ou para substituir console.* num projeto Node/TS.
---

# Structured logging (pino)

Instala um logger estruturado baseado em pino com redação de segredos e um helper `createModuleLogger`. **Rode e mostre a saída real ao final.**

## 1. Verificar

Projeto Node/TS (server-side ou full-stack). Identifique o diretório de libs (`src/lib/`, `lib/`) e o nome do serviço (nome do projeto no `package.json`).

## 2. Instalar dependências (confirme antes — ação de máquina)

```
npm i pino
npm i -D pino-pretty
```

## 3. Copiar e adaptar o logger

Copie `reference/logger.ts` para o projeto (ex: `src/lib/logger.ts`). Troque a const `SERVICE = 'app'` pelo nome real do serviço. Ajuste a lista `redact.paths` para incluir campos sensíveis específicos do domínio (ex: `cpf`, `cardNumber`).

## 4. Padrão de uso

```ts
import { createModuleLogger } from '@/lib/logger';
const log = createModuleLogger('module-name');

log.info({ userId }, 'mensagem');          // contexto = 1º arg (objeto), msg = 2º (string)
log.error({ err, orderId }, 'falha');       // erros sob a chave `err` (serializada por pino)
log.warn({ key: value }, 'aviso');
```

Regra: 1º argumento é o objeto de contexto (bindings), 2º é a mensagem.

## 5. Substituir console.* (opcional, confirme)

Se o usuário quiser, troque `console.log/error/warn` por chamadas ao logger. Em scripts/CLI/seeds, `console` pode ser intencional — não troque sem confirmar. Combina com a regra `no-direct-console` da skill `/nextjs-eslint-rules`.

## 6. Validar

Crie um trecho de smoke (ou um teste) que importe `createModuleLogger`, logue uma linha com um campo `password` e confirme na saída que veio `[REDACTED]`. Mostre a saída real. Se o ambiente não rodar, reporte os comandos para o usuário.

## 7. Reportar

Resuma: deps instaladas, arquivo criado/adaptado, nome do serviço, confirmação da redação funcionando.
```

- [ ] **Step 3: Registrar a skill na key `typescript`**

Em `lib/data/project-catalog.mjs`, atualize a linha `typescript`:

```js
  "typescript":   { agents: [], skills: ["structured-logging-pino"], rules: ["typescript/coding-standards.md"] },
```

- [ ] **Step 4: Escrever o teste da skill**

Criar `tests/skill-structured-logging-pino.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectProjectAssets } from "../lib/data/project-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "templates", "skills", "structured-logging-pino");

/** @param {string} lang @param {string[]} fws */
function profile(lang, fws = []) {
  return /** @type {any} */ ({ primaryLanguage: lang, frameworks: fws.map((n) => ({ name: n })) });
}

test("structured-logging-pino installs on any JS/TS stack", () => {
  assert.ok(selectProjectAssets(profile("TypeScript")).skills.includes("structured-logging-pino"));
  assert.ok(selectProjectAssets(profile("JavaScript", ["Express"])).skills.includes("structured-logging-pino"));
});

test("structured-logging-pino does NOT install on non-JS stacks", () => {
  assert.ok(!selectProjectAssets(profile("Go")).skills.includes("structured-logging-pino"));
  assert.ok(!selectProjectAssets(profile("Python")).skills.includes("structured-logging-pino"));
});

test("SKILL.md + logger reference exist and are generic", () => {
  const md = path.join(SKILL, "SKILL.md");
  assert.ok(fs.existsSync(md));
  assert.match(fs.readFileSync(md, "utf8"), /name:\s*structured-logging-pino/);
  const logger = fs.readFileSync(path.join(SKILL, "reference", "logger.ts"), "utf8");
  assert.match(logger, /createModuleLogger/);
  assert.match(logger, /redact/);
  assert.ok(!/swapo|inngest|discord|@vercel\/functions/i.test(logger), "logger still has swapo coupling");
});
```

- [ ] **Step 5: Rodar os testes — devem passar**

Run: `node --test tests/skill-structured-logging-pino.test.mjs tests/project-catalog.test.mjs`
Expected: PASS.

- [ ] **Step 6: Verificar apply não quebrou (key typescript afeta todo projeto JS/TS)**

Run: `node --test tests/plan-apply.test.mjs`
Expected: PASS. (O fixture `js-ts-app` agora inclui `skill:structured-logging-pino`; o diretório existe, então o apply copia OK. Se algum assert de conjunto exato falhar, ajuste o teste afetado para incluir a nova skill.)

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add templates/skills/structured-logging-pino/ lib/data/project-catalog.mjs tests/skill-structured-logging-pino.test.mjs
git commit -m "feat(skills): add structured-logging-pino skill (pino + secret redaction)"
```

---

## Task 7: Sugestão das skills na instalação (`plan.mjs` notes)

**Files:**
- Modify: `lib/plan.mjs` (seção `--- Notes ---`, antes do `return`)
- Test: `tests/plan-apply.test.mjs` (novo caso)

**Interfaces:**
- Consumes: `selectProjectAssets(profile).skills` (já importado em `plan.mjs`).
- Produces: entradas em `plan.notes` sugerindo `/drizzle-migration-system`, `/nextjs-eslint-rules`, `/structured-logging-pino` conforme as skills instaladas.

- [ ] **Step 1: Escrever o caso de teste que falha**

Adicione ao fim de `tests/plan-apply.test.mjs`:

```js
test("plan suggests stack skills via notes", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aia-sugg-"));
  try {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "x",
        dependencies: { next: "15", react: "19", "drizzle-orm": "0.4", "@shadcn/ui": "1" },
        devDependencies: { "drizzle-kit": "0.3", typescript: "5" },
      }),
    );
    const profile = scanProject(tmp);
    const plan = buildPlan(profile, { pluginRoot: ROOT, tools: [] });
    const notes = plan.notes.join("\n");
    assert.match(notes, /drizzle-migration-system/);
    assert.match(notes, /nextjs-eslint-rules/);
    assert.match(notes, /structured-logging-pino/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `node --test tests/plan-apply.test.mjs`
Expected: FAIL — notes não mencionam as skills ainda.

- [ ] **Step 3: Adicionar as notes de sugestão**

Em `lib/plan.mjs`, na seção `// --- Notes ---` (após o `const notes = [];` e antes da nota de large-files), adicione:

```js
  const suggestedSkills = selectProjectAssets(profile).skills;
  if (suggestedSkills.includes("drizzle-migration-system")) {
    notes.push(
      "Drizzle detected — run /drizzle-migration-system to install the idempotent hash-based migration runner.",
    );
  }
  if (suggestedSkills.includes("nextjs-eslint-rules")) {
    notes.push(
      "Next.js detected — run /nextjs-eslint-rules to add boundary/quality ESLint rules " +
        "(file size, structured logging, repository-only DB access, auth-wrapped API routes).",
    );
  }
  if (suggestedSkills.includes("structured-logging-pino")) {
    notes.push(
      "Run /structured-logging-pino to set up structured logging with secret redaction.",
    );
  }
```

> `selectProjectAssets` já está importado em `lib/plan.mjs` (linha ~23, do `asset-catalog.mjs`). Não reimporte.

- [ ] **Step 4: Rodar — deve passar**

Run: `node --test tests/plan-apply.test.mjs`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/plan.mjs tests/plan-apply.test.mjs
git commit -m "feat(plan): suggest stack skills (drizzle/eslint/pino) via plan notes"
```

---

## Task 8: Verificação final + nota no CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (seção que descreve `PROJECT_HOOK_BY_STACK`)
- Verify: suíte completa

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Atualizar a doc do CLAUDE.md**

Em `CLAUDE.md`, na frase que cita os hooks por stack (a que menciona "PHPStan for PHP"), acrescente o hook Drizzle. Localize o texto:

```
hooks shipped + settings-wired only for a stack (e.g. PHPStan for PHP) in `PROJECT_HOOK_BY_STACK`
```

e troque por:

```
hooks shipped + settings-wired only for a stack (e.g. PHPStan for PHP, block-drizzle-direct for Drizzle) in `PROJECT_HOOK_BY_STACK`
```

- [ ] **Step 2: Rodar a suíte completa**

Run: `npm test`
Expected: typecheck + lint + todos os `node --test` verdes. Corrija QUALQUER erro (mesmo pré-existente/não relacionado) antes de prosseguir.

- [ ] **Step 3: Smoke end-to-end — scan→plan→apply num projeto Next+Drizzle+shadcn temporário**

```bash
TMP=$(mktemp -d)
cat > "$TMP/package.json" <<'JSON'
{ "name": "smoke", "dependencies": { "next": "15", "react": "19", "drizzle-orm": "0.4", "@shadcn/ui": "1" }, "devDependencies": { "drizzle-kit": "0.3", "typescript": "5" } }
JSON
node bin/harness.mjs apply "$TMP" --yes --no-tools
echo "--- rules ---"; ls -R "$TMP/.claude/rules"
echo "--- skills ---"; ls "$TMP/.claude/skills"
echo "--- hook wired? ---"; grep -o 'block-drizzle-direct.mjs' "$TMP/.claude/settings.json"
echo "--- hook file copied? ---"; ls "$TMP/.claude/hooks/block-drizzle-direct.mjs"
rm -rf "$TMP"
```

Expected: rules `drizzle/`, `shadcn/`, `next/api-security.md`, `react/form-validation.md` presentes; skills `drizzle-migration-system`, `nextjs-eslint-rules`, `structured-logging-pino` presentes; `block-drizzle-direct.mjs` referenciado no settings.json e copiado em hooks/.

- [ ] **Step 4: Verificação adversarial (opcional, recomendado)**

Dispare o agente `aia-harness:harness-reviewer` sobre o `.claude/` gerado no smoke (ou rode `/doctor` num projeto de teste) para auditar: secrets, hooks fail-open, permissões, bloat de contexto. Corrija o que aparecer.

- [ ] **Step 5: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: note block-drizzle-direct hook in PROJECT_HOOK_BY_STACK"
```

---

## Self-Review (executado ao escrever o plano)

**1. Spec coverage:**
- 6 rules → Task 2 ✓ (next/api-security, drizzle/db-schema, drizzle/db-access, shadcn/tsx-screen, shadcn/mobile-first, react/form-validation)
- Hook block-drizzle-direct + teste → Task 3 ✓
- 3 skills → Tasks 4/5/6 ✓
- Detecção (Drizzle + stack-keys) → Task 1 ✓
- Registro no catálogo → Tasks 2/3/4/5/6 ✓
- Sugestão via notes → Task 7 ✓
- Testes (detect-stacks, project-catalog, hook, skills, plan) → distribuídos por task ✓
- Decisões: hard-block push/drop (T3) ✓; pino na key typescript (T6) ✓; plugin custom portado (T5) ✓

**2. Placeholder scan:** Os `create(context) { /* ...verbatim... */ }` no Step 1 da Task 5 NÃO são placeholders vazios — referenciam a fonte exata (`swapo-app/eslint.config.js`, regra homônima) com a instrução de port verbatim + as substituições de mensagem dadas. O `require-auth-wrapper` tem o `create()` genérico completo no Step 2. Aceitável (port preciso de fonte disponível).

**3. Type/nome consistency:** `selectProjectAssets`, `selectProjectHooks`, `allProjectAssets`, `PROJECT_BY_STACK`, `PROJECT_HOOK_BY_STACK`, `DRIZZLE_HOOKS`, `validatePreToolUseOutput`, `runHook`/`runHookRaw` — nomes batem com o código real lido. Stack-keys `drizzle`/`shadcn` consistentes entre T1 (emissão) e T2–T6 (consumo). Skill names batem entre SKILL.md, registro e notes.

**4. Ordem/dependências:** T1 (detecção) antes de tudo. T2 registra rules (sem skills). T4/T5/T6 adicionam skills às keys só depois de criar os diretórios — evita apply quebrado. T7 depende das skills registradas (T4–T6). T8 verifica tudo.
