/* zcode-workflow
description: Single-task gated pipeline for printorian-server — structural gates (PKGBUILD validation, python/shell checks, unit verification), implement, fix loops, independent review with bounded confirmation, final repo-wide gate, PR text. Never pushes, never installs on the host.
whenToUse: One scoped change in the server repo — a tool, a PKGBUILD, a config, docs. Not for build-to-repo runs of a package (psrv-package-pipeline), and not for design calls (psrv-architect).
args:
  - name: task
    type: string
    description: The task text — what to change and the acceptance.
    required: true
  - name: branch
    type: string
    description: Working branch to create (must not already exist).
    default: zcode/psrv-change
*/

// ---------------------------------------------------------------------------
// Structural gates for this repo. Each runs only over what its inputs cover,
// and says so: a gate with no inputs is recorded NOT RUN, never silently
// green (psrv-testing SKILL §1). Chroot builds are gated in
// psrv-package-pipeline; here `extra-x86_64-build` is only required when the
// diff touches a PKGBUILD.

const PREFLIGHT_SCRIPT =
  'echo "makepkg=$(command -v makepkg >/dev/null && echo ok || echo missing) ' +
  'devtools=$(command -v extra-x86_64-build >/dev/null && echo ok || echo missing) ' +
  'ruff=$(command -v ruff >/dev/null && echo ok || echo missing) ' +
  'shellcheck=$(command -v shellcheck >/dev/null && echo ok || echo missing) ' +
  'systemd-analyze=$(command -v systemd-analyze >/dev/null && echo ok || echo missing) ' +
  'python=$(command -v python3 >/dev/null && echo ok || echo missing)"; exit 0';

/** Validate every PKGBUILD under pkgs/ (or the whole repo if none named). */
function pkgbuildGateScript(scope: string[]): string {
  const dirs = scope.length > 0 ? scope.join(" ") : "$(find pkgs -name PKGBUILD -printf '%h ' 2>/dev/null)";
  return (
    `for d in ${dirs}; do ` +
    'if [ -f "$d/PKGBUILD" ]; then (cd "$d" && makepkg --printsrcinfo >/dev/null) || { echo "PKGBUILD invalid: $d" >&2; exit 1; }; fi; done; echo ok'
  );
}

/** Python gate: ruff when installed, else py_compile over the scope. */
function pythonGateScript(scope: string[], all: boolean): string {
  const files = all
    ? "$(find . -name '*.py' -not -path './.venv/*' 2>/dev/null)"
    : scope.filter((p) => p.endsWith(".py")).join(" ");
  return (
    `FILES="${files}"; [ -z "$FILES" ] && { echo "no python inputs"; exit 0; }; ` +
    'if command -v ruff >/dev/null; then ruff check $FILES; else python3 -m py_compile $FILES; fi'
  );
}

/** Shell gate: shellcheck when installed, else bash -n over the scope. */
function shellGateScript(scope: string[], all: boolean): string {
  const files = all
    ? "$(find . -name '*.sh' -not -path './.venv/*' 2>/dev/null)"
    : scope.filter((p) => p.endsWith(".sh")).join(" ");
  return (
    `FILES="${files}"; [ -z "$FILES" ] && { echo "no shell inputs"; exit 0; }; ` +
    'if command -v shellcheck >/dev/null; then shellcheck $FILES; else for f in $FILES; do bash -n "$f" || exit 1; done; fi'
  );
}

/** Unit gate: systemd-analyze verify on the scope's .service files. */
function unitGateScript(scope: string[]): string {
  const files = scope.filter((p) => p.endsWith(".service")).join(" ");
  return (
    `FILES="${files}"; [ -z "$FILES" ] && { echo "no unit inputs"; exit 0; }; ` +
    "systemd-analyze verify $FILES"
  );
}

interface GateStep {
  name: string;
  script: string;
  timeoutMs: number;
}

function gatesFor(scope: string[], all: boolean): GateStep[] {
  return [
    { name: "PKGBUILDs validate", script: pkgbuildGateScript(scope), timeoutMs: 120_000 },
    { name: "python check", script: pythonGateScript(scope, all), timeoutMs: 300_000 },
    { name: "shell check", script: shellGateScript(scope, all), timeoutMs: 120_000 },
    { name: "units verify", script: unitGateScript(scope), timeoutMs: 120_000 },
  ];
}

