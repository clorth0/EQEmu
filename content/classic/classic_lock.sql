-- Classic content lock (original EverQuest, March 1999).
--
-- Opt-in. Nothing in this tree applies this file. Do not call it from
-- perf/run.sh: that harness measures poknowledge and must keep loading it.
--
-- The lock updates the ruleset named `default` (ruleset_id 1 on a current
-- PEQ dump). World and zone boot that ruleset by name. Other rulesets are
-- left alone. It does not delete zone rows and it does not change C++
-- defaults in common/ruletypes.h.
--
-- Two different numbers are both zero, for different reasons:
--   Expansion:CurrentExpansion is the expansion id in
--   common/content/world_content_service.h. Classic is 0. -1 means every
--   expansion. This is not a bitmask.
--   World:ExpansionSettings and World:CharacterSelectExpansionSettings are
--   the client bitmask in common/emu_versions.h. maskEverQuest is 0.
--   maskRoK / bitRoK is 1 and would enable Kunark, including Iksar.
--
-- Supplemental hub tags use the same expansion ids. Only rows that would
-- still pass ContentFilterCriteria at Classic are raised, and only for
-- these short names:
--   nexus, bazaar                  The Shadows of Luclin      3
--   poknowledge                    The Planes of Power        4
--   nedaria                        Lost Dungeons of Norrath   6
--   guildlobby, guildhall          Dragons of Norrath         9
--   tutoriala, tutorialb           The Serpent's Spine       12
-- A row whose min_expansion is already above Classic is not rewritten.
-- About 530 later zones whose expansion column is already above 0 are
-- left alone: Handle_OP_ZoneChange already refuses non-GMs those.
--
-- tutoriala and tutorialb also have expansion set to 12 when it is still
-- 0, because that column is what the zone-in check compares. nedaria's
-- expansion is set to 6 when it is still 0 for the same reason.
-- guildlobby and guildhall keep their existing expansion (9 on current
-- PEQ) but lose bypass_expansion_check, which otherwise lets any expansion
-- in. POKTELE doors are raised to Planes of Power (4) only when still
-- untagged (min_expansion <= 0). Doors PEQ already tagged are left as they are.
--
-- Re-running this script leaves the same rule values and the same hub
-- floors. The procedure below is created, called, and dropped.

DROP PROCEDURE IF EXISTS eqemu_classic_lock_apply;

DELIMITER $$

CREATE PROCEDURE eqemu_classic_lock_apply()
BEGIN
  DECLARE rid INT DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SELECT ruleset_id INTO rid
  FROM rule_sets
  WHERE name = 'default'
  ORDER BY ruleset_id
  LIMIT 1;

  IF rid IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'classic lock: rule_sets has no row named default';
  END IF;

  START TRANSACTION;

  INSERT INTO rule_values (ruleset_id, rule_name, rule_value, notes) VALUES
    (rid, 'Expansion:CurrentExpansion', '0',
      'Classic content lock. Expansion id 0 is the March 1999 release. -1 means every expansion.'),
    (rid, 'World:UseClientBasedExpansionSettings', 'false',
      'Classic content lock. A newer client must not raise the server expansion.'),
    (rid, 'World:ExpansionSettings', '0',
      'Classic content lock. Client bitmask 0 is maskEverQuest. 1 is Kunark.'),
    (rid, 'World:CharacterSelectExpansionSettings', '0',
      'Classic content lock. Same bitmask, so character create stays classic.'),
    (rid, 'World:EnableTutorialButton', 'false',
      'Classic content lock. Hide the tutorial button.'),
    (rid, 'Character:MaxLevel', '50',
      'Classic content lock. Original level cap.'),
    (rid, 'World:TitaniumStartZoneID', '-1',
      'Classic content lock. Hometowns come from start_zones. -1 does not force a hub.'),
    (rid, 'World:SoFStartZoneID', '-1',
      'Classic content lock. Hometowns come from start_zones. -1 does not force a hub.')
  ON DUPLICATE KEY UPDATE rule_value = VALUES(rule_value);

  -- Present on current PEQ. Skip the insert when a dump has no bots rule.
  UPDATE rule_values
  SET rule_value = '0'
  WHERE ruleset_id = rid
    AND rule_name = 'Bots:BotExpansionSettings';

  -- Not present on current PEQ. Keep it from disagreeing with the bitmask
  -- when a database does have the row. Skip the write when it is already 0
  -- so a second apply does not touch the row.
  UPDATE variables
  SET value = '0'
  WHERE varname = 'Expansions'
    AND value <> '0';

  UPDATE zone
  SET min_expansion = 4
  WHERE short_name = 'poknowledge'
    AND min_expansion <= 0
    AND (max_expansion = -1 OR max_expansion >= 4);

  UPDATE zone
  SET min_expansion = 3
  WHERE short_name = 'nexus'
    AND min_expansion <= 0
    AND (max_expansion = -1 OR max_expansion >= 3);

  UPDATE zone
  SET min_expansion = 3
  WHERE short_name = 'bazaar'
    AND min_expansion <= 0
    AND (max_expansion = -1 OR max_expansion >= 3);

  UPDATE zone
  SET min_expansion = 12
  WHERE short_name IN ('tutoriala', 'tutorialb')
    AND min_expansion <= 0
    AND (max_expansion = -1 OR max_expansion >= 12);

  -- Zone-in uses zone.expansion, not min_expansion. PEQ leaves both
  -- Gloomingdeep mines at expansion 0, so a non-GM would still enter.
  UPDATE zone
  SET expansion = 12
  WHERE short_name IN ('tutoriala', 'tutorialb')
    AND expansion = 0;

  UPDATE zone
  SET min_expansion = 6
  WHERE short_name = 'nedaria'
    AND min_expansion <= 0
    AND (max_expansion = -1 OR max_expansion >= 6);

  UPDATE zone
  SET expansion = 6
  WHERE short_name = 'nedaria'
    AND expansion = 0;

  -- Raise the floor to the row's own expansion id (Dragons of Norrath, 9,
  -- on current PEQ) and clear the bypass that skips the zone-in check.
  UPDATE zone
  SET bypass_expansion_check = 0,
      min_expansion = expansion
  WHERE short_name IN ('guildlobby', 'guildhall')
    AND expansion > 0
    AND (bypass_expansion_check <> 0 OR min_expansion < expansion)
    AND (max_expansion = -1 OR max_expansion >= expansion);

  UPDATE doors
  SET min_expansion = 4
  WHERE name LIKE 'POKTELE%'
    AND min_expansion <= 0
    AND (max_expansion = -1 OR max_expansion >= 4);

  COMMIT;

  SELECT rv.rule_name, rv.rule_value
  FROM rule_values rv
  WHERE rv.ruleset_id = rid
    AND rv.rule_name IN (
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
  ORDER BY rv.rule_name;
END$$

DELIMITER ;

CALL eqemu_classic_lock_apply();

DROP PROCEDURE IF EXISTS eqemu_classic_lock_apply;
