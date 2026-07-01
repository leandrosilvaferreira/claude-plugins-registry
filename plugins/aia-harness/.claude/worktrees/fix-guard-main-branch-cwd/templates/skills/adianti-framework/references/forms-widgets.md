# Adianti Framework — Forms & Widgets

## BootstrapFormBuilder — Primary Form Builder (v8.x)

```php
$form = new BootstrapFormBuilder('form_name');     // unique ID
$form->setFormTitle('Product');                    // header title
$form->setColumnClasses(1, 'col-sm-12');           // 1 column full-width
$form->setColumnClasses(2, 'col-sm-6', 'col-sm-6'); // 2 equal columns
$form->setColumnClasses(3, 'col-sm-4', 'col-sm-4', 'col-sm-4'); // 3 col

// Add a row with label + field pairs
$form->addFields(
    [new TLabel('Name'), $name_field],
    [new TLabel('Price'), $price_field]
);

// Add row spanning all columns
$form->addFields([new TLabel('Description')], [$text_area], null);
// null = span remaining columns

// Add section separator
$form->addContent('<h5>Section Title</h5>');

// Actions (buttons in the footer)
$form->addAction('Save',  new TAction([$this, 'onSave']),   'fa:save green');
$form->addAction('Clear', new TAction([$this, 'onClear']),  'fa:eraser gray');
$form->addActionLink('Back', new TAction(['ListClass', 'onReload']), 'fa:arrow-left blue');

// Read / write form data
$data = $form->getData();           // returns StdClass
$form->setData($object_or_stdclass);
$form->clear();                     // clear all fields
$form->validate();                  // throws exception if validators fail
$form->disable();                   // make all fields read-only
```

### TForm — Legacy Form Builder

```php
$form = new TForm('form_name');
$table = new TTable;
$table->addRowSet(new TLabel('Name'), $name_field);
$form->add($table);
// setData / getData / validate same API
```

### TModalForm — Floating Modal Form (v8.0+)

```php
$form = new TModalForm('form_modal_product');
$form->setFormTitle('Product');
// Same API as BootstrapFormBuilder
// Displayed via JavaScript: Adianti.showModal('form_modal_product')
```

---

## Field Types

### TEntry — Text Input

```php
$field = new TEntry('field_name');
$field->setValue('default');
$field->setEditable(false);           // read-only
$field->setMaxLength(50);
$field->setPlaceholder('Type here...');
$field->setSize('100%');
$field->setMask('999.999.999-99');    // phone/CPF masks
$field->forceLowerCase();
$field->forceUpperCase();
$field->forceNoSpaces();
$field->exitOnEnter();                // submit form on Enter
$field->setChangeAction(new TAction([$this, 'onFieldChange']));
$field->setExitAction(new TAction([$this, 'onFieldExit']));
```

### TNumeric — Number with Format Mask

```php
$field = new TNumeric('price', 2, ',', '.', true);
// TNumeric($name, $decimals, $decSep, $thouSep, $reverse=false)
// $reverse=true → user types right-to-left (Brazilian numeric input style)
$field->setMinValue(0);
$field->setMaxValue(999999.99);
```

### TDate — Date Picker

```php
$field = new TDate('date');
$field->setMask('dd/mm/yyyy');     // display mask
$field->setDatabaseMask('yyyy-mm-dd');
$field->setMinDate('2024-01-01');
$field->setMaxDate('2026-12-31');
// Convert between masks
$us = TDate::convertToMask($br, 'dd/mm/yyyy', 'yyyy-mm-dd');
$br = TDate::convertToMask($us, 'yyyy-mm-dd', 'dd/mm/yyyy');
```

### TDateTime — Date + Time Picker

```php
$field = new TDateTime('created_at');
$field->setMask('dd/mm/yyyy HH:ii');
$field->setDatabaseMask('yyyy-mm-dd HH:ii:ss');
```

### TCombo — Dropdown Select

```php
// From static array
$field = new TCombo('status');
$field->addItems(['A' => 'Active', 'I' => 'Inactive']);
$field->setValue('A');

// DB-driven combo
$field = new TDBCombo('category_id', 'samples', 'Category', 'id', 'name');
// TDBCombo($name, $database, $model, $key, $value, $orderColumn='', $criteria=null)

// Cascading: reload child on parent change
$country->setChangeAction(new TAction(['StateCombo', 'onChangeCountry']));

// Static reload
TCombo::reload('state_id', ['SP' => 'São Paulo', 'RJ' => 'Rio de Janeiro']);
// Suppress change-event fire
TCombo::reload('state_id', $items, fireChangeAction: false);

// DB reload
TDBCombo::reloadFromModel('city_id', 'samples', 'City', 'id', 'name', $criteria);
```

