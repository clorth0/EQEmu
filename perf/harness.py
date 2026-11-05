#!/usr/bin/env python3
"""EQEmu performance baseline harness.

Brings up a private MariaDB, imports a ProjectEQ database archive, boots world
plus two zones, and writes perf/out/results-latest.json. Does not modify
gameplay code or the imported content except for rows it inserts into a
private spawn2 id range and deletes again (scripted NPC load).
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PERF = ROOT / "perf"
OUT = PERF / "out"
VAR = PERF / "var"
CACHE = PERF / "cache"
CAPTURES = PERF / "captures"
SERVER = VAR / "server"
MYSQL_DIR = VAR / "mysql"
SOCKET_PATH = VAR / "mysql.sock"
MYSQL_PID = VAR / "mysql.pid"
MYSQL_ERR = VAR / "mysql.err"
SLOW_LOG = VAR / "slow.log"
CLIENT_CNF = VAR / "client.cnf"
DB_STAMP = VAR / "db.stamp"
SHM_STAMP = VAR / "shm.stamp"

DB_NAME = "peq"
DB_USER = "eqemu"
DB_PASS = "eqemu"
DB_PORT = int(os.environ.get("PERF_DB_PORT", "3307"))
WORLD_PORT = int(os.environ.get("PERF_WORLD_PORT", "9000"))
WINDOW_SEC = int(os.environ.get("PERF_WINDOW_SEC", "30"))
BOOT_TIMEOUT = int(os.environ.get("PERF_BOOT_TIMEOUT_SEC", "420"))
PROFILE_SEC = int(os.environ.get("PERF_PROFILE_SEC", "20"))
LOAD_MAX_ADDED = int(os.environ.get("PERF_LOAD_MAX_ADDED", "800"))
PEQ_API = "https://db.eqemu.dev/api/v1/artifacts"
PEQ_ZIP_TMPL = "https://db.eqemu.dev/api/v1/dump/archive/{name}"

# Two back-to-back warm runs on the same machine should land inside these
# bounds. Absolute slack covers low-CPU noise; relative covers larger values.
VARIANCE_POLICY = {
    "boot_seconds": {"relative": 0.25, "absolute": 2.0},
    "idle_cpu_percent": {"relative": 0.25, "absolute": 2.0},
    "idle_rss_kb": {"relative": 0.10, "absolute": 32768},
    "query_count": {"relative": 0.20, "absolute": 100},
    "query_total_ms": {"relative": 0.35, "absolute": 1000},
    "load_cpu_percent": {"relative": 0.25, "absolute": 3.0},
}

BUSY_PREFERENCE = [
    "poknowledge",
    "freportw",
    "freporte",
    "qeynos",
    "qeynos2",
    "gfaydark",
    "commons",
    "neriakc",
    "kaladima",
    "felwithea",
    "grobb",
    "oggok",
    "rivervale",
    "erudnext",
    "freeporte",
    "freeportw",
    "northkarana",
    "eastkarana",
    "everfrost",
    "nektulos",
]
IDLE_PREFERENCE = [
    "qrg",
    "tutorialb",
    "tutoriala",
    "misty",
    "tox",
    "innothule",
    "steamfont",
    "blackburrow",
    "erudnint",
    "befallen",
    "unrest",
    "crushbone",
    "runnyeye",
    "gukbottom",
]


def log(msg: str) -> None:
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[perf {now}] {msg}", flush=True)


def run(cmd, **kwargs):
    log("exec: " + " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, check=True, **kwargs)


def which(name: str) -> str | None:
    return shutil.which(name)


class Proc:
    def __init__(self, args: list[str], log_path: Path, cwd: Path, env: dict | None = None):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path = log_path
        self._fh = open(log_path, "w", encoding="utf-8", errors="replace")
        merged = os.environ.copy()
        if env:
            merged.update(env)
        self.p = subprocess.Popen(
            args,
            cwd=str(cwd),
            stdout=self._fh,
            stderr=subprocess.STDOUT,
            env=merged,
            start_new_session=True,
        )
        log(f"started pid {self.p.pid}: {' '.join(args)} -> {log_path}")

    @property
    def pid(self) -> int:
        return self.p.pid

    def alive(self) -> bool:
        return self.p.poll() is None

    def stop(self, timeout: float = 15.0) -> None:
        if self.p.poll() is not None:
            self._fh.close()
            return
        try:
            os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        deadline = time.time() + timeout
        while time.time() < deadline and self.p.poll() is None:
            time.sleep(0.2)
        if self.p.poll() is None:
            try:
                os.killpg(self.p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.p.wait(timeout=5)
        self._fh.close()
        log(f"stopped pid {self.pid}")


def wait_log(path: Path, pattern: str, timeout: float, proc: Proc | None = None) -> float:
    rx = re.compile(pattern)
    fail_rx = re.compile(
        r"Zone Bootup failed|Exiting due to pending database updates|"
        r"Loading spells failed|Cannot continue without a database|"
        r"Failed to load zones|Incompatible quest plugins|"
        r"Loading server configuration failed|World port \[.*\] already in use"
    )
    start = time.time()
    seen = ""
    while time.time() - start < timeout:
        if proc is not None and not proc.alive():
            text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
            tail = "\n".join(text.splitlines()[-40:])
            raise RuntimeError(f"process exited before {pattern!r}\n{tail}")
        if path.exists():
            text = path.read_text(encoding="utf-8", errors="replace")
            if len(text) > len(seen):
                seen = text
            if rx.search(text):
                return time.time() - start
            m = fail_rx.search(text)
            if m:
                tail = "\n".join(text.splitlines()[-40:])
                raise RuntimeError(f"boot failed ({m.group(0)})\n{tail}")
        time.sleep(0.25)
    tail = ""
    if path.exists():
        tail = "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-40:])
    raise TimeoutError(f"timed out after {timeout}s waiting for {pattern!r}\n{tail}")


def read_cpu_ticks(pid: int) -> int | None:
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().split()
    except OSError:
        return None
    # utime (14) stime (15), 1-indexed; after comm which may contain spaces
    # comm is the second field and is parenthesized. Re-parse safely.
    raw = Path(f"/proc/{pid}/stat").read_text()
    try:
        rest = raw.rsplit(")", 1)[1].split()
        utime = int(rest[11])  # field 14 is index 11 after the comm close
        stime = int(rest[12])
        return utime + stime
    except (IndexError, ValueError):
        return None


def read_rss_kb(pid: int) -> int | None:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except OSError:
        return None
    return None


def sample_process(pid: int, seconds: float) -> dict:
    hz = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
    t0 = time.time()
    c0 = read_cpu_ticks(pid)
    rss = []
    deadline = t0 + seconds
    while time.time() < deadline:
        val = read_rss_kb(pid)
        if val is not None:
            rss.append(val)
        time.sleep(1.0)
    t1 = time.time()
    c1 = read_cpu_ticks(pid)
    cpu = None
    if c0 is not None and c1 is not None and t1 > t0:
        cpu = ((c1 - c0) / hz) / (t1 - t0) * 100.0
    return {
        "seconds": round(t1 - t0, 3),
        "cpu_percent": None if cpu is None else round(cpu, 3),
        "rss_kb_avg": None if not rss else int(sum(rss) / len(rss)),
        "rss_kb_min": None if not rss else min(rss),
        "rss_kb_max": None if not rss else max(rss),
        "rss_samples": len(rss),
    }


def mysql_bin() -> str:
    for name in ("mysql", "mariadb"):
        path = which(name)
        if path:
            return path
    raise RuntimeError("mysql client not installed")


def mariadbd_bin() -> str:
    for name in ("mariadbd", "mysqld"):
        path = which(name)
        if path:
            return path
    raise RuntimeError("mariadbd not installed")


def write_client_cnf() -> None:
    CLIENT_CNF.write_text(
        "\n".join(
            [
                "[client]",
                f"user={DB_USER}",
                f"password={DB_PASS}",
                f"socket={SOCKET_PATH}",
                "protocol=socket",
                "",
            ]
        ),
        encoding="utf-8",
    )
    os.chmod(CLIENT_CNF, 0o600)


def sql(query: str, db: str | None = None, user_cnf: Path | None = None) -> str:
    cmd = [mysql_bin(), f"--defaults-extra-file={user_cnf or CLIENT_CNF}", "-N", "-B"]
    if db:
        cmd.append(db)
    cmd.extend(["-e", query])
    proc = subprocess.run(cmd, check=True, text=True, capture_output=True)
    return proc.stdout


def sql_root_socket(query: str) -> str:
    """Connect as the datadir owner over the unix socket before the app user exists."""
    cmd = [
        mysql_bin(),
        f"--socket={SOCKET_PATH}",
        "-uroot",
        "-N",
        "-B",
        "-e",
        query,
    ]
    proc = subprocess.run(cmd, check=True, text=True, capture_output=True)
    return proc.stdout


def mysql_alive() -> bool:
    if not SOCKET_PATH.exists():
        return False
    try:
        sql_root_socket("SELECT 1")
        return True
    except subprocess.CalledProcessError:
        return False
    except Exception:
        return False


def start_mysql() -> Proc | None:
    if mysql_alive():
        log(f"MariaDB already up on {SOCKET_PATH}")
        return None
    if MYSQL_PID.exists():
        try:
            old = int(MYSQL_PID.read_text().strip())
            os.kill(old, 0)
            log(f"stale mysql pid {old} still alive; not starting a second server")
        except (OSError, ValueError):
            pass
    if not (MYSQL_DIR / "mysql").exists():
        if MYSQL_DIR.exists():
            shutil.rmtree(MYSQL_DIR)
        MYSQL_DIR.mkdir(parents=True)
        install = which("mariadb-install-db") or which("mysql_install_db")
        if not install:
            raise RuntimeError("mariadb-install-db not found")
        run(
            [
                install,
                f"--datadir={MYSQL_DIR}",
                "--auth-root-authentication-method=normal",
                "--skip-test-db",
                f"--user={os.environ.get('USER', 'ubuntu')}",
            ]
        )
    pool = os.environ.get("PERF_INNODB_BUFFER_POOL", "1G")
    args = [
        mariadbd_bin(),
        "--no-defaults",
        f"--datadir={MYSQL_DIR}",
        f"--socket={SOCKET_PATH}",
        f"--port={DB_PORT}",
        "--bind-address=127.0.0.1",
        f"--pid-file={MYSQL_PID}",
        f"--log-error={MYSQL_ERR}",
        f"--slow-query-log-file={SLOW_LOG}",
        "--slow-query-log=0",
        "--performance-schema=ON",
        f"--innodb-buffer-pool-size={pool}",
        "--innodb-flush-log-at-trx-commit=2",
        "--skip-name-resolve",
        "--character-set-server=latin1",
        "--collation-server=latin1_swedish_ci",
        "--sql-mode=NO_ENGINE_SUBSTITUTION",
        "--max-connections=100",
    ]
    proc = Proc(args, OUT / "logs" / "mariadbd.log", VAR)
    deadline = time.time() + 60
    while time.time() < deadline:
        if SOCKET_PATH.exists():
            try:
                sql_root_socket("SELECT VERSION()")
                break
            except subprocess.CalledProcessError:
                pass
        if not proc.alive():
            err = MYSQL_ERR.read_text(encoding="utf-8", errors="replace") if MYSQL_ERR.exists() else ""
            raise RuntimeError(f"mariadbd exited\n{err[-2000:]}")
        time.sleep(0.3)
    else:
        raise TimeoutError("mariadbd did not accept connections")
    sql_root_socket(
        "CREATE DATABASE IF NOT EXISTS peq CHARACTER SET latin1 COLLATE latin1_swedish_ci;"
        f"CREATE USER IF NOT EXISTS '{DB_USER}'@'127.0.0.1' IDENTIFIED BY '{DB_PASS}';"
        f"ALTER USER '{DB_USER}'@'127.0.0.1' IDENTIFIED BY '{DB_PASS}';"
        f"GRANT ALL PRIVILEGES ON *.* TO '{DB_USER}'@'127.0.0.1';"
        f"CREATE USER IF NOT EXISTS '{DB_USER}'@'localhost' IDENTIFIED BY '{DB_PASS}';"
        f"ALTER USER '{DB_USER}'@'localhost' IDENTIFIED BY '{DB_PASS}';"
        f"GRANT ALL PRIVILEGES ON *.* TO '{DB_USER}'@'localhost';"
        "FLUSH PRIVILEGES;"
    )
    write_client_cnf()
    # Confirm the app user works (socket + password).
    sql("SELECT 1", DB_NAME)
    log("MariaDB ready")
    return proc


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        log(f"cached {dest}")
        return
    log(f"download {url}")
    tmp = dest.with_suffix(dest.suffix + ".partial")
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dest)


def resolve_peq_zip() -> tuple[Path, str, str]:
    override = os.environ.get("PEQ_ZIP_URL", "").strip()
    if override:
        name = override.rstrip("/").split("/")[-1] or "peq.zip"
        dest = CACHE / name
        download(override, dest)
        return dest, override, sha256_file(dest)
    req = urllib.request.Request(PEQ_API, headers={"User-Agent": "eqemu-perf-baseline"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        artifacts = json.loads(resp.read().decode())
    artifacts.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    art = artifacts[0]
    name = art["filename"]
    url = PEQ_ZIP_TMPL.format(name=name)
    dest = CACHE / name
    download(url, dest)
    return dest, url, sha256_file(dest)


def import_sql_file(path: Path) -> None:
    log(f"import {path.name} ({path.stat().st_size} bytes)")
    cmd = [mysql_bin(), f"--defaults-extra-file={CLIENT_CNF}", DB_NAME]
    with path.open("rb") as fh:
        subprocess.run(cmd, stdin=fh, check=True)


def import_database(zip_path: Path, digest: str) -> None:
    if DB_STAMP.exists() and DB_STAMP.read_text().strip() == digest:
        log("database already imported for this archive")
        return
    log("importing PEQ archive (this replaces the local peq database)")
    sql_root_socket(
        f"DROP DATABASE IF EXISTS {DB_NAME};"
        f"CREATE DATABASE {DB_NAME} CHARACTER SET latin1 COLLATE latin1_swedish_ci;"
    )
    extract = CACHE / "peq-extract"
    if extract.exists():
        shutil.rmtree(extract)
    extract.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract)
    sql_files = sorted(extract.rglob("*.sql"))
    if not sql_files:
        raise RuntimeError(f"no .sql files in {zip_path}")
    # Prefer the harness-oriented create_tables_* layout; otherwise every file.
    create_files = [p for p in sql_files if p.name.startswith("create_tables_")]
    targets = create_files or sql_files
    for path in targets:
        import_sql_file(path)
    DB_STAMP.write_text(digest + "\n", encoding="utf-8")
    if SHM_STAMP.exists():
        SHM_STAMP.unlink()
    log(f"imported {len(targets)} sql files")


def column_names(table: str) -> list[str]:
    out = sql(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
        f"WHERE TABLE_SCHEMA='{DB_NAME}' AND TABLE_NAME='{table}' "
        "ORDER BY ORDINAL_POSITION",
        DB_NAME,
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def table_exists(table: str) -> bool:
    out = sql(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        f"WHERE TABLE_SCHEMA='{DB_NAME}' AND TABLE_NAME='{table}'",
        DB_NAME,
    )
    return out.strip() == "1"


def spawn_counts() -> dict[str, int]:
    if not table_exists("spawn2"):
        return {}
    cols = {c.lower(): c for c in column_names("spawn2")}
    zone_col = cols.get("zone")
    if not zone_col:
        return {}
    out = sql(
        f"SELECT `{zone_col}`, COUNT(*) FROM spawn2 GROUP BY `{zone_col}`",
        DB_NAME,
    )
    counts: dict[str, int] = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        zone, count = line.split("\t")
        counts[zone] = int(count)
    return counts


def pick_zone(counts: dict[str, int], preference: list[str], role: str, exclude: str | None) -> str:
    override = os.environ.get("PERF_IDLE_ZONE" if role == "idle" else "PERF_BUSY_ZONE", "").strip()
    if override:
        if override not in counts:
            raise RuntimeError(f"{role} zone {override} not present in spawn2")
        return override
    for name in preference:
        if name == exclude:
            continue
        n = counts.get(name, 0)
        if role == "idle" and 1 <= n <= 200:
            return name
        if role == "busy" and n >= 40:
            return name
    items = [(z, n) for z, n in counts.items() if z != exclude and n > 0]
    if not items:
        raise RuntimeError("spawn2 has no zones")
    if role == "idle":
        items.sort(key=lambda zn: (abs(zn[1] - 25), zn[1]))
        return items[0][0]
    items.sort(key=lambda zn: zn[1], reverse=True)
    return items[0][0]


def db_version() -> dict:
    if not table_exists("db_version"):
        return {}
    cols = column_names("db_version")
    out = sql(f"SELECT {', '.join('`'+c+'`' for c in cols)} FROM db_version LIMIT 1", DB_NAME)
    values = out.strip().split("\t") if out.strip() else []
    return dict(zip(cols, values))


def server_version() -> str:
    return sql("SELECT VERSION()").strip()


def write_config() -> str:
    quests, plugins, lua_modules, quest_note = resolve_quests()
    cfg = {
        "server": {
            "auto_database_updates": "true",
            "disable_config_checks": "true",
            "world": {
                "shortname": "perf",
                "longname": "EQEmu performance baseline",
                "address": "127.0.0.1",
                "localaddress": "127.0.0.1",
                "maxclients": "50",
                "key": "perfbaseline",
                "locked": "false",
                "loginserver": {
                    "host": "127.0.0.1",
                    "port": "5999",
                    "account": "",
                    "password": "",
                    "legacy": "1",
                },
                "tcp": {"ip": "127.0.0.1", "port": str(WORLD_PORT)},
                "telnet": {"ip": "127.0.0.1", "port": "9001", "enabled": "false"},
                "http": {"enabled": "false", "port": "9080", "mimefile": "mime.types"},
            },
            "ucs": {"host": "127.0.0.1", "port": "7778"},
            "queryserver": {"host": "127.0.0.1", "port": "9500"},
            "database": {
                "host": "127.0.0.1",
                "port": str(DB_PORT),
                "username": DB_USER,
                "password": DB_PASS,
                "db": DB_NAME,
            },
            "qsdatabase": {
                "host": "127.0.0.1",
                "port": str(DB_PORT),
                "username": DB_USER,
                "password": DB_PASS,
                "db": DB_NAME,
            },
            "zones": {"defaultstatus": "0", "ports": {"low": "7000", "high": "7100"}},
            "files": {
                "spells": "spells_us.txt",
                "opcodes": "opcodes.conf",
                "mail_opcodes": "mail_opcodes.conf",
                "plugin.pl": "plugin.pl",
            },
            "directories": {
                "maps": "maps",
                "quests": str(quests),
                "plugins": str(plugins),
                "lua_modules": str(lua_modules),
                "patches": str(ROOT / "utils" / "patches"),
                "opcodes": str(ROOT / "utils" / "patches"),
                "shared_memory": "shared/",
                "logs": "logs",
            },
            "launcher": {
                "logprefix": "logs/zone-",
                "logsuffix": ".log",
                "exe": "./zone",
                "timers": {"restart": "10000", "reterminate": "10000", "initial": "20000", "interval": "2000"},
            },
        }
    }
    SERVER.mkdir(parents=True, exist_ok=True)
    for rel in ("logs", "shared", "maps/base", "maps/water", "maps/nav", "quests"):
        (SERVER / rel).mkdir(parents=True, exist_ok=True)
    (SERVER / "eqemu_config.json").write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return quest_note


def resolve_quests() -> tuple[Path, Path, Path, str]:
    mode = os.environ.get("PERF_QUESTS", "auto")
    dest = CACHE / "projecteqquests"
    if mode != "stub":
        try:
            if not (dest / ".git").exists():
                run(
                    [
                        "git",
                        "clone",
                        "--depth",
                        "1",
                        "https://github.com/ProjectEQ/projecteqquests.git",
                        str(dest),
                    ]
                )
            plugins = dest / "plugins"
            lua_modules = dest / "lua_modules"
            # projecteqquests keeps zone scripts at the repo root, not under quests/.
            quests = dest / "quests" if (dest / "quests").is_dir() else dest
            blob = ""
            if plugins.exists():
                for path in plugins.iterdir():
                    if path.is_file() and b"CheckHandin" in path.read_bytes():
                        blob = "perl"
                        break
            lua_ok = False
            if lua_modules.exists():
                for path in lua_modules.iterdir():
                    if path.is_file() and b"CheckHandin" in path.read_bytes():
                        lua_ok = True
                        break
            if blob and lua_ok and quests.exists():
                return quests, plugins, lua_modules, f"projecteqquests@{dest}"
            log("projecteqquests checkout is missing CheckHandin; using stubs")
        except Exception as exc:
            log(f"quest clone failed ({exc}); using stubs")
    base = PERF / "fixtures"
    return base / "quests", base / "plugins", base / "lua_modules", "stub CheckHandin fixtures"


def try_download_maps(zones: list[str]) -> dict:
    """Fetch per-zone map/nav/water files. Missing files are recorded, not fatal.

    Pathing navmesh is loaded from {server}/maps/nav/{zone}.nav (hardcoded).
    Geometry is {MapDir}/base/{zone}.map.
    """
    base_url = "https://raw.githubusercontent.com/EQEmu/maps/master"
    found = {}
    for zone in zones:
        zone_l = zone.lower()
        specs = [
            (f"{base_url}/base/{zone_l}.map", SERVER / "maps" / "base" / f"{zone_l}.map"),
            (f"{base_url}/water/{zone_l}.wtr", SERVER / "maps" / "water" / f"{zone_l}.wtr"),
            (f"{base_url}/nav/{zone_l}.nav", SERVER / "maps" / "nav" / f"{zone_l}.nav"),
        ]
        found[zone] = {}
        for url, dest in specs:
            if dest.exists() and dest.stat().st_size > 0:
                found[zone][dest.name] = dest.stat().st_size
                continue
            try:
                download(url, dest)
                found[zone][dest.name] = dest.stat().st_size
            except Exception as exc:
                found[zone][dest.name] = f"missing ({exc.__class__.__name__})"
                if dest.exists() and dest.stat().st_size == 0:
                    dest.unlink()
    return found


def bin_dir() -> Path:
    env = os.environ.get("EQEMU_BUILD_DIR")
    if env:
        return Path(env) / "bin"
    return ROOT / "build" / "release" / "bin"


def ensure_build() -> None:
    script = PERF / "build-release.sh"
    run(["bash", str(script)])


def run_database_updates(bindir: Path) -> None:
    log_path = OUT / "logs" / "database-updates.log"
    proc = Proc(
        [str(bindir / "world"), "database:updates", "--skip-backup"],
        log_path,
        SERVER,
        env={"FORCE_INTERACTIVE": "1"},
    )
    deadline = time.time() + 1200
    while time.time() < deadline:
        if not proc.alive():
            code = proc.p.wait()
            text = log_path.read_text(encoding="utf-8", errors="replace")
            if code != 0:
                raise RuntimeError(f"database:updates exited {code}\n" + "\n".join(text.splitlines()[-50:]))
            log("database updates finished")
            return
        time.sleep(0.5)
    proc.stop()
    raise TimeoutError("database:updates timed out")


def run_shared_memory(bindir: Path, digest: str) -> None:
    binary = bindir / "shared_memory"
    stamp = f"{digest} {binary.stat().st_mtime}"
    if SHM_STAMP.exists() and SHM_STAMP.read_text().strip() == stamp and any((SERVER / "shared").iterdir()):
        log("shared memory files already built")
        return
    log_path = OUT / "logs" / "shared-memory.log"
    proc = Proc([str(binary)], log_path, SERVER)
    deadline = time.time() + 1200
    while time.time() < deadline:
        if not proc.alive():
            code = proc.p.wait()
            text = log_path.read_text(encoding="utf-8", errors="replace")
            if code != 0:
                raise RuntimeError(f"shared_memory exited {code}\n" + "\n".join(text.splitlines()[-50:]))
            SHM_STAMP.write_text(stamp + "\n", encoding="utf-8")
            log("shared memory ready")
            return
        time.sleep(0.5)
    proc.stop()
    raise TimeoutError("shared_memory timed out")


def boot_world(bindir: Path) -> Proc:
    # Free a leftover listener from a previous harness run.
    if WORLD_PORT_IN_USE():
        log(f"world port {WORLD_PORT} is in use; attempting to stop the previous world")
        stop_listeners(WORLD_PORT)
        time.sleep(1)
    proc = Proc([str(bindir / "world")], OUT / "logs" / "world.log", SERVER)
    wait_log(proc.log_path, r"listener started", 120, proc)
    return proc


def WORLD_PORT_IN_USE() -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", WORLD_PORT)) == 0


def stop_listeners(port: int) -> None:
    # Best-effort: fuser or ss. Do not kill unrelated processes if the tool is missing.
    if which("fuser"):
        subprocess.run(["fuser", "-k", f"{port}/tcp"], check=False)
        return
    if which("ss"):
        out = subprocess.run(["ss", "-lptn", f"sport = :{port}"], text=True, capture_output=True, check=False)
        for pid in re.findall(r"pid=(\d+)", out.stdout):
            try:
                os.kill(int(pid), signal.SIGTERM)
            except OSError:
                pass


def boot_zone(bindir: Path, zone: str, port: int, tag: str) -> tuple[Proc, float]:
    log_path = OUT / "logs" / f"{tag}-{zone}.log"
    start = time.time()
    proc = Proc(
        [str(bindir / "zone"), f"{zone}:{port}", "perf"],
        log_path,
        SERVER,
    )
    wait_log(proc.log_path, r"Zone bootup type", BOOT_TIMEOUT, proc)
    elapsed = time.time() - start
    log(f"{tag} {zone} boot {elapsed:.2f}s pid {proc.pid}")
    return proc, elapsed


def pfs_available() -> bool:
    try:
        out = sql(
            "SELECT COUNT(*) FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA='performance_schema' AND TABLE_NAME='events_statements_summary_by_digest'"
        )
        return out.strip() == "1"
    except subprocess.CalledProcessError:
        return False


def pfs_reset() -> None:
    try:
        if pfs_available():
            sql(
                "UPDATE performance_schema.setup_consumers SET ENABLED='YES' "
                "WHERE NAME LIKE 'events_statements%';"
                "UPDATE performance_schema.setup_instruments SET ENABLED='YES', TIMED='YES' "
                "WHERE NAME LIKE 'statement/%';"
                "TRUNCATE TABLE performance_schema.events_statements_summary_by_digest;"
            )
    except subprocess.CalledProcessError as exc:
        log(f"performance_schema reset failed: {exc.stderr[-300:] if exc.stderr else exc}")
    try:
        sql("SET GLOBAL slow_query_log=0; SET GLOBAL long_query_time=0; SET GLOBAL min_examined_row_limit=0;")
        SLOW_LOG.write_text("", encoding="utf-8")
        sql("SET GLOBAL slow_query_log=1;")
    except subprocess.CalledProcessError as exc:
        log(f"slow log reset failed: {exc.stderr[-300:] if exc.stderr else exc}")


def parse_slow_log() -> dict:
    if not SLOW_LOG.exists():
        return {"available": False}
    text = SLOW_LOG.read_text(encoding="utf-8", errors="replace")
    aggregates: dict[str, dict] = {}
    current_time = None
    statement: list[str] = []

    def flush() -> None:
        nonlocal current_time, statement
        if current_time is None or not statement:
            current_time = None
            statement = []
            return
        sql_text = " ".join(s.strip() for s in statement if s.strip() and not s.startswith("SET timestamp"))
        sql_text = re.sub(r"\s+", " ", sql_text).strip()
        sql_text = re.sub(r"'[^']*'", "?", sql_text)
        sql_text = re.sub(r"\b\d+\b", "?", sql_text)
        key = sql_text[:400] or "(empty)"
        row = aggregates.setdefault(key, {"digest": key, "count": 0, "total_ms": 0.0})
        row["count"] += 1
        row["total_ms"] += current_time * 1000.0
        current_time = None
        statement = []

    for line in text.splitlines():
        m = re.search(r"Query_time:\s+([0-9.]+)", line)
        if m:
            flush()
            current_time = float(m.group(1))
            statement = []
            continue
        if current_time is None:
            continue
        if line.startswith("#"):
            continue
        statement.append(line)
    flush()
    rows = sorted(aggregates.values(), key=lambda r: r["total_ms"], reverse=True)
    for row in rows:
        row["total_ms"] = round(row["total_ms"], 3)
        row["avg_ms"] = round(row["total_ms"] / row["count"], 3) if row["count"] else 0
    count = sum(r["count"] for r in rows)
    total_ms = round(sum(r["total_ms"] for r in rows), 3)
    return {
        "available": True,
        "source": "slow_query_log long_query_time=0",
        "count": count,
        "total_ms": total_ms,
        "by_time": rows[:20],
        "by_count": sorted(rows, key=lambda r: r["count"], reverse=True)[:20],
    }


def pfs_snapshot(limit: int = 20) -> dict:
    slow = parse_slow_log()
    try:
        sql("SET GLOBAL slow_query_log=0;")
    except subprocess.CalledProcessError:
        pass
    if not pfs_available():
        slow["available"] = slow.get("count") is not None
        return slow
    try:
        return _pfs_snapshot_query(limit, slow)
    except subprocess.CalledProcessError as exc:
        log(f"performance_schema snapshot failed, using slow log: {exc.stderr[-300:] if exc.stderr else exc}")
        return slow


def _pfs_snapshot_query(limit: int, slow: dict) -> dict:
    def rows(order: str) -> list[dict]:
        out = sql(
            "SELECT IFNULL(DIGEST_TEXT,''), COUNT_STAR, "
            "ROUND(SUM_TIMER_WAIT/1000000000,3), ROUND(AVG_TIMER_WAIT/1000000000,3), "
            "SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_NO_INDEX_USED "
            "FROM performance_schema.events_statements_summary_by_digest "
            f"ORDER BY {order} DESC LIMIT {int(limit)}"
        )
        parsed = []
        for line in out.splitlines():
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            parsed.append(
                {
                    "digest": parts[0][:500],
                    "count": int(float(parts[1])),
                    "total_ms": float(parts[2]),
                    "avg_ms": float(parts[3]),
                    "rows_examined": int(float(parts[4])),
                    "rows_sent": int(float(parts[5])),
                    "no_index_used": int(float(parts[6])),
                }
            )
        return parsed
    totals = sql(
        "SELECT IFNULL(SUM(COUNT_STAR),0), IFNULL(ROUND(SUM(SUM_TIMER_WAIT)/1000000000,3),0) "
        "FROM performance_schema.events_statements_summary_by_digest"
    ).strip().split("\t")
    snap = {
        "available": True,
        "source": "performance_schema.events_statements_summary_by_digest",
        "count": int(float(totals[0])) if totals and totals[0] else 0,
        "total_ms": float(totals[1]) if len(totals) > 1 else 0.0,
        "by_time": rows("SUM_TIMER_WAIT"),
        "by_count": rows("COUNT_STAR"),
        "slow_log": slow,
    }
    return snap


def questions_delta(start: int | None = None) -> int:
    out = sql("SHOW GLOBAL STATUS LIKE 'Questions'")
    # Questions\t123
    value = int(out.strip().split("\t")[1])
    if start is None:
        return value
    return value - start


def cleanup_injected_spawns() -> int:
    if not table_exists("spawn2"):
        return 0
    sql(
        "CREATE TABLE IF NOT EXISTS perf_harness_spawn (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
        DB_NAME,
    )
    if not table_exists("perf_harness_spawn"):
        return 0
    out = sql("SELECT COUNT(*) FROM perf_harness_spawn", DB_NAME).strip()
    n = int(out or "0")
    if n:
        sql(
            "DELETE s FROM spawn2 s INNER JOIN perf_harness_spawn p ON s.id = p.id; "
            "DELETE FROM perf_harness_spawn;",
            DB_NAME,
        )
        log(f"removed {n} harness spawn2 rows left from a previous run")
    return n


def duplicate_spawns(zone: str, max_added: int) -> dict:
    cols = column_names("spawn2")
    lower = {c.lower(): c for c in cols}
    zone_col = lower.get("zone")
    id_col = lower.get("id")
    if not zone_col or not id_col:
        return {"feasible": False, "reason": "spawn2 has no id/zone column"}
    if not re.fullmatch(r"[A-Za-z0-9_]+", zone):
        return {"feasible": False, "reason": f"unexpected zone name {zone!r}"}
    before = int(sql(f"SELECT COUNT(*) FROM spawn2 WHERE `{zone_col}`='{zone}'", DB_NAME).strip())
    if before <= 0:
        return {"feasible": False, "reason": "zone has no spawn2 rows", "spawn2_before": before}
    max_id = int(sql(f"SELECT IFNULL(MAX(`{id_col}`),0) FROM spawn2", DB_NAME).strip())
    insert_cols = [c for c in cols if c.lower() != "id"]
    # Skip generated columns if information_schema says so.
    extra = sql(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
        f"WHERE TABLE_SCHEMA='{DB_NAME}' AND TABLE_NAME='spawn2' "
        "AND (EXTRA LIKE '%auto_increment%' OR EXTRA LIKE '%GENERATED%')",
        DB_NAME,
    )
    skip = {line.strip() for line in extra.splitlines()}
    insert_cols = [c for c in insert_cols if c not in skip]
    col_sql = ", ".join(f"`{c}`" for c in insert_cols)
    added_target = min(max_added, before)
    sql(
        f"INSERT INTO spawn2 ({col_sql}) "
        f"SELECT {col_sql} FROM spawn2 WHERE `{zone_col}`='{zone}' AND `{id_col}`<={max_id} "
        f"LIMIT {int(added_target)}",
        DB_NAME,
    )
    sql(
        f"INSERT INTO perf_harness_spawn (id) "
        f"SELECT `{id_col}` FROM spawn2 WHERE `{id_col}`>{max_id}",
        DB_NAME,
    )
    after = int(sql(f"SELECT COUNT(*) FROM spawn2 WHERE `{zone_col}`='{zone}'", DB_NAME).strip())
    added = int(sql("SELECT COUNT(*) FROM perf_harness_spawn", DB_NAME).strip())
    return {
        "feasible": added > 0,
        "method": "duplicate existing spawn2 rows for the busy zone, then delete them",
        "spawn2_before": before,
        "spawn2_after": after,
        "added": added,
        "reason": None if added > 0 else "insert added 0 rows",
    }


def machine_info() -> dict:
    cpuinfo = Path("/proc/cpuinfo").read_text(errors="replace") if Path("/proc/cpuinfo").exists() else ""
    model = ""
    flags = ""
    for line in cpuinfo.splitlines():
        if line.startswith("model name") and not model:
            model = line.split(":", 1)[1].strip()
        if line.startswith("flags") and not flags:
            flags = line.split(":", 1)[1].strip()
    mem_kb = None
    if Path("/proc/meminfo").exists():
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                mem_kb = int(line.split()[1])
    flag_set = set(flags.split())
    return {
        "uname": platform.uname()._asdict(),
        "python": platform.python_version(),
        "cpu_model": model,
        "nproc": os.cpu_count(),
        "mem_total_kb": mem_kb,
        "isa": {
            "sse4_2": "sse4_2" in flag_set,
            "avx2": "avx2" in flag_set,
            "avx512f": "avx512f" in flag_set,
        },
        "perf_event_paranoid": Path("/proc/sys/kernel/perf_event_paranoid").read_text().strip()
        if Path("/proc/sys/kernel/perf_event_paranoid").exists()
        else None,
    }


def git_rev() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except subprocess.CalledProcessError:
        return ""


def load_build_manifest() -> dict:
    path = OUT / "build-manifest.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def read_cmake_cache(build: Path) -> dict:
    cache = build / "CMakeCache.txt"
    want = {
        "CMAKE_BUILD_TYPE",
        "CMAKE_CXX_COMPILER",
        "CMAKE_CXX_FLAGS_RELEASE",
        "CMAKE_INTERPROCEDURAL_OPTIMIZATION",
        "CMAKE_CXX_COMPILER_LAUNCHER",
    }
    found = {}
    if not cache.exists():
        return found
    for line in cache.read_text(errors="replace").splitlines():
        if ":" not in line or line.startswith("//") or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        name = key.split(":")[0]
        if name in want:
            found[name] = value
    return found


def find_perf() -> str | None:
    env = os.environ.get("PERF_BIN")
    candidates = []
    if env:
        candidates.append(env)
    candidates.extend(sorted(glob.glob("/usr/lib/linux-tools/*/perf")))
    wrapped = which("perf")
    if wrapped:
        candidates.append(wrapped)
    for cand in candidates:
        if not cand or not os.path.exists(cand):
            continue
        proc = subprocess.run(
            [cand, "stat", "-e", "cpu-clock", "-x,", "--", "sleep", "0.05"],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0 and "cpu-clock" in (proc.stderr + proc.stdout):
            return cand
    return None


def profile_pid(perf: str, pid: int, dest: Path, seconds: int) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = dest.with_suffix(".data")
    record = [
        perf,
        "record",
        "-e",
        "cpu-clock",
        "-F",
        "99",
        "-g",
        "--call-graph",
        "dwarf,16384",
        "-p",
        str(pid),
        "-o",
        str(data),
        "--",
        "sleep",
        str(seconds),
    ]
    proc = subprocess.run(record, capture_output=True, text=True)
    info = {"data": str(data), "record_rc": proc.returncode, "event": "cpu-clock", "call_graph": "dwarf"}
    if proc.returncode != 0:
        info["record_stderr"] = (proc.stderr or "")[-1000:]
        # Retry with frame pointers. The baseline binary is built with them.
        record[record.index("dwarf,16384")] = "fp"
        proc = subprocess.run(record, capture_output=True, text=True)
        info["call_graph"] = "fp"
        info["record_rc"] = proc.returncode
        info["record_stderr"] = (proc.stderr or "")[-1000:]
        if proc.returncode != 0:
            return info
    report = subprocess.run(
        [perf, "report", "-i", str(data), "--stdio", "--no-children", "-g", "none", "--percent-limit", "0.4"],
        capture_output=True,
        text=True,
    )
    report_path = dest.with_suffix(".report.txt")
    report_path.write_text(report.stdout, encoding="utf-8")
    info["report"] = str(report_path)
    info["top_self"] = parse_perf_report(report.stdout)
    script = subprocess.run([perf, "script", "-i", str(data)], capture_output=True, text=True)
    folded = fold_perf_script(script.stdout)
    folded_path = dest.with_suffix(".folded")
    folded_path.write_text("".join(f"{stack} {count}\n" for stack, count in folded), encoding="utf-8")
    svg_path = dest.with_suffix(".svg")
    write_flame_svg(folded, svg_path, title=dest.name)
    info["folded"] = str(folded_path)
    info["flamegraph"] = str(svg_path)
    return info


def parse_perf_report(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        m = re.match(r"\s*([0-9.]+)%\s+(\S+)\s+(\S+)\s+\[.\]\s+(.+)$", line)
        if not m:
            continue
        rows.append(
            {
                "overhead_percent": float(m.group(1)),
                "command": m.group(2),
                "dso": m.group(3),
                "symbol": m.group(4).strip(),
            }
        )
    return rows[:25]


def fold_perf_script(text: str) -> list[tuple[str, int]]:
    stacks: dict[str, int] = {}
    current: list[str] = []
    in_stack = False

    def flush() -> None:
        nonlocal current, in_stack
        if current:
            # perf script prints leaf first. Flame graphs want root first.
            current.reverse()
            key = ";".join(current)
            stacks[key] = stacks.get(key, 0) + 1
        current = []
        in_stack = False

    for line in text.splitlines():
        if not line:
            flush()
            continue
        if line.startswith("\t") or line.startswith("        "):
            in_stack = True
            sym = line.strip()
            # "addr symbol (dso)" or "symbol+off (dso)"
            sym = re.sub(r"\+0x[0-9a-fA-F]+", "", sym)
            sym = re.sub(r"\s+\([^)]*\)$", "", sym)
            sym = re.sub(r"^[0-9a-fA-F]+\s+", "", sym)
            if sym:
                current.append(sym[:180])
        elif in_stack:
            flush()
    flush()
    return sorted(stacks.items(), key=lambda kv: kv[1], reverse=True)


def write_flame_svg(folded: list[tuple[str, int]], path: Path, title: str) -> None:
    """Small flame graph (root at the bottom). Enough to open in a browser."""
    if not folded:
        path.write_text("<svg xmlns='http://www.w3.org/2000/svg'></svg>\n", encoding="utf-8")
        return
    total = sum(c for _, c in folded)
    width = 1200
    row_h = 16
    # Build prefix counts
    prefix: dict[tuple[str, ...], int] = {}
    for stack, count in folded:
        frames = tuple(stack.split(";")) if stack else tuple()
        for i in range(1, len(frames) + 1):
            key = frames[:i]
            prefix[key] = prefix.get(key, 0) + count
    max_depth = max((len(k) for k in prefix), default=1)
    height = 40 + row_h * (max_depth + 1)
    # x offsets per depth by walking a deterministic order
    lines = [
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}'>",
        "<style>text{font:11px sans-serif} rect:hover{stroke:#000;stroke-width:0.4}</style>",
        f"<text x='8' y='16'>{escape(title)} samples={total}</text>",
    ]
    # Group keys by depth and lay them out left to right in sorted order.
    by_depth: dict[int, list[tuple[str, ...]]] = {}
    for key in prefix:
        by_depth.setdefault(len(key), []).append(key)
    x_of: dict[tuple[str, ...], float] = {tuple(): 0.0}
    for depth in range(1, max_depth + 1):
        keys = sorted(by_depth.get(depth, []), key=lambda k: (x_of.get(k[:-1], 0.0), k[-1]))
        cursor: dict[tuple[str, ...], float] = {}
        for key in keys:
            parent = key[:-1]
            if parent not in cursor:
                cursor[parent] = x_of.get(parent, 0.0)
            w = width * prefix[key] / total
            x = cursor[parent]
            cursor[parent] = x + w
            x_of[key] = x
            y = height - depth * row_h - 4
            color = f"#{(hash(key[-1]) & 0xFFFFFF):06x}"
            lines.append(
                f"<rect x='{x:.2f}' y='{y}' width='{max(w, 0.4):.2f}' height='{row_h - 1}' fill='{color}'>"
                f"<title>{escape(key[-1])} ({prefix[key]} samples, {100.0 * prefix[key] / total:.2f}%)</title></rect>"
            )
            if w > 40:
                lines.append(
                    f"<text x='{x + 2:.2f}' y='{y + 12}'>{escape(key[-1][: max(4, int(w / 7))])}</text>"
                )
    lines.append("</svg>")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def heap_boot_profile(bindir: Path, zone: str, port: int, dest_prefix: Path) -> dict:
    """Record allocations for one zone boot. Attach-mode heaptrack deadlocks this
    guest (gdb inject leaves heaptrack_interpret blocked on a pipe), so the zone
    is started under heaptrack's LD_PRELOAD instead.
    """
    heaptrack = which("heaptrack")
    info: dict = {"tool": None, "mode": "boot-ldpreload"}
    if not heaptrack:
        return {"tool": "unavailable", "note": "heaptrack not installed"}
    log_path = OUT / "logs" / f"heaptrack-{zone}.log"
    proc = Proc(
        [
            heaptrack,
            "--record-only",
            "--output",
            str(dest_prefix),
            str(bindir / "zone"),
            f"{zone}:{port}",
            "perf",
        ],
        log_path,
        SERVER,
    )
    try:
        wait_log(log_path, r"Zone bootup type", min(BOOT_TIMEOUT, 240), proc)
        time.sleep(8)
    except Exception as exc:
        proc.stop()
        return {"tool": "heaptrack", "error": str(exc)[:800], "log": str(log_path)}
    proc.stop()
    candidates = [dest_prefix, Path(str(dest_prefix) + ".gz"), *dest_prefix.parent.glob(dest_prefix.name + "*")]
    data = next((p for p in candidates if p.is_file() and p.stat().st_size > 0 and p.suffix != ".txt"), None)
    printer = which("heaptrack_print")
    if not data or not printer:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-800:] if log_path.exists() else ""
        return {"tool": "heaptrack", "error": "no data file", "log_tail": tail}
    printed = subprocess.run([printer, str(data)], capture_output=True, text=True, timeout=180)
    summary = dest_prefix.with_suffix(".txt")
    summary.write_text(printed.stdout[:200000], encoding="utf-8")
    info.update(
        {
            "tool": "heaptrack",
            "data": str(data),
            "summary": str(summary),
            "top": extract_heaptrack_top(printed.stdout),
            "print_rc": printed.returncode,
        }
    )
    return info


def heap_profile(pid: int, dest_prefix: Path, seconds: int) -> dict:
    heaptrack = which("heaptrack")
    info: dict = {"tool": None}
    if heaptrack:
        out_base = dest_prefix
        proc = subprocess.Popen(
            [heaptrack, "-p", str(pid), "-o", str(out_base)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        time.sleep(seconds)
        try:
            os.killpg(proc.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        try:
            stdout, _ = proc.communicate(timeout=45)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, _ = proc.communicate(timeout=15)
        gz = Path(str(out_base) + ".gz")
        # heaptrack may append .gz itself or write exactly the -o path.
        candidates = [gz, out_base, *out_base.parent.glob(out_base.name + "*.gz")]
        data = next((p for p in candidates if p.is_file() and p.stat().st_size > 0), None)
        printer = which("heaptrack_print")
        text = ""
        if data and printer:
            printed = subprocess.run([printer, str(data)], capture_output=True, text=True, timeout=120)
            text = printed.stdout
            summary = dest_prefix.with_suffix(".txt")
            summary.write_text(text[:200000], encoding="utf-8")
            info.update(
                {
                    "tool": "heaptrack",
                    "data": str(data),
                    "summary": str(summary),
                    "top": extract_heaptrack_top(text),
                    "print_rc": printed.returncode,
                }
            )
            return info
        info.update({"tool": "heaptrack", "error": "no heaptrack output", "stdout": (stdout or "")[:1000]})
        return info
    massif = which("valgrind")
    info["tool"] = "unavailable"
    info["note"] = "heaptrack not installed" if not massif else "heaptrack failed; massif is invoked separately"
    return info


def extract_heaptrack_top(text: str) -> list[str]:
    lines = []
    keep = False
    for line in text.splitlines():
        if "MOST" in line or "peak" in line.lower() and "allocations" in line.lower():
            keep = True
        if keep:
            lines.append(line)
        if len(lines) > 80:
            break
    return lines[:80]


def massif_zone(bindir: Path, zone: str, port: int) -> dict:
    valgrind = which("valgrind")
    if not valgrind:
        return {"tool": "unavailable", "note": "valgrind not installed"}
    out = CAPTURES / f"massif-{zone}.out"
    log_path = OUT / "logs" / f"massif-{zone}.log"
    proc = Proc(
        [
            valgrind,
            "--tool=massif",
            f"--massif-out-file={out}",
            "--time-unit=ms",
            "--max-snapshots=40",
            str(bindir / "zone"),
            f"{zone}:{port}",
            "perf",
        ],
        log_path,
        SERVER,
    )
    try:
        wait_log(proc.log_path, r"Zone bootup type", max(BOOT_TIMEOUT, 900), proc)
        time.sleep(10)
    except Exception as exc:
        proc.stop()
        return {"tool": "massif", "error": str(exc)[:500], "out": str(out)}
    proc.stop()
    ms_print = which("ms_print")
    summary = ""
    if ms_print and out.exists():
        printed = subprocess.run([ms_print, str(out)], capture_output=True, text=True)
        summary_path = CAPTURES / f"massif-{zone}.txt"
        summary_path.write_text(printed.stdout[:200000], encoding="utf-8")
        summary = str(summary_path)
    return {"tool": "massif", "out": str(out), "summary": summary}


def within(policy_name: str, a: float, b: float) -> dict:
    policy = VARIANCE_POLICY[policy_name]
    delta = abs(a - b)
    base = max(abs(a), abs(b), 1e-9)
    limit = max(policy["absolute"], policy["relative"] * base)
    return {
        "a": a,
        "b": b,
        "abs_delta": round(delta, 4),
        "limit": round(limit, 4),
        "ok": delta <= limit,
        "policy": policy,
    }


def compare_results(path_a: Path, path_b: Path) -> int:
    a = json.loads(path_a.read_text(encoding="utf-8"))
    b = json.loads(path_b.read_text(encoding="utf-8"))
    checks = []

    def add(name: str, policy: str, va, vb):
        if va is None or vb is None:
            checks.append({"name": name, "ok": False, "skipped": True, "reason": "missing value"})
            return
        row = within(policy, float(va), float(vb))
        row["name"] = name
        checks.append(row)

    zones_a = {z["role"]: z for z in a.get("zones", [])}
    zones_b = {z["role"]: z for z in b.get("zones", [])}
    for role in sorted(set(zones_a) | set(zones_b)):
        za = zones_a.get(role, {})
        zb = zones_b.get(role, {})
        add(f"{role}.boot_seconds", "boot_seconds", za.get("boot_seconds"), zb.get("boot_seconds"))
        add(f"{role}.idle_cpu_percent", "idle_cpu_percent", za.get("idle_cpu_percent"), zb.get("idle_cpu_percent"))
        add(f"{role}.idle_rss_kb_avg", "idle_rss_kb", za.get("idle_rss_kb_avg"), zb.get("idle_rss_kb_avg"))
        add(
            f"{role}.boot_query_count",
            "query_count",
            (za.get("boot_queries") or {}).get("count"),
            (zb.get("boot_queries") or {}).get("count"),
        )
    add(
        "idle_queries.count",
        "query_count",
        (a.get("idle_queries") or {}).get("count"),
        (b.get("idle_queries") or {}).get("count"),
    )
    add(
        "idle_queries.total_ms",
        "query_total_ms",
        (a.get("idle_queries") or {}).get("total_ms"),
        (b.get("idle_queries") or {}).get("total_ms"),
    )
    add(
        "world.idle_cpu_percent",
        "idle_cpu_percent",
        (a.get("world") or {}).get("idle_cpu_percent"),
        (b.get("world") or {}).get("idle_cpu_percent"),
    )
    add(
        "world.idle_rss_kb_avg",
        "idle_rss_kb",
        (a.get("world") or {}).get("idle_rss_kb_avg"),
        (b.get("world") or {}).get("idle_rss_kb_avg"),
    )
    la = (a.get("load") or {})
    lb = (b.get("load") or {})
    if la.get("feasible") and lb.get("feasible"):
        add("load.cpu_percent", "load_cpu_percent", la.get("cpu_percent"), lb.get("cpu_percent"))
        add("load.rss_kb_avg", "idle_rss_kb", la.get("rss_kb_avg"), lb.get("rss_kb_avg"))
    failed = [c for c in checks if not c.get("ok")]
    report = {"ok": not failed, "checks": checks, "policy": VARIANCE_POLICY}
    out = OUT / "compare.json"
    OUT.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for row in checks:
        mark = "ok" if row.get("ok") else "OUT"
        print(f"{mark:3} {row.get('name')}: {row}")
    print(f"wrote {out}")
    return 0 if not failed else 1


def write_results(payload: dict) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    latest = OUT / "results-latest.json"
    dated = OUT / f"results-{stamp}.json"
    text = json.dumps(payload, indent=2) + "\n"
    latest.write_text(text, encoding="utf-8")
    dated.write_text(text, encoding="utf-8")
    log(f"wrote {latest}")
    log(f"wrote {dated}")
    return latest


def measure(args: argparse.Namespace) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "logs").mkdir(parents=True, exist_ok=True)
    CAPTURES.mkdir(parents=True, exist_ok=True)
    VAR.mkdir(parents=True, exist_ok=True)
    payload: dict = {
        "schema": "eqemu-perf-baseline/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_revision": git_rev(),
        "machine": machine_info(),
        "variance_policy": VARIANCE_POLICY,
        "window_seconds": WINDOW_SEC,
        "notes": [],
    }
    mysql_proc = None
    world = None
    zones: list[Proc] = []
    try:
        if not args.skip_build:
            ensure_build()
        payload["build"] = load_build_manifest()
        build_dir = Path(payload["build"].get("build_dir") or (ROOT / "build" / "release"))
        payload["cmake_cache"] = read_cmake_cache(build_dir)
        bindir = bin_dir()
        for name in ("zone", "world", "shared_memory", "tests"):
            if not (bindir / name).exists():
                raise RuntimeError(f"missing binary {bindir / name}; run ./perf/build-release.sh")

        mysql_proc = start_mysql()
        zip_path, url, digest = resolve_peq_zip()
        import_database(zip_path, digest)
        payload["database"] = {
            "engine": server_version(),
            "source_url": url,
            "filename": zip_path.name,
            "sha256": digest,
            "bytes": zip_path.stat().st_size,
            "port": DB_PORT,
            "datadir": str(MYSQL_DIR),
            "sql_mode": "NO_ENGINE_SUBSTITUTION",
            "character_set_server": "latin1",
            "innodb_buffer_pool": os.environ.get("PERF_INNODB_BUFFER_POOL", "1G"),
            "db_version_before_updates": db_version(),
            "note": (
                "db.projecteq.net no longer resolves. The harness uses the current "
                "ProjectEQ archive published at db.eqemu.dev unless PEQ_ZIP_URL is set. "
                "The sha256 above pins the bytes this run imported."
            ),
        }
        quest_note = write_config()
        removed = cleanup_injected_spawns()
        counts = spawn_counts()
        idle_name = pick_zone(counts, IDLE_PREFERENCE, "idle", None)
        busy_name = pick_zone(counts, BUSY_PREFERENCE, "busy", idle_name)
        payload["content"] = {
            "quests": quest_note,
            "spawn2_zones": len(counts),
            "idle_zone": {"name": idle_name, "spawn2_rows": counts.get(idle_name)},
            "busy_zone": {"name": busy_name, "spawn2_rows": counts.get(busy_name)},
            "maps": try_download_maps([idle_name, busy_name]) if os.environ.get("PERF_MAPS", "auto") != "off" else {},
            "pathing_note": (
                "Navmesh is loaded only from <server>/maps/nav/<zone>.nav. "
                "If that file is missing, zone uses PathfinderNull (no pathing CPU)."
            ),
        }
        if removed:
            payload["notes"].append(f"deleted {removed} leftover harness spawns before measurement")

        run_database_updates(bindir)
        payload["database"]["db_version_after_updates"] = db_version()
        run_shared_memory(bindir, digest)
        world = boot_world(bindir)
        world_boot_log = (OUT / "logs" / "world.log").read_text(encoding="utf-8", errors="replace")
        # boot_world already waited; approximate from log file mtime vs now is poor.
        # Re-read: Proc start isn't stored. Record listener-ready as already done.
        payload["world"] = {"pid": world.pid, "log": str(OUT / "logs" / "world.log")}

        def measured_boot(role: str, name: str, port: int) -> dict:
            cold_proc, cold_s = boot_zone(bindir, name, port, f"{role}-cold")
            cold_proc.stop()
            pfs_reset()
            q0 = questions_delta()
            proc, warm_s = boot_zone(bindir, name, port, f"{role}-warm")
            queries = pfs_snapshot()
            queries["questions_status_delta"] = questions_delta(q0)
            proc.stop()
            return {
                "role": role,
                "name": name,
                "port": port,
                "spawn2_rows": counts.get(name),
                "boot_seconds_cold": round(cold_s, 3),
                "boot_seconds": round(warm_s, 3),
                "boot_queries": queries,
                "boot_definition": "process start until log line 'Zone bootup type', warm boot after one discarded boot",
            }

        idle_row = measured_boot("idle", idle_name, 7001)
        busy_row = measured_boot("busy", busy_name, 7002)

        # Combined idle window with both zones and world up. Boot time is not taken from these.
        pfs_reset()
        q0 = questions_delta()
        idle_proc, _ = boot_zone(bindir, idle_name, 7001, "idle-sample")
        busy_proc, _ = boot_zone(bindir, busy_name, 7002, "busy-sample")
        zones.extend([idle_proc, busy_proc])
        # Let spawn timers settle for a couple of seconds before the window.
        time.sleep(3)
        pfs_reset()
        q0 = questions_delta()
        samples = sample_many(
            {"world": world.pid, "idle": idle_proc.pid, "busy": busy_proc.pid},
            WINDOW_SEC,
        )
        idle_queries = pfs_snapshot()
        idle_queries["questions_status_delta"] = questions_delta(q0)
        idle_row.update(
            {
                "idle_cpu_percent": samples["idle"]["cpu_percent"],
                "idle_rss_kb_avg": samples["idle"]["rss_kb_avg"],
                "idle_rss_kb_max": samples["idle"]["rss_kb_max"],
                "idle_rss_kb_min": samples["idle"]["rss_kb_min"],
            }
        )
        busy_row.update(
            {
                "idle_cpu_percent": samples["busy"]["cpu_percent"],
                "idle_rss_kb_avg": samples["busy"]["rss_kb_avg"],
                "idle_rss_kb_max": samples["busy"]["rss_kb_max"],
                "idle_rss_kb_min": samples["busy"]["rss_kb_min"],
            }
        )
        payload["world"].update(samples["world"])
        payload["world"]["idle_cpu_percent"] = samples["world"]["cpu_percent"]
        payload["world"]["idle_rss_kb_avg"] = samples["world"]["rss_kb_avg"]
        payload["zones"] = [idle_row, busy_row]
        payload["idle_queries"] = idle_queries
        payload["idle_window_seconds"] = WINDOW_SEC
        payload["cpu_percent_definition"] = (
            "100 means one full core (process utime+stime over wall time), not a share of the machine"
        )

        profiles: dict = {"perf": None, "heap": None}
        if not args.skip_profile:
            perf = find_perf()
            profiles["perf_bin"] = perf
            if not perf:
                profiles["perf_error"] = (
                    "perf cpu-clock sampling is unavailable. Hardware cycles are not supported "
                    "in this guest, and no usable perf binary was found."
                )
                payload["notes"].append(profiles["perf_error"])
            else:
                profiles["idle_zone"] = profile_pid(
                    perf, idle_proc.pid, CAPTURES / f"idle-{idle_name}", PROFILE_SEC
                )
                profiles["busy_zone"] = profile_pid(
                    perf, busy_proc.pid, CAPTURES / f"busy-{busy_name}", PROFILE_SEC
                )
                profiles["event"] = "cpu-clock"
                profiles["event_note"] = (
                    "Hardware PMU events such as cycles are not supported in this VM "
                    "(perf stat reports cycles:u as <not supported>, perf_event_paranoid="
                    f"{payload['machine'].get('perf_event_paranoid')}). "
                    "Flame graphs use the software cpu-clock event at 99 Hz."
                )
            profiles["heap"] = heap_boot_profile(
                bindir, busy_name, 7011, CAPTURES / f"heap-boot-{busy_name}"
            )
            if profiles["heap"].get("tool") != "heaptrack":
                # Stop the busy zone first so massif can bind the port.
                busy_proc.stop()
                zones.remove(busy_proc)
                profiles["massif"] = massif_zone(bindir, busy_name, 7002)

        # Scripted NPC load on the busy zone. Numbers are taken with perf detached.
        for proc in list(zones):
            if proc.alive() and proc is busy_proc:
                proc.stop()
                if proc in zones:
                    zones.remove(proc)
        load: dict = {"feasible": False}
        try:
            injected = duplicate_spawns(busy_name, LOAD_MAX_ADDED)
            load.update(injected)
            if injected.get("feasible"):
                pfs_reset()
                q0 = questions_delta()
                load_proc, load_boot = boot_zone(bindir, busy_name, 7002, "load")
                zones.append(load_proc)
                time.sleep(3)
                pfs_reset()
                q0 = questions_delta()
                sampled = sample_process(load_proc.pid, WINDOW_SEC)
                load_queries = pfs_snapshot()
                load_queries["questions_status_delta"] = questions_delta(q0)
                load.update(
                    {
                        "boot_seconds": round(load_boot, 3),
                        "cpu_percent": sampled["cpu_percent"],
                        "rss_kb_avg": sampled["rss_kb_avg"],
                        "rss_kb_max": sampled["rss_kb_max"],
                        "queries": load_queries,
                        "window_seconds": WINDOW_SEC,
                        "clients": 0,
                        "headless_clients": False,
                    }
                )
                if not args.skip_profile and profiles.get("perf_bin"):
                    profiles["load_zone"] = profile_pid(
                        profiles["perf_bin"], load_proc.pid, CAPTURES / f"load-{busy_name}", PROFILE_SEC
                    )
                load_proc.stop()
                zones.remove(load_proc)
            else:
                payload["notes"].append(
                    "Scripted spawn load did not run: " + str(injected.get("reason"))
                )
        finally:
            try:
                cleanup_injected_spawns()
            except Exception as exc:
                payload["notes"].append(f"spawn cleanup failed: {exc}")
        load["not_feasible"] = [
            "No headless EQ client is in this repository. A client has to complete the "
            "opcode identity handshake and zone-in before Client::Process, inventory, or "
            "network compression show up. Spawn duplication is server-side NPC AI load only.",
            "Bots require a logged-in character and would execute combat and spell code. "
            "That is out of scope for a baseline that must not change gameplay, and it is "
            "not scripted here.",
        ]
        payload["load"] = load
        payload["profiles"] = profiles
        payload["ok"] = True
        # Drop the huge world log body if we accidentally stored it.
        payload.pop("world_boot_log", None)
        _ = world_boot_log
        write_results(payload)
        return 0
    except Exception as exc:
        payload["ok"] = False
        payload["error"] = str(exc)
        log(f"FAILED: {exc}")
        try:
            write_results(payload)
        except Exception as write_exc:
            log(f"could not write results: {write_exc}")
        return 1
    finally:
        for proc in zones:
            try:
                proc.stop()
            except Exception:
                pass
        if world is not None:
            try:
                world.stop()
            except Exception:
                pass
        # Leave MariaDB up so a second invocation is warm and comparable.
        _ = mysql_proc


def sample_many(pids: dict[str, int], seconds: float) -> dict[str, dict]:
    hz = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
    start_ticks = {name: read_cpu_ticks(pid) for name, pid in pids.items()}
    rss: dict[str, list[int]] = {name: [] for name in pids}
    t0 = time.time()
    deadline = t0 + seconds
    while time.time() < deadline:
        for name, pid in pids.items():
            val = read_rss_kb(pid)
            if val is not None:
                rss[name].append(val)
        time.sleep(1.0)
    t1 = time.time()
    out = {}
    for name, pid in pids.items():
        c1 = read_cpu_ticks(pid)
        c0 = start_ticks[name]
        cpu = None
        if c0 is not None and c1 is not None and t1 > t0:
            cpu = ((c1 - c0) / hz) / (t1 - t0) * 100.0
        out[name] = {
            "seconds": round(t1 - t0, 3),
            "cpu_percent": None if cpu is None else round(cpu, 3),
            "rss_kb_avg": None if not rss[name] else int(sum(rss[name]) / len(rss[name])),
            "rss_kb_min": None if not rss[name] else min(rss[name]),
            "rss_kb_max": None if not rss[name] else max(rss[name]),
            "rss_samples": len(rss[name]),
            "pid": pid,
        }
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="EQEmu performance baseline")
    sub = parser.add_subparsers(dest="cmd")
    cmp = sub.add_parser("compare", help="check two results JSON files against the variance policy")
    cmp.add_argument("a")
    cmp.add_argument("b")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-profile", action="store_true")
    args = parser.parse_args()
    if args.cmd == "compare":
        return compare_results(Path(args.a), Path(args.b))
    return measure(args)


if __name__ == "__main__":
    sys.exit(main())
