# The printorian-server harness (`.zcode/`)

A development studio for this repo, ported from the app harness
(`../printorian/.zcode/`, itself ported from lumen) and rebuilt around the
**real-packages principle**: the host layer ships as a pacman repo of
PKGBUILD-built packages — chroot builds, throwaway-root verification, the
owner's key for signing, the owner's hands for every system install.

## Layout

```
.zcode/
├── config.json                     hook wiring (PreToolUse → the guard)
├── hooks/protect-generated-paths.sh
├── agents/                         9 role agents (psrv-planner … psrv-doc-writer)
├── skills/                         psrv-build, psrv-decisions, psrv-testing,
│                                   psrv-studio (router), psrv-memory-writer
├── memories/                       charter (verbatim) + network/host facts + index
└── workflows/                      psrv-gated-change, psrv-package-pipeline (.dwf.ts)
```

Naming: everything here is `psrv-*`, so it never collides with the app
repo's `printorian-*` harness when both live in one head.

## Precedence

`AGENTS.md` (binding rules: no system installs by agents, real packages,
upstream-latest, Python + SSH TUIs, the security constraints, measurement
discipline) → `memories/psrv-charter.md` (the owner's verbatim plan, with
dated amendments) → `skills/` → other memories (historical, never proof of
current behavior).

## Running the workflows

With `CreateWorkflow`, `saved` source (open a ZCode session in this
directory first):

- **psrv-package-pipeline** — `args: { package: "<name>", draft: true,
  sign: false }`. Upstream-latest check (or PKGBUILD draft) → clean-chroot
  build (`extra-x86_64-build`, devtools — owner-installed) → `repo-add`
  into `repo/x86_64/printorian-server.db.tar.gz` → install verification in
  a throwaway root (host untouched) → optional signing step handed to the
  owner. Never pushes.
- **psrv-gated-change** — one scoped change with structural gates
  (`makepkg --printsrcinfo`, ruff/py_compile, shellcheck/bash -n,
  `systemd-analyze verify`), independent review with bounded Flash
  confirmations, repo-wide final gate, PR text. Never pushes.

## What the hook blocks

Hand edits of generated artifacts — `repo/x86_64/` (the pacman repo db and
packages), makepkg workdirs (`pkgs/*/src/`, `pkgs/*/pkg/`), built packages
and signatures, `iso/`, the probe report. Each with its regeneration route
(`hooks/protect-generated-paths.sh`).

## The boundary with the app repo

The application stays containerized — that ruling lives in the app repo's
decisions skill §3 and is not re-litigated here. This repo builds what the
containers run on. The charter's 17 items plus their amendments
(`memories/psrv-charter.md`) are the founding intent; the repo's own docs
will carry the as-built truth as it grows.
