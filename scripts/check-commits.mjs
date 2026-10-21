#!/usr/bin/env node
/**
 * Commit message gate.
 *
 * semantic-release derives the next version from the commit subjects on main
 * (`fix`/`perf` -> patch, `feat` -> minor, `!` or a `BREAKING CHANGE` footer ->
 * major) and silently ignores every other subject. A malformed subject
 * therefore means "merged, but no release" -- this script fails before that.
 *
 * Modes:
 *   node scripts/check-commits.mjs --range v0.6.1..HEAD
 *   node scripts/check-commits.mjs --message-file .git/COMMIT_EDITMSG  (hook)
 *   node scripts/check-commits.mjs                                     (CI: reads the event env)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Types the release tooling understands, plus the usual non-releasing ones so
// they are accepted on purpose instead of by accident.
const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "style",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

// type(scope)!: subject -- the `!` marks a breaking change.
const HEADER = /^([a-zA-Z]+)(?:\(([^()\r\n]+)\))?(!)?: (.+)$/;
const FIELD = "\u001f";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch {
    return null;
  }
}

/** Returns the problem with a subject, or null when it is fine. */
function inspect(subject) {
  const match = HEADER.exec(subject);
  if (!match) {
    return "not a Conventional Commit header (expected `type(scope)!: subject`)";
  }
  if (!TYPES.includes(match[1])) {
    return `unknown type "${match[1]}" (allowed: ${TYPES.join(", ")})`;
  }
  if (match[4].trim() === "") {
    return "empty subject";
  }
  return null;
}

function isMerge(subject) {
  return subject.startsWith("Merge ");
}

function commitsIn(...args) {
  const out = git([
    "log",
    "--no-merges",
    "--format=%H" + FIELD + "%s",
    ...args,
  ]);
  if (out === null) {
    return null;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split(FIELD, 2);
      return { hash: hash.slice(0, 8), subject };
    });
}

function report(entries) {
  const bad = entries.filter((entry) => entry.problem);
  for (const entry of bad) {
    console.error(`  ${entry.hash}  ${entry.subject}`);
    console.error(`            -> ${entry.problem}`);
  }
  if (bad.length > 0) {
    console.error(
      `\n${bad.length} of ${entries.length} message(s) would not be picked up by semantic-release.`,
    );
    console.error(
      "Fix the subject to `type(scope)!: summary` (feat/fix/perf/refactor/docs/style/test/build/ci/chore/revert).",
    );
    return 1;
  }
  console.log(
    `${entries.length} message(s) checked, all parse as Conventional Commits.`,
  );
  return 0;
}

function fromMessageFile(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  // Ignore comment lines (an aborted `git commit` leaves only those) and merge
  // messages, which semantic-release ignores as well.
  const subject = lines.find(
    (line) => line.trim() !== "" && !line.startsWith("#"),
  );
  if (!subject || isMerge(subject)) {
    return 0;
  }
  return report([{ hash: path, subject, problem: inspect(subject) }]);
}

function fromRange(range) {
  const commits = commitsIn(range);
  if (commits === null) {
    console.error(`cannot resolve commit range ${range}`);
    return 2;
  }
  const entries = commits.map(({ hash, subject }) => ({
    hash,
    subject,
    problem: inspect(subject),
  }));
  return report(entries);
}

/** Range derived from the GitHub event, so the workflow needs no arguments. */
function fromEvent(env) {
  if (env.EVENT_NAME === "pull_request") {
    // A squash merge uses the PR title, a merge commit brings the branch
    // commits along: check both.
    const entries = [];
    const title = (env.PR_TITLE || "").trim();
    if (title !== "") {
      entries.push({
        hash: "PR title",
        subject: title,
        problem: inspect(title),
      });
    }
    const range = `${env.PR_BASE}..${env.PR_HEAD}`;
    const commits = commitsIn(range);
    if (commits === null) {
      console.log(
        `commit range ${range} not available locally, checked the PR title only`,
      );
    } else {
      entries.push(
        ...commits.map(({ hash, subject }) => ({
          hash,
          subject,
          problem: inspect(subject),
        })),
      );
    }
    return report(entries);
  }

  const zero = /^0+$/;
  if (env.BEFORE && !zero.test(env.BEFORE)) {
    return fromRange(`${env.BEFORE}..${env.SHA}`);
  }
  // New branch / first push: there is no usable range, check the pushed tip.
  const commits = commitsIn("-1", env.SHA);
  if (commits === null) {
    console.error(`cannot read commit ${env.SHA}`);
    return 2;
  }
  return report(
    commits.map(({ hash, subject }) => ({
      hash,
      subject,
      problem: inspect(subject),
    })),
  );
}

function main(argv, env) {
  const fileIndex = argv.indexOf("--message-file");
  if (fileIndex !== -1) {
    const path = argv[fileIndex + 1];
    if (!path) {
      console.error("--message-file needs a path");
      return 2;
    }
    return fromMessageFile(path);
  }

  const rangeIndex = argv.indexOf("--range");
  if (rangeIndex !== -1) {
    const range = argv[rangeIndex + 1];
    if (!range) {
      console.error("--range needs a value, e.g. --range v0.6.1..HEAD");
      return 2;
    }
    return fromRange(range);
  }

  if (!env.EVENT_NAME) {
    console.error(
      "nothing to check: pass --range or --message-file (or run inside GitHub Actions)",
    );
    return 2;
  }
  return fromEvent(env);
}

process.exitCode = main(process.argv.slice(2), process.env);