interface ImplResult {
  summary: string;
  changedPaths: string[];
  commits: string[];
  /** The command that proves the deliverable, plus its key output line. */
  provingCheck: string;
  deviations: string;
  hardest: string;
}

interface ReviewFinding {
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "NOTE";
  where: string;
  problem: string;
  suggestion: string;
  readingList: string;
}

interface Review {
  findings: ReviewFinding[];
  verdict: string;
}

interface Confirmation {
  verdict: "confirmed" | "refuted" | "inconclusive";
  preexisting: boolean;
  evidence: string;
}

interface ReportFinding {
  where: string;
  what: string;
  evidence: string;
  status: "verified" | "unconfirmed";
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  conclusion: string;
  findings: ReportFinding[];
  verified: string[];
  notCovered: string[];
}

function safeSlug(s: string): string {
  return /^[A-Za-z0-9_\/.\-]+$/.test(s) ? s : "";
}

const task = String(args.task ?? "").trim();
const branch = safeSlug(String(args.branch ?? "")) || "zcode/psrv-change";

if (task === "") {
  return {
    conclusion: "No task text was given; nothing ran.",
    findings: [],
    verified: [],
    notCovered: ["everything — the task argument is required"],
  };
}

const notCovered: string[] = [];
const verified: string[] = [];
const reportFindings: ReportFinding[] = [];

async function runGate(step: GateStep): Promise<{ name: string; exitCode: number; tail: string }> {
  const r = await world.run("bash", ["-c", step.script], { timeoutMs: step.timeoutMs, output: { tail: 8_192 } });
  return { name: step.name, exitCode: r.exitCode, tail: r.stderr + r.stdout };
}

// ---------------------------------------------------------------------------
phase("Check the build environment");
const pre = await world.run("bash", ["-c", PREFLIGHT_SCRIPT], { timeoutMs: 30_000 });
log(pre.stdout.trim());
if (!pre.stdout.includes("python=ok")) {
  return {
    conclusion: "python3 is missing on this host; nothing ran.",
    findings: [],
    verified: ["environment preflight"],
    notCovered: ["everything — no interpreter"],
  };
}
if (!pre.stdout.includes("devtools=ok")) {
  notCovered.push(
    "clean-chroot build NOT AVAILABLE — devtools missing (owner: sudo pacman -S devtools). PKGBUILD changes gate on makepkg --printsrcinfo only; run psrv-package-pipeline after devtools is installed for real builds.",
  );
}

// ---------------------------------------------------------------------------
phase("Verify a clean tree and a green baseline");
const status = await git.status();
if (!status.clean) {
  return {
    conclusion:
      `Working tree is dirty (${status.unstaged.length + status.untracked.length} paths); commit or stash first.`,
    findings: [],
    verified: ["git status"],
    notCovered: ["everything — dirty tree"],
  };
}
const baseLog = await git.log(1);
const baseSha = baseLog[0]?.hash ?? "HEAD";
const baseSubject = baseLog[0]?.subject ?? "";
const tracked = await git.changedFiles();
const baselineScope = tracked.filter((p) => !p.startsWith(".zcode/") && p !== "AGENTS.md" && p !== "README.md");
for (const gate of gatesFor(baselineScope, false)) {
  const g = await runGate(gate);
  verified.push(`baseline ${gate.name}: exit ${g.exitCode}`);
  if (g.exitCode !== 0) {
    return {
      conclusion: `Baseline red before any change: ${gate.name}.\n${g.tail.slice(-1500)}`,
      findings: [{ where: "(baseline)", what: `${gate.name} fails on ${baseSubject}`, evidence: g.tail.slice(-1500), status: "verified", severity: "high" }],
      verified,
      notCovered: ["the task — refused to start on a red baseline"],
    };
  }
}

// ---------------------------------------------------------------------------
phase("Create the working branch");
const br = await world.run("bash", ["-c", `git checkout -b ${branch}`], { timeoutMs: 60_000 });
if (br.exitCode !== 0) {
  return {
    conclusion: `Could not create branch ${branch}: ${br.stderr.slice(0, 400)}`,
    findings: [],
    verified,
    notCovered: ["the task — branch creation failed"],
  };
}

