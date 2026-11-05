#!/usr/bin/env bash
# Single entry point for the EQEmu performance baseline.
#
#   ./perf/run.sh                  # build, database, boot, measure, profiles, JSON
#   ./perf/run.sh compare A.json B.json
#
# Useful environment variables (defaults are in perf/harness.py):
#   PERF_WINDOW_SEC=30             idle / load sample length
#   PERF_BOOT_TIMEOUT_SEC=420      per zone boot
#   PERF_IDLE_ZONE=qrg             override idle zone shortname (else auto-pick)
#   PERF_BUSY_ZONE=freportw        override busy zone shortname (else auto-pick)
#   PERF_LOAD_MAX_ADDED=800        cap on duplicated spawn2 rows
#   PERF_PROFILE_SEC=20
#   EQEMU_MARCH=x86-64-v3          passed through to perf/build-release.sh
#   EQEMU_LTO=OFF
#   PEQ_ZIP_URL=...                pin a database zip instead of the latest archive
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "${ROOT}/perf/harness.py" "$@"
