# Adianti Framework — Patterns Cookbook

Complete annotated examples for every common Adianti pattern.

---

## 1. Master-Detail (Sale with Items)

Inline datagrid of child records on a parent form. Manual pattern — no trait.

```php
class SaleForm extends TPage
{
    private $form;
    private $detail_list;  // inline TDataGrid for items

    public function __construct()
    {
        parent::__construct();

        // PARENT FORM
        $this->form = new BootstrapFormBuilder('form_Sale');
        $this->form->setFormTitle('Sale');

        $id       = new TEntry('id');    $id->setEditable(false);
        $date     = new TDate('date');   $date->setMask('dd/mm/yyyy'); $date->setDatabaseMask('yyyy-mm-dd');
        $customer = new TDBUniqueSearch('customer_id', 'samples', 'Customer', 'id', 'name');
        $total    = new TNumeric('total', 2, ',', '.', true);
        $total->setEditable(false);

        $this->form->addFields([new TLabel('ID')],       [$id]);
        $this->form->addFields([new TLabel('Date')],     [$date]);
        $this->form->addFields([new TLabel('Customer')], [$customer]);
        $this->form->addFields([new TLabel('Total')],    [$total]);

        // DETAIL DATAGRID
        $this->detail_list = new BootstrapDatagridWrapper(new TDataGrid);
        $this->detail_list->style = 'width:100%';
        $this->detail_list->disableDefaultClick();

        $col_product  = new TDataGridColumn('product_name', 'Product',  'left',   '40%');
        $col_qty      = new TDataGridColumn('quantity',     'Qty',      'center', '15%');
        $col_price    = new TDataGridColumn('unit_price',   'Price',    'right',  '20%');
        $col_subtotal = new TDataGridColumn('subtotal',     'Subtotal', 'right',  '20%');
        $this->detail_list->addColumn($col_product);
        $this->detail_list->addColumn($col_qty);
        $this->detail_list->addColumn($col_price);
        $this->detail_list->addColumn($col_subtotal);

        // Actions per row
        $action_remove = new TDataGridAction([$this, 'onRemoveItem'], ['id' => '{id}']);
        $this->detail_list->addAction($action_remove, 'Remove', 'fa:trash red');
        $this->detail_list->createModel();

        // INLINE ADD FORM
        $add_form = new BootstrapFormBuilder('form_add_item');
        $product  = new TDBUniqueSearch('product_id', 'samples', 'Product', 'id', 'name');
        $qty      = new TNumeric('quantity', 0, ',', '.', true);
        $add_form->addFields([new TLabel('Product')],  [$product]);
        $add_form->addFields([new TLabel('Quantity')], [$qty]);
        $add_form->addAction('Add', new TAction([$this, 'onAddItem']), 'fa:plus green');

        // MAIN ACTIONS
        $this->form->addAction('Save', new TAction([$this, 'onSave']), 'fa:save green');
        $this->form->addActionLink('List', new TAction(['SaleList', 'onReload']), 'fa:table blue');

        $vbox = new TVBox;
        $vbox->style = 'width:100%';
        $vbox->add(new TXMLBreadCrumb('menu.xml', 'SaleList'));
        $vbox->add($this->form);
        $vbox->add(TPanelGroup::pack('Items', $this->detail_list));
        $vbox->add($add_form);
        parent::add($vbox);
    }

    public function onAddItem()
    {
        $add_form = BootstrapFormBuilder::getFormByName('form_add_item');
        $data = $add_form->getData();
        try {
            TTransaction::open('samples');
            $product = new Product($data->product_id);

            $item = new stdClass;
            $item->id           = uniqid();   // temp id for removal
            $item->product_id   = $product->id;
            $item->product_name = $product->name;
            $item->unit_price   = $product->price;
            $item->quantity     = $data->quantity;
            $item->subtotal     = $product->price * $data->quantity;
            TTransaction::close();

            $this->detail_list->addItem((object) $item);
            // Store in session for later save
            $items = TSession::getValue('SaleForm_items') ?? [];
            $items[$item->id] = $item;
            TSession::setValue('SaleForm_items', $items);

            // Update total
            $total = array_sum(array_column($items, 'subtotal'));
            $sale_data = BootstrapFormBuilder::getFormByName('form_Sale')->getData();
            $sale_data->total = $total;
            BootstrapFormBuilder::getFormByName('form_Sale')->setData($sale_data);
        } catch (Exception $e) {
            new TMessage('error', $e->getMessage());
            TTransaction::rollback();
        }
    }

    public function onRemoveItem($param)
    {
        TDataGrid::removeRowById('datagrid_id', $param['id']);
        $items = TSession::getValue('SaleForm_items') ?? [];
        unset($items[$param['id']]);
        TSession::setValue('SaleForm_items', $items);
    }

    public function onSave()
    {
        try {
            TTransaction::open('samples');
            $this->form->validate();
            $data = $this->form->getData();

            $sale = new Sale;
            $sale->fromArray((array) $data);
            $sale->store();

            $items = TSession::getValue('SaleForm_items') ?? [];
            foreach ($items as $item) {
                $sale_item = new SaleItem;
                $sale_item->sale_id    = $sale->id;
                $sale_item->product_id = $item->product_id;
                $sale_item->quantity   = $item->quantity;
                $sale_item->unit_price = $item->unit_price;
                $sale_item->subtotal   = $item->subtotal;
                $sale_item->store();
            }
            TSession::delValue('SaleForm_items');
            $data->id = $sale->id;
            $this->form->setData($data);
            TTransaction::close();
            new TMessage('info', AdiantiCoreTranslator::translate('Record saved'));
        } catch (Exception $e) {
            $this->form->setData($this->form->getData());
            new TMessage('error', $e->getMessage());
            TTransaction::rollback();
        }
    }
}
```

