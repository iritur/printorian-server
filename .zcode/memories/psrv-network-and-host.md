---
name: psrv-network-and-host
description: "Measured dev-host facts (2026-11-17, fastvm Arch VM): Python 3.14.10 only; rootless podman with fuse-overlayfs (kernel lacks overlay module); docker.io blob CDNs unreachable from this network (cloudflare AND cloudfront stall — podman pulls hang at first layer; daocloud mirror redirects to the same CDNs and fails identically); ghcr.io verified end-to-end ~1MB/s via pkg-containers.githubusercontent.com; quay.io reachable; archive.archlinux.org lists fast but package downloads crawl <1B/s; regular Arch mirrors fast; gh CLI authed as dimmus."
metadata:
  node_type: memory
  type: project
---

**Why:** On this network the container route for anything Docker-Hub-based
is dead at the blob-CDN level — a fact that silently costs hours if
rediscovered, and quietly misleads any workflow that assumes `docker pull`
works. The complementary facts (ghcr/quay fine, Arch mirrors fine) are what
make the real-packages path the right default here.

**How to apply:** Treat docker.io as unreachable from this box until
re-measured; source images from ghcr/quay when images are needed at all;
build host-layer things as packages. Re-measure before claiming any of this
changed (commands below), then update this record.

Evidence (all 2026-11-17, commands as run):

- `curl https://registry-1.docker.io/v2/` → 401 (alive); auth token → 200;
  blob GET → 307 → `production.cloudflare.docker.com` → stall, curl exit 56
  after ~20 s. Same via `docker.m.daocloud.io` mirror → 302 →
  `production.cloudfront.docker.com` → same stall. `podman pull` therefore
  hangs at "Copying blob" forever (debug log on file).
- `ghcr.io`: anonymous token → manifest → layer blob 2.8 MB in 2.6 s from
  `pkg-containers.githubusercontent.com`. `quay.io/v2/` → 401 alive.
- `archive.archlinux.org` directory listing 2.4 KB in 3.8 s, but pacman
  package retrieval aborted at <1 B/s; regular mirrors (`pacman -Sy`)
  fast.
- Kernel: no `/sys/module/overlay` → rootless podman needs fuse-overlayfs
  (`~/.config/containers/storage.conf` sets `mount_program`); `/dev/fuse`
  present; podman user socket enabled, `DOCKER_HOST` in `~/.bashrc`.
- Host: Python 3.14.10 (no `python3.13`); node 26.13.1; npm 12.2.2; gh
  authed as `dimmus` (SSH protocol); sudo NOPASSWD (wheel).
- GitHub: `iritur/printorian-server` created by the owner (2026-11-17,
  PRIVATE) and first-pushed the same day; `iritur/gnome-git` and
  `iritur/pkgs` exist (the charter's reference repos). Serving the pacman
  repo from git raw will need the repo PUBLIC (or token-auth Server= URLs)
  — owner's call when the packages are ready for consumers.

Disproven theory: "podman is broken" — podman was fine; the network path
to Docker's CDNs is what fails. Another: "use a docker.io mirror" — every
public mirror tried redirects blobs back to the blocked CDNs or is
auth-walled (docker.1ms.run: auth; docker.xuanyuan.me: rate-limited).

Related: [[psrv-charter]].
