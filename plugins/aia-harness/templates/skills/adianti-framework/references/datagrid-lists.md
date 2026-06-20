# Adianti Framework — DataGrid & Lists

## BootstrapDatagridWrapper — Primary DataGrid (v8.x)

```php
$datagrid = new BootstrapDatagridWrapper(new TDataGrid);
$datagrid->style = 'width:100%';
$datagrid->setHeight(400);          // optional fixed height (px)
$datagrid->disableDefaultClick();   // disable row-click → edit

// Add columns
$datagrid->addColumn(new TDataGridColumn('id',    'ID',     'center', '10%'));
$datagrid->addColumn(new TDataGridColumn('name',  'Name',   'left',   '50%'));
$datagrid->addColumn(new TDataGridColumn('price', 'Price',  'right',  '20%'));
$datagrid->addColumn(new TDataGridColumn('date',  'Date',   'center', '20%'));

// Add row actions (buttons per row)
$action_edit   = new TDataGridAction(['ProductForm', 'onEdit'],  ['id' => '{id}']);
$action_delete = new TDataGridAction([$this, 'onDelete'],         ['id' => '{id}']);
$action_edit->setLabel('Edit');
$action_edit->setImage('far:edit blue');
$action_delete->setLabel('Delete');
$action_delete->setImage('far:trash-alt red');
$action_delete->setField('name');     // used in confirmation message
$action_delete->setUseButton(false);  // icon-only, no button frame

$datagrid->addAction($action_edit);
$datagrid->addAction($action_delete);

// REQUIRED: generate model after all columns + actions defined
$datagrid->createModel();
```

---

## TDataGridColumn — Column Configuration

```php
$col = new TDataGridColumn('field_name', 'Header Label', 'left', '25%');
// TDataGridColumn($field, $label, $align, $width)

// Format callbacks
$col->setTransformer(function($value, $obj, $row) {
    return number_format($value, 2, ',', '.');
});

// Color rows based on value
$col->setTransformer(function($value, $obj, $row) {
    if ($obj->status == 'overdue') {
        $row->style = 'color:red';
    }
    return $value;
});

// Display image/icon
$col->setTransformer(function($value, $obj, $row) {
    if ($value) {
        $img = new TImage("files/{$value}");
        $img->setSize(32, 32);
        return $img;
    }
    return '';
});

// Make column sortable (header click)
$col->enableAutoHide(600);    // hide col on screens < 600px

// Relationship traversal (auto-resolves via magic getters)
new TDataGridColumn('{customer->name}', 'Customer', 'left', '30%');
new TDataGridColumn('{city->state->name}', 'State', 'left', '15%');
// Null-safe (v8.1+)
new TDataGridColumn('{category?->name}', 'Category', 'left', '20%');
```

---

## AdiantiStandardListTrait — Auto List Behavior

Add this trait to a list controller to get `onReload`, `onSearch`, `onDelete` for free.

```php
class ProductList extends TPage
{
    protected $form;          // REQUIRED: search form
    protected $datagrid;      // REQUIRED: data grid
    protected $pageNavigation; // REQUIRED: pagination

    use Adianti\Base\AdiantiStandardListTrait;

    public function __construct()
    {
        parent::__construct();
        $this->setDatabase('samples');               // database INI name
        $this->setActiveRecord('Product');            // model class name
        $this->setDefaultOrder('id', 'asc');          // default sort
        $this->setLimit(15);                          // rows per page
        $this->setTransformer([$this, 'formatRow']);  // optional row callback

        // Filter fields: form_field_name, operator, [db_column_if_different]
        $this->addFilterField('name',        'like');       // WHERE name LIKE '%...%'
        $this->addFilterField('category_id', '=');          // WHERE category_id = ?
        $this->addFilterField('price',       '>=', 'price'); // explicit column
        $this->addFilterField('date_from',   '>=', 'date',  function($v) {
            return TDate::convertToMask($v, 'dd/mm/yyyy', 'yyyy-mm-dd');
        });

        // Build form + datagrid (see SKILL.md boilerplate)
        // ...
    }

    // Optional: custom row formatter
    public function formatRow($obj)
    {
        $obj->price_fmt = 'R$ ' . number_format($obj->price, 2, ',', '.');
        return $obj;
    }
}
```

**Trait provides:**

- `onReload($param)` — paginated query, populates `$this->datagrid`
- `onSearch()` — saves filter form data to session, calls `onReload`
- `onDelete($param)` — deletes record, refreshes list

Session key pattern: `{ClassName}_filter_data`.

---

## TPageNavigation — Pagination

```php
$nav = new TPageNavigation;
$nav->enableCounters();                                  // show "X to Y of Z records"
$nav->setAction(new TAction([$this, 'onReload']));
$nav->setWidth(800);

// In onReload(), bind the navigation:
$this->pageNavigation->setCount($count);
$this->pageNavigation->setProperties($param);
$this->pageNavigation->setLimit($limit);
```

---

## Export Buttons (CSV, XLS, PDF)

### BootstrapDatagridWrapper built-in export

```php
$datagrid = new BootstrapDatagridWrapper(new TDataGrid);
// Export buttons added to datagrid header
$datagrid->enableExport(
    filename:   'products',
    title:      'Product List',
    formats:    ['csv', 'xls', 'pdf'],      // optional subset
);
```