---

## 2. Seek Window (Popup Field Lookup)

Select a record from a popup and populate parent form fields.

```php
// SEEK WINDOW (app/control/CustomerSeek.class.php)
class CustomerSeek extends TWindow
{
    public function __construct()
    {
        parent::__construct();
        $this->setTitle('Select Customer');
        $this->setSize(0.7, 0.6);

        $datagrid = new BootstrapDatagridWrapper(new TDataGrid);
        $datagrid->addColumn(new TDataGridColumn('id',    'ID',    'center', '10%'));
        $datagrid->addColumn(new TDataGridColumn('name',  'Name',  'left',   '60%'));
        $datagrid->addColumn(new TDataGridColumn('email', 'Email', 'left',   '30%'));

        // Row click → send to parent + close
        $sel = new TDataGridAction([$this, 'onSelect'], ['id' => '{id}', 'name' => '{name}']);
        $datagrid->addAction($sel, 'Select', 'fa:check green');
        $datagrid->createModel();

        TTransaction::open('samples');
        foreach (Customer::all() as $c) {
            $datagrid->addItem($c);
        }
        TTransaction::close();

        parent::add($datagrid);
    }

    public function onSelect($param)
    {
        TForm::sendData('form_Order', (object) [
            'customer_id'   => $param['id'],
            'customer_name' => $param['name'],
        ]);
        parent::closeWindow();
    }

    public static function onPopup($param)
    {
        parent::openWindow(new self);
    }
}

// IN PARENT FORM (form_Order):
$customer_id   = new TEntry('customer_id');   $customer_id->setEditable(false);
$customer_name = new TEntry('customer_name'); $customer_name->setEditable(false);
$seek = new TSeekButton('customer_seek');
$seek->setAction(new TAction(['CustomerSeek', 'onPopup']));

$form->addFields(
    [new TLabel('Customer')],
    [$customer_id, $seek, $customer_name]
);
```

---

## 3. Side Panel (Read-Only Detail)

Load detail view into right panel without navigating away.

```php
// LIST — action opens right panel
$action_view = new TDataGridAction(['SaleSidePanelView', 'onLoad'], ['id' => '{id}']);
$action_view->setTarget('adianti_right_panel');  // magic target
$datagrid->addAction($action_view, 'View', 'fa:eye blue');

// SIDE PANEL VIEW (app/control/SaleSidePanelView.class.php)
class SaleSidePanelView extends TPage
{
    public function __construct()
    {
        parent::__construct();
        parent::setTargetContainer('adianti_right_panel');
    }

    public static function onLoad($param)
    {
        $page = new self;
        try {
            TTransaction::open('samples');
            $sale = new Sale($param['id']);

            $container = new TVBox;
            $container->style = 'width:100%; padding:15px';

            // Header
            $header = new TElement('h4');
            $header->add("Sale #{$sale->id}");
            $container->add($header);

            // Details (form read-only)
            $form = new BootstrapFormBuilder('form_sale_detail');
            $form->disable();
            $form->setData($sale);
            // ... add fields ...
            $container->add($form);

            TTransaction::close();
            $page->add($container);
        } catch (Exception $e) {
            TTransaction::rollback();
        }
        $page->show();
    }
}
```

---

## 4. Cascading Combo (State → City)

