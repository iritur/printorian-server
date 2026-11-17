#!/usr/bin/env python3
"""psrv_bootstrap.py — bring an Arch host to the printorian-server baseline.

The SAME setup runs on the development VM and on real server hardware
(charter item 1: rebuild on dev, easy update on production). It is
idempotent, stdlib-only, and deliberately free of host-specific tricks:
whatever differs between a VM and real hardware is *measured* by
tools/psrv_probe.py, not branched on here.

Baseline applied:
  * latest `postgresql` and `valkey` from the repos (pacman --needed)
  * a DEDICATED PostgreSQL cluster at /var/lib/postgres/printorian,
    port 5433, loopback only — the system default cluster is untouched
  * systemd unit printorian-postgres.service for that cluster
  * valkey on port 6380 (bind 127.0.0.1, protected mode)
  * role printorian + databases printorian and printorian_test

Usage:
  sudo python3 tools/psrv_bootstrap.py --check    # report only
  sudo python3 tools/psrv_bootstrap.py --apply    # make it so

Exit codes: 0 = baseline holds (or was applied cleanly); 1 = a check or
step failed, with the failing step named on stderr.
"""

from __future__ import annotations

import argparse
import pathlib
import socket
import subprocess
import sys

PGDATA = pathlib.Path("/var/lib/postgres/printorian")
PGPORT = 5433
VALKEY_CONF = pathlib.Path("/etc/valkey/valkey.conf")
UNIT_NAME = "printorian-postgres.service"
UNIT_PATH = pathlib.Path("/etc/systemd/system") / UNIT_NAME
PACKAGES = ("postgresql", "valkey")
ROLE = "printorian"
DATABASES = ("printorian", "printorian_test")

UNIT_BODY = """\
[Unit]
Description=Printorian PostgreSQL (dedicated cluster, port {port})
After=network.target

[Service]
Type=notify
User=postgres
# /run/postgresql exists only after the stock postgresql.service has run once
# on some hosts — this unit must not depend on that.
RuntimeDirectory=postgresql
RuntimeDirectoryOwner=postgres
RuntimeDirectoryGroup=postgres
ExecStart=/usr/bin/postgres -D {pgdata}
ExecReload=/bin/kill -HUP $MAINPID
KillMode=mixed
TimeoutSec=120

[Install]
WantedBy=multi-user.target
""".format(port=PGPORT, pgdata=PGDATA)


def run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)  # type: ignore[arg-type]


