/**
 * Framework catalog. A framework is matched when any of its dependency names
 * (exact or prefix) appears in the project's dependency set, or any of its
 * marker files exist. Inspired by @vercel/frameworks' three-way matcher.
 *
 * @module data/frameworks
 */

/**
 * @typedef {Object} FrameworkDef
 * @property {string} name
 * @property {"frontend"|"backend"|"fullstack"|"mobile"|"build"|"test"|"meta"} category
 * @property {"js"|"php"|"python"|"ruby"|"jvm"|"dotnet"|"go"|"any"} ecosystem
 * @property {string[]} [deps]         Exact dependency names.
 * @property {string[]} [depPrefixes]  Dependency name prefixes (e.g. "@remix-run/").
 * @property {string[]} [markers]      Marker files (relative paths) that imply this framework.
 */

/** @type {FrameworkDef[]} */
export const FRAMEWORKS = [
  // ---- JS fullstack / meta-frameworks ----
  { name: "Next.js", category: "fullstack", ecosystem: "js", deps: ["next"] },
  { name: "Nuxt", category: "fullstack", ecosystem: "js", deps: ["nuxt", "nuxt3"] },
  { name: "SvelteKit", category: "fullstack", ecosystem: "js", deps: ["@sveltejs/kit"] },
  { name: "Remix", category: "fullstack", ecosystem: "js", depPrefixes: ["@remix-run/"] },
  { name: "Astro", category: "fullstack", ecosystem: "js", deps: ["astro"] },
  { name: "Gatsby", category: "fullstack", ecosystem: "js", deps: ["gatsby"] },
  { name: "Angular", category: "frontend", ecosystem: "js", deps: ["@angular/core"] },
  // ---- JS frontend libraries ----
  { name: "React", category: "frontend", ecosystem: "js", deps: ["react"] },
  { name: "Vue", category: "frontend", ecosystem: "js", deps: ["vue"] },
  { name: "Svelte", category: "frontend", ecosystem: "js", deps: ["svelte"] },
  { name: "SolidJS", category: "frontend", ecosystem: "js", deps: ["solid-js"] },
  { name: "Qwik", category: "frontend", ecosystem: "js", deps: ["@builder.io/qwik"] },
  { name: "Preact", category: "frontend", ecosystem: "js", deps: ["preact"] },
  // ---- JS backend ----
  { name: "NestJS", category: "backend", ecosystem: "js", deps: ["@nestjs/core"] },
  { name: "Express", category: "backend", ecosystem: "js", deps: ["express"] },
  { name: "Fastify", category: "backend", ecosystem: "js", deps: ["fastify"] },
  { name: "Koa", category: "backend", ecosystem: "js", deps: ["koa"] },
  { name: "Hono", category: "backend", ecosystem: "js", deps: ["hono"] },
  { name: "AdonisJS", category: "backend", ecosystem: "js", deps: ["@adonisjs/core"] },
  // ---- JS native / mobile ----
  { name: "React Native", category: "mobile", ecosystem: "js", deps: ["react-native"] },
  { name: "Expo", category: "mobile", ecosystem: "js", deps: ["expo"] },
  // ---- JS build / test ----
  { name: "Vite", category: "build", ecosystem: "js", deps: ["vite"] },
  { name: "Webpack", category: "build", ecosystem: "js", deps: ["webpack"] },
  { name: "esbuild", category: "build", ecosystem: "js", deps: ["esbuild"] },
  { name: "Rollup", category: "build", ecosystem: "js", deps: ["rollup"] },
  { name: "Vitest", category: "test", ecosystem: "js", deps: ["vitest"] },
  { name: "Jest", category: "test", ecosystem: "js", deps: ["jest"] },
  { name: "Mocha", category: "test", ecosystem: "js", deps: ["mocha"] },
  { name: "Playwright", category: "test", ecosystem: "js", deps: ["@playwright/test", "playwright"] },
  { name: "Cypress", category: "test", ecosystem: "js", deps: ["cypress"] },
  // ---- PHP ----
  { name: "Laravel", category: "fullstack", ecosystem: "php", deps: ["laravel/framework"], markers: ["artisan"] },
  { name: "Symfony", category: "fullstack", ecosystem: "php", deps: ["symfony/framework-bundle", "symfony/symfony"] },
  { name: "Slim", category: "backend", ecosystem: "php", deps: ["slim/slim"] },
  { name: "CakePHP", category: "fullstack", ecosystem: "php", deps: ["cakephp/cakephp"] },
  { name: "Yii", category: "fullstack", ecosystem: "php", deps: ["yiisoft/yii2"] },
  { name: "Laminas", category: "fullstack", ecosystem: "php", depPrefixes: ["laminas/"] },
  { name: "WordPress", category: "fullstack", ecosystem: "php", markers: ["wp-config.php", "wp-load.php"] },
  { name: "Drupal", category: "fullstack", ecosystem: "php", deps: ["drupal/core"] },
  { name: "Adianti", category: "fullstack", ecosystem: "php", deps: ["adianti/framework"], markers: ["lib/adianti", "engine.php", "menu.xml"] },
  { name: "Pest", category: "test", ecosystem: "php", deps: ["pestphp/pest"] },
  { name: "PHPUnit", category: "test", ecosystem: "php", deps: ["phpunit/phpunit"] },
  // ---- Python (dependency names matched against requirements/pyproject text) ----
  { name: "Django", category: "fullstack", ecosystem: "python", deps: ["django"], markers: ["manage.py"] },
  { name: "Flask", category: "backend", ecosystem: "python", deps: ["flask"] },
  { name: "FastAPI", category: "backend", ecosystem: "python", deps: ["fastapi"] },
  // ---- JVM ----
  { name: "Spring Boot", category: "backend", ecosystem: "jvm", deps: ["spring-boot-starter"], depPrefixes: ["org.springframework.boot"] },
  { name: "Quarkus", category: "backend", ecosystem: "jvm", depPrefixes: ["io.quarkus"] },
  { name: "Micronaut", category: "backend", ecosystem: "jvm", depPrefixes: ["io.micronaut"] },
  // ---- Ruby / .NET ----
  { name: "Ruby on Rails", category: "fullstack", ecosystem: "ruby", deps: ["rails"], markers: ["config/application.rb"] },
  { name: "ASP.NET Core", category: "backend", ecosystem: "dotnet", markers: ["Program.cs", "Startup.cs"] },
  // ---- JS libs / tooling (detected for skill mapping) ----
  { name: "shadcn/ui", category: "frontend", ecosystem: "js", deps: ["@shadcn/ui"], markers: ["components.json"] },
  { name: "LangChain.js", category: "meta", ecosystem: "js", depPrefixes: ["@langchain/"], deps: ["langchain"] },
  { name: "Remotion", category: "meta", ecosystem: "js", deps: ["remotion"] },
  { name: "amqplib", category: "backend", ecosystem: "js", deps: ["amqplib", "rabbitmq-client"] },
  { name: "Prisma", category: "meta", ecosystem: "js", deps: ["@prisma/client", "prisma"] },
  { name: "node-postgres", category: "backend", ecosystem: "js", deps: ["pg", "postgres"] },
];
