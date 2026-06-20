---
description: Adianti Framework PHP coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP + Adianti Framework — Coding Standards

**Fonte:** aia-harness/templates/skills/adianti-framework (first-party)

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Acesso a model fora de transação | Sempre envolver em `TTransaction::open/close` |
| `SELECT *` via PDO raw | `TRecord::getObjects()` ou `TRepository::load()` |
| Não chamar `addAttribute()` para uma coluna | Coluna não persiste — registrar todos os atributos |
| `new TMessage()` em catch sem rollback | Sempre chamar `TTransaction::rollback()` no catch |
| Esquecer `$this->form->validate()` antes de salvar | Salva dados inválidos/incompletos |
| Nome de database hard-coded | `$this->setDatabase('name')` / config-driven |
| Lógica de negócio na classe de view/form | Métodos de model ou service classes |
| AJAX callbacks como métodos de instância | Devem ser `public static` para AJAX |
| Não chamar `$this->datagrid->createModel()` | DataGrid não renderiza colunas |
| Esquecer `parent::add($container)` | Página renderiza em branco |
| Classe não registrada em menu.xml ou allowed classes | Página não acessível |

## Padrões por objetivo

| Objetivo | Padrão |
|----------|--------|
| Listar registros com busca + paginação | `TStandardList` trait em `TPage` |
| Criar/Editar/Excluir um registro | `TStandardForm` trait em `TPage` |
| Lista + formulário na mesma página | `TStandardFormList` trait em `TPage` |
| Registro master + linhas de detalhe inline | Master-detail manual em `TPage` |
| Popup lookup/busca | Classe `TWindow` seek com `TForm::sendData()` |
| Detalhe read-only em painel lateral | `setTargetContainer('adianti_right_panel')` |
| Formulário em modal | Estender `TWindow`, encapsular classe de form |
| Many-to-many tags | `TDBCheckGroup` + `saveAggregate()` |
| Linhas inline dinâmicas | `TFieldList` + `saveComposite()` |
| Combos em cascata | `setChangeAction()` + `TCombo::reload()` |
| Upload de arquivo | `TFile` + `AdiantiFileSaveTrait::saveFile()` |

## Convenções

- Todo controller estende `TPage`; janelas estendem `TWindow`
- Ações referenciadas em `TAction` devem ser `public`; callbacks AJAX devem ser `public static`
- `TAction`: `['ClassName', 'methodName']` para static · `[$this, 'methodName']` para instance
- Models: sempre definir `TABLENAME`, `PRIMARYKEY`, `IDPOLICY` como constantes
- `addAttribute()` obrigatório para todo campo que deve ser persistido
