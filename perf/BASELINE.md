# EQEmu performance baseline

Measured on commit `b69fa9cbc` (master at the time of the run). The harness in this change does not alter zone, world, combat, timers, or spawn behavior. Numbers below are from two back-to-back runs of `./perf/run.sh` plus one supplemental AI pass. Raw JSON is written to `perf/out/` (gitignored). Profile text and flame graphs are in `perf/captures/`.

## Reproduce

Host packages used here (Ubuntu 24.04):

```bash
sudo apt-get install -y build-essential ninja-build ccache autoconf automake libtool \
  pkg-config uuid-dev libperl-dev mariadb-server mariadb-client python3 \
  linux-tools-generic heaptrack valgrind
git submodule update --init submodules/vcpkg submodules/websocketpp
./perf/build-release.sh
./perf/run.sh
./perf/run.sh compare perf/out/results-run1.json perf/out/results-run2.json
```

`./perf/run.sh` is the single entry point. It calls `perf/build-release.sh`, starts a private MariaDB on `127.0.0.1:3307`, imports the ProjectEQ archive, runs `world database:updates --skip-backup` and `shared_memory`, boots world plus two zones, writes `perf/out/results-latest.json`, and saves perf and heaptrack captures.

### Build

| Setting | Value |
| --- | --- |
| Compiler | g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, via `CXX=g++` `CC=gcc` |
| Generator | Ninja |
| Type | Release |
| `CMAKE_CXX_FLAGS_RELEASE` | `-O3 -DNDEBUG -march=x86-64-v3 -fno-omit-frame-pointer -g` |
| `-march` | `x86-64-v3` (explicit). The guest also has AVX-512; the binary does not use `-march=native`. |
| LTO | OFF (`CMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF`). `EQEMU_LTO=ON` turns it on. This baseline did not rebuild with LTO, so there is no LTO delta. |
| Frame pointers | On, so `perf` fp/dwarf call chains match this binary. That is part of the measured code. |
| Debug info | `-g` (disk size of `bin/zone` is 572MB). |
| Targets | server, loginserver, Perl, Lua, tests. Client import/export tools are off. |
| Deps | vcpkg manifest `vcpkg.json`, toolchain `submodules/vcpkg`. |

`/usr/bin/c++` on this image is clang++ 18, and that clang cannot link `libstdc++` (it selects GCC 14 headers; `libstdc++-14-dev` is not installed). `g++` links. `perf/build-release.sh` exports `CC`/`CXX` because vcpkg's compiler probe follows the environment. The libsodium port also requires `autoconf`.

### Database

`db.projecteq.net` does not resolve. The harness reads `https://db.eqemu.dev/api/v1/artifacts` and downloads the newest archive unless `PEQ_ZIP_URL` is set.

This run pinned:

- file: `peq-1793404815.zip` (created 2026-10-31, 34,088,823 bytes)
- URL: `https://db.eqemu.dev/api/v1/dump/archive/peq-1793404815.zip`
- sha256: `db0413dfaf5945ca37ab085916d26eb135f3a068fc8ada297a3ac5d215bc11fe`
- uncompressed SQL: about 301MB, of which `create_tables_content.sql` is 295MB
- import into a fresh datadir: about 30 seconds
- `db_version`: 9328 / bots 0 / custom 0, matching `CURRENT_BINARY_DATABASE_VERSION` 9328
- server: MariaDB 10.11.14, `character-set-server=latin1`, `sql-mode=NO_ENGINE_SUBSTITUTION`, `innodb_buffer_pool_size=1G`, `performance_schema=ON`, slow log available with `long_query_time=0`
- bots rule `Bots:Enabled` is false, and there are no `bot*` tables, so bot migrations did not run

Quests: shallow clone of `https://github.com/ProjectEQ/projecteqquests.git` (zone scripts live at the repo root). Maps for the two zones came from `https://github.com/EQEmu/maps` (`base/*.map`, `water/*.wtr`, `nav/*.nav`). Both zones have a navmesh, so pathing is not `PathfinderNull`. `qrg` has 2 `spawn2` rows with `path_when_zone_idle=1`. `poknowledge` has 0.

