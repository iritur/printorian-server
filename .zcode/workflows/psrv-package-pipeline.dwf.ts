/* zcode-workflow
description: The real-packages pipeline for printorian-server — drafts or verifies a PKGBUILD at upstream-latest, builds it in a clean devtools chroot, adds it to the local pacman repo with repo-add, verifies the install in a throwaway root (host untouched), and optionally hands the owner the signing step. Never pushes, never installs on the host.
whenToUse: Building/publishing one package into the printorian-server pacman repo. Not for general code changes (psrv-gated-change) or design calls (psrv-architect). Requires devtools for the chroot build; if missing, the run stops with the exact install line for the owner.
args:
  - name: package
    type: string
    description: Package name — its directory is pkgs/<package>/PKGBUILD.
    required: true
  - name: draft
    type: boolean
    description: Draft the PKGBUILD from upstream latest when missing, and bump it when stale. false = only verify and build what exists.
    default: true
  - name: sign
    type: boolean
    description: Hand the owner the signing step (their GPG key — agents never touch keys). false = package/db left unsigned with a note.
    default: false
*/

// ---------------------------------------------------------------------------
// The charter's real-packages discipline, mechanized: chroot build, repo-add,
// throwaway-root verification. Nothing in this pipeline writes outside this
// repo's directories and /tmp (psrv-build SKILL §3–§5).

const REPO_DIR = "repo/x86_64";
const REPO_DB = `${REPO_DIR}/printorian-server.db.tar.gz`;

interface UpstreamCheck {
  /** Latest upstream version tag/version string. */
  latestVersion: string;
  /** Where that fact comes from (release page URL). */
  source: string;
  /** true when pkgs/<package>/PKGBUILD already carries latestVersion. */
  current: boolean;
}

interface ImplResult {
  summary: string;
  changedPaths: string[];
  commits: string[];
  deviations: string;
}

interface SignDecision {
  done: boolean;
  note?: string;
}

interface WorkflowReport {
  conclusion: string;
  findings: { where: string; what: string; evidence: string; status: "verified" | "unconfirmed"; severity: "low" | "medium" | "high" }[];
  verified: string[];
  notCovered: string[];
}

function safeName(s: string): string {
  return /^[a-z0-9][a-z0-9._+-]*$/.test(s) ? s : "";
}

const pkgName = safeName(String(args.package ?? "").trim());
const draft = args.draft !== false;
const sign = args.sign === true;

if (pkgName === "") {
  return {
    conclusion: "No (valid) package name given; nothing ran.",
    findings: [],
    verified: [],
    notCovered: ["everything — the package argument is required (lowercase, pkg-style name)"],
  };
}

const notCovered: string[] = [];
const verified: string[] = [];

artifact.table("packages", {
  columns: [
    { field: "package", label: "Package" },
    { field: "artifact", label: "Artifact" },
    { field: "sha256", label: "sha256" },
    { field: "stage", label: "Stage" },
  ],
  key: "package",
});

// ---------------------------------------------------------------------------
phase("Check the build environment");
const pre = await world.run(
  "bash",
  [
    "-c",
    'echo "makepkg=$(command -v makepkg >/dev/null && echo ok || echo missing) ' +
      "devtools=$(command -v extra-x86_64-build >/dev/null && echo ok || echo missing) " +
      'repo-add=$(command -v repo-add >/dev/null && echo ok || echo missing) ' +
      "gpg=$(command -v gpg >/dev/null && echo ok || echo missing) sudo=$(sudo -n true 2>/dev/null && echo ok || echo missing)\"; exit 0",
  ],
  { timeoutMs: 30_000 },
);
log(pre.stdout.trim());
if (!pre.stdout.includes("makepkg=ok") || !pre.stdout.includes("repo-add=ok")) {
  return {
    conclusion: `makepkg/repo-add missing (${pre.stdout.trim()}) — pacman itself is incomplete; nothing ran.`,
    findings: [],
    verified: ["environment preflight"],
    notCovered: ["everything — base tooling missing"],
  };
}
if (pre.stdout.includes("devtools=missing")) {
  const decision = await hole<SignDecision>(
    "devtools is missing — the clean-chroot builder",
    "The real-packages pipeline builds in a clean chroot with extra-x86_64-build (devtools). Host-side " +
      "`makepkg -s` is banned here (it installs build deps onto YOUR system — owner rule: you install, agents " +
      "don't). Install it yourself, then choose done:\n\n  sudo pacman -S devtools",
  );
  if (!decision.done) {
    return {
      conclusion: "Stopped: devtools missing and the owner chose not to install it now. Nothing was built.",
      findings: [],
      verified: ["environment preflight"],
      notCovered: ["everything — devtools missing (sudo pacman -S devtools)"],
    };
  }
  const recheck = await world.run("bash", ["-c", "command -v extra-x86_64-build >/dev/null && echo ok || echo missing"], { timeoutMs: 30_000 });
  if (!recheck.stdout.includes("ok")) {
    return {
      conclusion: "devtools still missing after the owner's step; nothing was built.",
      findings: [],
      verified: ["environment preflight (twice)"],
      notCovered: ["everything — devtools still missing"],
    };
  }
}

