#!/usr/bin/env bash
# Release build used by the performance baseline.
#
# Documented toolchain (override with env vars; the manifest records the values used):
#   Compiler:  g++ / gcc (CXX / CC). This VM's baseline uses the system g++.
#   Generator: Ninja
#   Type:      Release
#   -march:    x86-64-v3 (EQEMU_MARCH). Not -march=native, so the binary does not
#              silently follow the build host's exact CPU.
#   Opt:       -O3 -DNDEBUG
#   Symbols:   -g plus -fno-omit-frame-pointer so perf fp call graphs match this binary.
#              -g does not change codegen. Frame pointers do, by a small amount, and
#              that cost is part of the published baseline.
#   LTO:       OFF (EQEMU_LTO=ON to turn CMAKE_INTERPROCEDURAL_OPTIMIZATION on).
#              Baseline numbers are LTO-off so hot functions stay attributable.
#   Tests:     EQEMU_BUILD_TESTS=ON (same tree as the server binaries).
#   Deps:      vcpkg submodule toolchain (submodules/vcpkg), manifest vcpkg.json.
#
# Usage (from anywhere):
#   ./perf/build-release.sh
#   EQEMU_LTO=ON EQEMU_MARCH=x86-64-v3 ./perf/build-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Export CC/CXX. vcpkg's compiler probe uses the environment, and on this
# image /usr/bin/c++ is clang without a linkable libstdc++. g++ is the baseline.
export CC="${CC:-gcc}"
export CXX="${CXX:-g++}"
MARCH="${EQEMU_MARCH:-x86-64-v3}"
LTO="${EQEMU_LTO:-OFF}"
BUILD_DIR="${EQEMU_BUILD_DIR:-${ROOT}/build/release}"
JOBS="${CMAKE_BUILD_PARALLEL_LEVEL:-3}"
TOOLCHAIN="${ROOT}/submodules/vcpkg/scripts/buildsystems/vcpkg.cmake"

missing=()
for tool in "$CXX" "$CC" cmake ninja autoconf perl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done
if ((${#missing[@]})); then
  echo "Missing build tools: ${missing[*]}" >&2
  echo "Ubuntu example: sudo apt-get install -y build-essential ninja-build ccache autoconf automake libtool pkg-config uuid-dev libperl-dev" >&2
  exit 1
fi

if [[ ! -f "$TOOLCHAIN" ]]; then
  echo "vcpkg toolchain missing at $TOOLCHAIN" >&2
  echo "Run: git submodule update --init submodules/vcpkg submodules/websocketpp" >&2
  exit 1
fi

if [[ ! -f "${ROOT}/submodules/websocketpp/websocketpp/server.hpp" ]]; then
  echo "websocketpp submodule is not checked out" >&2
  echo "Run: git submodule update --init submodules/websocketpp" >&2
  exit 1
fi

export VCPKG_MAX_CONCURRENCY="${VCPKG_MAX_CONCURRENCY:-2}"
export VCPKG_DISABLE_METRICS=1
export CMAKE_BUILD_PARALLEL_LEVEL="$JOBS"

REL_FLAGS="-O3 -DNDEBUG -march=${MARCH} -fno-omit-frame-pointer -g"

echo "Configuring Release"
echo "  compiler: ${CXX}"
echo "  flags:    ${REL_FLAGS}"
echo "  lto:      ${LTO}"
echo "  jobs:     ${JOBS} (vcpkg concurrency ${VCPKG_MAX_CONCURRENCY})"
echo "  build:    ${BUILD_DIR}"

cmake -S "$ROOT" -B "$BUILD_DIR" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$CC" \
  -DCMAKE_CXX_COMPILER="$CXX" \
  -DCMAKE_C_COMPILER_LAUNCHER=ccache \
  -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
  -DCMAKE_C_FLAGS_RELEASE="${REL_FLAGS}" \
  -DCMAKE_CXX_FLAGS_RELEASE="${REL_FLAGS}" \
  -DCMAKE_INTERPROCEDURAL_OPTIMIZATION="${LTO}" \
  -DEQEMU_BUILD_TESTS=ON \
  -DEQEMU_BUILD_LOGIN=ON \
  -DEQEMU_BUILD_LUA=ON \
  -DEQEMU_BUILD_PERL=ON \
  -DEQEMU_BUILD_CLIENT_FILES=OFF

cmake --build "$BUILD_DIR" --parallel "$JOBS"

mkdir -p "${ROOT}/perf/out"
MANIFEST="${ROOT}/perf/out/build-manifest.json"
"$CXX" --version > "${ROOT}/perf/out/compiler-version.txt"
python3 - "$MANIFEST" "$ROOT" "$BUILD_DIR" "$CC" "$CXX" "$MARCH" "$LTO" "$REL_FLAGS" "$JOBS" <<'PY'
import json, os, subprocess, sys
manifest, root, build, cc, cxx, march, lto, flags, jobs = sys.argv[1:]
def ver(cmd):
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
        return out.strip().splitlines()[0]
    except Exception as exc:
        return str(exc)
cmake_ver = ver(["cmake", "--version"])
data = {
    "cmake_build_type": "Release",
    "generator": "Ninja",
    "c_compiler": cc,
    "cxx_compiler": cxx,
    "c_compiler_version": ver([cc, "--version"]),
    "cxx_compiler_version": ver([cxx, "--version"]),
    "cmake_version": cmake_ver,
    "cxx_flags_release": flags,
    "march": march,
    "lto": lto,
    "frame_pointers": True,
    "debug_info": True,
    "jobs": int(jobs),
    "vcpkg_max_concurrency": int(os.environ.get("VCPKG_MAX_CONCURRENCY", "2")),
    "vcpkg_toolchain": "submodules/vcpkg/scripts/buildsystems/vcpkg.cmake",
    "options": {
        "EQEMU_BUILD_TESTS": "ON",
        "EQEMU_BUILD_LOGIN": "ON",
        "EQEMU_BUILD_LUA": "ON",
        "EQEMU_BUILD_PERL": "ON",
        "EQEMU_BUILD_CLIENT_FILES": "OFF",
    },
    "build_dir": build,
    "bin_dir": os.path.join(build, "bin"),
}
with open(manifest, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
print(f"Wrote {manifest}")
PY

test -x "${BUILD_DIR}/bin/zone"
test -x "${BUILD_DIR}/bin/world"
test -x "${BUILD_DIR}/bin/shared_memory"
test -x "${BUILD_DIR}/bin/tests"
echo "Release build ok: ${BUILD_DIR}/bin"
