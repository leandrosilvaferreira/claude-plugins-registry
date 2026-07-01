---
description: Adianti Framework PHP coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP + Adianti Framework — Coding Standards

**Source:** aia-harness/templates/skills/adianti-framework (first-party)

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Accessing a model outside a transaction | Always wrap in `TTransaction::open/close` |
| `SELECT *` via raw PDO | `TRecord::getObjects()` or `TRepository::load()` |
| Not calling `addAttribute()` for a column | Column will not persist — register all attributes |
| `new TMessage()` in catch without rollback | Always call `TTransaction::rollback()` in catch |
| Forgetting `$this->form->validate()` before saving | Saves invalid/incomplete data |
| Hard-coded database name | `$this->setDatabase('name')` / config-driven |
| Business logic in the view/form class | Model methods or service classes |
| AJAX callbacks as instance methods | Must be `public static` for AJAX |
| Not calling `$this->datagrid->createModel()` | DataGrid will not render columns |
| Forgetting `parent::add($container)` | Page renders blank |
| Class not registered in menu.xml or allowed classes | Page not accessible |

## Patterns by goal

| Goal | Pattern |
|------|---------|
| List records with search + pagination | `TStandardList` trait on `TPage` |
| Create/Edit/Delete a record | `TStandardForm` trait on `TPage` |
| List + form on the same page | `TStandardFormList` trait on `TPage` |
| Master record + inline detail lines | Manual master-detail on `TPage` |
| Lookup/search popup | `TWindow` seek class with `TForm::sendData()` |
| Read-only detail in side panel | `setTargetContainer('adianti_right_panel')` |
| Form in a modal | Extend `TWindow`, encapsulate form class |
| Many-to-many tags | `TDBCheckGroup` + `saveAggregate()` |
| Dynamic inline rows | `TFieldList` + `saveComposite()` |
| Cascading combos | `setChangeAction()` + `TCombo::reload()` |
| File upload | `TFile` + `AdiantiFileSaveTrait::saveFile()` |

## Conventions

- Every controller extends `TPage`; windows extend `TWindow`
- Actions referenced in `TAction` must be `public`; AJAX callbacks must be `public static`
- `TAction`: `['ClassName', 'methodName']` for static · `[$this, 'methodName']` for instance
- Models: always define `TABLENAME`, `PRIMARYKEY`, `IDPOLICY` as constants
- `addAttribute()` mandatory for every field that must be persisted