// ---------------------------------------------------------------------------
phase("Draft or verify the PKGBUILD at upstream latest");
const exists = await world.run("bash", ["-c", `test -f pkgs/${pkgName}/PKGBUILD && echo yes || echo no`], { timeoutMs: 30_000 });
let upstream: UpstreamCheck | null = null;
if (exists.stdout.trim() === "yes") {
  const researcher = agent("Upstream researcher", {
    system:
      "You answer ONE question with a source: what is the latest released version of an upstream project, and is " +
      "our PKGBUILD's pkgver that version? Read pkgs/<name>/PKGBUILD for the current pkgver and source URL, then " +
      "check the upstream release page (WebFetch/WebSearch). The version comes from the official release page or " +
      "tag list, never a third-party listing. If you cannot verify, say so in current=false with the reason in " +
      "source — an honest unknown beats a guess.",
  });
  upstream = await researcher.ask<UpstreamCheck>(`Package: ${pkgName}. PKGBUILD at pkgs/${pkgName}/PKGBUILD.`);
  verified.push(`upstream check: latest=${upstream.latestVersion} (${upstream.source}); ours current=${upstream.current}`);
  if (!upstream.current && draft) {
    const fixer = agent("PKGBUILD bumper", {
      system:
        "You bump one PKGBUILD to a cited upstream release: pkgver/pkgrel, and sha512sums computed from the exact " +
        "release artifact you downloaded (curl it to /tmp from the official URL — http/https only — and sha256sum " +
        "your download before hashing; never copy sums from a listing). Commit as a sentence citing the release " +
        "note URL. Never push, never touch the host system.",
    });
    const bump = await fixer.ask<ImplResult>(
      `Bump pkgs/${pkgName}/PKGBUILD to ${upstream.latestVersion} (source: ${upstream.source}). Validate with makepkg --printsrcinfo afterwards.`,
    );
    verified.push(`bumped to ${upstream.latestVersion}: ${bump.commits.join(", ")}`);
  } else if (!upstream.current && !draft) {
    return {
      conclusion: `PKGBUILD for ${pkgName} is stale (${upstream.latestVersion} is out, ${upstream.source}) and draft=false. Nothing was built.`,
      findings: [{ where: `pkgs/${pkgName}/PKGBUILD`, what: `stale: latest is ${upstream.latestVersion}`, evidence: upstream.source, status: "verified", severity: "medium" }],
      verified,
      notCovered: ["build, repo-add, install verification — refused on a stale PKGBUILD"],
    };
  }
} else if (draft) {
  const implementer = agent("PKGBUILD drafter", {
    system:
      "You draft ONE PKGBUILD for upstream-latest software. Read .zcode/skills/psrv-build/SKILL.md §2 first. " +
      "Find the official upstream (release page, source tarball URL); pkgver is the latest release, cited in your " +
      "handoff; sha512sums computed from the exact artifact you downloaded to /tmp (http/https only, official host " +
      "only — never a mirror listing's copied sums). Directory pkgs/<name>/PKGBUILD; arches and depends honest " +
      "(check the project's own build docs); no vendored blobs upstream ships separately. Validate with " +
      "makepkg --printsrcinfo before committing. Commit as a sentence. Never push, never touch the host system. " +
      "If upstream is ambiguous or the artifact cannot be fetched from an official source, stop and return with " +
      "deviations saying so.",
  });
  const drafted = await implementer.ask<ImplResult>(`Draft pkgs/${pkgName}/PKGBUILD at upstream latest. Package name: ${pkgName}.`);
  verified.push(`PKGBUILD drafted: ${drafted.commits.join(", ")}`);
  if (drafted.deviations.trim() !== "") {
    notCovered.push(`draft deviations: ${drafted.deviations}`);
  }
} else {
  return {
    conclusion: `pkgs/${pkgName}/PKGBUILD does not exist and draft=false; nothing was built.`,
    findings: [],
    verified: ["existence check"],
    notCovered: ["everything — no PKGBUILD and drafting disabled"],
  };
}
const validate = await world.run("bash", ["-c", `cd pkgs/${pkgName} && makepkg --printsrcinfo >/dev/null && echo valid`], { timeoutMs: 120_000 });
verified.push(`PKGBUILD validation: exit ${validate.exitCode}`);
if (validate.exitCode !== 0) {
  return {
    conclusion: `pkgs/${pkgName}/PKGBUILD does not validate (makepkg --printsrcinfo exit ${validate.exitCode}).`,
    findings: [{ where: `pkgs/${pkgName}/PKGBUILD`, what: "invalid PKGBUILD", evidence: validate.stderr.slice(-800), status: "verified", severity: "high" }],
    verified,
    notCovered: ["build, repo-add, install verification"],
  };
}