`loginserver`, `ucs`, and `queryserv` are built and not booted. World login is pointed at `127.0.0.1:5999` with nothing listening.

### What the harness boots

| Role | Zone | `spawn2` rows in the dump | Port |
| --- | --- | --- | --- |
| idle small | `qrg` (Surefall Glade), zone id 3 | 68 | 7001 |
| busy city | `poknowledge` (Plane of Knowledge) | 535 | 7002 |

Both rows in `zone` have `idle_when_empty=1`. `EntityList::MobProcess` (`zone/entity.cpp`) skips `Mob::Process` when `numclients==0` unless the spawn has `path_when_zone_idle` or the settle timer is running. Spawn duplication therefore adds entities without turning on full AI. A separate pass set `idle_when_empty=0` for `poknowledge` only, measured, and restored the column to 1.

Boot time is process start until the log line `Zone bootup type`. Each reported `boot_seconds` is the second boot (the first boot in that run is `boot_seconds_cold` and is discarded from the variance check). The idle window is 30 seconds with world and both zones up. CPU percent is process user+system time over wall time, where 100 means one full core. RSS is `VmRSS`.

The log line `Loaded [N] spawn2 entries` in `ZoneDatabase::PopulateZoneSpawnList` prints the respawn-timer list size (`l.size()` at `zone/spawn2.cpp`), which was 0 in these runs. Spawn groups did load (60 entries in `qrg`, 530 in `poknowledge`). Do not use that log line as a spawn count.

Query totals come from `performance_schema.events_statements_summary_by_digest`. They include a few harness statements (`SET GLOBAL slow_query_log`, and on the idle window the snapshot reads themselves). Game queries are called out separately below.

## Machine

- Linux 6.12.94+ x86_64, 4 vCPU, `Intel(R) Xeon(R) Processor` (the hypervisor label; flags include AVX2 and AVX-512)
- `MemTotal` 16,387,280 kB
- `/proc/sys/kernel/perf_event_paranoid` = 2
- `perf stat -e cycles` reports `cycles:u` as `<not supported>`. Profiles use software `cpu-clock` at 99 Hz, call graph `dwarf,16384` (fp if dwarf fails). The installed `perf` wrapper rejects kernel `6.12.94+`; the harness uses `/usr/lib/linux-tools/*/perf` (here perf 6.8.12).
- Idle zones spend almost all of the window off-CPU, so a 15 second `cpu-clock` capture is a handful of samples. Sample counts are stated with the profiles. They are enough to see the timer and `MobProcess`, and too small to rank callees inside `Mob::Process`.

## Results

### Run A (`results-20261105T043757Z`) and run B (`results-20261105T044352Z`)

| Metric | Run A | Run B | Limit | Result |
| --- | --- | --- | --- | --- |
| `qrg` warm boot | 0.251 s | 0.251 s | max(2.0 s, 25%) | inside |
| `qrg` cold boot | 0.501 s | 0.251 s | not in the policy | |
| `qrg` idle CPU | 0.333% | 0.333% | max(2.0 points, 25%) | inside |
| `qrg` idle RSS avg | 93,895 kB | 93,835 kB | max(32 MB, 10%) | inside |
| `qrg` boot statements | 112 | 112 | max(100, 20%) | inside |
| `qrg` boot SQL time | 84.0 ms | 75.9 ms | | |
| `poknowledge` warm boot | 1.001 s | 1.252 s | max(2.0 s, 25%) | inside (0.251 s) |
| `poknowledge` cold boot | 1.252 s | 1.002 s | not in the policy | |
| `poknowledge` idle CPU | 0.466% | 0.500% | max(2.0 points, 25%) | inside |
| `poknowledge` idle RSS avg | 137,512 kB | 137,572 kB | max(32 MB, 10%) | inside |
| `poknowledge` boot statements | 158 | 158 | max(100, 20%) | inside |
| `poknowledge` boot SQL time | 98.1 ms | 99.3 ms | | |
| world idle CPU | 0.300% | 0.333% | max(2.0 points, 25%) | inside |
| world idle RSS avg | 31,304 kB | 31,292 kB | max(32 MB, 10%) | inside |
| idle-window statements | 9 | 15 | max(100, 20%) | inside |
| idle-window SQL time | 1.55 ms | 2.82 ms | max(1000 ms, 35%) | inside |
| spawn-duplication CPU | 0.500% | 0.500% | max(3.0 points, 25%) | inside |
| spawn-duplication RSS | 142,096 kB | 140,572 kB | max(32 MB, 10%) | inside |
| spawn-duplication boot | 1.252 s | 1.252 s | | |
| rows added then deleted | 535 | 535 | | |

