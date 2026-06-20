---
name: adianti-framework
description: This skill should be used when the user is working on a PHP project that uses the Adianti Framework (version 7.x, 8.x) — identified by TRecord, TPage, TForm, TDataGrid, TTransaction, BootstrapFormBuilder, AdiantiStandardListTrait, or adianti/ in paths. Use when the user asks to "create a form", "create a list", "create a CRUD", "add a datagrid", "implement master-detail", "add a seek button", "create an Active Record model", "add relationship", "implement composition", "add aggregation", "create a window", "configure database connection", "add filter field", "create seek window", "add file upload", "export datagrid", "cascading combo", "dynamic filter", or any task involving Adianti classes, patterns, or architecture.
version: 1.0.0
---

# Adianti Framework Expert

Adianti Framework is a PHP MVC framework (v8.5, min PHP 8.2) for building web systems with Bootstrap 5 UI, Active Record ORM, reactive form system, paginated datagrids, and a full widget library (188 classes, 1985 methods).

## Architecture at a Glance

```
app/
├── config/
│   ├── application.php     ← theme, language, debug, template options
│   └── *.ini               ← one per database connection
├── model/                  ← Active Records (extend TRecord)
├── control/                ← Page controllers (extend TPage / TWindow)
├── service/                ← Business logic, REST services
└── view/                   ← Reusable presentation classes
lib/adianti/               ← Framework core (never edit)
menu.xml                   ← Application navigation + permissions
index.php                  ← Entry point
engine.php                 ← Ajax/action dispatcher
```

Controllers are plain PHP classes that extend `TPage`. The request cycle:

1. `index.php` parses `?class=ClassName&method=methodName&params`
2. `engine.php` instantiates the class and calls the method
3. The page renders HTML via `parent::add($container)` and `show()`

**Full reference files:**

- `references/architecture.md` — project structure, config, menu, lifecycle, themes, permissions
- `references/active-record.md` — TRecord, relationships, soft-delete, caching, static finders
- `references/repository-database.md` — TTransaction, TRepository, TCriteria, TFilter, TConnection
- `references/forms-widgets.md` — BootstrapFormBuilder, all field types, validators, file upload
- `references/datagrid-lists.md` — TDataGrid, columns, actions, pagination, export traits, standard traits
- `references/layout-components.md` — TVBox, THBox, TWindow, TNotebook, TMessage, dialogs
- `references/patterns-cookbook.md` — complete annotated examples for every pattern

---

## Core Rules (Always Apply)

### 1. Every Database Access Needs TTransaction

```php
TTransaction::open('database_name');  // matches app/config/database_name.ini
try {
    // all CRUD here
    TTransaction::close();
} catch (Exception $e) {
    new TMessage('error', $e->getMessage());
    TTransaction::rollback();
}
```

Never access models outside a transaction. Never use raw PDO — always use TRecord / TRepository / TTransaction.

### 2. Model Constants Are Mandatory

```php
class Product extends TRecord
{
    const TABLENAME  = 'product';
    const PRIMARYKEY = 'id';
    const IDPOLICY   = 'max';    // 'max' = SELECT MAX(id)+1, 'serial' = DB sequence/autoincrement, 'uuid7'

    public function __construct($id = NULL)
    {
        parent::__construct($id);
        parent::addAttribute('name');    // only addAttribute() columns are persisted
        parent::addAttribute('price');
        parent::addAttribute('category_id');
    }
}
```

### 3. Controllers Are Classes, Actions Are Public Methods

```php
class ProductList extends TPage
{
    use Adianti\Base\AdiantiStandardListTrait;  // gives onReload, onSearch, onDelete

    public function __construct()
    {
        parent::__construct();
        $this->setDatabase('samples');
        $this->setActiveRecord('Product');
        // ... build form + datagrid
        parent::add($container);
    }
}
```

Actions referenced in `TAction` must be public (or static for AJAX callbacks without instance).

### 4. TAction Points to a Controller Method

```php
new TAction(['ClassName', 'methodName'])               // static call
new TAction([$this, 'methodName'])                     // instance call
new TAction(['ClassName', 'method'], ['key' => '{id}']) // with parameters
```

