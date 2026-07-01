# Adianti Framework — Layout & Components

## TVBox / THBox — Container Building Blocks

```php
// Vertical stack
$vbox = new TVBox;
$vbox->style = 'width:100%';
$vbox->add($form);
$vbox->add($datagrid);

// Horizontal row
$hbox = new THBox;
$hbox->add($left_panel);   // cells side by side
$hbox->add($right_panel);

// Use as root container
parent::add($vbox);
parent::show();
```

---

## TPanelGroup — Bootstrap Card Panel

```php
// Simple panel wrapping content
$panel = TPanelGroup::pack('Panel Title', $datagrid);
$panel = TPanelGroup::pack('',            $datagrid, $pageNavigation);
$panel->style = 'width:100%';

// Manual construction for more control
$panel = new TPanelGroup('Products');
$panel->add($datagrid);
$panel->addFooter($pageNavigation);
$panel->setHeaderActions([
    new TButton('btn_add', 'fa:plus green', 'Add', new TAction(['ProductForm', 'onEdit']))
]);
```

---

## TPanel — Simple Content Container

```php
$panel = new TPanel(400, 300);  // width, height (px)
$panel->put($form, 10, 10);     // place at x=10, y=10
$panel->put($button, 10, 60);
```

---

## TNotebook — Tabbed Interface

```php
$notebook = new TNotebook;
$notebook->style = 'width:100%; height:auto;';

$notebook->appendPage('General',  $page1_content);
$notebook->appendPage('Details',  $page2_content);
$notebook->appendPage('Files',    $page3_content);

parent::add($notebook);

// Select tab programmatically
$notebook->setCurrentPage(1);   // 0-indexed

// Notebook pills style (v8.5)
$notebook = new TNotebook(style: 'pills');
```

---

## TWindow — Modal / Float Window (Controller)

Extend `TWindow` to create a popup window (seek dialogs, edit modals):

```php
class CustomerFormWindow extends TWindow
{
    private $form_view;

    public function __construct()
    {
        parent::__construct();
        $this->setTitle('Customer');
        $this->setSize(0.5, null);        // 50% width, auto height
        $this->setMinWidth(0.5, 700);     // responsive min 700px
        $this->removePadding();           // remove internal padding
        $this->disableEscape();           // don't close on Esc
        // $this->disableClose();         // remove X button

        $this->form_view = new CustomerFormView;
        parent::add($this->form_view);
    }

    public static function onEdit($param)
    {
        parent::openWindow(new self);
    }
}

// Open from another controller:
TApplication::openPage(['class' => 'CustomerFormWindow', 'method' => 'onEdit', 'id' => $id]);
// or via TAction:
$action = new TAction(['CustomerFormWindow', 'onEdit'], ['id' => '{id}']);
```

### Seek Window Pattern

```php
class CustomerSeek extends TWindow
{
    public function __construct()
    {
        parent::__construct();
        $this->setTitle('Select Customer');
        $this->setSize(0.8, 0.8);

        $datagrid = new BootstrapDatagridWrapper(new TDataGrid);
        $datagrid->addColumn(new TDataGridColumn('id',   'ID',   'center', '10%'));
        $datagrid->addColumn(new TDataGridColumn('name', 'Name', 'left',   '90%'));

        // Click row → send data back to parent form
        $action = new TDataGridAction([$this, 'onSelect'], ['id' => '{id}', 'name' => '{name}']);
        $datagrid->addAction($action, 'Select', 'fa:check green');
        $datagrid->createModel();

        // Populate
        TTransaction::open('samples');
        foreach (Customer::all() as $c) {
            $datagrid->addItem($c);
        }
        TTransaction::close();

        parent::add($datagrid);
    }

    public function onSelect($param)
    {
        // Send data back to parent form
        TForm::sendData('form_Order', (object) [
            'customer_id'   => $param['id'],
            'customer_name' => $param['name'],
        ]);
        parent::closeWindow();
    }
}
```

---

## Side Panel (Right Panel)

Load content into the right side panel without navigating away:

```php
class SaleSidePanelView extends TPage
{
    public function __construct()
    {
        parent::__construct();
        // Build the panel content
        $container = new TVBox;
        $container->style = 'width:100%; padding:15px';
        $container->add(new TXMLBreadCrumb('menu.xml', 'SaleList'));
        // ... add form/details ...
        parent::add($container);
    }
}

// In the calling controller (e.g. list row action):
$action = new TDataGridAction(['SaleSidePanelView', 'onLoad'], ['id' => '{id}']);
$action->setTarget('adianti_right_panel');   // load into right panel

// Alternative: set on the page class itself
class SaleSidePanelView extends TPage
{
    public function __construct()
    {
        parent::__construct();
        parent::setTargetContainer('adianti_right_panel');
        // ...
    }
}
```

