---
name: new-module-adianti
description: This skill should be used to scaffold a complete new CRUD module in a PHP Adianti Framework project — Active Record model (TRecord) + list controller + form controller + menu.xml entry — by mirroring an existing module already in the codebase. Use when the user asks "create new module", "new Adianti module", "scaffold a module", "create CRUD", "new entity/registration", "create model + list + form", "add a new domain/entity", or names a new entity to register (e.g. "create a Fornecedores module"). Mirror the project's own conventions first; fall back to the adianti-framework skill references only when no existing module exists.
version: 1.2.0
---

# New Adianti Module

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

## Pattern Decision Tree

Before writing any file, pick the right pattern for the module:

| Goal | Pattern |
| ------ | --------- |
| List + separate form page | `AdiantiStandardListTrait` on List + `TStandardForm` trait on Form |
| List + form on same page | `TStandardFormList` trait on `TPage` |
| Master record + inline child rows | Manual master-detail in `TPage` (no trait) |
| Popup lookup / seek window | `TWindow` subclass + `TForm::sendData()` |
| Form in side panel | `parent::setTargetContainer('adianti_right_panel')` + close button via `TScript::create("Template.closeRightPanel();")` |
| Form in modal dialog | Extend `TWindow`, wrap form class |
| Many-to-many (tags, skills) | `TDBCheckGroup` + `saveAggregate()` in model |
| Dynamic inline rows (contacts) | `TFieldList` + `saveComposite()` in model |

**Sibling rule:** always mirror the pattern the project's neighbouring modules use for the
same domain. Do **not** introduce a new pattern if a consistent one already exists. When
in doubt, `grep` for the trait used by sibling list controllers and use the same one.

## Procedure

### 1. Find a reference module to mirror (do this FIRST)

Locate an existing `*List.php` + `*Form.php` pair plus its model:

```bash
ls app/model app/control 2>/dev/null
grep -rln "extends TPage" app/control | head
grep -rln "extends TRecord" app/model | head
```

Open one representative model, its List, and its Form. Note exactly:

- The **base class and traits** each controller uses (e.g. `AdiantiStandardListTrait`,
  a project base class like `TStandardList`, or hand-rolled — use whatever the project
  uses, do not invent one).
- The model's `TABLENAME` / `PRIMARYKEY` / `IDPOLICY` style and whether siblings use
  timestamp constants (`CREATEDAT`, `UPDATEDAT`, `DELETEDAT`) or audit-user constants.
- Which **attributes** each model registers via `addAttribute()`.
- The **menu.xml** structure: group, label, `action`/`class` attributes, icon, and any
  `program`/`permission` conventions — copy attribute names from a neighbour entry.
- The **database name** passed to `TTransaction::open(...)` or `$this->setDatabase(...)`.
- Protected properties declared on list controllers (`$form`, `$datagrid`, `$pageNavigation`).

If **no** module exists yet, fall back to the patterns in the
`adianti-framework` skill references (`references/active-record.md`,
`references/datagrid-lists.md`, `references/forms-widgets.md`,
`references/architecture.md`).

### 2. Create the model — `app/model/<Entity>.php`

Mirror the reference model. Required elements:

```php
class Fornecedor extends TRecord
{
    const TABLENAME  = 'fornecedor';
    const PRIMARYKEY = 'id';
    const IDPOLICY   = 'max';       // 'max' | 'serial' | 'uuid7' — mirror siblings

    // Copy timestamp/audit constants if siblings use them:
    // const CREATEDAT = 'created_at';
    // const UPDATEDAT = 'updated_at';
    // const DELETEDAT = 'deleted_at';

    public function __construct($id = NULL)
    {
        parent::__construct($id);
        parent::addAttribute('name');          // only addAttribute() columns persist
        parent::addAttribute('document');
        parent::addAttribute('empresa_id');    // always register tenant column
        // ... add all columns
    }
}
```

**Rules:**

- Every persisted column **must** have `addAttribute()`. Omitting it silently ignores the column.
- Add relationships (composition / aggregation) only if the user declared child entities.
- Copy any shared trait the project applies to every model (changelog, soft-delete).

### 3. Create the list controller — `app/control/<domain>/<Entity>List.php`