`./perf/run.sh compare` exited 0 on these two files. Policy constants live in `perf/harness.py` (`VARIANCE_POLICY`) and are copied into each JSON.

Shared memory files after `shared_memory`: `items` 184MB, `spells` 45MB. A warm `shared_memory` run finished in about 3 seconds. Zone RSS stays below those file sizes, so idle zones do not fault in every item page.

### Supplemental: `poknowledge` with `idle_when_empty=0`

Single run, not part of the variance pair. Column restored to 1 afterward (`SELECT` confirmed `1`). Boot 1.252 s, 20 s sample, CPU 0.65% of one core, RSS avg 137,185 kB. `perf` top self time (11 samples, so each bar is one sample): `std::_Rb_tree_increment` 18%, then one sample each of `Mob::BuffProcess`, `Mob::HasOwner`, `EntityList::MobProcess`, `QueryServ::CheckForConnectState`, `uv_timer_stop`, `uv__io_poll`, `epoll_pwait`, `__strdup`. Capture: `perf/captures/ai-poknowledge.svg`.

Doubling `spawn2` and turning the empty-zone fast path off both left the process under 1% of one core. There is no measured idle-CPU problem of the "one core per city" kind on this dump with zero clients.

## Profiles

Default captures are 15 s, `cpu-clock`, 99 Hz, while the zones were in the empty-zone fast path.

`qrg` (2 samples): `EntityList::MobProcess` 50%, `dtNavMeshQuery::queryPolygonsInTile` 50%. The navmesh hit matches the 2 `path_when_zone_idle` spawns. Folded stack: `uv_run` -> `uv__run_timers` -> zone timer lambda -> `EntityList::MobProcess`. Files: `perf/captures/idle-qrg.svg`.

`poknowledge` (5 samples): `EntityList::MobProcess` 40%, `__errno_location` 20%, `getenv` 20%, `uv_timer_stop` 20%. The `getenv` frame is under `ZoneEventScheduler::Process` -> `tzset_internal`. Files: `perf/captures/busy-poknowledge.svg`.

Spawn-duplicated `poknowledge` (4 samples): `EntityList::MobProcess` 50%, `epoll_pwait` 25%, `uv_timer_stop` 25%. Files: `perf/captures/load-poknowledge.svg`.

The zone loop timer is `process_timer.Start(32, true)` in `zone/main.cpp`. That 32 ms cadence is why the process wakes at all while idle.

Heaptrack (LD_PRELOAD of a `poknowledge` boot, `perf/captures/heap-boot-poknowledge.txt`; attach-mode heaptrack deadlocks this guest because `heaptrack_interpret` blocks on a pipe):

- Peak heap consumer: `KSM::AllocatePageAligned` 23.43MB over 5 calls, from `Map::LoadV2` -> `createRaycastMesh` (`zone/map.cpp`, `zone/raycast_mesh.cpp`). The on-disk `poknowledge.map` is 940KB.
- `SkillCaps::LoadSkillCaps` (`common/skill_caps.cpp:107`): 58,359 `std::map::operator[]` nodes, 3.27MB peak.
- `Perl_safesysmalloc`: 39,117 calls during `Embperl::DoInit` / `PerlembParser::ReloadQuests` (`zone/embperl.cpp`, `zone/embparser.cpp`). Retained peaks in the top Perl frames are tens of KB; most of these are temporary parser allocations.
- `TaskManager::LoadTasks` (`zone/task_manager.cpp:217`): about 1,060 string assignments, 40KB peak.