```php
// In form constructor
$state = new TDBCombo('state_id', 'samples', 'State', 'id', 'name');
$city  = new TDBCombo('city_id',  'samples', 'City',  'id', 'name');

// Fire callback when state changes
$state->setChangeAction(new TAction([$this, 'onStateChange']));

$form->addFields([new TLabel('State')], [$state]);
$form->addFields([new TLabel('City')],  [$city]);

// Reload callback (must be public static — called via AJAX)
public static function onStateChange($param)
{
    $state_id = $param['state_id'];
    $criteria = new TCriteria;
    $criteria->add(new TFilter('state_id', '=', $state_id));
    $criteria->setProperty('order', 'name');

    TTransaction::open('samples');
    TDBCombo::reloadFromModel(
        'city_id',          // form field name
        'samples',          // database
        'City',             // model
        'id',               // key column
        'name',             // display column
        'name',             // order column
        $criteria           // filter
    );
    TTransaction::close();
}
```

---

## 5. File Upload (with AdiantiFileSaveTrait)

```php
class ProductForm extends TPage
{
    use Adianti\Base\AdiantiFileSaveTrait;

    public function __construct()
    {
        parent::__construct();
        $this->enableFileHandling();

        $this->form = new BootstrapFormBuilder('form_Product');
        // ...
        $photo = new TFile('photo');
        $photo->setAllowedExtensions(['jpg', 'jpeg', 'png', 'gif']);
        $photo->setMaxSize(5);          // MB
        $this->form->addFields([new TLabel('Photo')], [$photo]);

        $docs = new TMultiFile('documents');
        $docs->setAllowedExtensions(['pdf', 'doc', 'xls']);
        $this->form->addFields([new TLabel('Documents')], [$docs]);
    }

    public function onSave()
    {
        try {
            TTransaction::open('samples');
            $this->form->validate();
            $data = $this->form->getData();
            $object = new Product;
            $object->fromArray((array) $data);

            // Single file → saves to files/products/, stores filename in $object->photo
            $this->saveFile($object, $data, 'photo', 'files/products');

            // Multiple files → saves to files/docs/, stores JSON array in $object->documents
            $this->saveFiles($object, $data, 'documents', 'files/docs');

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

## 6. Composition (Customer with Contacts via TFieldList)

```php
class CustomerForm extends TPage
{
    public function __construct()
    {
        parent::__construct();
        $this->form = new BootstrapFormBuilder('form_Customer');
        $this->form->setFormTitle('Customer');

        // Main fields
        $name  = new TEntry('name');
        $email = new TEntry('email');
        $this->form->addFields([new TLabel('Name')],  [$name]);
        $this->form->addFields([new TLabel('Email')], [$email]);

        // Contacts (composition via TFieldList)
        $fieldlist = new TFieldList;
        $fieldlist->width = '100%';
        $fieldlist->addField('<b>Type</b>',   new TCombo('contact_type[]'),  ['width' => '25%']);
        $fieldlist->addField('<b>Value</b>',  new TEntry('contact_value[]'), ['width' => '65%']);
        $fieldlist->addField('',              new TButton('btn_add[]'),       ['width' => '10%']);

        $fieldlist->generateInsertButton('Add Contact');
        $fieldlist->generateRemoveButton('fa:minus red');

        $this->form->addContent($fieldlist);
        $this->form->addAction('Save', new TAction([$this, 'onSave']), 'fa:save green');
        // ...
    }

