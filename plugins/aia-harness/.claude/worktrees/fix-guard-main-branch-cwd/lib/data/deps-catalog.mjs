/**
 * System dependency catalog — maps stack keys and tool names to required
 * system binaries, with cross-platform install hints.
 *
 * Pure data module: no functions, no IO.
 * @module data/deps-catalog
 */

/** @typedef {import('../profile.mjs').DepEntry} DepEntry */

/** Always required — the engine itself needs Node. @type {DepEntry[]} */
export const ENGINE_DEPS = [{ name: "node", level: "required" }];

/**
 * Stack key → additional binary deps.
 * Node-only stacks need nothing extra (ENGINE_DEPS already covers node).
 * @type {Record<string, DepEntry[]>}
 */
export const STACK_DEPS = {
  python: [
    { name: "python3", level: "required" },
    { name: "pip3", level: "recommended" },
    { name: "uv", level: "recommended" },
  ],
  go: [{ name: "go", level: "required" }],
  php: [
    { name: "php", level: "required" },
    { name: "composer", level: "required" },
  ],
  ruby: [
    { name: "ruby", level: "required" },
    { name: "bundle", level: "required" },
  ],
  java: [
    { name: "java", level: "required" },
    { name: "mvn", level: "recommended" },
  ],
  rust: [{ name: "cargo", level: "required" }],
  dotnet: [{ name: "dotnet", level: "required" }],
};

/**
 * Tool name → extra binary deps beyond what the stack already requires.
 * Node-only tools (ponytail) need nothing extra — already covered by ENGINE_DEPS.
 * @type {Record<string, DepEntry[]>}
 */
export const TOOL_DEPS = {
  rtk: [{ name: "rtk", level: "required" }],
  // uv installs and runs the graphify binary (with its own managed python). The
  // PreToolUse orientation hook is plain Node (already a required engine dep), so
  // graphify needs no python3 on PATH.
  graphify: [{ name: "uv", level: "required" }],
  ponytail: [],
  gh: [{ name: "gh", level: "required" }],
};

/**
 * Install hints per binary per platform.
 * @type {Record<string, Record<'win32'|'darwin'|'linux', string>>}
 */
export const INSTALL_HINTS = {
  node: {
    win32: "winget install OpenJS.NodeJS  OU  fnm: https://github.com/Schniz/fnm",
    darwin: "brew install fnm && fnm install --lts",
    linux: "curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts",
  },
  python3: {
    win32: "winget install Python.Python.3  OU  https://www.python.org/downloads/",
    darwin: "brew install python3  OU  pyenv install 3.12",
    linux: "sudo apt install python3  OU  pyenv install 3.12",
  },
  pip3: {
    win32: "python -m ensurepip --upgrade",
    darwin: "python3 -m ensurepip --upgrade",
    linux: "python3 -m ensurepip --upgrade  OU  sudo apt install python3-pip",
  },
  uv: {
    win32: "winget install astral-sh.uv  OU  pip install uv",
    darwin: "brew install uv  OU  curl -LsSf https://astral.sh/uv/install.sh | sh",
    linux: "curl -LsSf https://astral.sh/uv/install.sh | sh",
  },
  go: {
    win32: "winget install GoLang.Go  OU  https://go.dev/dl/",
    darwin: "brew install go",
    linux: "sudo apt install golang-go  OU  https://go.dev/dl/",
  },
  php: {
    win32: "https://windows.php.net/download/",
    darwin: "brew install php",
    linux: "sudo apt install php",
  },
  composer: {
    win32: "https://getcomposer.org/Composer-Setup.exe",
    darwin: "brew install composer",
    linux: "https://getcomposer.org/download/",
  },
  ruby: {
    win32: "https://rubyinstaller.org/",
    darwin: "brew install ruby",
    linux: "sudo apt install ruby-full",
  },
  bundle: {
    win32: "gem install bundler",
    darwin: "gem install bundler",
    linux: "gem install bundler",
  },
  cargo: {
    win32: "winget install Rustlang.Rustup  OU  https://rustup.rs",
    darwin: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    linux: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  },
  java: {
    win32: "winget install Microsoft.OpenJDK.21  OU  https://adoptium.net/",
    darwin: "brew install --cask temurin",
    linux: "sudo apt install default-jdk  OU  https://adoptium.net/",
  },
  mvn: {
    win32: "winget install Apache.Maven  OU  https://maven.apache.org/download.cgi",
    darwin: "brew install maven",
    linux: "sudo apt install maven",
  },
  dotnet: {
    win32: "winget install Microsoft.DotNet.SDK.8  OU  https://dotnet.microsoft.com/download",
    darwin: "brew install --cask dotnet-sdk  OU  https://dotnet.microsoft.com/download",
    linux: "https://dotnet.microsoft.com/download",
  },
  graphify: {
    win32: "uv tool install graphifyy  OU  pip install graphifyy",
    darwin: "uv tool install graphifyy  OU  pip install graphifyy",
    linux: "uv tool install graphifyy  OU  pip install graphifyy",
  },
  gh: {
    win32: "winget install --id GitHub.cli",
    darwin: "brew install gh",
    linux: [
      "(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y))",
      "&& sudo mkdir -p -m 755 /etc/apt/keyrings",
      "&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg",
      "&& cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null",
      "&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg",
      '&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main"',
      "| sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null",
      "&& sudo apt update && sudo apt install gh -y",
    ].join(" \\\n  "),
  },
  rtk: {
    win32: [
      "WSL (recommended — full hook + auto-rewrite support):",
      "  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
      "  rtk init -g",
      "Native Windows (limited — no auto-rewrite hook, CLAUDE.md injection fallback only):",
      "  1. Download rtk-x86_64-pc-windows-msvc.zip from https://github.com/rtk-ai/rtk/releases",
      "  2. Extract rtk.exe and add its directory to PATH",
      "  3. rtk init -g",
      "  NOTE: do NOT install via npm — that installs an unrelated package with the same name.",
    ].join("\n"),
    darwin:
      "brew install rtk  OU  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
    linux:
      "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
  },
};
