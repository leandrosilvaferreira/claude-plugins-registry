---
name: novo-modulo-adianti
description: This skill should be used to scaffold a complete new CRUD module in a PHP Adianti Framework project — Active Record model (TRecord) + list controller + form controller + menu.xml entry — by mirroring an existing module already in the codebase. Use when the user asks "criar novo módulo", "novo módulo Adianti", "scaffold a module", "criar CRUD", "novo cadastro", "create model + list + form", "add a new domain/entity", or names a new entity to register (e.g. "criar módulo de Fornecedores"). Mirror the project's own conventions first; fall back to the adianti-framework skill references only when no existing module exists.
version: 1.0.0
---

# Novo Módulo Adianti

Scaffold a new CRUD module (model + list + form + menu) for an Adianti project.
The goal is a module **indistinguishable from the ones already in the codebase** —
same base classes, traits, naming, folder layout, and menu structure. Never impose
a generic template over the project's real conventions.

## Inputs to gather first

- **Entity name** (singular, PascalCase) — e.g. `Fornecedor`.
- **Table name** — confirm with the user or infer from sibling models (`const TABLENAME`).
- **Domain / subfolder** under `app/control/` — e.g. `compras`. Mirror where similar
  controllers live.
- **Fields** — column name, type, label, required? If unknown, scaffold the
  skeleton and list the attributes the user must still declare.

If the user gave only a name, proceed with the skeleton and clearly flag what is
left to fill (attributes, fields, validation, menu label/group).

## Procedure

1. **Find a reference module to mirror (do this FIRST).**
   Locate an existing `*List.php` + `*Form.php` pair plus its model. Search:

   ```bash
   ls app/model app/control 2>/dev/null
   grep -rln "extends TPage" app/control | head
   grep -rln "extends TRecord" app/model | head
   ```

   Open one representative model, its List, and its Form. Note exactly:
   - the **base class** and **traits** each controller uses (the project may use
     `AdiantiStandardListTrait`, a project base class like `TStandardList`, or a
     hand-rolled pattern — use whatever the project uses, do not invent one);
   - the model's `TABLENAME` / `PRIMARYKEY` / `IDPOLICY` style and how attributes
     and relationships are declared;
   - the **menu.xml** structure (group, label, `action`/`class` attributes,
     icon, program/permission conventions);
   - the database name passed to `TTransaction::open(...)`.

   If **no** module exists yet, fall back to the patterns in the
   `adianti-framework` skill references (`references/active-record.md`,
   `references/datagrid-lists.md`, `references/forms-widgets.md`,
   `references/architecture.md`).

2. **Create the model** — `app/model/<Entity>.php`.
   Mirror the reference model: `TABLENAME`, `PRIMARYKEY`, `IDPOLICY`, an
   `addAttribute(...)` per column, relationships, and any shared trait the
   project applies to every model (e.g. a changelog/soft-delete trait — copy it
   if the siblings use it). Wrap CRUD in `TTransaction` as the project does.

3. **Create the list controller** — `app/control/<domain>/<Entity>List.php`.
   Copy the reference List and adapt: the active record class, the `TDataGrid`
   columns, the filter form fields, datagrid actions (edit/delete), pagination,
   and the `onReload` / `onSearch` / `onDelete` handlers. Keep the same base
   class and traits.

4. **Create the form controller** — `app/control/<domain>/<Entity>Form.php`.
   Copy the reference Form and adapt: the `BootstrapFormBuilder` (or project
   builder), the fields and validators, and `onSave` / `onEdit` inside
   `TTransaction`. Match field widget choices to the column types.

5. **Register in `menu.xml`.**
   Add the entry in the correct group, mirroring sibling entries exactly
   (label, `action`/`class` pointing at `<Entity>List`, icon, and any
   program/permission attributes the project uses). Do not guess attribute names —
   copy them from a neighbouring `<menuitem>`.

6. **Report what remains.**
   List every attribute, field, validation rule, relationship, and permission
   the user still needs to declare or confirm. If fields were unknown, make this
   explicit so nothing ships half-defined.

## Rules

- **Consistency beats convention.** When the project's pattern differs from the
  generic Adianti docs, follow the project.
- **Every DB access uses `TTransaction`** with the same database name the
  siblings use.
- **Never edit** `lib/adianti/` (framework core).
- Show the files you will create and wait for confirmation before writing if the
  user has not pre-approved scaffolding.
