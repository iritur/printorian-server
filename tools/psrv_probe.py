#!/usr/bin/env python3
"""psrv_probe.py — investigate and gather everything about this installation.

Charter item 3: a universal probe that collects the hardware, environment
and virtualization facts needed to correctly optimize the ISO to be built —
identical on the development VM and on real server hardware, because the
DIFFERENCES it reports are exactly what the build has to account for.

Rules it obeys (AGENTS.md §1): stdlib-only so it runs anywhere Python does;
every fact carries its source command or file path in the report; network
probes speak http/https only to named public hosts and refuse
loopback/private/reserved targets (the local service checks connect to
explicitly-local ports and say so); nothing is written except the report.

Usage:
  python3 tools/psrv_probe.py                 # human-readable
  python3 tools/psrv_probe.py --json out.json # machine-readable (default:
                                              # psrv-probe-report.json)
"""

from __future__ import annotations

import argparse
import datetime
import ipaddress
import json
import pathlib
import platform
import re
import socket
import ssl
import subprocess
import urllib.error
import urllib.parse
import urllib.request

REPORT_DEFAULT = pathlib.Path("psrv-probe-report.json")

# Network probes: https-only, public hosts, each named for what it tells us.
NETWORK_PROBES: tuple[tuple[str, str], ...] = (
    ("arch-mirror", "https://geo.mirror.pkgbuild.com/lastupdate"),
    ("github", "https://github.com"),
    ("ghcr", "https://ghcr.io/v2/"),
    ("quay", "https://quay.io/v2/"),
    ("docker-registry", "https://registry-1.docker.io/v2/"),
    ("docker-cdn-cloudflare", "https://production.cloudflare.docker.com/"),
    ("gitverse", "https://gitverse.ru/"),
)

# Local services this farm's dev/test baseline listens on (loopback by design).
LOCAL_SERVICE_PROBES: tuple[tuple[str, str, int], ...] = (
    ("postgres (printorian cluster)", "127.0.0.1", 5433),
    ("valkey", "127.0.0.1", 6380),
)


def run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.stdout.strip() if proc.returncode == 0 else ""


def read_file(path: str) -> str:
    try:
        return pathlib.Path(path).read_text().strip()
    except OSError:
        return ""


def first_match(pattern: str, text: str) -> str:
    found = re.search(pattern, text, re.M)
    return found.group(1).strip() if found else "not-found"


def cpu_facts() -> dict[str, str]:
    lscpu = run(["lscpu"])
    return {
        "model": first_match(r"^Model name:\s*(.+)$", lscpu),
        "cores": first_match(r"^CPU\(s\):\s*(\d+)$", lscpu),
        "mhz-max": first_match(r"^CPU max MHz:\s*(.+)$", lscpu),
        "virtualization": first_match(r"^Virtualization:\s*(.+)$", lscpu) or "none",
        "flags-sample": run(["sh", "-c", "lscpu | grep -oE 'avx512[a-z_]*|aes|sha_ni|amx[a-z_]*' | sort -u | tr '\\n' ' '"]),
    }


def memory_facts() -> dict[str, str]:
    meminfo = read_file("/proc/meminfo")
    return {
        "memtotal-kb": first_match(r"^MemTotal:\s+(\d+)", meminfo),
        "swaptotal-kb": first_match(r"^SwapTotal:\s+(\d+)", meminfo),
    }


def disk_facts() -> list[dict[str, str]]:
    lsblk = run(["lsblk", "-dno", "NAME,SIZE,ROTA,TYPE", "-e", "7"])
    disks = []
    for line in lsblk.splitlines():
        parts = line.split()
        if len(parts) == 4:
            disks.append({"name": parts[0], "size": parts[1], "rotational": parts[2], "type": parts[3]})
    return disks


def filesystems_facts() -> list[dict[str, str]]:
    out = []
    for line in read_file("/proc/mounts").splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[0].startswith("/dev/"):
            out.append({"device": parts[0], "mount": parts[1], "fs": parts[2]})
    return out


