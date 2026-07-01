# Adianti Framework — Architecture & Project Structure

## Directory Layout

```
project-root/
├── index.php              ← Entry point (HTML template assembly + initial page load)
├── engine.php             ← AJAX/action dispatcher (all subsequent requests)
├── init.php               ← Framework class loader bootstrap
├── download.php           ← File download utility
├── rest.php               ← Embedded REST server entry point
├── cmd.php                ← CLI utility
├── menu.xml               ← Application navigation + route definitions
│
├── app/
│   ├── config/
│   │   ├── application.php    ← Main application config (theme, language, debug)
│   │   ├── samples.ini        ← Database connection (one per DB)
│   │   └── palettes.php       ← Color palette definitions
│   ├── model/                 ← Active Record classes (extend TRecord)
│   ├── control/               ← Page controllers (extend TPage/TWindow)
│   ├── service/               ← Business logic + REST services
│   ├── view/                  ← Reusable presentation-only classes
│   ├── templates/
│   │   └── adminbs5/          ← Bootstrap 5 theme (layout.html, libraries.html, etc.)
│   ├── reports/               ← PDF report definitions (Adianti PDF Designer)
│   ├── output/                ← Generated temporary files (reports, exports)
│   ├── database/              ← Local SQLite databases
│   ├── images/                ← Application images
│   ├── resources/             ← HTML fragments used by templates
│   └── lib/                   ← App-specific libraries
│
├── lib/
│   └── adianti/               ← Framework core (NEVER EDIT)
│       ├── base/              ← Standard traits (AdiantiStandardListTrait, etc.)
│       ├── core/              ← Framework nucleus (AdiantiCoreApplication, etc.)
│       ├── database/          ← Database layer (TRecord, TRepository, etc.)
│       ├── widget/            ← All UI widget classes
│       ├── wrapper/           ← Bootstrap wrappers (BootstrapFormBuilder, etc.)
│       ├── validator/         ← Field validators
│       ├── service/           ← Backend services (autocomplete, uploader, etc.)
│       ├── registry/          ← Session + cache (TSession, TAPCache)
│       └── log/               ← Logging classes
│
├── vendor/                    ← Composer packages (DomPDF, PHPMailer, etc.)
└── files/                     ← User-uploaded files storage
```

## File Naming Conventions

- Models: `Product.class.php` → class `Product` extends `TRecord`
- Controllers: `ProductList.class.php` or `ProductList.php` → class `ProductList`
- Standard suffix: `.class.php` (legacy) or `.php` both accepted
- Class name must match file name
- Located in `app/model/`, `app/control/` (can have subdirectories)

## application.php — Main Config

```php
// app/config/application.php
return [
    'general' => [
        'timezone'       => 'America/Sao_Paulo',
        'language'       => 'pt',        // 'pt', 'en', 'es', 'it', 'de', 'fr'
        'application'    => 'myapp',
        'title'          => 'My App',
        'theme'          => 'adminbs5',  // Bootstrap 5 theme
        'debug'          => '1',         // '1' = on, '0' = off
        'strict_request' => '1',         // Recommended: '1' (security)
    ],
    'template' => [
        'navbar' => [
            'has_menu_mode_switch' => '1',
            'has_main_mode_switch' => '1',
        ],
        'dialogs' => [
            'use_swal' => '1',           // Use SweetAlert2 for messages
        ],
        'theme' => [
            'menu_mode' => 'dark',       // 'dark' | 'light'
            'main_mode' => 'light',
        ],
    ],
];
```

## Database Connection INI Files

Each database needs a file `app/config/<name>.ini`:

```ini
; app/config/samples.ini — PostgreSQL example
[samples]
host = localhost
port = 5432
name = mydb
user = myuser
pass = mypassword
type = pgsql         ; pgsql | mysql | sqlite | mssql | oci8 | ibase | fbird

; MySQL example
[myapp]
host     = localhost
port     = 3306
name     = myapp_db
user     = root
pass     = password
type     = mysql
prep     = 1         ; use prepared statements (recommended)
cache    = TAPCache   ; optional query-level cache

; SQLite example
[local]
name = app/database/local.db
type = sqlite
```

`TTransaction::open('samples')` maps to `app/config/samples.ini`.

## menu.xml — Navigation + Routing

All controllers must appear in `menu.xml` (or in `AdiantiClassMap::getAllowedClasses()`) to be accessible.

```xml
<?xml version="1.0" encoding="utf-8"?>
<menu>
    <menuitem label="Products">
        <menuitem label="Product List"    action="ProductList"    icon="fa:box"/>
        <menuitem label="Product Form"    action="ProductForm"    icon="fa:plus"/>
        <menuitem label="Sale List"       action="SaleList"       icon="fa:shopping-cart"/>
    </menuitem>

    <menuitem label="Reports">
        <menuitem label="Sales Report"    action="SalesReport"    icon="fa:chart-bar"/>
    </menuitem>
</menu>
```