### TMultiCombo — Multiple Select Dropdown (v8.0+)

```php
$field = new TMultiCombo('tag_ids');
$field->addItems(['php' => 'PHP', 'js' => 'JavaScript']);
// DB-driven
$field = new TDBMultiCombo('tag_ids', 'samples', 'Tag', 'id', 'name');
$field->setValue([1, 2, 3]);  // set selected IDs
```

### TUniqueSearch / TDBUniqueSearch — Autocomplete (single)

```php
// DB-backed autocomplete
$field = new TDBUniqueSearch('customer_id', 'samples', 'Customer', 'id', 'name');
// TDBUniqueSearch($name, $database, $model, $key, $value, $operator='ilike', $orderColumn=null)
$field->setMinLength(2);           // min chars before searching
$field->setMask('{name} ({email})'); // result display mask
$field->setValue(1);               // set by key

// Seek button for popup window alternative
$seek = new TSeekButton('customer_id');
$seek->setAction(new TAction(['CustomerSeek', 'onPopup']), 'Seek Customer');
```

### TMultiSearch / TDBMultiSearch — Autocomplete (multiple)

```php
$field = new TDBMultiSearch('product_ids', 'samples', 'Product', 'id', 'name');
$field->setMinLength(1);
$field->setMaxSize(5);       // max selected items
```

### TCheckGroup / TDBCheckGroup — Checkboxes

```php
// Static
$field = new TCheckGroup('features');
$field->addItems(['pdf' => 'PDF', 'csv' => 'CSV']);
$field->setLayout('horizontal');

// DB-driven (used for aggregation)
$field = new TDBCheckGroup('skill_ids', 'samples', 'Skill', 'id', 'name');
$field->setValue([1, 3, 5]);
```

### TRadioGroup / TDBRadioGroup — Radio Buttons

```php
$field = new TRadioGroup('gender');
$field->addItems(['M' => 'Male', 'F' => 'Female']);
$field->setLayout('horizontal');
$field->setChangeAction(new TAction([$this, 'onGenderChange']));
```

### TText — Textarea

```php
$field = new TText('description');
$field->setSize('100%', 80);    // width, height (px)
```

### THtmlEditor — WYSIWYG Rich Text

```php
$field = new THtmlEditor('content');
$field->setSize('100%', 200);
```

### TPassword — Password Input

```php
$field = new TPassword('password');
```

### THidden — Hidden Field

```php
$field = new THidden('record_id');
$field->setValue(42);
```

### TFile — Single File Upload

```php
$field = new TFile('photo');
$field->setAllowedExtensions(['jpg', 'jpeg', 'png', 'gif']);
$field->setMaxSize(5);             // MB
$field->setDisplayLabel('Upload Photo');
```

### TMultiFile — Multiple File Upload

```php
$field = new TMultiFile('attachments');
$field->setAllowedExtensions(['pdf', 'doc', 'xls']);
$field->setMaxFiles(10);
```

### TImageCropper — Image with Crop (v8.x)

```php
$field = new TImageCropper('avatar');
$field->setAspectRatio(1, 1);     // square crop
$field->setOutputWidth(400);
```

### TSignaturePad — Digital Signature (v8.4+)

```php
$field = new TSignaturePad('signature');
$field->setOutputFormat('png');
```

---

## AdiantiFileSaveTrait — File Upload Handling

Add this trait to the form class to enable file save/delete:

```php
class ProductForm extends TPage
{
    use Adianti\Base\AdiantiFileSaveTrait;

    public function __construct()
    {
        // ...
        $this->enableFileHandling();   // activates file save/delete handling
    }

    public function onSave()
    {
        try {
            TTransaction::open('samples');
            $this->form->validate();
            $data = $this->form->getData();
            $object = new Product;
            $object->fromArray((array) $data);

            // Save single file
            $this->saveFile($object, $data, 'photo', 'files/products');

            // Save multiple files (stored as JSON array)
            $this->saveFiles($object, $data, 'attachments', 'files/docs');

            $object->store();
            $data->id = $object->id;
            $this->form->setData($data);
            TTransaction::close();
        } catch (Exception $e) {
            TTransaction::rollback();
            new TMessage('error', $e->getMessage());
        }
    }
}
```

### File Display (read-only preview)

```php
// In onEdit() — show existing file
if ($object->photo) {
    $img = new TImage('files/products/' . $object->photo);
    $img->setSize(100, 100);
    $form->addContent($img);
}
```

---

## TFieldList — Dynamic Row List (Composition UI)

