# Classic content lock (March 1999)

Opt-in baseline for a server that should boot as original-release Norrath: hometown starts, the original boats, level cap 50, and no Plane of Knowledge or later expansion. Customization comes after this, on top of it.

This changes which content is available. It does not change combat math, timers, spawn timing, or loot formulas, and it does not flip classic-feel combat rules.

The script is not part of database migrations, and `perf/run.sh` does not apply it. The performance harness boots `poknowledge` on purpose. C++ defaults in `common/ruletypes.h` are unchanged, because that harness reads those defaults when the database has not overridden them, and a PEQ import already overrides them.

## What it sets

The ruleset named `default` is the one world and zone load on boot. On a current PEQ dump that row is `ruleset_id` 1. Other rulesets are not modified.

| rule_name | rule_value | why |
| --- | --- | --- |
| `Expansion:CurrentExpansion` | `0` | Expansion id for Classic in `common/content/world_content_service.h`. `-1` means every expansion. This is not a bitmask. |
| `World:UseClientBasedExpansionSettings` | `false` | A newer client must not unlock later content over the server setting. |
| `World:ExpansionSettings` | `0` | Client bitmask `maskEverQuest` in `common/emu_versions.h`. `1` is `maskRoK` / `bitRoK` and would enable Kunark, including Iksar. |
| `World:CharacterSelectExpansionSettings` | `0` | Same Classic bitmask, so character create hides Iksar, Vah Shir, Froglok, Drakkin, Beastlord, and Berserker. |
| `World:EnableTutorialButton` | `false` | No tutorial button. |
| `Character:MaxLevel` | `50` | Original level cap. |
| `World:TitaniumStartZoneID` | `-1` | Hometowns come from `start_zones`. `-1` does not force a hub. |
| `World:SoFStartZoneID` | `-1` | Same for Secrets of Faydwer clients. |
| `Bots:BotExpansionSettings` | `0` | Updated only when the row already exists, so bots use the same Classic bitmask. |
| `variables.Expansions` | `0` | Updated only when that `varname` already exists, so it cannot disagree with the bitmask. |

`World:TutorialZoneID` is left alone.

## How content filtering decides

`ContentFilterCriteria::apply()` keeps a row when the current expansion is 0 and all of these hold:

- `min_expansion <= 0` or `min_expansion = -1`
- `max_expansion >= 0` or `max_expansion = -1`
- `content_flags` is null or empty, unless that flag is enabled
- `content_flags_disabled` is null or empty, unless that flag is disabled

`-1` on either expansion column means "no bound". A hub stored as `min_expansion = -1` and `max_expansion = -1` still loads at Classic.

The lock raises `min_expansion` only for these short names, and only when the row would still pass that test. Rows already tagged above Classic are not rewritten, and nothing is deleted.

| short_name | min_expansion | expansion id |
| --- | --- | --- |
| `poknowledge` | 4 | The Planes of Power |
| `nexus` | 3 | The Shadows of Luclin |
| `bazaar` | 3 | The Shadows of Luclin, only if a version is still untagged |
| `tutorialb` | 12 | The Serpent's Spine (Mines of Gloomingdeep) |

Doors whose name starts with `POKTELE` are raised to 4 only when `min_expansion` is still `-1` or `0`.

`ZoneStore::LoadZones` reads every zone row and does not apply this filter. The filter is what doors, objects, and the other content queries use, and it is what `DoesZonePassContentFiltering` uses when routing a versioned zone. The separate `zone.expansion` column is what `Client::Handle_OP_ZoneChange` compares to `CurrentExpansion`. A GM skips that check.

## Apply

Import PEQ first (the same archives `perf/harness.py` reads from `https://db.eqemu.dev/api/v1/artifacts`). Then:

```bash
./content/classic/apply --socket=/path/to/mysql.sock -uroot peq
```

Any extra arguments are passed to the `mysql` client. The last argument is the database name. The client has to be the `mysql` CLI because the script uses `DELIMITER`.

Running it a second time leaves the same rule values. Check:

```sql
SELECT rule_name, rule_value
FROM rule_values
WHERE ruleset_id = (
    SELECT ruleset_id FROM rule_sets WHERE name = 'default' ORDER BY ruleset_id LIMIT 1
  )
  AND rule_name IN (
    'Expansion:CurrentExpansion',
    'World:UseClientBasedExpansionSettings',
    'World:ExpansionSettings',
    'World:CharacterSelectExpansionSettings',
    'World:EnableTutorialButton',
    'Character:MaxLevel',
    'World:TitaniumStartZoneID',
    'World:SoFStartZoneID',
    'Bots:BotExpansionSettings'
  )
ORDER BY rule_name;
```

