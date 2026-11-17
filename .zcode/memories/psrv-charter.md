---
name: psrv-charter
description: "The owner's charter for printorian-server (verbatim, 2026-11-17): custom minimal hardened Arch host for Printorian — real packages via a private pacman repo (model on iritur/gnome-git, better and more secure), hardware probe (VPS-aware), minimal hardened kernel, best scheduler/filesystem per measured hardware, per-hardware optimization flags, rebuild scripts, ISO+TUI installer, full server config, migrated-empty DB, post-install health check, backup service with drills, best-configured web monitoring; all tooling Python with SSH-functional TUIs; rebuild on dev, easy update on prod via pacman; GitHub origin mirrored to gitverse.ru/printorian/server."
metadata:
  node_type: memory
  type: project
---

**Why:** The host is the one layer the farm cannot pull as a verified
image, so the owner builds it as a product: reproducible from this repo,
updatable through a package channel, minimal enough to audit. This record
is the founding intent — the repo's docs and, later, its own ADRs carry the
as-built truth.

**How to apply:** Every proposal maps to a charter item (cite its number);
conflicts surface to the owner instead of being absorbed. The application
stays containerized (app repo's ruling) regardless of what this host is
built from.

## The charter, verbatim from the owner (2026-11-17)

Goal: the fastest, most secure, most stable server on the Linux kernel +
Arch for Printorian servicing.

1. **Rebuild on dev (current machine), easy update on production.**
2. **A GitHub-hosted pacman repository** for our packages — updates land on
   the server via `pacman` (model on gnome-git's custom-repo flow, "but
   better and more secure"). The close example the owner named —
   **`iritur/gnome-git`** — exists on GitHub, alongside **`iritur/pkgs`**.
3. **A universal probe script** that investigates and gathers everything
   about the target installation — hardware, environment, virtualization
   (it may be a VPS) — to correctly optimize the ISO to be built.
4. Repo at `printorian-server`, **origin on GitHub** — created by the owner
   2026-11-17 as PRIVATE `iritur/printorian-server`, first-pushed the same
   day — with a script **mirroring to gitverse**
   (`gitverse.ru/printorian/server`, already created empty).
5. **All scripts in Python.** TUI: nice, modern, technological — and
   correctly functional **through SSH** (Textual-class).
6. **Kernel configured and compiled for a printorian-only system**:
   minimal for security, latest kernel features, unneeded components
   switched off, per the provided hardware specification.
7. **Best scheduler** for the server's purpose and the hardware's
   abilities.
8. **Best filesystem** for the server's purpose and the hardware's
   abilities.
9. **Optimization flags for the provided hardware** during all
   compilations (kernel and all software).
10. A **list of tools and accompanying software to recompile** for the
    purpose, plus the package installation list.
11. A script to **download new packages and rebuild them**.
12. A script to **create ISO images** for first installation, with a modern
    TUI for the install process and progress.
13. **All server configuration** for correct Printorian functionality.
14. **Database created and migrated, empty** — the app's
    RUNBOOK-FIRST-BOOT state (migrated schema; a person provisions the
    owner).
15. A script to **check systems and set up health/status after
    installation**.
16. A **backup tool** on the installed server: different backup kinds,
    periodic stress/restore tests, a service to run backups with status,
    notifications and logs — secure, and drilled (ADR-0019 culture: an
    untested backup is not a backup).
17. The **best web tool to monitor** server system, component health and
    security status, configured the best way — aligned with, not
    duplicating, the app repo's documented observability target
    (VictoriaMetrics/Grafana/Alertmanager/Loki).

## Amendments

- **2026-11-17 (same day, from the harness session):** the host layer is
  built from **real packages — not containers, not VM tricks**; only
  **latest upstream versions**; and **the owner installs system packages
  themselves** — agents surface exact `pacman -S` lines, never execute.
  Security constraints for all tooling: http/https only, host validated,
  localhost/loopback/private/reserved refused (explicit local-probe
  exceptions say so); parameter-bound SQL only. Every performance/security
  claim carries a measurement plan; dev-VM evidence is labeled, never
  passed off as target-hardware evidence.

Related: [[psrv-network-and-host]].
