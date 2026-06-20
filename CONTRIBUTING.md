# Publishing a plugin

## Requirements

Before submitting, your plugin must:

- Have a public GitHub repo with a `.claude-plugin/plugin.json` manifest
- Follow the [Claude Code plugin structure](https://github.com/leandrosilvaferreira/aia_harness)
- Use a valid SPDX license (`MIT`, `Apache-2.0`, etc.)
- Have a descriptive README with usage instructions

## Steps

1. **Fork** this repo
2. **Edit** `registry.json` — add your plugin entry to the `plugins` array:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What it does (max 200 chars)",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "repository": "https://github.com/you/my-plugin",
  "license": "MIT",
  "category": "tooling",
  "keywords": ["keyword1", "keyword2"],
  "installUrl": "https://github.com/you/my-plugin",
  "publishedAt": "2026-06-19"
}
```

3. **Validate** locally:

```bash
npm install -g ajv-cli
ajv validate -s schema/plugin.schema.json -d registry.json
```

4. **Open a PR** — CI validates the schema automatically

## Rules

- One plugin per PR
- `name` must be globally unique in the registry (kebab-case)
- `installUrl` must be publicly accessible
- No malicious or deceptive plugins — maintainers review all submissions

## Updating a plugin

Submit a PR changing `version` and any updated fields.  
`publishedAt` stays as the original publish date — do not update it.
