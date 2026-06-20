# Adianti Framework — TTransaction, TRepository, TCriteria, TFilter

## TTransaction — Database Connection Manager

**All database operations must happen inside a TTransaction block.**

```php
// Standard pattern
TTransaction::open('database_name');   // 'database_name' = app/config/database_name.ini
try {
    // ... queries, CRUD operations ...
    TTransaction::close();             // commit
} catch (Exception $e) {
    new TMessage('error', $e->getMessage());
    TTransaction::rollback();          // undo pending operations
}
```

### Multiple Databases

```php
TTransaction::open('sales_db');
TTransaction::open('inventory_db');   // nested transactions — opens second connection
try {
    $sale = new Sale;
    $sale->store();                   // uses sales_db (most recent open)
    $product->stock -= $qty;
    $product->store();                // uses inventory_db
    TTransaction::close('inventory_db');
    TTransaction::close('sales_db');
} catch (Exception $e) {
    TTransaction::rollbackAll();
}
```

### Logging Transactions

```php
// Log all SQL to file
TTransaction::open('samples');
TTransaction::dump('app/output/sql.log');    // write SQL to file
// ... operations ...
TTransaction::close();

// Log to HTML output (debug)
TTransaction::adump();   // opens debug panel in browser (v8.2+)
```

### Key Methods

```php
TTransaction::open($database, $dbinfo = null)   // open connection
TTransaction::close()                            // commit + close
TTransaction::rollback()                         // rollback current
TTransaction::rollbackAll()                      // rollback all open transactions
TTransaction::closeAll()                         // commit + close all
TTransaction::get()                              // returns current PDO connection
TTransaction::getDatabase()                      // returns current database name
TTransaction::setLogger($logger)                 // assign TLogger strategy
TTransaction::log($message)                      // write to log
TTransaction::dump($file)                        // enable SQL dump to file
```

---

## TConnection — Low-Level Connection

```php
// Open a raw PDO connection (useful for TDatabase operations)
$conn = TConnection::open('samples');

// Open from array (no INI file needed)
$conn = TConnection::openArray([
    'host' => 'localhost',
    'name' => 'mydb',
    'user' => 'root',
    'pass' => 'password',
    'type' => 'mysql',
    'port' => 3306,
]);

// Get connection info
$info = TConnection::getDatabaseInfo('samples');  // returns array from INI
```

---

## TCriteria — Composite Filter Builder

```php
$criteria = new TCriteria;

// Add individual filters
$criteria->add(new TFilter('price', '>', 10));
$criteria->add(new TFilter('category_id', '=', 5));
$criteria->add(new TFilter('name', 'like', 'Widget'));   // auto-wraps with %

// OR condition
$criteria->add(new TFilter('active', '=', 1), TExpression::OR_OPERATOR);

// Properties
$criteria->setProperty('order',     'name');      // ORDER BY
$criteria->setProperty('direction', 'asc');       // ASC | DESC
$criteria->setProperty('limit',     20);          // LIMIT
$criteria->setProperty('offset',    40);          // OFFSET

// Merge two criteria
$criteria->mergeCriteria($another_criteria);

// Dump the SQL WHERE clause (debugging)
echo $criteria->dump();         // with placeholders
echo $criteria->dump(true);     // with actual values
```

### TCriteria::create() Shortcut (v8.0+)

```php
$criteria = TCriteria::create([
    ['price', '>', 10],
    ['active', '=', 1],
], ['order' => 'name', 'limit' => 50]);
```

---

## TFilter — Individual Condition

```php
// Comparison operators: =, !=, <>, >, >=, <, <=, like, not like, in, not in, between, is null, is not null
new TFilter('name',  'like',    'Widget')     // WHERE name LIKE '%Widget%'
new TFilter('price', '>',       10.00)
new TFilter('id',    'in',      [1, 2, 3])    // WHERE id IN (1,2,3)
new TFilter('date',  'between', '2025-01-01', '2025-12-31')
new TFilter('deleted_at', 'is null', '')

// Case insensitive (v8.x)
$filter = new TFilter('name', 'like', 'test');
$filter->setCaseInsensitive(true);
```

---

## TRepository — Fluent Query Interface

```php
$repo = new TRepository('Product');

// Basic load with criteria
$products = $repo->load($criteria);                        // array of Product objects

// Fluent interface (chainable)
$products = $repo->where('active', '=', 1)
                 ->where('price', '>', 5)
                 ->orderBy('name', 'asc')
                 ->take(20)                                // LIMIT
                 ->skip(40)                                // OFFSET
                 ->load();

// OR conditions
$repo->where('status', '=', 'active')
     ->orWhere('featured', '=', 1)
     ->load();

// Select specific columns
$repo->select('id, name, price')
     ->where('active', '=', 1)
     ->load();

// Count
$total = $repo->where('active', '=', 1)->count();

// First / Last
$first = $repo->orderBy('id')->first();
$last  = $repo->orderBy('id', 'desc')->first();

// Delete matching records
$repo->where('active', '=', 0)->delete();

// Bulk update
$repo->where('category_id', '=', 5)->update(['active' => 0]);
// Fluent set() + update()
$repo->where('active', '=', 1)->set('price', 0)->update();

// Transform results
$result = $repo->where('active', '=', 1)
               ->transform(function($obj) {
                   $obj->display_price = 'R$ ' . number_format($obj->price, 2, ',', '.');
                   return $obj;
               })
               ->load();

// Filter with PHP callback
$filtered = $repo->filter(function($obj) {
    return $obj->price > 10;
})->load();

// Indexed array [key => value]
$options = $repo->where('active', '=', 1)
                ->getIndexedArray('id', 'name');

// Aggregate functions
$repo->sumBy('price', 'total_price')->load();
$repo->avgBy('price', 'avg_price')->load();
$repo->countBy('category_id', 'qty')->load();
$repo->maxBy('price', 'max_price')->load();
$repo->minBy('price', 'min_price')->load();

// Group by
$repo->select('category_id, SUM(price) as total')
     ->groupBy('category_id')
     ->load();
```