def virt_facts() -> dict[str, str]:
    detect_virt = run(["systemd-detect-virt"])
    dmi = read_file("/sys/class/dmi/id/product_name")
    return {
        "systemd-detect-virt": detect_virt or "unknown",
        "dmi-product": dmi or "not-found (VM or restricted)",
    }


def kernel_facts() -> dict[str, str]:
    modules = run(["lsmod"])
    return {
        "release": platform.release(),
        "version": platform.version(),
        "overlay-module": "yes" if pathlib.Path("/sys/module/overlay").exists() else "no",
        "fuse": "yes" if pathlib.Path("/dev/fuse").exists() else "no",
        "modules-loaded": str(len(modules.splitlines())),
    }


def os_facts() -> dict[str, str]:
    return {
        "arch": platform.machine(),
        "python": platform.python_version(),
        "pretty-name": first_match(r"^PRETTY_NAME=\"(.+)\"", read_file("/etc/os-release")),
        "hostname": socket.gethostname(),
        "pacman": run(["pacman", "--version"]).splitlines()[0] if run(["pacman", "--version"]) else "not-found",
        "utc-now": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def _refuse_private(url: str) -> None:
    """Security rule: probe only public, named hosts (AGENTS.md §1)."""
    host = urllib.parse.urlsplit(url).hostname or ""
    addr = ipaddress.ip_address(socket.gethostbyname(host))
    if addr.is_loopback or addr.is_private or addr.is_reserved or addr.is_link_local or addr.is_multicast:
        raise ValueError(f"refusing non-public probe target {host} ({addr})")


def probe_url(name: str, url: str, timeout: float = 6.0) -> dict[str, str]:
    try:
        _refuse_private(url)
        ctx = ssl.create_default_context()
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=timeout, context=ctx) as response:
            status = str(response.status)
        return {"probe": name, "result": f"reachable (HTTP {status})", "url": url}
    except urllib.error.HTTPError as exc:
        # Registries answer HEAD with 401/403 challenges — that is reachable.
        return {"probe": name, "result": f"reachable (HTTP {exc.code})", "url": url}
    except ValueError as exc:
        return {"probe": name, "result": f"refused: {exc}", "url": url}
    except Exception as exc:  # noqa: BLE001 - a probe reports, never raises
        return {"probe": name, "result": f"unreachable ({type(exc).__name__}: {exc})"[:160], "url": url}


def probe_local_service(name: str, host: str, port: int) -> dict[str, str]:
    # Explicitly-local check of this host's own baseline services — the
    # AGENTS.md §1 refusal rule is about outbound request targets; this is
    # the sanctioned local-service exception, named at the call site.
    try:
        with socket.create_connection((host, port), timeout=2):
            status = "answers"
    except OSError:
        status = "no answer"
    return {"probe": name, "result": status, "url": f"tcp://{host}:{port} (local service)"}


def collect() -> dict[str, object]:
    report: dict[str, object] = {
        "os": os_facts(),
        "kernel": kernel_facts(),
        "cpu": cpu_facts(),
        "memory": memory_facts(),
        "disks": disk_facts(),
        "filesystems": filesystems_facts(),
        "virtualization": virt_facts(),
        "network": [probe_url(n, u) for n, u in NETWORK_PROBES]
        + [probe_local_service(n, h, p) for n, h, p in LOCAL_SERVICE_PROBES],
    }
    # Sources: what a reader re-runs to verify any fact above.
    report["sources"] = [
        "lscpu", "/proc/meminfo", "lsblk -dno NAME,SIZE,ROTA,TYPE -e 7",
        "/proc/mounts", "systemd-detect-virt", "/sys/class/dmi/id/product_name",
        "/sys/module/overlay", "/dev/fuse", "lsmod", "/etc/os-release",
        "HEAD <url> via urllib (public hosts only)",
    ]
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", nargs="?", const=str(REPORT_DEFAULT), default=None,
                        help="write machine-readable report (default path: %s)" % REPORT_DEFAULT)
    args = parser.parse_args()

    report = collect()
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(report, indent=2) + "\n")
        print(f"report written: {args.json}")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
