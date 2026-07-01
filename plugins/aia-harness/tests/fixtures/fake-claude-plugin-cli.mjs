#!/usr/bin/env node
// Fake `claude` CLI double for hooks/scripts/check-plugin-update.mjs tests.
// Behavior is controlled by env vars so one fixture covers every scenario:
//   AIA_TEST_INSTALLED_VERSION — version reported by `plugin list --json`
//   AIA_TEST_MARKETPLACE       — marketplace suffix reported in the id
//   AIA_TEST_OMIT_SELF         — "1" omits the aia-harness entry from the list
//   AIA_TEST_FAIL_ON           — comma-separated subcommands to fail:
//                                "list" | "marketplace-update" | "update"
const args = process.argv.slice(2);
const failOn = new Set((process.env.AIA_TEST_FAIL_ON ?? "").split(",").filter(Boolean));
const marketplace = process.env.AIA_TEST_MARKETPLACE ?? "test-marketplace";
const installedVersion = process.env.AIA_TEST_INSTALLED_VERSION ?? "0.1.0";
const omitSelf = process.env.AIA_TEST_OMIT_SELF === "1";

if (args[0] === "plugin" && args[1] === "list" && args.includes("--json")) {
  if (failOn.has("list")) {
    process.stderr.write("simulated failure: plugin list\n");
    process.exit(1);
  }
  const entries = omitSelf ? [] : [{ id: `aia-harness@${marketplace}`, version: installedVersion }];
  process.stdout.write(JSON.stringify(entries));
  process.exit(0);
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "update") {
  if (failOn.has("marketplace-update")) {
    process.stderr.write("simulated failure: marketplace update\n");
    process.exit(1);
  }
  process.exit(0);
} else if (args[0] === "plugin" && args[1] === "update") {
  if (failOn.has("update")) {
    process.stderr.write("simulated failure: plugin update\n");
    process.exit(1);
  }
  process.exit(0);
} else {
  process.exit(1);
}
