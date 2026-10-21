#!/usr/bin/env node
/**
 * Points git at the checked-in hooks in .githooks, so `commit-msg` runs before
 * every commit and rejects messages that would not produce a release.
 *
 * Run once per clone with `pnpm hooks:install` (or the same `git config`
 * command by hand); it is deliberately not a `prepare` script because the
 * Docker deps stage installs dependencies without the `scripts/` directory.
 *
 * Outside a clone -- the Docker build, a tarball -- there is no .git and this
 * is a no-op.
 *
 * Note: on POSIX checkouts the hook also needs its executable bit in git
 * (`git update-index --chmod=+x .githooks/commit-msg`); on Windows git runs
 * hooks through sh regardless.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".git")) {
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "ignore",
  });
} catch {
  // No git on PATH: nothing to install, and installs must not fail because of it.
}