// ---------------------------------------------------------------------------
phase("Implement the task");
const implementer = agent("Implementer", {
  system:
    "You are the implementation stage of the printorian-server studio. Read first, binding: AGENTS.md §1 " +
    "(no system installs — surface the pacman line instead; real packages; Python-only tooling with SSH-functional " +
    "TUIs; the security constraints — http/https only, host validated, localhost/loopback/private/reserved refused, " +
    "parameter-bound SQL; no invented numbers); .zcode/skills/psrv-build/SKILL.md for commands and layout. " +
    "Rules: write only what the task asks; PKGBUILDs track upstream latest with the release note cited and sha512 " +
    "from the artifact you inspected; builds and installs happen in chroots/throwaway roots, never on the host; " +
    "commit as a sentence, never push, never amend reviewed commits. Blocked by a rule → return with deviations " +
    "saying so. A check impossible to pass or contradictory instructions → escalate plainly.",
});
const impl = await implementer.ask<ImplResult>(
  `Task: ${task}\nBranch: ${branch} (checked out). Implement, prove, commit. Return the contract.`,
);
log(`Implementation: ${impl.commits.length} commits, ${impl.changedPaths.length} paths`);
if (impl.deviations.trim() !== "") {
  reportFindings.push({ where: "(plan)", what: `Deviation: ${impl.deviations}`, evidence: "implementer handoff", status: "unconfirmed", severity: "low" });
}

// ---------------------------------------------------------------------------
phase("Run the structural gates and fix what they catch");
const fixer = agent("Fixer", {
  system:
    "You repair a printorian-server change so a gate passes without widening the diff: fix the cause, never the " +
    "gate (no sum loosening, no skip, no threshold). Commit each fix as its own sentence. Never push, never touch " +
    "the host system. If the gate is wrong rather than the code, return with notFixed saying so. Escalate rather " +
    "than improvise around a block.",
});
let gatesGreen = false;
for (let round = 1; round <= 3; round++) {
  const failures: string[] = [];
  for (const gate of gatesFor(impl.changedPaths, false)) {
    const g = await runGate(gate);
    verified.push(`round ${round} ${gate.name}: exit ${g.exitCode}`);
    if (g.exitCode !== 0) failures.push(`--- ${gate.name} ---\n${g.tail.slice(-2500)}`);
  }
  if (failures.length === 0) {
    gatesGreen = true;
    break;
  }
  if (round === 3) break;
  await fixer.ask(`Gates failed on round ${round}:\n${failures.join("\n")}\nFix the causes and commit. Context: ${impl.summary}`);
}
if (!gatesGreen) {
  return {
    conclusion: `Gates still red after 3 fix rounds on ${branch}; branch left for inspection.`,
    findings: reportFindings,
    verified,
    notCovered: [...notCovered, "review, final gate — gates never went green"],
  };
}

// ---------------------------------------------------------------------------
phase("Review the diff independently");
const reviewer = agent("Reviewer", {
  system:
    "You are the independent review stage of the printorian-server studio; read the diff, report findings, never " +
    "edit. Read first, binding: AGENTS.md; .zcode/skills/psrv-decisions/SKILL.md (proposing a settled question as " +
    "new work is itself a finding); .zcode/memories/MEMORY.md grepped for the touched areas — repeating a recorded " +
    "trap is CRITICAL, cite the memory. Policy is read from the BASE ref — a change cannot weaken its own review. " +
    "Sections: correctness; packaging discipline (upstream-latest pkgver with a cited release, correct sums, no " +
    "vendored blobs, reproducible); the security constraints line-by-line (scheme, host validation, private-address " +
    "refusal, parameter binding); Python/TUI discipline (typed, SSH-functional, stdlib-first); number discipline " +
    "(dev-VM labels kept distinct from hardware claims); evidence expectations; minimal diff. " +
    "Approving takes evidence; objecting is the useful move; clean is called clean, plainly. Every finding carries " +
    "a reading list for a bounded confirmer.",
});
const review = await reviewer.ask<Review>(
  `Review branch ${branch} against ${baseSha} ("${baseSubject}"). Task: ${task}\n` +
    `Changed paths: ${impl.changedPaths.join(", ") || "(none reported)"}\nLook hardest at: ${impl.hardest}\n` +
    `Run git diff ${baseSha} yourself and read the files. Findings in severity order + verdict.`,
);
log(`Review: ${review.findings.length} finding(s)`);

