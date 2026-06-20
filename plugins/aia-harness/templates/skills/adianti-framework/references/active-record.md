# Adianti Framework — Active Record (TRecord)

`TRecord` is the ORM base class. Each subclass maps to one database table.

## Minimal Model

```php
class Product extends TRecord
{
    const TABLENAME  = 'product';
    const PRIMARYKEY = 'id';
    const IDPOLICY   = 'max';    // 'max' | 'serial' | 'uuid7'

    public function __construct($id = NULL)
    {
        parent::__construct($id);
        parent::addAttribute('name');        // registers persisted columns
        parent::addAttribute('price');
        parent::addAttribute('stock');
        parent::addAttribute('category_id');
    }
}
```

**IDPOLICY values:**

- `'max'` — `SELECT MAX(id)+1` (portable, safe for all databases)
- `'serial'` — relies on DB autoincrement/sequence
- `'uuid7'` — generates UUID v7 as primary key

**Only columns registered with `addAttribute()` are read/written.** Unregistered columns are silently ignored.

## Timestamps & Soft Delete

Add constants to enable automatic tracking:

```php
class Customer extends TRecord
{
    const TABLENAME  = 'customer';
    const PRIMARYKEY = 'id';
    const IDPOLICY   = 'max';
    const CREATEDAT  = 'created_at';   // auto-set on insert
    const UPDATEDAT  = 'updated_at';   // auto-set on update
    const DELETEDAT  = 'deleted_at';   // soft-delete: marks timestamp instead of deleting row
    // const CREATEDBY = 'created_by'; // stores session user id
    // const UPDATEDBY = 'updated_by';
    // const DELETEDBY = 'deleted_by';

    public function __construct($id = NULL)
    {
        parent::__construct($id);
        parent::addAttribute('name');
        parent::addAttribute('email');
        parent::addAttribute('created_at');
        parent::addAttribute('updated_at');
        parent::addAttribute('deleted_at');
    }
}
```

With `DELETEDAT`, calling `$obj->delete()` sets the column to current timestamp instead of removing the row. Use `withTrashed()` to include soft-deleted records.

## Cache Control

```php
class Category extends TRecord
{
    const TABLENAME   = 'category';
    const PRIMARYKEY  = 'id';
    const IDPOLICY    = 'max';
    const CACHECONTROL = 'TAPCache';   // enables APC query-level cache
    // ...
}
```

`TRecord::findCache($id)` — finds within request-level static cache (v8.2+, avoids repeated queries).
`TRecord::preCache($collection)` — pre-warms cache with a collection.

## CRUD Operations

All require an open `TTransaction`.

```php
// Create / Update
$p = new Product;
$p->name  = 'Widget';
$p->price = 9.99;
$p->store();        // INSERT or UPDATE (checks if id exists)
echo $p->id;        // populated after store()

// Read by ID
$p = new Product(42);   // constructor loads from DB
// or
$p = Product::find(42);

// Update
$p = new Product(42);
$p->price = 12.99;
$p->store();

// Delete
$p = new Product(42);
$p->delete();
// or
Product::find(42)->delete();

// Bulk via TRepository (see repository-database.md)
Product::where('stock', '<', 0)->delete();
```

## Loading from Array / Converting to Array

```php
$data = $form->getData();           // StdClass from form
$object = new Product;
$object->fromArray((array) $data);  // fill from array
$object->store();

$arr = $object->toArray();          // returns ['id'=>1, 'name'=>'Widget', ...]
$json = $object->toJson();          // returns JSON string
```

## Static Finder Methods

```php
Product::find(42)                   // load by PK, returns instance
Product::findCache(42)              // try static cache first
Product::first()                    // first record
Product::last()                     // last record
Product::all()                      // all records as array
Product::getObjects($criteria)      // by TCriteria

// Fluent query (returns TRepository)
Product::where('price', '>', 10)
       ->orderBy('name')
       ->take(20)
       ->load();

Product::where('stock', '>', 0)
       ->where('category_id', '=', 3)
       ->load();

// OR filter
Product::where('status', '=', 'active')
       ->orWhere('featured', '=', 1)
       ->load();

// Get indexed array [id => name]
Product::getIndexedArray('id', 'name');
Product::getIndexedArray('id', 'name', $criteria);

// Count
Product::count();                   // count all
Product::where('active', '=', 1)->count();
```