To call a specific method on load:

```xml
<menuitem label="New Sale" action="SaleMultiValueForm#method=onClear"/>
```

`TXMLBreadCrumb` reads `menu.xml` to build breadcrumb navigation:

```php
new TXMLBreadCrumb('menu.xml', 'ProductList')
```

## Request Lifecycle

### Full Page Load (index.php)

1. `init.php` — autoloader bootstrapped
2. `application.php` — config loaded
3. `TSession::start()` — session initialized
4. Theme HTML template assembled (`app/templates/adminbs5/layout.html`)
5. `menu.xml` parsed, filtered by user permissions
6. Template placeholders replaced (`{MENU}`, `{class}`, `{title}`, etc.)
7. If `?class=ClassName` in URL: `AdiantiCoreApplication::loadPage()` called

### AJAX Action (engine.php — all subsequent requests)

1. `$_REQUEST['class']` and `$_REQUEST['method']` extracted
2. Permission checked against session
3. Class instantiated, method called
4. Output captured and returned as HTML fragment
5. JavaScript inserts HTML into `#adianti_content` div

## Class Autoloading

Autoloading via `AdiantiCoreLoader::autoload()` + `AdiantiApplicationLoader::autoload()`:

- Framework classes: mapped from `lib/adianti/` via class map
- Application classes: scanned from `app/model/`, `app/control/`, `app/service/`, etc.
- No `use` statements needed for framework classes — all globally available
- Application classes can be in subdirectories (scanned recursively)

## Theme System (Bootstrap 5 — adminbs5)

The default theme is `adminbs5` (Bootstrap 5 + jQuery 3.7 + FontAwesome 6 + SweetAlert2).

Theme files in `app/templates/adminbs5/`:

- `layout.html` — full page shell (sidebar, topbar, content div)
- `libraries.html` — CSS/JS includes
- `iframe.html` — embedded frame version

Configurable via `application.php` under `template`:

- `menu_mode`: `'dark'` | `'light'`
- `main_mode`: `'dark'` | `'light'`
- `has_menu_mode_switch`: show/hide theme toggle
- `box_layout`: centered max-width layout
- `only_top_menu`: horizontal navigation only

Icons use FontAwesome 6: `'fa:save'`, `'fas:trash-alt'`, `'far:edit'`, `'fab:github'`.

## Permissions & Authentication

The framework integrates with an administrative module (separate package) that provides:

- User/group management
- Program registration (menu items → allowed classes)
- Permission assignment per user/group

For custom permission checks:

```php
// In menu setup callback
$permission_callback = function($program) {
    return TSession::getValue('logged') && CheckPermission($program);
};
AdiantiMenuBuilder::parse('menu.xml', $theme, $permission_callback);
```

`TSession` stores authentication data:

```php
TSession::setValue('logged', true);
TSession::setValue('userid', $user->id);
TSession::setValue('username', $user->name);
TSession::setValue('usergroups', [1, 2, 3]);
```

## Version History (v8.x)

| Version | Date | Key additions |
|---------|------|---------------|
| 8.5.0 | 2026-04 | Oracle 12c+ pagination, UUID v7 policy, notebook pills, datagrid groups/subtotals, drag-scroll Kanban/Gantt |
| 8.4.0 | 2025-12 | PHP 8.5 support, TSignaturePad, dark mode login, library updates (DomPDF 3.1.4) |
| 8.3.0 | 2025-09 | 6-language support, TBarChart/TLineChart/TPieChart (ChartJS), box_layout, only_top_menu |
| 8.2.0 | 2025-07 | TRecord::findCache(), isCreatedBySessionUser(), mobile fullscreen windows, a_dump() |
| 8.1.0 | 2025-04 | PHP 8.2 minimum, TPageWrapper, TPageFrame, Object injection security fix, STRICT_REQUESTS |
| 8.0.0 | 2024-12 | Bootstrap 5 migration, TMultiCombo, TModalForm, TTreeView rewrite, UUID support |

## Migration Notes

- **Bootstrap 4 → 5**: Mandatory template update from `theme3/theme4` to `adminbs5`
- **application.ini → application.php**: Config format changed in 8.0
- **FontAwesome 4 → 6**: Replace `"fa:"` with `"fas:"` for solid icons
- **PHP minimum**: 8.2 since v8.1.0
- **XSS protection**: Now on by default; use `disableHtmlConversion()` or `{$var|raw}` where raw HTML needed
- **Change events**: `TCombo::reload()`, `TDBCombo::reloadFromModel()` fire change events by default — pass `false` to suppress
