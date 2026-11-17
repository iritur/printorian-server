---
name: psrv-decisions
description: Settled questions for printorian-server — the charter's binding rulings (real packages not containers/VM-tricks for the host, Python-only tooling with SSH TUIs, latest upstream versions, owner installs system packages), the security constraints, and the inherited deployment-shape ruling from the app repo. Check before proposing anything architectural or "simpler".
---

# Decided questions — do not re-litigate

Full fidelity: `.zcode/memories/psrv-charter.md` (the owner's verbatim
plan) and `.zcode/memories/psrv-network-and-host.md` (measured environment
facts). This file is the index you check before proposing something.

## 1. Ruled by the owner (2026-11-17)

| Ruling | Consequence |
|---|---|
| **Real packages, not containers, not VM tricks** | The host layer ships as a pacman repo of PKGBUILD-built packages; chroot builds, throwaway-root verification. Containers remain the app's delivery (app repo ruling) — this repo never re-opens that. |
| **Latest upstream versions only** | No pinning to old releases for comfort; `pkgver` cites the upstream release note. Reopen only with a concrete incompatibility, filed as an issue with evidence. |
| **The owner installs system packages** | Agents never run `pacman -S`/`-R`. Missing tool → the exact install line surfaced via escalation/hole. |
| **All scripts in Python; TUIs modern and SSH-functional** | Shell only for makepkg/pacman/repo glue the charter names. A TUI that needs a local display is wrong on arrival. |
| **Security constraints** | http/https only, host validated, localhost/loopback/private/reserved refused (explicit local-probe exceptions say so at the call site); parameter-bound SQL, never string-assembled. |
| **Every optimization claim carries a measurement plan** | "Fastest/most secure" without a measurement on the real host is an assertion, labeled as one. Dev-VM numbers never masquerade as hardware numbers. |
| **gitverse mirror** | The repo mirrors to `gitverse.ru/printorian/server`; mirroring is a script in this repo (charter item 4), run with the owner's push approval. |

## 2. Inherited from the app repo (binding here too)

- Deployment shape: containerized modular monolith under systemd compose;
  no microservices; no host installs of the *application* (the trust chain
  is CI's digest/cosign/release-gate). The host this repo builds *serves*
  those containers.
- Never invent a number the machine did not measure; null is "not
  measured", never 0.
- Backups are drilled or they are not backups (ADR-0019 culture) — the
  charter's backup service inherits the drill requirement.

## 3. Environment facts on record (measured 2026-11-17)

See `.zcode/memories/psrv-network-and-host.md`: docker.io blob CDNs
unreachable from the dev network (ghcr/quay fine); fastvm kernel lacks the
overlay module; Python 3.14-only. These are facts with commands attached —
re-measure before claiming they changed, then update the memory.

## 4. Reopening anything

Takes an owner decision or a measurement the ruling did not have. Bring
evidence, not preference.