## Magic Getters and Setters (Relationships)

Define `get_relation()` and `set_relation()` for lazy-loaded relationship access:

```php
class Sale extends TRecord
{
    const TABLENAME  = 'sale';
    const PRIMARYKEY = 'id';
    const IDPOLICY   = 'max';
    private $customer;

    public function __construct($id = NULL)
    {
        parent::__construct($id);
        parent::addAttribute('date');
        parent::addAttribute('total');
        parent::addAttribute('customer_id');
    }

    // Access: $sale->customer->name
    public function get_customer()
    {
        if (empty($this->customer)) {
            $this->customer = new Customer($this->customer_id);
        }
        return $this->customer;
    }

    // Set: $sale->customer = $customerObj  (also sets customer_id FK)
    public function set_customer(Customer $object)
    {
        $this->customer = $object;
        $this->customer_id = $object->id;
    }

    // Virtual computed property: $sale->customer_name
    public function get_customer_name()
    {
        return $this->get_customer()->name;
    }
}
```

In DataGrid columns, relationship traversal uses dot/arrow syntax:

```php
new TDataGridColumn('{customer->name}', 'Customer', 'left', '40%');
new TDataGridColumn('{city->state->name}', 'State', 'left', '20%');
// Conditional (v8.1+): won't throw if null
new TDataGridColumn('{city?->name}', 'City', 'left', '20%');
```

## Property Validation via Setter

Override `set_field()` to validate before storage:

```php
public function set_birthdate($value)
{
    $parts = explode('-', $value);
    if (!checkdate($parts[1], $parts[2], $parts[0])) {
        throw new Exception("Invalid date: $value");
    }
    $this->data['birthdate'] = $value;
}
```

## Column Readers and Writers (v8.0+)

```php
// In constructor — encrypt on write, decrypt on read
parent::addAttribute('ssn',
    writer: 'encrypt',   // callable/session var applied on store()
    reader: 'decrypt'    // callable/session var applied on load()
);
```

## Composition (One-to-Many with cascade)

Composition = child records whose lifecycle depends on the parent (contacts, order items).

```php
class Customer extends TRecord
{
    // ...
    private $contacts = [];

    public function addContact(Contact $obj) { $this->contacts[] = $obj; }
    public function getContacts() { return $this->contacts; }

    public function load($id)
    {
        // Load child records (Contact with FK customer_id)
        $this->contacts = parent::loadComposite('Contact', 'customer_id', $id);
        return parent::load($id);
    }

    public function store()
    {
        parent::store();
        // Save/replace all contacts
        parent::saveComposite('Contact', 'customer_id', $this->id, $this->contacts);
    }

    public function delete($id = NULL)
    {
        $id = $id ?? $this->id;
        parent::deleteComposite('Contact', 'customer_id', $id);
        parent::delete($id);
    }
}
```

**Methods:**

- `loadComposite($class, $fk, $id)` — load array of child objects
- `saveComposite($class, $fk, $id, $objects)` — replace all children (delete+insert)
- `deleteComposite($class, $fk, $id)` — delete all children

## Aggregation (Many-to-Many via Junction Table)

Aggregation = independent objects linked via a join table (skills, tags, categories).

```php
class Customer extends TRecord
{
    // ...
    private $skills = [];

    public function addSkill(Skill $obj) { $this->skills[] = $obj; }
    public function getSkills() { return $this->skills; }

    public function load($id)
    {
        // Junction table: CustomerSkill (customer_id, skill_id)
        $this->skills = parent::loadAggregate('Skill', 'CustomerSkill', 'customer_id', 'skill_id', $id);
        return parent::load($id);
    }

    public function store()
    {
        parent::store();
        parent::saveAggregate('CustomerSkill', 'customer_id', 'skill_id', $this->id, $this->skills);
    }

    public function delete($id = NULL)
    {
        $id = $id ?? $this->id;
        parent::deleteComposite('CustomerSkill', 'customer_id', $id);
        parent::delete($id);
    }
}
```

