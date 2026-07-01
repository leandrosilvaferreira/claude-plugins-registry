/**
 * Type definitions for the project profile produced by the detection engine.
 * This module is type-only; it has no runtime behavior.
 *
 * @module profile
 */

/**
 * @typedef {Object} LanguageInfo
 * @property {string} name        Language name (e.g. "TypeScript").
 * @property {"programming"|"markup"|"data"|"prose"|"config"} type Classification.
 * @property {number} bytes       Total bytes of source attributed to this language.
 * @property {number} files       Number of files attributed to this language.
 * @property {number} share       Share of programming bytes, 0..1 (programming langs only).
 */

/**
 * @typedef {Object} PackageManagerInfo
 * @property {string} name        npm | yarn | pnpm | bun | composer | pip | poetry | uv | go | cargo | maven | gradle | bundler | dotnet | unknown
 * @property {string} ecosystem   js | php | python | go | rust | jvm | ruby | dotnet | unknown
 * @property {string|null} version Declared version when known.
 * @property {string} evidence    Why this PM was chosen.
 */

/**
 * @typedef {Object} FrameworkInfo
 * @property {string} name
 * @property {"frontend"|"backend"|"fullstack"|"mobile"|"build"|"test"|"meta"} category
 * @property {string|null} version
 * @property {string} evidence
 */

/**
 * @typedef {Object} CommandSet
 * @property {string|null} install
 * @property {string|null} lint
 * @property {string|null} format
 * @property {string|null} typecheck
 * @property {string|null} test
 * @property {string|null} build
 * @property {string|null} run
 * @property {string} source      Where commands were inferred from.
 * @property {Record<string,string>} raw Raw declared scripts discovered.
 */

/**
 * @typedef {Object} MonorepoInfo
 * @property {boolean} isMonorepo
 * @property {string|null} tool   turborepo | nx | lerna | rush | pnpm | npm-workspaces | yarn-workspaces | go-work | cargo-workspace | null
 * @property {string[]} packages  Workspace globs or package dirs when discoverable.
 * @property {string|null} evidence
 */

/**
 * @typedef {Object} DomainInfo
 * @property {string} path        Path relative to project root.
 * @property {"app"|"package"|"layer"|"feature"|"module"|"service"} kind
 * @property {string} role        Human description of the domain's responsibility.
 */

/**
 * @typedef {Object} ArchitectureInfo
 * @property {"monorepo"|"layered"|"modular"|"flat"|"unknown"} style
 * @property {DomainInfo[]} domains
 * @property {string[]} signals   Directory/marker signals that informed the inference.
 */

/**
 * @typedef {Object} ExistingHarness
 * @property {boolean} claudeMd
 * @property {string[]} claudeMdFiles
 * @property {boolean} settings
 * @property {boolean} settingsLocal
 * @property {boolean} mcp
 * @property {boolean} hooks
 * @property {boolean} rules
 * @property {string[]} skills
 * @property {{ postCommit: boolean, postCheckout: boolean }} graphifyGitHooks  Whether graphify's git hooks are installed (markers present in .git/hooks/).
 */

/**
 * @typedef {Object} VcsInfo
 * @property {boolean} isGit
 * @property {boolean} worktreeReady
 * @property {string|null} defaultBranch
 * @property {string|null} remoteUrl     URL of the first remote found in .git/config, or null.
 */

/**
 * @typedef {Object} TestingInfo
 * @property {boolean}     configured    Project already uses unit tests (framework dep OR test files OR declared test script).
 * @property {string|null} framework     Detected unit-test framework name, or null.
 * @property {boolean}     hasTestFiles  Test files found via per-ecosystem glob.
 * @property {boolean}     hasTestScript A DECLARED `test` script exists (not the ecosystem default).
 * @property {string|null} recommended   Recommended framework when !configured, or null.
 * @property {boolean}     installNeeded Recommended framework requires a dep install (false for built-ins).
 * @property {string}      evidence      Short human explanation.
 */