For AJAX callbacks (change actions, inline edits), mark methods `public static`.

---

## Pattern Decision Tree

| Goal | Pattern to use |
|------|---------------|
| List records with search + pagination | `TStandardList` trait on `TPage` |
| Create/Edit/Delete one record | `TStandardForm` trait on `TPage` |
| List + form on same page | `TStandardFormList` trait on `TPage` |
| Master record + detail rows (inline datagrid) | Manual master-detail in `TPage` |
| Popup lookup/search | `TWindow` seek class with `TForm::sendData()` |
| Read-only detail in side panel | `setTargetContainer('adianti_right_panel')` |
| Form in modal dialog | Extend `TWindow`, wrap form class |
| Many-to-many tags/skills | `TDBCheckGroup` + `saveAggregate()` |
| Dynamic inline rows (contacts list) | `TFieldList` + `saveComposite()` |
| Cascading combos | `setChangeAction()` + `TCombo::reload()` |
| File upload | `TFile` + `AdiantiFileSaveTrait::saveFile()` |

---

## Standard List — Minimal Boilerplate

```php
class ProductList extends TPage
{
    protected $form;
    protected $datagrid;
    protected $pageNavigation;

    use Adianti\Base\AdiantiStandardListTrait;

    public function __construct()
    {
        parent::__construct();
        $this->setDatabase('samples');
        $this->setActiveRecord('Product');
        $this->setDefaultOrder('id', 'asc');
        $this->addFilterField('name', 'like');       // form field name → DB column

        // Search form
        $this->form = new BootstrapFormBuilder('form_search_Product');
        $this->form->setFormTitle('Products');
        $name = new TEntry('name');
        $this->form->addFields([new TLabel('Name')], [$name]);
        $this->form->setData(TSession::getValue('ProductList_filter_data'));
        $this->form->addAction('Find', new TAction([$this, 'onSearch']), 'fa:search blue');
        $this->form->addActionLink('New', new TAction(['ProductForm', 'onEdit']), 'fa:plus green');

        // DataGrid
        $this->datagrid = new BootstrapDatagridWrapper(new TDataGrid);
        $this->datagrid->addColumn(new TDataGridColumn('id', 'ID', 'center', '10%'));
        $this->datagrid->addColumn(new TDataGridColumn('name', 'Name', 'left', '70%'));
        $this->datagrid->addColumn(new TDataGridColumn('price', 'Price', 'right', '20%'));

        $action_edit   = new TDataGridAction(['ProductForm', 'onEdit'],   ['id' => '{id}']);
        $action_delete = new TDataGridAction([$this, 'onDelete'],          ['id' => '{id}']);
        $this->datagrid->addAction($action_edit,   'Edit',   'far:edit blue');
        $this->datagrid->addAction($action_delete, 'Delete', 'far:trash-alt red');
        $this->datagrid->createModel();

        // Pagination
        $this->pageNavigation = new TPageNavigation;
        $this->pageNavigation->enableCounters();
        $this->pageNavigation->setAction(new TAction([$this, 'onReload']));

        $container = new TVBox;
        $container->style = 'width:100%';
        $container->add(new TXMLBreadCrumb('menu.xml', __CLASS__));
        $container->add($this->form);
        $container->add(TPanelGroup::pack('', $this->datagrid, $this->pageNavigation));
        parent::add($container);
    }
}
```

## Standard Form — Minimal Boilerplate