## Top queries (`poknowledge` warm boot, run B, by `SUM_TIMER_WAIT`)

| Total | Count | Rows examined | Statement |
| --- | --- | --- | --- |
| 15.1 ms | 1 | 40,722 | `SELECT COUNT(*) FROM spells_new` (`SharedDatabase::GetSpellsCount`, `common/shareddb.cpp`) |
| 12.4 ms | 1 | 58,359 | full `skill_caps` read (`SkillCapsRepository::All`) |
| 11.6 ms | 1 | 35,346 | merchant list for this zone's NPCs (`Zone::LoadMerchants`, `zone/zone.cpp`) |
| 9.9 ms | 1 | 145,149 | `SELECT COUNT(*) FROM items` (`SharedDatabase::GetItemsCount`) |
| 5.2 ms | 3 | 1,241 | full `zone` row read, three times |
| 3.9 ms | 2 | 2,126 | `npc_types` rows for spawns |
| 3.8 ms | 1 | 21,707 | `faction_list_mod` `WHERE faction_id IN (...)`, `no_index_used` |
| 3.0 ms | 20 | 240 | `quest_globals WHERE npcid = ?` (`QGlobalCache::LoadByNPCID`, `zone/qglobals.cpp`) |

Idle window after boot is a handful of statements and under 3 ms. Steady-state query cost with zero clients is negligible next to boot.

## Ranked candidates

Estimates are from these traces only. "Size" is how much server code would have to change later. Nothing here was implemented.

1. **Stop reloading `skill_caps` into a per-zone `std::map`.** Every zone boot reads 58,359 rows (~12 ms, full scan even though `level_skill_cap` exists, because the query has no `WHERE`) and allocates 58,359 map nodes (3.27MB). Items and spells already use shared memory. Putting skill caps in the same files removes the query and the map from every zone process. Impact: about 12 ms and 3.3MB per zone, times the number of zone processes. Risk: skill caps feed combat rolls. A bad cache returns the wrong cap. The load must stay byte-for-byte the same values. Size: medium (shared-memory writer + `SkillCaps::LoadSkillCaps`).

2. **Drop the boot-time `COUNT(*)` on `items` and `spells_new`.** `GetItemsCount` / `GetSpellsCount` scan 145,149 and 40,722 rows (~10 ms and ~16 ms) only to size structures that `shared_memory` already wrote. The counts can live in the mapped file header. Impact: about 25 ms per zone boot. Risk: low if the header is written by the same `shared_memory` run that writes the payload. A mismatch fails the map open, which is already fatal for spells. Size: small.

3. **Rewrite `Zone::LoadMerchants`.** The nested `IN (SELECT ...)` examined 35,346 rows and cost 11.6 ms on `poknowledge`. A join from this zone's `spawn2` to `merchantlist` should touch the merchant rows for NPCs that actually spawn here. Impact: on the order of 10 ms per city boot, more on zones with more merchants. Risk: low for combat math; the result set must stay the same or merchants change. Size: medium (one query, needs a row-for-row check).

4. **`faction_list_mod` lookup.** 3.8 ms, 21,707 rows examined, `no_index_used=1`, even though `faction_id_mod_name` starts with `faction_id`. The `IN (...)` list is large enough that the optimizer scans. Impact: a few milliseconds per boot. Risk: low. Size: small (query shape or a covering lookup), after confirming the plan with `EXPLAIN`.

5. **`quest_globals` by `npcid`.** 20 separate queries on this boot, 3.0 ms total, 240 rows examined. Primary key is `(charid, npcid, zoneid, name)`, so `WHERE npcid = ?` does not use a leading column. The table is tiny on this archive (on the order of a dozen rows), so the cost is the round trips, not the data. Impact today: about 3 ms. Impact grows if the table grows or more NPCs call `LoadByNPCID`. Risk: low. Size: small (one query for the zone, or an index starting with `npcid`). Not loot or combat math.

