/*	EQEmu: EQEmulator

	Copyright (C) 2001-2026 EQEmu Development Team

	This program is free software; you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation; either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
#pragma once

#include "common/item_data.h"
#include "common/multiclass.h"
#include "common/races.h"
#include "cppunit/cpptest.h"

#include <fstream>
#include <sstream>
#include <string>

class MultiClassTest : public Test::Suite {
public:
	MultiClassTest()
	{
		TEST_ADD(MultiClassTest::SingleClassMatchesPrimaryClass);
		TEST_ADD(MultiClassTest::WarriorClericItemsManaAndSpells);
		TEST_ADD(MultiClassTest::SkillCapsAreCachedMax);
		TEST_ADD(MultiClassTest::CombatHelpersReadSkills);
		TEST_ADD(MultiClassTest::CommandAddListRemove);
		TEST_ADD(MultiClassTest::ZeroMaskIsPrimaryClass);
	}

private:
	static uint16 Bit(uint8 class_id)
	{
		return GetPlayerClassBit(class_id);
	}

	void SingleClassMatchesPrimaryClass()
	{
		const uint8 level = 60;
		const uint16 warrior = Bit(Class::Warrior);
		TEST_ASSERT_EQUALS(MultiClass::ClassCount(warrior), 1);
		TEST_ASSERT_EQUALS(
			MultiClass::BestClassLevelFactor(warrior, level),
			MultiClass::ClassLevelFactor(Class::Warrior, level)
		);
		TEST_ASSERT(!MultiClass::MaskUsesMana(warrior));
		TEST_ASSERT_EQUALS(MultiClass::ClassicBaseMana(0, level), MultiClass::ClassicBaseMana(0, level));

		uint8 levels[Class::PLAYER_CLASS_COUNT];
		for (uint8& entry : levels) {
			entry = 255;
		}
		levels[Class::Warrior - 1] = 255;
		levels[Class::Cleric - 1] = 14;
		const auto warrior_spell = MultiClass::SpellLevelForMask(levels, warrior);
		TEST_ASSERT_EQUALS(warrior_spell.class_id, 0);
		TEST_ASSERT_EQUALS(warrior_spell.level, static_cast<uint8>(255));
		TEST_ASSERT(!MultiClass::CanUseSpell(levels, warrior, 60));

		EQ::ItemData item{};
		item.Classes = Bit(Class::Warrior);
		item.Races = RaceBitmask::Human;
		TEST_ASSERT(item.IsClassEquipable(Class::Warrior));
		TEST_ASSERT(item.IsClassEquipableByBitmask(warrior));
		TEST_ASSERT(item.IsEquipable(Race::Human, Class::Warrior));
		TEST_ASSERT(item.IsEquipableByClassBitmask(Race::Human, warrior));
		TEST_ASSERT(!item.IsClassEquipable(Class::Cleric));
		TEST_ASSERT(!item.IsClassEquipableByBitmask(Bit(Class::Cleric)));

		int lookups = 0;
		auto caps = MultiClass::BuildSkillCapCache(warrior, level, 65, [&](uint8 class_id, EQ::skills::SkillType skill, uint8) {
			++lookups;
			if (class_id == Class::Warrior && skill == EQ::skills::SkillDualWield) {
				return static_cast<uint16>(200);
			}
			return static_cast<uint16>(0);
		});
		const int lookups_after_build = lookups;
		TEST_ASSERT_EQUALS(caps.cap[EQ::skills::SkillDualWield], static_cast<uint16>(200));
		TEST_ASSERT(caps.can_have[EQ::skills::SkillDualWield]);
		const bool attack_can_dual_wield = caps.can_have[EQ::skills::SkillDualWield] != 0;
		TEST_ASSERT(attack_can_dual_wield);
		TEST_ASSERT_EQUALS(lookups, lookups_after_build);
	}

	void WarriorClericItemsManaAndSpells()
	{
		const uint16 mask = static_cast<uint16>(Bit(Class::Warrior) | Bit(Class::Cleric));
		EQ::ItemData either{};
		either.Classes = mask;
		either.Races = RaceBitmask::Human;
		TEST_ASSERT(either.IsClassEquipableByBitmask(Bit(Class::Warrior)));
		TEST_ASSERT(either.IsClassEquipableByBitmask(Bit(Class::Cleric)));
		TEST_ASSERT(either.IsClassEquipableByBitmask(mask));
		TEST_ASSERT(!either.IsClassEquipable(Class::Wizard));
		TEST_ASSERT(either.IsEquipableByClassBitmask(Race::Human, Bit(Class::Cleric)));

		EQ::ItemData cleric_only{};
		cleric_only.Classes = Bit(Class::Cleric);
		cleric_only.Races = RaceBitmask::Human;
		TEST_ASSERT(!cleric_only.IsClassEquipable(Class::Warrior));
		TEST_ASSERT(cleric_only.IsClassEquipableByBitmask(mask));

		TEST_ASSERT(!MultiClass::ClassUsesMana(Class::Warrior));
		TEST_ASSERT(MultiClass::ClassUsesMana(Class::Cleric));
		TEST_ASSERT(MultiClass::IsWisdomManaClass(Class::Cleric));
		TEST_ASSERT(!MultiClass::MaskUsesMana(Bit(Class::Warrior)));
		TEST_ASSERT(MultiClass::MaskUsesMana(mask));
		TEST_ASSERT(MultiClass::ClassicBaseMana(80, 10) > 0);
		TEST_ASSERT_EQUALS(MultiClass::ClassicBaseMana(80, 10), static_cast<int64>(210));
		TEST_ASSERT_EQUALS(MultiClass::ClassicBaseMana(150, 20), static_cast<int64>(637));

		const uint32 warrior_hp = MultiClass::ClassLevelFactor(Class::Warrior, 60);
		const uint32 cleric_hp = MultiClass::ClassLevelFactor(Class::Cleric, 60);
		TEST_ASSERT(warrior_hp > cleric_hp);
		TEST_ASSERT_EQUALS(MultiClass::BestClassLevelFactor(mask, 60), warrior_hp);

		uint8 levels[Class::PLAYER_CLASS_COUNT];
		for (uint8& entry : levels) {
			entry = 255;
		}
		levels[Class::Cleric - 1] = 14;
		levels[Class::Wizard - 1] = 4;
		const auto use = MultiClass::SpellLevelForMask(levels, mask);
		TEST_ASSERT_EQUALS(use.class_id, static_cast<uint8>(Class::Cleric));
		TEST_ASSERT_EQUALS(use.level, static_cast<uint8>(14));
		TEST_ASSERT(MultiClass::CanUseSpell(levels, mask, 14));
		TEST_ASSERT(!MultiClass::CanUseSpell(levels, mask, 13));
		TEST_ASSERT(!MultiClass::CanUseSpell(levels, Bit(Class::Warrior), 60));

		const uint16 both_casters = static_cast<uint16>(Bit(Class::Cleric) | Bit(Class::Wizard));
		const auto lowest = MultiClass::SpellLevelForMask(levels, both_casters);
		TEST_ASSERT_EQUALS(lowest.class_id, static_cast<uint8>(Class::Wizard));
		TEST_ASSERT_EQUALS(lowest.level, static_cast<uint8>(4));
	}

	void SkillCapsAreCachedMax()
	{
		const uint16 mask = static_cast<uint16>(Bit(Class::Warrior) | Bit(Class::Cleric));
		int lookups = 0;
		auto cache = MultiClass::BuildSkillCapCache(mask, 50, 65, [&](uint8 class_id, EQ::skills::SkillType skill, uint8 level) {
			++lookups;
			if (skill == EQ::skills::SkillDualWield && class_id == Class::Warrior && level == 50) {
				return static_cast<uint16>(240);
			}
			if (skill == EQ::skills::SkillMeditate && class_id == Class::Cleric && level == 50) {
				return static_cast<uint16>(180);
			}
			if (skill == EQ::skills::SkillMeditate && class_id == Class::Cleric && level == 65) {
				return static_cast<uint16>(252);
			}
			if (skill == EQ::skills::SkillDualWield && class_id == Class::Warrior && level == 65) {
				return static_cast<uint16>(252);
			}
			return static_cast<uint16>(0);
		});
		const int after_build = lookups;
		TEST_ASSERT(after_build > 0);
		TEST_ASSERT_EQUALS(cache.cap[EQ::skills::SkillDualWield], static_cast<uint16>(240));
		TEST_ASSERT_EQUALS(cache.cap[EQ::skills::SkillMeditate], static_cast<uint16>(180));
		TEST_ASSERT(cache.can_have[EQ::skills::SkillDualWield]);
		TEST_ASSERT(cache.can_have[EQ::skills::SkillMeditate]);
		TEST_ASSERT(!cache.can_have[EQ::skills::SkillBlock]);

		const bool dual_wield = cache.can_have[EQ::skills::SkillDualWield] != 0;
		const bool dodge = cache.can_have[EQ::skills::SkillDodge] != 0;
		TEST_ASSERT(dual_wield);
		TEST_ASSERT(!dodge);
		TEST_ASSERT_EQUALS(lookups, after_build);

		auto warrior_only = MultiClass::BuildSkillCapCache(Bit(Class::Warrior), 50, 65, [&](uint8 class_id, EQ::skills::SkillType skill, uint8 level) {
			if (class_id == Class::Warrior && skill == EQ::skills::SkillDualWield && level == 50) {
				return static_cast<uint16>(240);
			}
			return static_cast<uint16>(0);
		});
		TEST_ASSERT_EQUALS(warrior_only.cap[EQ::skills::SkillDualWield], cache.cap[EQ::skills::SkillDualWield]);
		TEST_ASSERT_EQUALS(warrior_only.cap[EQ::skills::SkillMeditate], static_cast<uint16>(0));
	}

	static std::string ReadSource(const char* path)
	{
		std::ifstream input(path);
		if (!input) {
			return {};
		}
		std::ostringstream buffer;
		buffer << input.rdbuf();
		return buffer.str();
	}

	static std::string FunctionBody(const std::string& source, const std::string& signature)
	{
		const auto start = source.find(signature);
		if (start == std::string::npos) {
			return {};
		}
		const auto next = source.find("\nbool Mob::", start + signature.size());
		if (next == std::string::npos) {
			return source.substr(start);
		}
		return source.substr(start, next - start);
	}

	void CombatHelpersReadSkills()
	{
		std::string source = ReadSource("../zone/mob.cpp");
		if (source.empty()) {
			source = ReadSource("zone/mob.cpp");
		}
		TEST_ASSERT_MSG(!source.empty(), "zone/mob.cpp was not readable from the test working directory");

		const char* helpers[] = {
			"bool Mob::CanThisClassDualWield",
			"bool Mob::CanThisClassDoubleAttack",
			"bool Mob::CanThisClassParry",
			"bool Mob::CanThisClassDodge",
			"bool Mob::CanThisClassRiposte",
			"bool Mob::CanThisClassBlock",
		};
		for (const char* signature : helpers) {
			const std::string body = FunctionBody(source, signature);
			TEST_ASSERT_MSG(!body.empty(), signature);
			TEST_ASSERT_MSG(body.find("HasSkill(") != std::string::npos, signature);
			TEST_ASSERT_MSG(body.find("GetSkillCap") == std::string::npos, signature);
			TEST_ASSERT_MSG(body.find("PLAYER_CLASS_COUNT") == std::string::npos, signature);
		}
	}

	void CommandAddListRemove()
	{
		const uint8 primary = Class::Warrior;
		uint16 mask = 0;
		const int max_classes = 3;

		auto added = MultiClass::ApplyCommand("add", "Wizard", primary, mask, true, max_classes);
		TEST_ASSERT(added.code == MultiClass::CommandCode::Ok);
		TEST_ASSERT(added.action == MultiClass::CommandAction::Add);
		mask = added.mask;
		TEST_ASSERT(MultiClass::HasClass(mask, Class::Warrior));
		TEST_ASSERT(MultiClass::HasClass(mask, Class::Wizard));
		TEST_ASSERT_EQUALS(MultiClass::ClassCount(mask), 2);

		auto third = MultiClass::ApplyCommand("add", "3", primary, mask, true, max_classes);
		TEST_ASSERT(third.code == MultiClass::CommandCode::Ok);
		TEST_ASSERT(MultiClass::HasClass(third.mask, Class::Paladin));
		mask = third.mask;
		TEST_ASSERT_EQUALS(MultiClass::ClassCount(mask), 3);

		auto fourth = MultiClass::ApplyCommand("add", "Rogue", primary, mask, true, max_classes);
		TEST_ASSERT(fourth.code == MultiClass::CommandCode::AtCap);
		TEST_ASSERT_EQUALS(fourth.mask, mask);

		auto again = MultiClass::ApplyCommand("add", "wizard", primary, mask, true, max_classes);
		TEST_ASSERT(again.code == MultiClass::CommandCode::AlreadyHasClass);

		auto banker = MultiClass::ApplyCommand("add", "Banker", primary, mask, true, max_classes);
		TEST_ASSERT(banker.code == MultiClass::CommandCode::InvalidClass);
		auto merchant = MultiClass::ApplyCommand("add", "40", primary, mask, true, max_classes);
		TEST_ASSERT(merchant.code == MultiClass::CommandCode::InvalidClass);
		auto gm = MultiClass::ApplyCommand("add", "WarriorGM", primary, mask, true, max_classes);
		TEST_ASSERT(gm.code == MultiClass::CommandCode::InvalidClass);
		auto injected = MultiClass::ApplyCommand("add", "Wizard'; DROP TABLE character_data;--", primary, mask, true, max_classes);
		TEST_ASSERT(injected.code == MultiClass::CommandCode::InvalidClass);
		TEST_ASSERT_EQUALS(injected.mask, mask);
		TEST_ASSERT(injected.message.find("DROP") == std::string::npos);

		auto shadow = MultiClass::ApplyCommand("remove", "Paladin", primary, mask, true, max_classes);
		TEST_ASSERT(shadow.code == MultiClass::CommandCode::Ok);
		mask = shadow.mask;
		auto named = MultiClass::ApplyCommand("add", "Shadow Knight", primary, mask, true, max_classes);
		TEST_ASSERT(named.code == MultiClass::CommandCode::Ok);
		TEST_ASSERT(MultiClass::HasClass(named.mask, Class::ShadowKnight));
		mask = named.mask;

		auto primary_remove = MultiClass::ApplyCommand("remove", "Warrior", primary, mask, true, max_classes);
		TEST_ASSERT(primary_remove.code == MultiClass::CommandCode::CannotRemovePrimary);
		TEST_ASSERT(MultiClass::HasClass(primary_remove.mask, Class::Warrior));

		auto missing = MultiClass::ApplyCommand("remove", "Enchanter", primary, mask, true, max_classes);
		TEST_ASSERT(missing.code == MultiClass::CommandCode::NotOwned);

		auto listed = MultiClass::ApplyCommand("list", "", primary, mask, true, max_classes);
		TEST_ASSERT(listed.code == MultiClass::CommandCode::Ok);
		TEST_ASSERT(listed.message.find("Warrior") != std::string::npos);
		TEST_ASSERT(listed.message.find("Wizard") != std::string::npos);

		auto disabled = MultiClass::ApplyCommand("add", "Rogue", primary, mask, false, max_classes);
		TEST_ASSERT(disabled.code == MultiClass::CommandCode::Disabled);
		TEST_ASSERT_EQUALS(disabled.mask, MultiClass::NormalizeClassBitmask(primary, mask));
		auto disabled_remove = MultiClass::ApplyCommand("remove", "Wizard", primary, mask, false, max_classes);
		TEST_ASSERT(disabled_remove.code == MultiClass::CommandCode::Disabled);

		auto bad = MultiClass::ApplyCommand("frob", "Wizard", primary, mask, true, max_classes);
		TEST_ASSERT(bad.code == MultiClass::CommandCode::BadCommand);
	}

	void ZeroMaskIsPrimaryClass()
	{
		TEST_ASSERT_EQUALS(MultiClass::NormalizeClassBitmask(Class::Warrior, 0), Bit(Class::Warrior));
		TEST_ASSERT_EQUALS(MultiClass::NormalizeClassBitmask(Class::Cleric, 0), Bit(Class::Cleric));
		TEST_ASSERT_EQUALS(MultiClass::NormalizeClassBitmask(Class::Wizard, 0), Bit(Class::Wizard));

		const uint16 stored = Bit(Class::Cleric);
		const uint16 normalized = MultiClass::NormalizeClassBitmask(Class::Warrior, stored);
		TEST_ASSERT(MultiClass::HasClass(normalized, Class::Warrior));
		TEST_ASSERT(MultiClass::HasClass(normalized, Class::Cleric));
		TEST_ASSERT_EQUALS(MultiClass::ClassCount(normalized), 2);

		TEST_ASSERT_EQUALS(MultiClass::NormalizeClassBitmask(Class::None, 0), static_cast<uint16>(0));
		TEST_ASSERT(!MultiClass::MaskUsesMana(MultiClass::NormalizeClassBitmask(Class::Warrior, 0)));
		TEST_ASSERT_EQUALS(
			MultiClass::BestClassLevelFactor(MultiClass::NormalizeClassBitmask(Class::Ranger, 0), 10),
			MultiClass::ClassLevelFactor(Class::Ranger, 10)
		);
	}
};