def as_postgres(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a command as the postgres user (only meaningful under sudo)."""
    return run(["sudo", "-u", "postgres", *cmd])


def write_root(path: pathlib.Path, body: str, append: bool = False) -> None:
    """Write a root-owned file via `sudo tee` (no shell, no temp files)."""
    proc = subprocess.run(
        ["sudo", "tee", str(path)] + (["-a"] if append else []),
        input=body, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"writing {path} failed: {proc.stderr.strip()}")


# --- checks -----------------------------------------------------------------

def port_answers(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def pkg_installed(name: str) -> bool:
    return run(["pacman", "-Qi", name]).returncode == 0


def unit_active(name: str) -> bool:
    return run(["systemctl", "is-active", "--quiet", name]).returncode == 0


def unit_enabled(name: str) -> bool:
    return run(["systemctl", "is-enabled", "--quiet", name]).returncode == 0


def db_objects_ok() -> bool:
    role = as_postgres(["psql", "-p", str(PGPORT), "-tAc",
                        f"SELECT 1 FROM pg_roles WHERE rolname='{ROLE}'"])
    if role.returncode != 0 or role.stdout.strip() != "1":
        return False
    for db in DATABASES:
        exists = as_postgres(["psql", "-p", str(PGPORT), "-tAc",
                              f"SELECT 1 FROM pg_database WHERE datname='{db}'"])
        if exists.returncode != 0 or exists.stdout.strip() != "1":
            return False
    return True


def check_all() -> list[tuple[str, bool]]:
    return [
        ("packages installed (postgresql, valkey)",
         all(pkg_installed(p) for p in PACKAGES)),
        (f"cluster initialized at {PGDATA}",
         (PGDATA / "PG_VERSION").exists()),
        (f"{UNIT_NAME} enabled", unit_enabled(UNIT_NAME)),
        (f"{UNIT_NAME} active", unit_active(UNIT_NAME)),
        (f"postgres answers on 127.0.0.1:{PGPORT}", port_answers(PGPORT)),
        ("valkey enabled", unit_enabled("valkey.service")),
        ("valkey active", unit_active("valkey.service")),
        (f"valkey answers on 127.0.0.1:6380", port_answers(6380)),
        (f"role {ROLE} and databases exist", db_objects_ok()),
    ]


# --- apply ------------------------------------------------------------------

def apply_packages() -> None:
    proc = run(["pacman", "-S", "--needed", "--noconfirm", *PACKAGES])
    if proc.returncode != 0:
        raise RuntimeError(f"pacman failed: {proc.stderr.strip()[-500:]}")


def ensure_conf_line(key: str, value: str) -> None:
    """Append a setting to the cluster's postgresql.conf if not present."""
    conf = PGDATA / "postgresql.conf"
    current = run(["sudo", "cat", str(conf)]).stdout
    for line in current.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if stripped.startswith(key) and "=" in stripped:
            return  # already set explicitly
    write_root(conf, f"{key} = {value}\n", append=True)
    run(["sudo", "chown", "postgres:postgres", str(conf)])


def wait_port(port: int, timeout: float = 30.0) -> bool:
    import time
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if port_answers(port):
            return True
        time.sleep(0.5)
    return False


def apply_cluster() -> None:
    if (PGDATA / "PG_VERSION").exists():
        print(f"  cluster exists at {PGDATA}; initdb skipped")
    else:
        run(["sudo", "mkdir", "-p", str(PGDATA)])
        run(["sudo", "chown", "postgres:postgres", str(PGDATA)])
        # Local socket: peer auth (administration is `sudo -u postgres psql`).
        # TCP: scram — which requires a superuser password at initdb time, so
        # a random one is generated, used once via pwfile, and discarded:
        # nobody logs in as the superuser over TCP by design.
        import secrets
        pwfile = pathlib.Path("/var/lib/postgres/.psrv-initdb-pw")
        pw_proc = subprocess.run(
            ["sudo", "-u", "postgres", "tee", str(pwfile)],
            input=secrets.token_urlsafe(32) + "\n", capture_output=True, text=True,
        )
        if pw_proc.returncode != 0:
            raise RuntimeError(f"pwfile setup failed: {pw_proc.stderr.strip()}")
        run(["sudo", "-u", "postgres", "chmod", "600", str(pwfile)])
        proc = as_postgres(["initdb", "-D", str(PGDATA),
                            "--auth-local=peer",
                            "--auth-host=scram-sha-256",
                            f"--pwfile={pwfile}",
                            "--encoding=UTF8", "--locale=C.UTF-8"])
        run(["sudo", "-u", "postgres", "rm", "-f", str(pwfile)])
        if proc.returncode != 0:
            raise RuntimeError(f"initdb failed: {proc.stderr.strip()[-500:]}")
    # A dedicated cluster's port, listener and socket should be visible at a
    # glance in its own conf — appended idempotently, never sed-ed inline.
    ensure_conf_line("port", str(PGPORT))
    ensure_conf_line("listen_addresses", "'127.0.0.1'")
    ensure_conf_line("unix_socket_directories", "'/run/postgresql'")


def apply_unit() -> None:
    write_root(UNIT_PATH, UNIT_BODY)
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", UNIT_NAME])


def apply_valkey() -> None:
    changed = False
    if not VALKEY_CONF.exists():
        run(["sudo", "mkdir", "-p", str(VALKEY_CONF.parent)])
        write_root(VALKEY_CONF, "port 6380\nbind 127.0.0.1\nprotected-mode yes\n")
        changed = True
    else:
        conf = run(["sudo", "cat", str(VALKEY_CONF)]).stdout
        out: list[str] = []
        has_active_port = False
        for line in conf.splitlines():
            stripped = line.strip()
            if stripped == "port 6379":  # active directive only — never comments
                out.append("port 6380")
                has_active_port = True
                changed = True
            else:
                if stripped == "port 6380":
                    has_active_port = True
                out.append(line)
        if not has_active_port:
            out.append("port 6380")
            changed = True
        if changed:
            write_root(VALKEY_CONF, "\n".join(out) + "\n")
    run(["systemctl", "enable", "--now", "valkey.service"])
    # A running valkey keeps its startup conf; restart when the file changed
    # or when the port still does not answer.
    if changed or not port_answers(6380):
        run(["systemctl", "restart", "valkey.service"])


def apply_db_objects() -> None:
    if not wait_port(PGPORT):
        raise RuntimeError(
            "postgres did not answer on 5433 within 30 s — "
            "check journalctl -u printorian-postgres"
        )
    role = as_postgres(["psql", "-p", str(PGPORT), "-tAc",
                        f"SELECT 1 FROM pg_roles WHERE rolname='{ROLE}'"])
    if role.stdout.strip() != "1":
        proc = as_postgres(["psql", "-p", str(PGPORT), "-c",
                            f"CREATE ROLE {ROLE} LOGIN PASSWORD '{ROLE}';"])
        if proc.returncode != 0:
            raise RuntimeError(f"role creation failed: {proc.stderr.strip()[-300:]}")
    # The app's test harness creates and drops scratch databases (the
    # docker-compose dev world runs POSTGRES_USER=printorian as the
    # container's superuser). CREATEDB is the minimum that reproduces that
    # on a native cluster without handing out superuser.
    proc = as_postgres(["psql", "-p", str(PGPORT), "-c",
                        f"ALTER ROLE {ROLE} CREATEDB;"])
    if proc.returncode != 0:
        raise RuntimeError(f"ALTER ROLE CREATEDB failed: {proc.stderr.strip()[-300:]}")
    for db in DATABASES:
        exists = as_postgres(["psql", "-p", str(PGPORT), "-tAc",
                              f"SELECT 1 FROM pg_database WHERE datname='{db}'"])
        if exists.stdout.strip() != "1":
            proc = as_postgres(["createdb", "-p", str(PGPORT), "-O", ROLE, db])
            if proc.returncode != 0:
                raise RuntimeError(f"createdb {db} failed: {proc.stderr.strip()[-300:]}")


APPLY_STEPS = (
    ("packages", apply_packages),
    ("postgres cluster", apply_cluster),
    ("systemd unit", apply_unit),
    ("valkey", apply_valkey),
    ("role and databases", apply_db_objects),
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report the baseline, change nothing")
    mode.add_argument("--apply", action="store_true", help="bring the host to the baseline")
    args = parser.parse_args()

    if args.apply and run(["sudo", "-n", "true"]).returncode != 0:
        print("this script needs sudo; run it under sudo or configure NOPASSWD", file=sys.stderr)
        return 1

    if args.apply:
        for name, step in APPLY_STEPS:
            print(f"== apply: {name}")
            try:
                step()
            except RuntimeError as exc:
                print(f"FAILED at {name}: {exc}", file=sys.stderr)
                return 1

    failures = 0
    print("== baseline" + (" after apply:" if args.apply else ":"))
    for label, ok in check_all():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        failures += 0 if ok else 1
    if failures:
        print(f"{failures} check(s) failing", file=sys.stderr)
        return 1
    print("baseline holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