6. **Raycast mesh for the zone map.** Heaptrack peak is 23.43MB in `KSM::AllocatePageAligned` from `Map::LoadV2` for a 940KB `poknowledge.map`. That is a real piece of the RSS gap versus `qrg` (94MB vs 138MB). Impact: tens of MB per zoned map, paid once at boot. Risk: high if the mesh changes. Line of sight and pathing affect spells and aggro. This baseline only supports "the mesh is the large heap allocation," not a specific compression. Size: large. Leave it until a change can show the same LOS results.

7. **Perl quest startup.** About 39k `Perl_safesysmalloc` calls in `Embperl::DoInit` while reloading quests, before per-NPC scripts. Impact: boot allocations more than idle CPU (idle SQL and CPU stay low after boot). Risk: high to skip or stub Perl. Quest scripts are gameplay. Size: large. Treat as a cost of shipping ProjectEQ quests, not as a switch to flip.

8. **Do not lengthen the 32 ms zone timer to chase idle CPU.** The timer is why `uv_timer_stop` and `epoll_pwait` show up, and why an empty zone still uses about 0.3–0.7% of one core. `idle_when_empty` already skips `Mob::Process` for `poknowledge`. Turning that flag off moved CPU from 0.47% to 0.65%. Doubling spawns left CPU at 0.50% and added about 4MB RSS. A slower timer would touch combat rounds, buff ticks, and spawn timing. Risk: high, and the measured idle CPU does not justify it. Size: tiny, which is why it is tempting. Leave it.

LTO stays off in this baseline. A later run can set `EQEMU_LTO=ON` and compare boot time, idle CPU, and RSS. No LTO number is claimed here.

## Tests

```bash
# GitHub Actions runs this from the build directory with no eqemu_config.json.
# The process exits 0. IPCMutexTest is 0/4 in that case: the lock path is
# {shared_memory}/{name}.lock and the shared-memory directory is empty when
# config load fails. 75 of 79 assertions pass. Total line: 94% correct.
cd build/release && ./bin/tests

# With a config whose shared_memory directory exists (what shared_memory and
# zone require anyway): 79/79, 100% correct, exit 0.
# Ran from /tmp/eqemu-tests with directories.shared_memory=shared.
/workspace/build/release/bin/tests
```

Result of the configured run: `Total: 79 tests, 100% correct`, exit 0.

## Load generation

What works now:

- Real PEQ `spawn2` for a small zone and a city, with ProjectEQ quests and the zone navmesh.
- Duplicating `spawn2` rows (535 extra on `poknowledge`), measuring, then deleting them via `perf_harness_spawn`. Under `idle_when_empty=1` this does not run `Mob::Process`.
- One-shot `idle_when_empty=0` on `poknowledge` (restored after). CPU stayed at 0.65%.

What is not feasible in this tree:

- A headless game client. Nothing here completes the EQStream identify handshake or sends a zone-in. `Client::Process`, inventory, and zone compression do not run. That needs a small client (or a recorded packet replay) that can enter `poknowledge` and stand there. Combat, spell casting, and loot need that client, or a bot owned by a real character. Bots are disabled in this database and would execute combat code, so they were not scripted.
- Aggro load without a target. Empty-zone AI that is not in combat stays under 1% of a core even with `Mob::Process` enabled. A useful combat profile needs a client or an in-zone attacker. Do that in a later change, and keep it out of combat-math edits until the profile says which function is hot.

## Blockers

- vcpkg will not configure if `c++` is the broken clang++ on this image, or if `autoconf` is missing (libsodium). The build script exports `gcc`/`g++` and tells you to install `autoconf`. After that, port builds were short and the C++ compile at `-j2` was about 20 minutes.
- The PEQ archive is 34MB compressed and imported in about 30 seconds. Database size was not a blocker. `db.projecteq.net` is gone; `db.eqemu.dev` is the working source.
- Hardware `cycles` events do not work in this guest. Flame graphs are `cpu-clock` and are sparse on idle zones. A busier capture needs clients, not a longer idle sleep: more idle time mostly records the same timer wakeup.