// ---------------------------------------------------------------------------
phase("Build in a clean chroot");
const build = await world.run("bash", ["-c", `cd pkgs/${pkgName} && extra-x86_64-build -- --noconfirm`], {
  timeoutMs: 3_600_000,
  output: { tail: 16_384 },
});
verified.push(`chroot build (extra-x86_64-build): exit ${build.exitCode}`);
if (build.exitCode !== 0) {
  return {
    conclusion: `Clean-chroot build of ${pkgName} failed (exit ${build.exitCode}). Nothing entered the repo.\n${build.tail.slice(-2000)}`,
    findings: [{ where: `pkgs/${pkgName}`, what: "chroot build failed", evidence: build.tail.slice(-2000), status: "verified", severity: "high" }],
    verified,
    notCovered: ["repo-add, install verification — build failed"],
  };
}
const built = await world.run("bash", ["-c", `ls -1 pkgs/${pkgName}/*.pkg.tar.zst 2>/dev/null || ls -1 pkgs/${pkgName}/*.pkg.tar.xz 2>/dev/null`], { timeoutMs: 30_000 });
const builtPath = built.stdout.trim().split("\n")[0] ?? "";
if (builtPath === "") {
  return {
    conclusion: `Build exited 0 but no package artifact found in pkgs/${pkgName}/ — investigate before retry.`,
    findings: [],
    verified,
    notCovered: ["repo-add, install verification — artifact missing"],
  };
}
const sha = await world.run("bash", ["-c", `sha256sum ${builtPath}`], { timeoutMs: 60_000 });
verified.push(`artifact: ${builtPath} (sha256 ${sha.stdout.trim().split(" ")[0]})`);
report({ package: pkgName, artifact: builtPath, sha256: sha.stdout.trim().split(" ")[0] ?? "", stage: "built" }, "packages");

// ---------------------------------------------------------------------------
phase("Add the package to the pacman repo");
const add = await world.run(
  "bash",
  ["-c", `mkdir -p ${REPO_DIR} && repo-add ${REPO_DB} ${builtPath} && echo repo-added`],
  { timeoutMs: 120_000, output: { tail: 8_192 } },
);
verified.push(`repo-add to ${REPO_DB}: exit ${add.exitCode}`);
if (add.exitCode !== 0) {
  return {
    conclusion: `repo-add failed (exit ${add.exitCode}) — the built package is in pkgs/${pkgName}/ but the repo db was not updated.\n${add.tail.slice(-1000)}`,
    findings: [{ where: REPO_DB, what: "repo-add failed", evidence: add.tail.slice(-1000), status: "verified", severity: "high" }],
    verified,
    notCovered: ["install verification — repo step failed"],
  };
}
report({ package: pkgName, artifact: builtPath, sha256: sha.stdout.trim().split(" ")[0] ?? "", stage: "in-repo" }, "packages");