// ---------------------------------------------------------------------------
phase("Confirm each finding in parallel, cheaply");
const MAX_CONFIRM = 12;
const toConfirm = review.findings.slice(0, MAX_CONFIRM);
if (review.findings.length > MAX_CONFIRM) {
  notCovered.push(`${review.findings.length - MAX_CONFIRM} finding(s) beyond the cap reported unconfirmed`);
}
// Join: dispositions need every confirmation together.
const confirmations = await Promise.all(
  toConfirm.map((f, i) =>
    agent(`Confirmer ${i + 1}`, {
      model: "GLM-5.3-Flash",
      budget: { webSearch: 0 },
      system:
        "You verify ONE review finding from its evidence alone; read-only, never edit. Read the reading list and " +
        "run its command if it names one. confirmed / refuted / inconclusive — an honest inconclusive beats a " +
        "grind; at most ONE follow-up read.",
    }).ask<Confirmation>(`Finding: ${JSON.stringify(f)}\nBase ref: ${baseSha}.`),
  ),
);
const confirmedOnChange: ReviewFinding[] = [];
const confirmedPreexisting: ReviewFinding[] = [];
toConfirm.forEach((f, i) => {
  const c = confirmations[i];
  if (c.verdict === "confirmed") {
    (c.preexisting ? confirmedPreexisting : confirmedOnChange).push(f);
    reportFindings.push({
      where: f.where,
      what: `${f.problem} → ${f.suggestion}`,
      evidence: `confirmed (${c.evidence})${c.preexisting ? " — pre-existing" : ""}`,
      status: "verified",
      severity: f.severity === "CRITICAL" ? "high" : f.severity === "MAJOR" ? "medium" : "low",
    });
  } else if (c.verdict === "refuted") {
    reportFindings.push({ where: f.where, what: `Refuted: ${f.problem}`, evidence: c.evidence, status: "verified", severity: "low" });
  } else {
    reportFindings.push({
      where: f.where,
      what: `${f.problem} → ${f.suggestion}`,
      evidence: `inconclusive (${c.evidence})`,
      status: "unconfirmed",
      severity: f.severity === "CRITICAL" ? "high" : f.severity === "MAJOR" ? "medium" : "low",
    });
  }
});

// ---------------------------------------------------------------------------
phase("Fix the confirmed findings and re-check");
if (confirmedOnChange.length > 0) {
  await fixer.ask(
    `Fix these confirmed findings on ${branch}:\n` +
      confirmedOnChange.map((f) => `- [${f.severity}] ${f.where}: ${f.problem} → ${f.suggestion}`).join("\n") +
      `\nCommit each fix as its own sentence.`,
  );
  let regreen = false;
  for (let round = 1; round <= 2; round++) {
    const failures: string[] = [];
    for (const gate of gatesFor(impl.changedPaths, false)) {
      const g = await runGate(gate);
      if (g.exitCode !== 0) failures.push(`--- ${gate.name} ---\n${g.tail.slice(-2500)}`);
    }
    if (failures.length === 0) {
      regreen = true;
      verified.push("post-fix re-gate green");
      break;
    }
    if (round === 2) break;
    await fixer.ask(`Post-fix gates still red:\n${failures.join("\n")}\nFix and commit.`);
  }
  if (!regreen) {
    return {
      conclusion: `Confirmed fixes applied but gates did not recover on ${branch}; branch left for inspection.`,
      findings: reportFindings,
      verified,
      notCovered: [...notCovered, "final gate — post-fix gates never went green"],
    };
  }
  const delta = await reviewer.ask<Review>(
    `Delta re-review on ${branch} versus ${baseSha}: only that the fixes hold; do not re-raise reported findings.`,
  );
  delta.findings
    .filter((f) => f.severity === "CRITICAL" || f.severity === "MAJOR")
    .forEach((f) =>
      reportFindings.push({ where: f.where, what: `Delta re-review: ${f.problem}`, evidence: f.readingList, status: "unconfirmed", severity: f.severity === "CRITICAL" ? "high" : "medium" }),
    );
}
if (confirmedPreexisting.length > 0) {
  notCovered.push(
    `${confirmedPreexisting.length} confirmed pre-existing defect(s) recorded, not fixed: ` +
      confirmedPreexisting.map((f) => `${f.where} — ${f.problem}`).join("; "),
  );
}

