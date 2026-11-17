---
name: psrv-testing
description: Printorian-server's verification discipline — the change-surface to required-evidence table (PKGBUILD, Python tool, service unit, kernel/config, ISO, docs), the evidence contract with origin labels (dev VM vs real hardware), the exact status vocabulary, and the independence/no-substitution rules. Use when planning proof, running checks, or judging results.
---

# Verification discipline

This repo's product is infrastructure, so its evidence rules are stricter
about *where* something was proven than about how many tests ran.

## 1. Change surface → required evidence

| Change surface | Required evidence (beyond structural gates) |
|---|---|
| Any change | `makepkg --printsrcinfo` clean on every touched PKGBUILD; `python3 -m py_compile` (or ruff when installed) on every touched .py; `bash -n` (or shellcheck when installed) on every touched script. |
| New/changed PKGBUILD | Clean-chroot build (`extra-x86_64-build`) exits 0; throwaway-root `-U` install succeeds and `-Ql` lists what the package claims to lay down; `pkgver` bump cites the upstream release. |
| Python tool | It runs end-to-end with its real inputs (a probe run produces its report; the mirror script's dry-run mode prints what it would push). TUI verified over `ssh -t` from another session, or labeled NOT RUN. |
| Service/unit/config | Unit parses (`systemd-analyze verify`); the service's effect demonstrated in the sanctioned sandbox or labeled NOT RUN — nothing is enabled on the host by an agent. |
| Kernel/config/scheduler/fs choice | A measurement plan naming the target hardware and the comparison baseline; the measurement itself when the hardware is available; until then an explicit assertion label. Dev-VM measurements are provisional evidence, labeled. |
| ISO builder | The ISO builds and its artifact hash is recorded; booting it is hardware-gated (UNSUPPORTED on the dev VM). |
| Security-relevant code | The constraints checked line-by-line (scheme, host validation, private-address refusal, parameter binding) — review finding, not self-attestation. |
| Docs-only | Every claim verified against the repo; numbers cite commands. |

## 2. Evidence contract

Every gating run records: exact argv, cwd, exit code (never through a
pipe), the printed lines that matter, artifact paths + sha256 when they
gate, **who ran it** (agent/model — independence is checked), and the
**origin label**: `dev-vm` or `target-hardware`. An unlabeled benchmark is
`INVALID`.

## 3. Status vocabulary (exact)

`PASS / FAIL / NOT RUN / UNSUPPORTED / COULD NOT RUN / INVALID` —
UNSUPPORTED for what this host cannot do by design (boot the ISO, measure
hardware scheduler behavior); COULD NOT RUN for missing tooling (surface
the `pacman -S` line, never install); INVALID for contaminated evidence
(host state changed mid-run, wrong root, output lost).

## 4. Discipline rules

- **No substitutions.** `makepkg -s` on the host is not a chroot build; a
  user-home install is not a throwaway-root test; a lint pass is not a
  build. The check asked for is the check that runs.
- **No weakening to pass.** Sum, skip, threshold, or exclusion changes made
  to make a gate green are themselves changes through review.
- **Independence.** Implementer ≠ reviewer ≠ analyst; the gate checks from
  the evidence's who-ran-it.
- **Serialization.** One chroot build at a time (devtools chroots lock);
  one throwaway root per verification, cleaned in `finally`-style
  regardless of outcome.
- **Hardware claims.** Nothing measured only on the dev VM enters a
  decision about the real host without the gap being named in the report.