Used to build repeating rows for child records (contacts, order items):

```php
$fieldlist = new TFieldList;
$fieldlist->width = '100%';
$fieldlist->setRowHeight('30px');
$fieldlist->generateAria(true);

// Define row columns
$fieldlist->addField('<b>Name</b>',  new TEntry('name[]'),     ['width' => '60%']);
$fieldlist->addField('<b>Phone</b>', new TEntry('phone[]'),    ['width' => '30%']);
$fieldlist->addField('<b>Type</b>',  new TCombo('type[]'),     ['width' => '10%']);

// Allow user to add/remove rows
$fieldlist->addActionButton('Add Row',    new TAction([$this, 'onAddRow']), 'fa:plus');
$fieldlist->addActionButton('Remove Row', new TAction([$this, 'onRemoveRow']), 'fa:minus');
$fieldlist->generateTotals(); // auto-sum numeric columns (v8.x)

$form->addContent($fieldlist);

// In onSave(), read rows:
$contacts = [];
if (!empty($data->name)) {
    foreach ($data->name as $i => $name) {
        if (empty($name)) continue;
        $contact = new Contact;
        $contact->name  = $name;
        $contact->phone = $data->phone[$i] ?? '';
        $contacts[] = $contact;
    }
}
$customer->contacts = $contacts;
```

---

## Validators

Add validators to fields before calling `$form->validate()`:

```php
$field->addValidation('Field Label', new TRequiredValidator);
$field->addValidation('Email', new TEmailValidator);
$field->addValidation('CPF', new TCPFValidator);
$field->addValidation('CNPJ', new TCNPJValidator);
$field->addValidation('CEP', new TCEPValidator);
$field->addValidation('Phone', new TPhoneValidator);
$field->addValidation('Min 3 chars', new TMinLengthValidator, [3]);
$field->addValidation('Max 100', new TMaxLengthValidator, [100]);
$field->addValidation('Number range', new TRangeValidator, [1, 100]);
$field->addValidation('Integer only', new TIntegerValidator);

// Custom validator (callable)
$field->addValidation('Unique email', function($label, $value, $params) {
    // throw exception if invalid
    if (User::where('email', '=', $value)->count() > 0) {
        throw new Exception("$label: email already in use");
    }
});
```

---

## TLabel — Form Labels

```php
$label = new TLabel('Product Name');
$label->setFontColor('#555555');
$label->setFontSize('14px');
$label = new TLabel('Required Field', '#ff0000', 'italic', 'bold', '11px');
// TLabel($value, $color='', $fontStyle='', $fontWeight='', $fontSize='')
```

---

## Form Data Flow — Standard onSave/onEdit Pattern

```php
public function onSave()
{
    try {
        TTransaction::open('samples');
        $this->form->validate();
        $data = $this->form->getData();          // StdClass from form

        $object = new Product;
        $object->fromArray((array) $data);        // fill model from form
        $object->store();                          // INSERT or UPDATE

        $data->id = $object->id;                  // propagate new ID back
        $this->form->setData($data);              // update form (shows saved ID)
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
```

---

## TForm::sendData — Send Data to Another Form

Used in seek windows to populate parent form fields:

```php
// In the seek window, after user selects a record:
TForm::sendData('parent_form_name', (object) [
    'customer_id'   => $customer->id,
    'customer_name' => $customer->name,
]);
parent::closeWindow();
```

The parent form must have fields named `customer_id` and `customer_name`.

---

## Common Field Layout Patterns

### Full-width textarea in BootstrapFormBuilder

```php
$form->addFields(
    [new TLabel('Description')],
    [$textarea],
    null         // span all remaining columns
);
```

### Inline field + button (seek button)

```php
$wrapper = new THBox;
$wrapper->add($customer_id_field);
$wrapper->add($seek_button);
$form->addFields([new TLabel('Customer')], [$wrapper]);
```

### Conditional field visibility

```php
// In AJAX callback (setChangeAction)
public static function onTypeChange($param)
{
    $data = TSession::getValue('form_data');
    // Show/hide via CSS
    TScript::create("$('#field_id').closest('.form-group').toggle(" . ($param['type'] == 'X') . ")");
}
```

---

## TSeekButton — Popup Field Search

```php
// In form setup
$seek = new TSeekButton('customer_id');
$seek->setAction(new TAction(['CustomerSeek', 'onPopup']), 'Search Customer');
$seek->setSize('30px');
$form->addFields(
    [new TLabel('Customer')],
    [$customer_id_field, $seek, $customer_name_field]
);

// CustomerSeek class (extends TWindow — see layout-components.md)
```