**Methods:**

- `loadAggregate($class, $joinClass, $fkParent, $fkChild, $id)` — load related objects
- `saveAggregate($joinClass, $fkParent, $fkChild, $id, $objects)` — replace join rows
- `loadAggregateIds(...)` — load just the IDs

**In the form:** Use `TDBCheckGroup` to display checkboxes for aggregation, then in `onSave`:

```php
// Build Skill objects from checked IDs
$skills = [];
if (isset($data->skills)) {
    foreach ($data->skills as $skill_id) {
        $skills[] = new Skill($skill_id);
    }
}
$customer->skills = $skills;
$customer->store();  // saveAggregate called inside store()
```

## Dependency Check (Referential Integrity)

Prevent deletion when referenced by other tables:

```php
public function delete($id = NULL)
{
    $id = $id ?? $this->id;
    // Throws exception if any Customer has city_id = $id
    parent::checkDependencies('Customer', 'city_id', $id, 'Customer');
    parent::delete($id);
}
```

## Prefilters (v8.0+)

Apply automatic WHERE conditions to all queries on a model (multi-tenant, soft-delete filters):

```php
class Product extends TRecord
{
    // ...
    public static function getPrefilters()
    {
        return [
            new TFilter('tenant_id', '=', TSession::getValue('tenant_id'))
        ];
    }
}
```

## Loading Collections

```php
// Via static fluent API
$products = Product::where('active', '=', 1)
                   ->orderBy('name')
                   ->load();

// Via explicit criteria
$criteria = new TCriteria;
$criteria->add(new TFilter('price', '>', 10));
$criteria->setProperty('order', 'name');
$products = Product::getObjects($criteria);

// Via repository
$repo = new TRepository('Product');
$products = $repo->where('active', '=', 1)
                 ->orderBy('name')
                 ->take(50)
                 ->load();

// Lazy shortcut methods
$order->items = $order->hasMany('OrderItem', 'order_id');
$order->items = $order->filterMany('OrderItem', 'order_id');  // returns TRepository
$customer->skills = $customer->belongsToMany('Skill', 'CustomerSkill', 'customer_id', 'skill_id');
```

## Bulk Save / Batch Operations

```php
// Batch update via repository
Product::where('category_id', '=', 5)
       ->set('active', 0)
       ->update();

// Using TDatabase for raw operations
TDatabase::execute($conn, "UPDATE product SET active=0 WHERE category_id=5");
TDatabase::insertData($conn, 'product', ['name'=>'A', 'price'=>1.0]);
TDatabase::updateData($conn, 'product', ['active'=>1], $criteria);
```

## hasMany / belongsToMany Shortcuts

```php
class Order extends TRecord
{
    // ...
    public function getItems()
    {
        return $this->hasMany('OrderItem', 'order_id');          // array of objects
    }

    public function getItemsRepo()
    {
        return $this->filterMany('OrderItem', 'order_id');       // TRepository (chainable)
    }
}

class Customer extends TRecord
{
    public function getSkills()
    {
        return $this->belongsToMany('Skill', 'CustomerSkill', 'customer_id', 'skill_id');
    }
}
```

## Common Anti-Patterns

| Wrong | Correct |
|---|---|
| `SELECT *` via raw PDO | `Product::getObjects()` / `TRepository::load()` |
| Not calling `addAttribute('col')` | Column silently ignored on store |
| Accessing `$obj->field` outside transaction | Wrap in `TTransaction::open/close` |
| `$obj->store()` without `TTransaction` | Exception: no connection open |
| Forgetting `$data->id = $object->id` after store | Form loses the new ID |