// ---------------------------------------------------------------------------
phase("Verify the install in a throwaway root");
const verifyInstall = await world.run(
  "bash",
  [
    "-c",
    `VROOT=$(mktemp -d /tmp/psrv-verify.XXXXXX) && sudo mkdir -p "$VROOT/var/lib/pacman" && ` +
      `sudo pacman --root "$VROOT" --dbpath "$VROOT/var/lib/pacman" -U ${builtPath} --noconfirm --disable-download-timeout && ` +
      `pacman --root "$VROOT" --dbpath "$VROOT/var/lib/pacman" -Ql ${pkgName} | head -30; RC=$?; ` +
      `sudo rm -rf "$VROOT"; exit $RC`,
  ],
  { timeoutMs: 1_800_000, output: { tail: 8_192 } },
);
verified.push(`throwaway-root install of ${pkgName}: exit ${verifyInstall.exitCode}`);
if (verifyInstall.exitCode !== 0) {
  return {
    conclusion: `Install verification of ${pkgName} into a throwaway root failed (exit ${verifyInstall.exitCode}). The package is in the repo but NOT proven installable.\n${verifyInstall.tail.slice(-1500)}`,
    findings: [{ where: builtPath, what: "throwaway-root install failed", evidence: verifyInstall.tail.slice(-1500), status: "verified", severity: "high" }],
    verified,
    notCovered: ["signing — verification failed first"],
  };
}
report({ package: pkgName, artifact: builtPath, sha256: sha.stdout.trim().split(" ")[0] ?? "", stage: "install-verified" }, "packages");

// ---------------------------------------------------------------------------
phase("Hand the owner the signing step, then report");
if (sign) {
  const decision = await hole<SignDecision>(
    "Sign the package and the repo db (your key)",
    "Agents never touch key material. With your key loaded, run:\n\n" +
      `  gpg --detach-sign --use-agent -u <KEYID> ${builtPath}\n` +
      `  gpg --detach-sign --use-agent -u <KEYID> ${REPO_DB}\n\n` +
      "(or `makepkg --sign` from the package dir). Then choose done — or skip with a note for why.",
  );
  if (decision.done) {
    verified.push("signing: owner reports done (key and signature are the owner's evidence)");
  } else {
    notCovered.push(`signing skipped by owner${decision.note ? ` (${decision.note})` : ""}`);
  }
} else {
  notCovered.push("package and repo db are UNSIGNED (sign=false) — consumers need SigLevel = Never/Optional until signed, which is a bootstrap-only posture");
}

await artifact.markdown(
  "pipeline-report",
  [
    `# Package pipeline: ${pkgName}`,
    "",
    `- Artifact: \`${builtPath}\``,
    `- sha256: \`${sha.stdout.trim().split(" ")[0]}\``,
    `- Repo: \`${REPO_DB}\` (repo-add exit ${add.exitCode})`,
    `- Install verification (throwaway root, host untouched): exit ${verifyInstall.exitCode}`,
    `- Chroot build: extra-x86_64-build exit ${build.exitCode}`,
    ...(upstream ? [`- Upstream: ${upstream.latestVersion} (${upstream.source})`] : []),
    "",
    "What is deliberately NOT done here: pushing (origin or gitverse mirror — the owner's), signing " +
    `(unless asked: ${sign ? "handed to owner" : "not requested"}), installing on any real host.`,
    ...(notCovered.length > 0 ? ["", "## Not covered", "", ...notCovered.map((n) => `- ${n}`)] : []),
  ].join("\n"),
  { title: "Pipeline report", description: `Build, repo-add and install verification of ${pkgName}.`, primary: true },
);

return {
  conclusion:
    `${pkgName}: built in a clean chroot (exit ${build.exitCode}), added to ${REPO_DB}, install-verified in a ` +
    `throwaway root (exit ${verifyInstall.exitCode}, host untouched). Upstream ${upstream ? upstream.latestVersion : "(newly drafted)"}. ` +
    `Next steps are the owner's: review, commit the repo/ artifacts, push + mirror, sign when ready.`,
  findings: [],
  verified,
  notCovered,
};
