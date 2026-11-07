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

#include "common/classes.h"
#include "common/skills.h"
#include "common/types.h"

#include <array>
#include <bit>
#include <string>
#include <string_view>

// Optional player multiclassing. GetClass() stays the single class id the
// official client displays. Extra classes live only in this bitmask.
namespace MultiClass {

constexpr uint8 SPELL_LEVEL_CANNOT_USE = 255;
constexpr int DEFAULT_MAX_CLASSES = 3;

enum class CommandCode {
	Ok,
	Disabled,
	AlreadyHasClass,
	AtCap,
	InvalidClass,
	CannotRemovePrimary,
	NotOwned,
	BadCommand
};

enum class CommandAction {
	None,
	Add,
	Remove,
	List
};

struct SpellClassUse {
	uint8 class_id = 0;
	uint8 level = SPELL_LEVEL_CANNOT_USE;
};

struct CommandResult {
	CommandCode code = CommandCode::BadCommand;
	CommandAction action = CommandAction::None;
	uint16 mask = 0;
	uint8 class_id = 0;
	std::string message;
};

struct SkillCapCache {
	std::array<uint16, EQ::skills::SkillCount> cap{};
	std::array<uint8, EQ::skills::SkillCount> can_have{};
};

inline bool HasClass(uint16 mask, uint8 class_id)
{
	return (mask & GetPlayerClassBit(class_id)) != 0;
}

inline bool HasAnyClass(uint16 mask, uint16 class_bits)
{
	return (mask & class_bits) != 0;
}

inline int ClassCount(uint16 mask)
{
	return static_cast<int>(std::popcount(mask));
}

template <typename Fn>
void ForEachPlayerClass(uint16 mask, Fn&& fn)
{
	for (uint8 class_id = Class::Warrior; class_id <= Class::PLAYER_CLASS_COUNT; ++class_id) {
		if (HasClass(mask, class_id)) {
			fn(class_id);
		}
	}
}

// A stored 0 means "never written": the character is their primary class only.
// The primary class bit is always kept so the class the client displays is owned.
uint16 NormalizeClassBitmask(uint8 primary_class, uint16 stored_mask);

bool ParsePlayerClass(std::string_view text, uint8& class_id);

std::string ClassList(uint16 mask);

CommandResult AddClass(uint8 primary_class, uint16 stored_mask, uint8 class_id, bool enabled, int max_classes);
CommandResult RemoveClass(uint8 primary_class, uint16 stored_mask, uint8 class_id, bool enabled, int max_classes);
CommandResult ApplyCommand(
	std::string_view subcommand,
	std::string_view class_text,
	uint8 primary_class,
	uint16 stored_mask,
	bool enabled,
	int max_classes
);

uint32 ClassLevelFactor(uint8 class_id, uint8 level);
uint32 BestClassLevelFactor(uint16 mask, uint8 level);

bool IsIntelligenceManaClass(uint8 class_id);
bool IsWisdomManaClass(uint8 class_id);
bool ClassUsesMana(uint8 class_id);
bool MaskUsesMana(uint16 mask);

// Pre-SoF / non-SoD base mana from the casting stat. Shared by INT and WIS casters.
int64 ClassicBaseMana(int stat, uint8 level);

// Lowest usable class level among owned classes. 255 / class 0 means none can use it.
SpellClassUse SpellLevelForMask(const uint8* class_levels, uint16 mask);
bool CanUseSpell(const uint8* class_levels, uint16 mask, uint8 character_level);

template <typename CapFn>
SkillCapCache BuildSkillCapCache(uint16 mask, uint8 level, uint8 max_level, CapFn&& cap_for)
{
	SkillCapCache cache;
	ForEachPlayerClass(mask, [&](uint8 class_id) {
		for (int skill = 0; skill < EQ::skills::SkillCount; ++skill) {
			const auto skill_id = static_cast<EQ::skills::SkillType>(skill);
			const uint16 at_level = cap_for(class_id, skill_id, level);
			const uint16 at_max = cap_for(class_id, skill_id, max_level);
			if (at_level > cache.cap[skill]) {
				cache.cap[skill] = at_level;
			}
			if (at_max > 0) {
				cache.can_have[skill] = 1;
			}
		}
	});
	return cache;
}

} // namespace MultiClass