Mirror the reference List. Required elements:

```php
class FornecedorList extends TPage
{
    protected $form;            // REQUIRED by AdiantiStandardListTrait
    protected $datagrid;        // REQUIRED by AdiantiStandardListTrait
    protected $pageNavigation;  // REQUIRED by AdiantiStandardListTrait

    use Adianti\Base\AdiantiStandardListTrait;

    public function __construct()
    {
        parent::__construct();
        $this->setDatabase('nome_banco');           // matches app/config/nome_banco.ini
        $this->setActiveRecord('Fornecedor');
        $this->setDefaultOrder('id', 'asc');
        $this->setLimit(15);

        // Filter fields: form_field_name, operator, [optional db_column]
        $this->addFilterField('name', 'like');

        // Search form
        $this->form = new BootstrapFormBuilder('form_search_Fornecedor');
        $this->form->setFormTitle('Fornecedores');
        $name = new TEntry('name');
        $this->form->addFields([new TLabel('Name')], [$name]);
        $this->form->setData(TSession::getValue('FornecedorList_filter_data'));
        $this->form->addAction('Search', new TAction([$this, 'onSearch']), 'fa:search blue');
        $this->form->addActionLink('New', new TAction(['FornecedorForm', 'onEdit']), 'fa:plus green');

        // DataGrid — call createModel() AFTER all columns and actions are added
        $this->datagrid = new BootstrapDatagridWrapper(new TDataGrid);
        $this->datagrid->addColumn(new TDataGridColumn('id',   'ID',   'center', '10%'));
        $this->datagrid->addColumn(new TDataGridColumn('name', 'Name', 'left',   '80%'));

        $action_edit   = new TDataGridAction(['FornecedorForm', 'onEdit'],  ['id' => '{id}']);
        $action_delete = new TDataGridAction([$this, 'onDelete'],            ['id' => '{id}']);
        $this->datagrid->addAction($action_edit,   'Edit',   'far:edit blue');
        $this->datagrid->addAction($action_delete, 'Delete', 'far:trash-alt red');
        $this->datagrid->createModel();   // REQUIRED — must be called after all columns

        // Pagination
        $this->pageNavigation = new TPageNavigation;
        $this->pageNavigation->enableCounters();
        $this->pageNavigation->setAction(new TAction([$this, 'onReload']));

        $container = new TVBox;
        $container->style = 'width:100%';
        $container->add(new TXMLBreadCrumb('menu.xml', __CLASS__));
        $container->add($this->form);
        $container->add(TPanelGroup::pack('', $this->datagrid, $this->pageNavigation));
        parent::add($container);   // REQUIRED — page renders blank without this
    }
}
```

### 4. Create the form controller — `app/control/<domain>/<Entity>Form.php`

Mirror the reference Form. The canonical method order inside every `try` block is
mandatory — never reorder these steps.

**onSave — canonical sequence (must follow this order):**

1. `TTransaction::open('db')` — first line inside the try
2. `$this->form->validate()` — before any data access
3. `$data = $this->form->getData()`
4. Custom business validations (`throw new Exception(...)` if invalid)
5. `$object = new Entity()` / or load existing by PK for edits
6. `$object->fromArray((array) $data)`
7. Set computed / protected fields (`empresa_id`, `dt_registro`, etc.)
8. `$object->store()`
9. `$data->id = $object->id; $this->form->setData($data)` — propagate new ID
10. `TTransaction::close()` — commit before any message or navigation
11. `new TMessage('info', ...)` — **after** close, outside the transaction

**onEdit — always wrap in TTransaction:**
Any `new Entity($id)` or `TRecord` load must be inside `TTransaction::open/close`.
Loading a record outside a transaction is an anti-pattern even for reads.

**onDelete — load, verify tenant, then delete:**
After `TTransaction::open`, load the object, verify `empresa_id`, then call `delete()`.

**catch block — rollback before message (always):**
`TTransaction::rollback()` must come before `new TMessage('error', ...)`.
Missing rollback leaves the transaction open; wrong order can mask data corruption.

