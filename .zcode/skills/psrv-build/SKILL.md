---
name: psrv-build
description: How printorian-server builds real Arch packages — PKGBUILD conventions (upstream-latest, cited pkgver, sha512), clean-chroot builds with devtools, repo-add to the local pacman repo, throwaway-root install verification, signing (owner's key), and the environment facts of the dev VM (what is reachable, what is missing, owner-installs-tools rule). Use before building, packaging, or verifying anything in this repo.
---

# Building real packages in printorian-server

The principle (owner, 2026-11-17): the host layer is built from **real
Arch packages** — not containers, not VM-specific tricks. The application
stays containerized (app repo's ruling); this repo produces what the
containers and the farm console run *on*.

## 1. Layout

```
pkgs/<name>/PKGBUILD      one package per directory
repo/x86_64/              the pacman repo: printorian-server.db.tar.gz + built packages
tools/                    Python tooling (probe, rebuild, mirror, health)
iso/                      generated ISO images
```

## 2. PKGBUILD discipline

- **Upstream latest** (owner rule: "install only latest packages"): `pkgver`
  is the newest upstream release; the commit/PR cites the release note URL.
- `sha512sums` from the artifact you actually downloaded and inspected —
  never copied from a third-party listing.
- Reference shape: read a PKGBUILD from the official Arch repos
  (`/usr/share/` examples aside, `asp`/git.archlinux.org equivalents) before
  inventing structure.
- No vendored blobs that upstream ships separately; no `install=` scripts
  doing things pacman already does.
- Validate locally, always: `cd pkgs/<name> && makepkg --printsrcinfo`
  (exits nonzero on a broken PKGBUILD). `namcap` when installed.

## 3. Clean-chroot build (the real thing)

Builds happen in a clean chroot so build deps never touch this host, and
the package builds the same way twice:

```bash
cd pkgs/<name>
extra-x86_64-build          # devtools; needs sudo — OWNER-INSTALLED devtools
```

`extra-x86_64-build` requires the `devtools` package and passwordless sudo
for the chroot helpers — **the owner installs devtools; agents never
install anything** (AGENTS.md rule 2). If devtools is missing: report
`COULD NOT RUN` with `sudo pacman -S devtools` for the owner; do NOT fall
back to `makepkg -s` on the host (it installs deps onto the host system —
that substitution is banned).

## 4. The pacman repo

```bash
mkdir -p repo/x86_64
repo-add repo/x86_64/printorian-server.db.tar.gz pkgs/<name>/*.pkg.tar.zst
```

`repo-add` is part of pacman (present). The db and everything in
`repo/x86_64/` are **generated** — the hook blocks hand edits. Consumers
add to `/etc/pacman.conf`:

```
[printorian-server]
SigLevel = Required
Server = https://github.com/iritur/printorian-server/raw/main/repo/x86_64
```

(Serving via git raw is the bootstrap; the gnome-git flow
(`iritur/gnome-git`) is the reference to study and beat — GitHub pages/raw
has size limits the charter's repo script must handle deliberately.)

**Signing**: packages and the db are signed with the owner's GPG key.
Agents never generate, import, or expose keys — the pipeline asks (hole)
and the owner signs, or runs the signing step with the key loaded.

## 5. Throwaway-root install verification

An install test that touches nothing on the host:

```bash
VROOT=$(mktemp -d)
sudo pacman --root "$VROOT" --dbpath "$VROOT/var/lib/pacman" -U \
  pkgs/<name>/*.pkg.tar.zst --noconfirm
pacman --root "$VROOT" --dbpath "$VROOT/var/lib/pacman" -Ql <name>
sudo rm -rf "$VROOT"
```

(needs sudo for the root dir — constructing throwaway roots is not
"installing packages on the system"; it is the sanctioned verification
path. The listing proves what the package lays down.)

## 6. Dev-VM environment facts (2026-11-17, fastvm box)

- Python 3.14.10 only; `python3 -m venv` works; no `python3.13` command.
- **Owner installs all system packages** — agents surface the exact
  `pacman -S` line and stop.
- Network: docker.io blob CDNs unreachable from here (both cloudflare and
  cloudfront stall; mirrors redirecting there fail too); **ghcr.io and
  quay.io verified reachable**; archive.archlinux.org lists fine but
  package downloads crawl; regular Arch mirrors (for pacman) are fast.
- Rootless podman exists with fuse-overlayfs (kernel lacks overlay
  module); systemd-nspawn-based chroots (devtools) are the build path.
- Anything measured here is **dev-VM evidence** and is labeled as such;
  scheduler/fs/kernel-performance claims need the real target host.

## 7. Exit-code discipline

`cmd > /tmp/out.log 2>&1; echo "exit=$?"` — never pipe through `tail`; a
pipe once reported a successful install that had failed.
