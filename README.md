# printorian-server

The host layer for Printorian: a custom, minimal, hardened **Arch Linux**
system purpose-built to serve the farm — kernel, filesystem, scheduler and
compiler flags chosen for the target hardware; a private pacman repository
for our packages; an ISO installer with a TUI; backup tooling with periodic
restore drills; and web monitoring. The application itself stays
containerized (see the app repo's `.zcode/memories/printorian-deployment-shape.md`)
— this repo builds and updates what the containers run *on*.

**Full charter:** `printorian/.zcode/memories/printorian-server-charter.md`
(owner, 2026-11-17). **Close example to study and beat:** `iritur/gnome-git`
(custom pacman repo flow) and `iritur/pkgs` on GitHub. **Mirror:** this repo
mirrors to `gitverse.ru/printorian/server`.

House rules carried over from the app repo: all scripts in Python, TUIs
modern and functional over SSH (Textual-class); every "fastest/most secure"
claim ships with a measurement plan — never invent a number the machine did
not measure; network-facing scripts speak http/https only with host
validation (localhost/loopback/private/reserved refused); database access is
parameter-bound, never string-assembled; backups are drilled or they are not
backups (ADR-0019 culture).

Status: initialized 2026-11-17 — remotes set, nothing pushed.