/**
 * @typedef {Object} LargeFileEntry
 * @property {string} file   Path relative to project root (POSIX).
 * @property {number} lines  Line count.
 */

/**
 * @typedef {Object} LargeFilesInfo
 * @property {number} threshold              Line budget per source file (350).
 * @property {number} count                  Source files already over the budget.
 * @property {"block"|"advisory"} recommended Suggested large-file guard mode: `block`
 *   (clean repo → born strict, agent refactors before finishing) or `advisory`
 *   (legacy repo with pre-existing big files → suggest + confirm, never auto-block).
 * @property {LargeFileEntry[]} sample        Up to a few of the largest offenders.
 */

/**
 * @typedef {Object} GitHubPMInfo
 * @property {boolean} detected          Remote contains github.com and isGit=true.
 * @property {boolean} hasIssueTemplates .github/ISSUE_TEMPLATE/ path found in file list.
 * @property {boolean} hasWorkflows      .github/workflows/ path found in file list.
 * @property {boolean} hasPmConfig       .claude/pm-config.json found in file list.
 */

/**
 * @typedef {Object} HookPlaceholderIssue
 * @property {string} event       Hook event key the offending entry lives under (e.g. "PostToolUse").
 * @property {string} matcher     Matcher string of the group ("" if the group has none, e.g. SessionStart).
 * @property {string} script      Basename of the offending `args` string (its last `/`-separated segment).
 * @property {string} arg         The full offending `args[]` string, verbatim.
 * @property {"CLAUDE_PROJECT_DIR"|"CLAUDE_PLUGIN_ROOT"|"CLAUDE_PLUGIN_DATA"} placeholder
 *   Which path placeholder was found unbraced.
 */

/**
 * @typedef {Object} HookHygieneInfo
 * @property {HookPlaceholderIssue[]} placeholderIssues  Exec-form hook `args` entries using a
 *   bare (unbraced) path placeholder. Exec-form hooks (an `args` array present) bypass the
 *   shell, so Claude Code only substitutes the braced `${VAR}` form — a bare `$VAR` is passed
 *   through literally and `node` throws MODULE_NOT_FOUND resolving it as a relative path.
 */

/**
 * @typedef {{ name: string, level: 'required'|'recommended' }} DepEntry
 */

/**
 * @typedef {Object} DepCheck
 * @property {string} name           Binary name, e.g. "node", "python3".
 * @property {boolean} found
 * @property {string|null} version   Parsed version string, or null if not found.
 * @property {string} resolvedPath   Absolute path to binary, or '' if not found.
 * @property {'required'|'recommended'} level
 * @property {Record<'win32'|'darwin'|'linux', string>} installHint
 */

/**
 * @typedef {Object} DepsReport
 * @property {'ok'|'warn'|'block'} status
 *   ok    = all required found.
 *   warn  = some recommended missing, no required missing.
 *   block = at least one required missing — engine exits 1.
 * @property {DepCheck[]} checks
 * @property {string[]} missing   Names of required deps not found.
 */

/**
 * @typedef {Object} ProjectProfile
 * @property {string} root                  Absolute project root.
 * @property {LanguageInfo[]} languages     Sorted by bytes desc.
 * @property {string|null} primaryLanguage  Top programming language.
 * @property {PackageManagerInfo[]} packageManagers
 * @property {FrameworkInfo[]} frameworks
 * @property {MonorepoInfo} monorepo
 * @property {CommandSet} commands
 * @property {ArchitectureInfo} architecture
 * @property {ExistingHarness} existingHarness
 * @property {TestingInfo} testing
 * @property {LargeFilesInfo} largeFiles    Pre-existing oversized-source summary + recommended guard mode.
 * @property {GitHubPMInfo} githubPM        GitHub PM detection results.
 * @property {HookHygieneInfo} hookHygiene  Bare-placeholder hook hygiene results.
 * @property {VcsInfo} vcs
 * @property {string[]} markers             Notable marker files found at root.
 * @property {boolean} truncated            True if the file walk hit its cap.
 */

export {};
