# Working in this repository (ZCode harness)

Standing instructions for ZCode agents in `printorian-server` — the host
layer of the Printorian farm. The application repo (`../printorian`) is the
authority on what the system *is*; this repo is the authority on what it
runs *on*. Its founding charter is recorded verbatim in
`.zcode/memories/psrv-charter.md`.

**Read HANDOFF context before starting**: this repo has no HANDOFF.md yet —
when the first studio run creates one, reading it before starting and
updating it before finishing becomes binding (same protocol as the app
repo). Until then, the charter memory is the state of record.

## 1. Binding owner rules

1. **Never push without explicit approval.** When approved: origin via SSH
   (`git push git@github.com:iritur/printorian-server.git`), then run the
   gitverse mirror script (when it exists) — `gitverse.ru/printorian/server`.
2. **Never install or remove system packages.** The owner sets up this
   machine themselves, with latest packages, their own best setup
   (2026-11-17). Missing tooling is surfaced (`hole()`/escalation) with the
   exact `pacman -S` line, never executed. Package *building* happens in
   chroots and throwaway roots that touch nothing.
3. **Real packages, not containers, not VM tricks.** The host layer is built
   from native Arch packages (PKGBUILD → makepkg/devtools chroot →
   repo-add → signed pacman repo). The application stays containerized —
   that ruling lives in the app repo and is not re-litigated here. VM
   evidence (this fastvm box) is always labeled as VM evidence; claims about
   real hardware (speed, scheduler, kernel features) are measured on the
   real target host or they are assertions.
4. **All tooling is Python.** Scripts, TUIs, services. TUIs are modern and
   correctly functional **over SSH** (Textual-class). Shell is for glue the
   charter explicitly asks for (makepkg/pacman/repo invocations).
5. **Security constraints for every network- or data-touching line**:
   http/https only; validate the host before a request; refuse localhost,
   loopback, private and reserved addresses (unless the target *is* the
   local service being probed — then say so in the code); database access is
   parameter-bound, never string-assembled.
6. **Never invent a number the machine did not measure** — inherited from
   the app repo (ADR-0007 culture) and doubly binding for "fastest/most
   secure" claims: each ships with a measurement plan or is labeled an
   assertion.

## 2. The harness map

| | |
|---|---|
| `AGENTS.md` | this file — binding session rules |
| `.zcode/memories/psrv-charter.md` | the owner's charter, verbatim — the founding decisions |
| `.zcode/skills/` | build (real-packages discipline), decisions, testing, studio (router), memory-writer |
| `.zcode/agents/` | planner, architect, researcher, implementer, reviewer, tester, test-analyst, gatekeeper, doc-writer |
| `.zcode/workflows/` | `psrv-gated-change`, `psrv-package-pipeline` |
| `.zcode/hooks/` | generated-artifact guard (repo db, built packages, makepkg workdirs, ISOs) |

Precedence: this file → charter memory → skills → other memories
(historical, never proof of current behavior).

Naming: everything is `psrv-*` inside this repo (short, unambiguous, and it
never collides with the app repo's `printorian-*` agents when both harnesses
are loaded in one head).

## 3. Repo layout the harness builds toward

```
pkgs/<name>/PKGBUILD        one package per directory (upstream-latest)
repo/x86_64/                the pacman repo (printorian-server.db.tar.gz + packages)
tools/                      Python tooling (probe, rebuild, mirror, health)
iso/                        generated ISO images (never hand-edited)
```

Nothing of this exists yet — the workflows create it on first use, and the
first gated-change task should be the charter's probe tool (item 3).