```php
class FornecedorForm extends TPage
{
    protected $form;

    public function __construct()
    {
        parent::__construct();
        $this->form = new BootstrapFormBuilder('form_Fornecedor');
        $this->form->setFormTitle('Fornecedor');

        $id   = new TEntry('id');
        $name = new TEntry('name');

        $id->setEditable(false);
        $name->addValidation('Name', new TRequiredValidator);

        $this->form->addFields([new TLabel('ID')],   [$id]);
        $this->form->addFields([new TLabel('Name')], [$name]);

        $this->form->addAction('Save',  new TAction([$this, 'onSave']),   'fa:save green');
        $this->form->addActionLink('List', new TAction(['FornecedorList', 'onReload']), 'fa:table blue');

        $vbox = new TVBox;
        $vbox->style = 'width:100%';
        $vbox->add(new TXMLBreadCrumb('menu.xml', 'FornecedorList'));
        $vbox->add($this->form);
        parent::add($vbox);   // REQUIRED
    }

    public function onSave()
    {
        try {
            TTransaction::open('nome_banco');              // 1. first line
            $this->form->validate();                       // 2. validate before getData
            $data = $this->form->getData();                // 3. read form data

            // 4. custom business validation (example)
            // if (empty($data->name)) throw new Exception("Name is required.");

            $object = new Fornecedor;                      // 5. new or load existing by PK
            $object->fromArray((array) $data);             // 6. fill from form data
            $object->empresa_id = funcao::RetornaEmpresaId(); // 7. protected/computed fields
            $object->store();                              // 8. persist

            $data->id = $object->id;                       // 9. propagate new ID back
            $this->form->setData($data);
            TTransaction::close();                         // 10. commit
            new TMessage('info', AdiantiCoreTranslator::translate('Record saved')); // 11. after close
        } catch (Exception $e) {
            $this->form->setData($this->form->getData());
            TTransaction::rollback();                      // rollback BEFORE message
            new TMessage('error', $e->getMessage());
        }
    }

    public function onEdit($param)
    {
        try {
            if (isset($param['id'])) {
                TTransaction::open('nome_banco');           // REQUIRED even for reads
                $object = new Fornecedor($param['id']);
                if ($object->empresa_id !== funcao::RetornaEmpresaId()) {
                    throw new Exception("Access denied.");
                }
                $this->form->setData($object);
                TTransaction::close();
            } else {
                $this->form->clear();
            }
        } catch (Exception $e) {
            TTransaction::rollback();
            new TMessage('error', $e->getMessage());
        }
    }

    public function onDelete($param)
    {
        try {
            TTransaction::open('nome_banco');
            $object = new Fornecedor($param['id']);
            if ($object->empresa_id !== funcao::RetornaEmpresaId()) {
                throw new Exception("Access denied.");
            }
            $object->delete();
            TTransaction::close();
            $this->onReload($param);
        } catch (Exception $e) {
            TTransaction::rollback();
            new TMessage('error', $e->getMessage());
        }
    }
}
```

### 5. Register in `menu.xml`

Add the entry in the correct group, copying attribute names verbatim from a sibling entry.
Do not guess attribute names — open `menu.xml` and copy from a neighbouring `<menuitem>`.

```xml
<menuitem label="Fornecedores" action="FornecedorList" icon="fa:building" />
```

### 6. Report what remains

List every attribute, field, validation rule, relationship, and permission
the user still needs to declare or confirm. If fields were unknown, make this
explicit so nothing ships half-defined.

## Multi-Tenant Security

This project uses `empresa_id` to isolate tenants. **Enforce on every operation** —
never skip, even for read-only edits. Violation → `throw new Exception("Access denied.")`,
which the catch block will rollback and display.

| Operation | Rule |
| --- | --- |
| **TCriteria / TRepository** (list queries) | Always add `TFilter('empresa_id', '=', funcao::RetornaEmpresaId())` |
| **onEdit** (before `setData`) | Load object, verify `$object->empresa_id === funcao::RetornaEmpresaId()` |
| **onSave** (edit path, before `store`) | Verify `empresa_id` on the loaded object |
| **onSave** (new record) | Set `$object->empresa_id = funcao::RetornaEmpresaId()` in step 7 |
| **onDelete** (before `delete`) | Load object, verify `empresa_id`, then delete |