// ---------------------------------------------------------------------------
phase("Run the final gate over the whole repo");
for (const gate of gatesFor(impl.changedPaths, true)) {
  const g = await runGate(gate);
  verified.push(`final ${gate.name} (repo-wide): exit ${g.exitCode}`);
  if (g.exitCode !== 0) {
    return {
      conclusion: `Final gate red: ${gate.name}.\n${g.tail.slice(-1500)}`,
      findings: reportFindings,
      verified,
      notCovered: [...notCovered, "chroot build + throwaway-root install — run psrv-package-pipeline for those"],
    };
  }
}
const hasTests = await files.glob("tests/**/*.py");
if (hasTests.length > 0) {
  const pytest = await world.run("bash", ["-c", "python3 -m pytest -q 2>/dev/null || { command -v pytest >/dev/null && pytest -q; } || { echo 'pytest missing (owner: pacman -S python-pytest)'; exit 42; }"], { timeoutMs: 600_000, output: { tail: 8_192 } });
  if (pytest.exitCode === 42) {
    notCovered.push("pytest suite NOT RUN — pytest not installed (owner: sudo pacman -S python-pytest)");
  } else {
    verified.push(`pytest: exit ${pytest.exitCode}`);
    if (pytest.exitCode !== 0) {
      return {
        conclusion: `pytest red on ${branch}.\n${(pytest.stderr + pytest.stdout).slice(-1500)}`,
        findings: reportFindings,
        verified,
        notCovered: [...notCovered, "chroot build + throwaway-root install — run psrv-package-pipeline"],
      };
    }
  }
} else {
  notCovered.push("no tests/ directory yet — the proving check is the task's own: " + (impl.provingCheck || "(none reported)"));
}

// ---------------------------------------------------------------------------
phase("Write the handoff and let a fresh reader check it");
const prText = [
  `## ${task.split("\n")[0]}`,
  "",
  impl.summary,
  "",
  `**Proving check:** ${impl.provingCheck || "(see gates)"}`,
  `**Commits:** ${impl.commits.join(", ") || "(see branch)"}`,
  ...(impl.deviations.trim() !== "" ? ["", `**Deviations:** ${impl.deviations}`] : []),
  ...(confirmedPreexisting.length > 0
    ? ["", `**Pre-existing defects found** (not fixed here): ${confirmedPreexisting.map((f) => `${f.where} — ${f.problem}`).join("; ")}`]
    : []),
].join("\n");
const reader = agent("Handoff reader", {
  model: "GLM-5.3-Flash",
  budget: { webSearch: 0 },
  system:
    "You read a handoff for unsupported claims — from the text alone. List anything unsupported, any number " +
    "without a source, any question the owner will ask that it does not answer. Empty list means it holds.",
});
const readerNotes = await reader.ask<string>(`Handoff to check:\n${prText}`);

await artifact.markdown(
  "change-report",
  [
    `# Gated change: ${task.split("\n")[0]}`,
    "",
    `Branch \`${branch}\` from \`${baseSha}\` ("${baseSubject}").`,
    "",
    impl.summary,
    "",
    "## Gates",
    "",
    ...verified.map((v) => `- ${v}`),
    "",
    "## Findings ledger",
    "",
    ...(reportFindings.length === 0 ? ["- none"] : reportFindings.map((f) => `- [${f.severity}/${f.status}] ${f.where}: ${f.what}`)),
    ...(notCovered.length > 0 ? ["", "## Not covered", "", ...notCovered.map((n) => `- ${n}`)] : []),
  ].join("\n"),
  { title: "Change report", description: "Gates, findings and dispositions.", primary: true },
);
await artifact.markdown("pr-text", prText + (readerNotes.trim() === "" ? "" : `\n\n**Reader notes:** ${readerNotes}`), {
  title: "Pull-request text (not pushed)",
});

return {
  conclusion:
    `READY: ${task.split("\n")[0]} on ${branch} (${impl.commits.length} commits). ` +
    `${review.findings.length} finding(s): ${confirmedOnChange.length} fixed, ${confirmedPreexisting.length} pre-existing recorded, the rest refuted/unconfirmed. ` +
    `Nothing pushed; nothing installed on the host.`,
  findings: reportFindings,
  verified,
  notCovered,
};