```php
class ProductForm extends TPage
{
    protected $form;

    public function __construct()
    {
        parent::__construct();
        $this->form = new BootstrapFormBuilder('form_Product');
        $this->form->setFormTitle('Product');

        $id    = new TEntry('id');
        $name  = new TEntry('name');
        $price = new TNumeric('price', 2, ',', '.', true);

        $id->setEditable(false);
        $name->addValidation('Name', new TRequiredValidator);
        $price->addValidation('Price', new TRequiredValidator);

        $this->form->addFields([new TLabel('ID')],    [$id]);
        $this->form->addFields([new TLabel('Name')],  [$name]);
        $this->form->addFields([new TLabel('Price')], [$price]);

        $this->form->addAction('Save',  new TAction([$this, 'onSave']), 'fa:save green');
        $this->form->addActionLink('List', new TAction(['ProductList', 'onReload']), 'fa:table blue');

        $vbox = new TVBox;
        $vbox->style = 'width:100%';
        $vbox->add(new TXMLBreadCrumb('menu.xml', 'ProductList'));
        $vbox->add($this->form);
        parent::add($vbox);
    }

    public function onSave()
    {
        try {
            TTransaction::open('samples');
            $this->form->validate();
            $data = $this->form->getData();
            $object = new Product;
            $object->fromArray((array) $data);
            $object->store();
            $data->id = $object->id;
            $this->form->setData($data);
            TTransaction::close();
            new TMessage('info', AdiantiCoreTranslator::translate('Record saved'));
        } catch (Exception $e) {
            $this->form->setData($this->form->getData());
            new TMessage('error', $e->getMessage());
            TTransaction::rollback();
        }
    }

    public function onEdit($param)
    {
        try {
            if (isset($param['id'])) {
                TTransaction::open('samples');
                $object = new Product($param['id']);
                $this->form->setData($object);
                TTransaction::close();
            } else {
                $this->form->clear();
            }
        } catch (Exception $e) {
            new TMessage('error', $e->getMessage());
            TTransaction::rollback();
        }
    }
}
```

---

## Common Anti-Patterns to Avoid

| Anti-pattern | Correct approach |
|---|---|
| Accessing model outside transaction | Always wrap in `TTransaction::open/close` |
| Using `SELECT *` via raw PDO | Use `TRecord::getObjects()` or `TRepository::load()` |
| Not calling `addAttribute()` for a column | Column won't persist — always register all attributes |
| `new TMessage()` inside a catch without rollback | Always call `TTransaction::rollback()` in catch |
| Forgetting `$this->form->validate()` before saving | Will save invalid/incomplete data |
| Hard-coding database name | Use `$this->setDatabase('name')` / config-driven |
| Putting business logic in the view/form class | Put in model methods or service classes |
| AJAX callbacks as instance methods | Must be `public static` for AJAX |
| Not calling `$this->datagrid->createModel()` | DataGrid won't render columns |
| Forgetting `parent::add($container)` | Page renders blank |
| Not registering class in menu.xml or allowed classes | Page won't be accessible |

---

## Key Widget Quick Reference

| Need | Class |
|---|---|
| Text input | `TEntry` |
| Number with mask | `TNumeric($name, $dec, $decSep, $thouSep)` |
| Date picker | `TDate` |
| Date+time picker | `TDateTime` |
| Dropdown | `TCombo` / `TDBCombo` |
| Multi-select dropdown | `TMultiCombo` / `TDBMultiCombo` |
| Autocomplete search | `TUniqueSearch` / `TDBUniqueSearch` |
| Multi-value autocomplete | `TMultiSearch` / `TDBMultiSearch` |
| Checkbox group | `TCheckGroup` / `TDBCheckGroup` |
| Radio group | `TRadioGroup` / `TDBRadioGroup` |
| File upload (single) | `TFile` |
| File upload (multiple) | `TMultiFile` |
| HTML editor | `THtmlEditor` |
| Image upload + crop | `TImageCropper` |
| Signature | `TSignaturePad` |
| Hidden field | `THidden` |
| Password | `TPassword` |
| Text area | `TText` |

---

## References

Load these files when you need detailed information:

- **`references/architecture.md`** — full project structure, config files format, menu.xml, permissions, themes
- **`references/active-record.md`** — all TRecord methods, relationship patterns (composition/aggregation), soft-delete, caching
- **`references/repository-database.md`** — TTransaction, TRepository fluent API, TCriteria, TFilter, SQL builders
- **`references/forms-widgets.md`** — every form builder, every field type with all methods, validators
- **`references/datagrid-lists.md`** — TDataGrid full API, standard traits, export, pagination, inline edit
- **`references/layout-components.md`** — container elements, dialogs, windows, navigation, notifications
- **`references/patterns-cookbook.md`** — complete annotated code for: master-detail, seek window, side panel, cascading combos, file upload, composition, aggregation
