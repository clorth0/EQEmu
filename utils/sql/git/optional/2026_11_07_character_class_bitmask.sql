-- Optional player multiclassing.
-- Applied automatically as database manifest version 9329 when auto database updates are on.
-- Rollback: set rule MultiClass:Enabled to false (single-class gameplay, column can stay),
-- or drop the column after the bitmask is no longer read:
--   ALTER TABLE `character_data` DROP COLUMN `class_bitmask`;
--   DELETE FROM `rule_values` WHERE `rule_name` IN ('MultiClass:Enabled', 'MultiClass:MaxClasses');

ALTER TABLE `character_data`
	ADD COLUMN `class_bitmask` smallint(5) UNSIGNED NOT NULL DEFAULT 0 AFTER `class`;

INSERT INTO `rule_values` (`ruleset_id`, `rule_name`, `rule_value`, `notes`)
SELECT 1, 'MultiClass:Enabled', 'false', 'Allow a character to be more than one player class at their current level. Default false keeps single-class gameplay.'
FROM DUAL
WHERE NOT EXISTS (
	SELECT 1 FROM `rule_values` WHERE `ruleset_id` = 1 AND `rule_name` = 'MultiClass:Enabled'
);

INSERT INTO `rule_values` (`ruleset_id`, `rule_name`, `rule_value`, `notes`)
SELECT 1, 'MultiClass:MaxClasses', '3', 'Maximum player classes a character may hold, including their primary class.'
FROM DUAL
WHERE NOT EXISTS (
	SELECT 1 FROM `rule_values` WHERE `ruleset_id` = 1 AND `rule_name` = 'MultiClass:MaxClasses'
);