```php
// TCriteria — always include this in list controllers
$criteria->add(new TFilter('empresa_id', '=', funcao::RetornaEmpresaId()));

// Guard pattern for onEdit / onDelete
$object = new Fornecedor($param['id']);
if ($object->empresa_id !== funcao::RetornaEmpresaId()) {
    throw new Exception("Access denied.");
}
```

## Widget Type Guide

Choose the widget based on the column's data type. Mirror what siblings use for the same type.

| Column type | Widget |
| --- | --- |
| Short text / varchar | `TEntry` |
| Long text / text | `TText` |
| Integer / decimal / money | `TNumeric($name, $decimals, ',', '.', true)` |
| Date | `TDate` with `setMask('dd/mm/yyyy')` + `setDatabaseMask('yyyy-mm-dd')` |
| Date + time | `TDateTime` with `setMask('dd/mm/yyyy HH:ii')` + `setDatabaseMask('yyyy-mm-dd HH:ii:ss')` |
| Enum / static list | `TCombo` with `addItems(['key' => 'Label', ...])` |
| Boolean / checkbox | `TCheckButton` |
| FK → another table (simple dropdown) | `TDBCombo($name, $db, $model, 'id', 'name')` |
| FK → another table (autocomplete search) | `TDBUniqueSearch($name, $db, $model, 'id', 'name')` |
| Many-to-many checkboxes | `TDBCheckGroup` |
| Many-to-many multi-select | `TDBMultiCombo` or `TDBMultiSearch` |
| Single file upload | `TFile` |
| Multiple file upload | `TMultiFile` |
| Rich text / HTML | `THtmlEditor` |
| Password | `TPassword` |
| Hidden / system field | `THidden` |

**FK choice:** prefer `TDBUniqueSearch` when the FK table has many rows (autocomplete avoids
loading all options). Use `TDBCombo` only for small, bounded lookup tables.

## Anti-Patterns — Never Generate These

| Anti-pattern | Correct approach |
| --- | --- |
| `new Entity($id)` outside `TTransaction::open/close` | Every TRecord load must be inside `TTransaction::open/close` — even reads |
| Forgetting `addAttribute('col')` for a column | Column silently ignored on store — register every persisted column |
| Forgetting `$this->datagrid->createModel()` | DataGrid renders empty — call after all columns and actions are added |
| Forgetting `parent::add($container)` | Page renders blank — always call at end of constructor |
| `new TMessage('error', ...)` in catch before `TTransaction::rollback()` | Always rollback first, then show the error message |
| Calling `$this->form->validate()` after `getData()` or not at all | Must be first — persists invalid data otherwise |
| Callbacks passed to `setChangeAction()` as instance methods | Must be `public static` — AJAX calls have no instance context |
| Omitting `empresa_id` filter in list TCriteria | Data from other tenants leaks — always filter by `funcao::RetornaEmpresaId()` |
| Operating on a record from another tenant in onEdit / onDelete | Always verify `$object->empresa_id` before operating — throw on mismatch |
| Forgetting `$data->id = $object->id` after `store()` | Form loses the new record's ID on subsequent saves |
| Omitting `protected $form`, `$datagrid`, `$pageNavigation` | Required properties for `AdiantiStandardListTrait` |
| Not restoring `setData(TSession::getValue(...))` on search form | Filter values lost on page reload |
| Raw PDO queries instead of TRecord / TRepository | Use `TRecord::getObjects()` or `TRepository::load()` |
| `new TMessage(...)` inside the transaction (before `TTransaction::close()`) | Show messages only after closing/committing the transaction |

## Rules

- **Consistency beats convention.** When the project's pattern differs from the
  generic Adianti docs, follow the project.
- **Every DB access uses `TTransaction`** with the same database name the siblings use.
  This includes reads — `new Entity($id)` always needs `TTransaction::open/close`.
- **Never edit** `lib/adianti/` (framework core).
- **Show files before writing.** Before any Write tool call, list every file you will
  create with its path and a one-line description (e.g. `app/model/Fornecedor.php` —
  Active Record model). Wait for explicit user confirmation before writing, unless the
  user has already pre-approved scaffolding in this conversation.
- **Flag every open item.** If any field type, validation, relationship, or menu group
  is unknown, list it explicitly in your report — never silently scaffold a half-defined module.