---

## Dialogs and Messages

### TMessage — Info / Error / Question Box

```php
new TMessage('info',    'Operation completed successfully');
new TMessage('error',   $e->getMessage());
new TMessage('warning', 'Check the data before saving');

// With callback on close
new TMessage('info', 'Saved!', new TAction(['ProductList', 'onReload']));
```

### TQuestion — Confirm Dialog

```php
new TQuestion('Are you sure you want to delete this record?',
    new TAction([$this, 'onDeleteConfirm'], ['id' => $id]),  // Yes
    new TAction([$this, 'onCancel'])                          // No
);
```

### TToast — Non-blocking Toast Notification

```php
TToast::show('success', 'Record saved!',  'top right', 'fa:check-circle');
TToast::show('error',   'Error occurred', 'top right', 'fa:exclamation-circle');
// Positions: 'top right', 'top left', 'bottom right', 'bottom left', 'top center'
```

### TNotify — Notification Bar (top)

```php
TNotify::show('success', 'Saved', 'fa:check', 3000);  // 3 seconds
```

---

## TScript — Execute JavaScript

```php
// Run JS immediately
TScript::create("alert('hello')");

// Reload current page
TScript::create("__adianti_load_page('{url}')");

// Redirect
TApplication::gotoPage('ProductList');
// Or full redirect with params
TApplication::gotoPage('ProductForm', 'onEdit', ['id' => 42]);
```

---

## TBreadCrumb / TXMLBreadCrumb

```php
// Auto-built from menu.xml
$bc = new TXMLBreadCrumb('menu.xml', 'ProductList');

// Manual
$bc = new TBreadCrumb;
$bc->addItem('Home',     new TAction(['Dashboard', 'onLoad']));
$bc->addItem('Products', new TAction(['ProductList', 'onReload']));
$bc->addItem('Edit');   // current page (no link)
```

---

## TImage

```php
$img = new TImage('app/images/logo.png');
$img->setSize(100, 50);    // width, height

// Dynamic file path
$img = new TImage("files/products/{$product->photo}");
$img->onclick = "window.open(this.src)";
```

---

## TButton — Standalone Button

```php
$btn = new TButton('btn_save');
$btn->setLabel('Save');
$btn->setImage('fa:save green');
$btn->setAction(new TAction([$this, 'onSave']));
$btn->setProperty('style', 'margin: 5px');
```

---

## TPage — Base Controller

```php
class MyPage extends TPage
{
    public function __construct()
    {
        parent::__construct();

        $container = new TVBox;
        $container->style = 'width:100%';
        // ... build UI ...
        parent::add($container);
    }

    // Static action methods for AJAX callbacks
    public static function onReload($param = [])
    {
        $page = new self;
        $page->onLoad($param);
    }
}
```

**`parent::add($container)` must be called once — defines what renders.**

---

## TWizard — Step Wizard

```php
$wizard = new TWizard(600, 400);  // width, height
$wizard->addStep('Step 1', $step1_form);
$wizard->addStep('Step 2', $step2_form);
$wizard->addStep('Confirm', $confirm_panel);
$wizard->setFinishAction(new TAction([$this, 'onFinish']));
parent::add($wizard);
```

---

## TFrameView / TPageFrame (v8.1+)

Embeds another page/URL inside the current page:

```php
$frame = new TPageFrame;
$frame->setAction(new TAction(['DashboardWidget', 'onLoad']));
$frame->setSize('100%', 400);
parent::add($frame);

// Or embed external URL
$frame = new TFrameView('https://example.com/widget');
$frame->setSize('100%', 300);
```

---

## Charts (v8.3+)

```php
// Bar chart
$chart = new TBarChart;
$chart->setTitle('Sales by Month');
$chart->setSize('100%', 300);
$chart->setLabels(['Jan', 'Feb', 'Mar']);
$chart->addSeries('Revenue', [10000, 15000, 12000]);

// Line chart
$chart = new TLineChart;
$chart->addSeries('Users', [100, 120, 115]);

// Pie chart
$chart = new TPieChart;
$chart->setData(['PHP' => 40, 'Python' => 30, 'JS' => 30]);
```

---

## Container Utilities

```php
// Create spacer
$space = new TElement('br');

// Raw HTML
$html = new TElement('div');
$html->add('<strong>Status:</strong> Active');
$html->style = 'color: green';

// Use inside TVBox
$vbox->add($html);
```

---

## AdiantiCoreTranslator — i18n

```php
// Get translated string
$msg = AdiantiCoreTranslator::translate('Record saved');
$msg = AdiantiCoreTranslator::translate('Record deleted');

// Common keys
'Record saved'         // success save
'Record deleted'       // success delete
'Permission denied'    // access control
'Field required'       // validator
'Invalid email'        // validator
'Record not found'     // load failure
```