That result is the table above. `variables` will not contain `Expansions` on a stock PEQ dump; the statement updates it only when the row exists.

Hubs at Classic, using the same predicate as `ContentFilterCriteria`:

```sql
SELECT short_name, version, min_expansion, max_expansion, expansion,
       bypass_expansion_check,
       CASE
         WHEN (min_expansion <= 0 OR min_expansion = -1)
          AND (max_expansion >= 0 OR max_expansion = -1)
          AND (content_flags IS NULL OR content_flags = '')
          AND (content_flags_disabled IS NULL OR content_flags_disabled = '')
         THEN 'would_load'
         ELSE 'filtered'
       END AS at_expansion_0
FROM zone
WHERE short_name IN ('poknowledge', 'nexus', 'bazaar', 'tutorialb')
ORDER BY short_name, version;
```

After the lock, every one of those rows is `filtered`.

## Revert

Copy `rule_values` for the default ruleset before you apply if you want the previous numbers back. This script does not keep a backup table.

Opening every expansion again is `Expansion:CurrentExpansion = -1`. That alone does not restore the client bitmask or the level cap. Put the previous `rule_value` back for each rule this script set. On archive `peq-1794013215` (2026-11-07) the default ruleset had:

| rule_name | value before this lock |
| --- | --- |
| `Expansion:CurrentExpansion` | `9` |
| `World:UseClientBasedExpansionSettings` | `false` |
| `World:ExpansionSettings` | `524287` |
| `World:CharacterSelectExpansionSettings` | `522239` |
| `World:EnableTutorialButton` | `true` |
| `Character:MaxLevel` | `70` |
| `World:TitaniumStartZoneID` | `-1` |
| `World:SoFStartZoneID` | `-1` |
| `Bots:BotExpansionSettings` | `16383` |

There was no `variables.Expansions` row. The C++ default for `Expansion:CurrentExpansion` is `-1` (all); that PEQ dump had already overridden it to `9` (Dragons of Norrath).

Hub floors this script may have raised, and the previous values on that same dump:

```sql
UPDATE zone SET min_expansion = -1 WHERE short_name IN ('poknowledge', 'nexus', 'tutorialb');
```

`bazaar` was already tagged (`version` 0 is Luclin through Omens of War, `min_expansion` 3 / `max_expansion` 8; `version` 1 is Dragons of Norrath, 9 / 99), so the lock does not change it. `POKTELE` doors were already at `min_expansion` 4 or higher, so the door statement changes no rows on that dump.

Restart world and zone after either apply or revert. Rules are read at boot, and a runtime rules reload ignores `World:ExpansionSettings` and `World:UseClientBasedExpansionSettings` (`RuleManager::SetRule` returns without applying those two when `reload` is set).

## GM `#zone`

`#zone` still reaches a filtered zone when the character has the GM flag. `Client::Handle_OP_ZoneChange` skips the `zone.expansion` check for GMs and tells them so. The zone row is not deleted. A player without that flag is held to `zone.expansion <= CurrentExpansion` unless `bypass_expansion_check` is set.

## What a current PEQ dump still leaves open

Checked against `peq-1794013215` after importing `create_tables_*.sql` the way `perf/harness.py` does. About 530 zone rows have `expansion > 0` and `min_expansion <= 0`. They were not rewritten. The zone-in check uses `zone.expansion`, so a non-GM still cannot enter a zone whose `expansion` is above 0. These are the leaks that check does not cover, or that are easy to mistake for Classic:

- `tutorialb` (`zoneidnumber` 189, Mines of Gloomingdeep) had `min_expansion` -1 and `expansion` 0. The lock raises `min_expansion` to 12. The `expansion` column stays 0, so the zone-in check still treats it as Classic. `World:EnableTutorialButton = false` removes the button. `tutoriala` (188) is the same mines and is the same shape (`min_expansion` -1, `expansion` 0) and is not modified.
- `nedaria` (Nedaria's Landing, LDoN) is `expansion` 0 and `min_expansion` -1, so the zone-in check does not treat it as later content.
- `guildlobby` and `guildhall` are `expansion` 9 with `bypass_expansion_check` 1 and `min_expansion` -1, so the zone-in check allows them at any expansion.
- Kunark boat zones `timorous`, `firiona`, and `overthere` are `expansion` 1 and `min_expansion` -1. Non-GMs cannot enter them at Classic because of `expansion`, and their content rows are still untagged. Classic boats `oot`, `erudsxing`, and `butcher` are `expansion` 0 and stay available.

`poknowledge` (`expansion` 4) and `nexus` (`expansion` 3) were untagged on `min_expansion` only. After the lock their zone rows fail the content filter at Classic, and the existing `expansion` values already stop a non-GM from zoning in.