    public function onSave()
    {
        try {
            TTransaction::open('samples');
            $this->form->validate();
            $data = $this->form->getData();

            $customer = new Customer;
            $customer->name  = $data->name;
            $customer->email = $data->email;

            // Build contacts from field list arrays
            $contacts = [];
            if (!empty($data->contact_type)) {
                foreach ($data->contact_type as $i => $type) {
                    if (empty($type)) continue;
                    $contact = new Contact;
                    $contact->type  = $type;
                    $contact->value = $data->contact_value[$i] ?? '';
                    $contacts[] = $contact;
                }
            }
            $customer->contacts = $contacts;
            $customer->store();   // store() calls saveComposite() internally

            $data->id = $customer->id;
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
                $customer = new Customer($param['id']);
                $this->form->setData($customer);

                // Populate fieldlist with existing contacts
                $fieldlist = BootstrapFormBuilder::getFormByName('form_Customer')
                    ->getFieldByName('contact_type[]')
                    ->getFieldList();
                foreach ($customer->contacts as $contact) {
                    $fieldlist->addRow([
                        'contact_type[]'  => $contact->type,
                        'contact_value[]' => $contact->value,
                    ]);
                }
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

## 7. Aggregation (Customer with Skills via TDBCheckGroup)

```php
class CustomerForm extends TPage
{
    public function __construct()
    {
        parent::__construct();
        $this->form = new BootstrapFormBuilder('form_Customer');
        // ... main fields ...

        // Aggregation checkboxes
        $skills = new TDBCheckGroup('skill_ids', 'samples', 'Skill', 'id', 'name');
        $skills->setLayout('horizontal');
        $this->form->addFields([new TLabel('Skills')], [$skills], null);
        // ...
    }

    public function onSave()
    {
        try {
            TTransaction::open('samples');
            $this->form->validate();
            $data = $this->form->getData();

            $customer = new Customer;
            $customer->name = $data->name;

            // Build Skill objects from checked IDs
            $skill_objects = [];
            if (!empty($data->skill_ids)) {
                foreach ($data->skill_ids as $skill_id) {
                    $skill_objects[] = new Skill($skill_id);
                }
            }
            $customer->skills = $skill_objects;
            $customer->store();   // calls saveAggregate() internally

            $data->id = $customer->id;
            $this->form->setData($data);
            TTransaction::close();
            new TMessage('info', 'Saved');
        } catch (Exception $e) {
            TTransaction::rollback();
            new TMessage('error', $e->getMessage());
        }
    }

    public function onEdit($param)
    {
        try {
            if (isset($param['id'])) {
                TTransaction::open('samples');
                $customer = new Customer($param['id']);
                // populate form
                $this->form->setData($customer);
                // populate checkgroup from aggregation
                $skill_ids = array_map(fn($s) => $s->id, $customer->skills);
                TDBCheckGroup::setValue('skill_ids', $skill_ids);
                TTransaction::close();
            }
        } catch (Exception $e) {
            TTransaction::rollback();
            new TMessage('error', $e->getMessage());
        }
    }
}
```

---

## 8. DataGrid with Inline Filter (prependRow)

```php
// In datagrid setup (after addColumn calls, before createModel)
$filter_row = $this->datagrid->prependRow();

$filter_name = new TEntry('filter_name');
$filter_name->setSize('100%', 25);
$filter_name->exitOnEnter();
$filter_name->setChangeAction(new TAction([$this, 'onSearch']));
$filter_row->addCell($filter_name);

$filter_status = new TCombo('filter_status');
$filter_status->addItems(['' => 'All', 'A' => 'Active', 'I' => 'Inactive']);
$filter_status->setSize('100%', 25);
$filter_status->setChangeAction(new TAction([$this, 'onSearch']));
$filter_row->addCell($filter_status);

$this->datagrid->createModel();
```

---

## 9. PDF Export via DomPDF

```php
public static function onExportPDF($param)
{
    TTransaction::open('samples');
    $sale = new Sale($param['id']);
    $items = SaleItem::where('sale_id', '=', $sale->id)->load();
    TTransaction::close();

    // Build HTML for PDF
    $html  = '<h1>Sale #' . $sale->id . '</h1>';
    $html .= '<p>Date: ' . $sale->date . '</p>';
    $html .= '<table border="1" style="width:100%">';
    $html .= '<tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>';
    foreach ($items as $item) {
        $html .= "<tr><td>{$item->product_name}</td><td>{$item->quantity}</td>";
        $html .= "<td>{$item->unit_price}</td><td>{$item->subtotal}</td></tr>";
    }
    $html .= '</table>';

    $file = 'app/output/sale_' . $sale->id . '.pdf';
    $dompdf = new \Dompdf\Dompdf;
    $dompdf->loadHtml($html);
    $dompdf->setPaper('A4', 'portrait');
    $dompdf->render();
    file_put_contents($file, $dompdf->output());

    // Offer download
    TApplication::openFile($file);
    // OR open in side panel:
    // parent::openWindow(new TWindow)->load($file);
}
```

---

## 10. Form in Modal Window

Wrap any form view in a TWindow subclass:

```php
class ProductFormWindow extends TWindow
{
    public function __construct()
    {
        parent::__construct();
        $this->setTitle('Product');
        $this->setSize(0.5, null);        // 50% viewport width, auto height
        $this->setMinWidth(0.5, 700);
        $this->removePadding();
        $this->disableEscape();

        $form_view = new ProductFormView;  // the actual form (TPage subclass)
        parent::add($form_view);
    }

    public static function onEdit($param)
    {
        $win = new self;
        $win->form_view->onEdit($param);  // propagate param to inner form
        parent::openWindow($win);
    }
}

// Open from list:
$action = new TDataGridAction(['ProductFormWindow', 'onEdit'], ['id' => '{id}']);
$datagrid->addAction($action, 'Edit', 'far:edit blue');
```