### Joins (v8.0+)

```php
$repo = new TRepository('Sale');
$repo->join('customer', ['Sale.customer_id = customer.id'])
     ->select('Sale.id, Sale.date, customer.name')
     ->where('Sale.status_id', '=', 1)
     ->load();
```

---

## SQL Statement Builders

For raw SQL control when ORM isn't enough:

```php
// SELECT
$sql = new TSqlSelect;
$sql->setEntity('product');
$sql->addColumn('id');
$sql->addColumn('name');
$sql->addColumn('price');
$sql->setCriteria($criteria);
echo $sql->getInstruction();   // "SELECT id, name, price FROM product WHERE ..."

// INSERT
$sql = new TSqlInsert;
$sql->setEntity('product');
$sql->setRowData('name',  'Widget');
$sql->setRowData('price', 9.99);
$conn->exec($sql->getInstruction());

// UPDATE
$sql = new TSqlUpdate;
$sql->setEntity('product');
$sql->setRowData('price', 12.99);
$sql->setCriteria($criteria);

// DELETE
$sql = new TSqlDelete;
$sql->setEntity('product');
$sql->setCriteria($criteria);
```

---

## TDatabase — Utility Operations

For data migrations, bulk operations, cross-database copies:

```php
$conn = TConnection::open('samples');

// Execute arbitrary SQL
TDatabase::execute($conn, "ALTER TABLE product ADD COLUMN notes TEXT");

// Insert rows
TDatabase::insertData($conn, 'product', [
    'name'  => 'Widget',
    'price' => 9.99,
]);

// Update rows with criteria
TDatabase::updateData($conn, 'product', ['active' => 0], $criteria);

// Clear all rows (with optional criteria)
TDatabase::clearData($conn, 'product', $criteria);

// Query raw data
$rows = TDatabase::getData($conn, "SELECT * FROM product WHERE active=1");
foreach ($rows as $row) {
    echo $row['name'];
}

// Schema operations
TDatabase::createTable($conn, 'new_table', [
    ['name' => 'id',   'type' => 'INTEGER', 'options' => 'PRIMARY KEY'],
    ['name' => 'name', 'type' => 'VARCHAR(100)', 'options' => 'NOT NULL'],
]);
TDatabase::dropTable($conn, 'old_table', ifexists: true);
TDatabase::addColumn($conn, 'product', 'notes', 'TEXT', '');
TDatabase::dropColumn($conn, 'product', 'old_col');

// Copy data between tables/databases
TDatabase::copyData($source_conn, $target_conn, 'source_table', 'target_table', [
    'src_col' => 'dst_col',   // column mapping
]);

// Import/Export CSV
TDatabase::importFromFile('data.csv', $conn, 'product', ['col1' => 'name', 'col2' => 'price']);
TDatabase::exportToFile($conn, 'product', 'output.csv', ['id', 'name', 'price']);
```

---

## TSession — Session Variables

```php
TSession::setValue('user_id', 42);
$id = TSession::getValue('user_id');
TSession::delValue('temp_filter');
TSession::clear();                   // destroy all session data
TSession::regenerate();              // regenerate session ID (after login)
```

Sessions used for filter state in list pages:

```php
// In onSearch()
TSession::setValue('ProductList_filter_data', $form->getData());

// In constructor, restore filters
$this->form->setData(TSession::getValue('ProductList_filter_data'));
```

---

## TAPCache — APC Query Cache

```php
// Manual cache usage
TAPCache::setValue('key', $value);
$value = TAPCache::getValue('key');
TAPCache::delValue('key');
TAPCache::clear();

// Enable on model (see active-record.md)
const CACHECONTROL = 'TAPCache';
```

Cache is request-scoped by default. Enable APC extension for cross-request caching.

---

## Common Patterns

### Filter with Date Range

```php
$criteria = new TCriteria;
if ($date_from = $data->date_from) {
    $us_date = TDate::convertToMask($date_from, 'dd/mm/yyyy', 'yyyy-mm-dd');
    $criteria->add(new TFilter('date', '>=', $us_date));
}
if ($date_to = $data->date_to) {
    $us_date = TDate::convertToMask($date_to, 'dd/mm/yyyy', 'yyyy-mm-dd');
    $criteria->add(new TFilter('date', '<=', $us_date));
}
```

### Filter with IN (multi-select)

```php
if (!empty($data->status_ids)) {
    $criteria->add(new TFilter('status_id', 'in', $data->status_ids));
}
```

### addFilterField with Transformer (in List trait setup)

```php
$this->addFilterField('date', '>=', 'date_from', function($value) {
    return TDate::convertToMask($value, 'dd/mm/yyyy', 'yyyy-mm-dd');
});
$this->addFilterField('date', '<=', 'date_to', function($value) {
    return TDate::convertToMask($value, 'dd/mm/yyyy', 'yyyy-mm-dd');
});
```