### Manual export from onReload()

```php
public static function onExportCSV($param)
{
    $criteria = self::buildCriteria();   // reuse filter logic
    TTransaction::open('samples');
    $objects = (new TRepository('Product'))->load($criteria);
    TTransaction::close();

    $data = array_map(fn($o) => [
        'ID'    => $o->id,
        'Name'  => $o->name,
        'Price' => $o->price,
    ], $objects);

    TSpreadsheetXLSX::exportFromArray($data, 'products.xlsx');
}
```

---

## TDataGridAction — Row Actions

```php
$action = new TDataGridAction(['ClassName', 'method'], ['id' => '{id}']);
$action->setLabel('View');
$action->setImage('far:eye blue');
$action->setUseButton(true);           // render as button (default false = icon)
$action->setButtonClass('btn btn-sm btn-primary');
$action->setField('name');             // shown in delete confirm dialog
$action->setVisibilityCondition(function($obj) {
    return $obj->status == 'active';   // hide action for certain rows
});

// Add to datagrid
$datagrid->addAction($action, 'View', 'far:eye blue');
// or
$datagrid->addAction($action);   // label/icon already set on $action
```

---

## Inline DataGrid Editing (master-detail)

For master-detail with editable inline rows (like SaleForm):

```php
// Column with inline TEntry
$col_qty = new TDataGridColumn('quantity', 'Qty', 'center', '100px');
$col_qty->setEditAction(new TAction([$this, 'onMutationAction']));
// The action receives row data when user changes the field

// Replace row after recalculation
public function onMutationAction($param)
{
    $row = $param;   // all row fields
    $row['total'] = $row['quantity'] * $row['unit_price'];
    TDataGrid::replaceRowById('datagrid_id', $row['id'], $row);
}

// Remove row
TDataGrid::removeRowById('datagrid_id', $row_id);
```

---

## TDataGrid::prependRow — Sticky Header Row

Used for inline filters above the data rows:

```php
$filter_row = $datagrid->prependRow();
$name_filter = new TEntry('filter_name');
$name_filter->exitOnEnter();
$name_filter->setChangeAction(new TAction([$this, 'onSearch']));
$filter_row->addCell($name_filter);
```

---

## Column Groups and Subtotals (v8.5)

```php
// Group columns under a header
$datagrid->addColumnGroup('Dimensions', ['width', 'height', 'depth']);

// Auto-subtotal a column
$col_price = new TDataGridColumn('price', 'Price', 'right', '20%');
$col_price->enableSum('R$ {value}');   // shows sum in footer row
$datagrid->addColumn($col_price);
```

---

## TDataGrid — Standalone (without Wrapper)

```php
$grid = new TDataGrid;
$grid->style = 'width:100%';
$grid->setHeight(300);
$grid->disableDefaultClick();
$grid->addColumn(new TDataGridColumn('name', 'Name', 'left', '100%'));
$grid->createModel();

// Populate in onReload()
$grid->clear();
foreach ($objects as $obj) {
    $row = $grid->addItem($obj);
    $row->style = 'background:#f5f5f5';
}
```

---

## DataGrid Populate Pattern (used in onReload)

```php
public function onReload($param = [])
{
    try {
        TTransaction::open('samples');

        $repository = new TRepository('Product');
        $criteria   = new TCriteria;

        // Restore filter from session
        $filter = TSession::getValue('ProductList_filter_data');
        if ($filter && $filter->name) {
            $criteria->add(new TFilter('name', 'like', $filter->name));
        }

        $limit  = 15;
        $offset = ($param['offset'] ?? 0);
        $criteria->setProperty('order',     'name');
        $criteria->setProperty('direction', 'asc');
        $criteria->setProperty('limit',     $limit);
        $criteria->setProperty('offset',    $offset);

        $count      = $repository->count(clone $criteria);
        $objects    = $repository->load($criteria);

        $this->datagrid->clear();
        if ($objects) {
            foreach ($objects as $object) {
                $row = $this->datagrid->addItem($object);
            }
        }

        $this->pageNavigation->setCount($count);
        $this->pageNavigation->setProperties($param);
        $this->pageNavigation->setLimit($limit);

        TTransaction::close();
        $this->loaded = true;
    } catch (Exception $e) {
        new TMessage('error', $e->getMessage());
        TTransaction::rollback();
    }
}
```

---

## TDataGrid Columns: Formatting Shortcuts

```php
// Badge/status column
$col_status = new TDataGridColumn('status', 'Status', 'center', '15%');
$col_status->setTransformer(function($v) {
    $colors = ['active' => 'success', 'inactive' => 'danger', 'pending' => 'warning'];
    $color  = $colors[$v] ?? 'secondary';
    return "<span class='badge bg-{$color}'>{$v}</span>";
});
// Note: use TDataGridColumnColor for simple color mapping

// Currency
$col_price->setTransformer(fn($v) => 'R$ ' . number_format($v, 2, ',', '.'));

// Date
$col_date->setTransformer(fn($v) => TDate::convertToMask($v, 'yyyy-mm-dd', 'dd/mm/yyyy'));

// Conditional icon
$col_active->setTransformer(fn($v) =>
    $v ? '<i class="fas fa-check text-success"></i>' : '<i class="fas fa-times text-danger"></i>'
);
```
