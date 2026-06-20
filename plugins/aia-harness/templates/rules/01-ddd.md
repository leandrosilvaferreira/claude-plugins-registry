---
paths:
  - "**/*"
---

# Domain-Driven Design

## Objetivo

Aplicar DDD de forma pragmática, mantendo regras de negócio isoladas de frameworks, banco de dados, APIs externas e detalhes de infraestrutura.

## Faça

- Modele o código usando conceitos reais do domínio do negócio.
- Use nomes que façam sentido para pessoas do negócio e para desenvolvedores.
- Separe domínio, aplicação, infraestrutura e interface.
- Mantenha regras de negócio dentro da camada de domínio.
- Use entidades quando houver identidade e ciclo de vida.
- Use Value Objects para valores imutáveis com significado no domínio.
- Use Aggregates para proteger invariantes de negócio.
- Use Domain Services apenas quando a regra não pertencer naturalmente a uma entidade ou Value Object.
- Use Application Services ou Use Cases para orquestrar fluxos.
- Use Repositories como abstração de persistência.
- Faça a camada de domínio depender de abstrações, não de implementações.
- Deixe banco de dados, ORM, filas, HTTP, cache e serviços externos na infraestrutura.
- Mantenha validações de regra de negócio no domínio.
- Mantenha validações de formato, transporte e entrada na camada de interface ou aplicação.
- Prefira comandos e métodos que expressem intenção de negócio.
- Proteja invariantes dentro do próprio modelo de domínio.
- Use eventos de domínio quando algo relevante aconteceu no negócio.
- Mantenha o domínio testável sem banco, rede, framework ou container.
- Crie factories apenas quando a criação do objeto tiver regra relevante.
- Faça o código refletir a linguagem usada no negócio.

## Não faça

- Não coloque regra de negócio em controllers, rotas, resolvers, handlers HTTP ou componentes visuais.
- Não coloque regra de negócio em repositories.
- Não acople entidades a ORM, banco, framework ou serialização.
- Não use nomes técnicos genéricos quando existir nome de domínio melhor.
- Não crie entidades anêmicas que só carregam dados e deixam toda regra em services.
- Não crie Domain Services para qualquer função simples.
- Não crie Aggregates grandes demais.
- Não exponha setters públicos que permitam quebrar invariantes.
- Não deixe infraestrutura chamar diretamente detalhes internos do domínio.
- Não modele o domínio baseado apenas nas tabelas do banco.
- Não misture DTOs, entidades de domínio e modelos de persistência sem necessidade clara.
- Não use DDD para criar camadas artificiais em CRUD simples.
- Não crie abstrações de domínio sem regra de negócio real.
- Não duplique regras de negócio entre domínio, aplicação e interface.
- Não trate integração externa como parte do domínio.
- Não deixe casos de uso dependerem diretamente de detalhes de framework.

## Critérios de aceitação

- A regra de negócio principal está fora de controllers, rotas e repositories.
- O domínio pode ser testado sem banco de dados ou serviços externos.
- Os nomes representam conceitos reais do negócio.
- As invariantes são protegidas dentro do domínio.
- A infraestrutura pode ser trocada com impacto mínimo no domínio.
- Não há camadas extras sem necessidade concreta.
