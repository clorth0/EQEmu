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
#include "common/multiclass.h"

#include "common/strings.h"

#include "fmt/format.h"

#include <cctype>
#include <charconv>

namespace {

struct ClassName {
	const char* name;
	uint8 id;
};

// Compared with spaces removed and case folded, so "Shadow Knight" and
// "shadowknight" both resolve. Guildmaster, banker, and merchant ids are absent.
constexpr ClassName kClassNames[] = {
	{"warrior", Class::Warrior},
	{"cleric", Class::Cleric},
	{"paladin", Class::Paladin},
	{"ranger", Class::Ranger},
	{"shadowknight", Class::ShadowKnight},
	{"shadow knight", Class::ShadowKnight},
	{"druid", Class::Druid},
	{"monk", Class::Monk},
	{"bard", Class::Bard},
	{"rogue", Class::Rogue},
	{"shaman", Class::Shaman},
	{"necromancer", Class::Necromancer},
	{"wizard", Class::Wizard},
	{"magician", Class::Magician},
	{"enchanter", Class::Enchanter},
	{"beastlord", Class::Beastlord},
	{"berserker", Class::Berserker},
};

std::string FoldClassName(std::string_view text)
{
	std::string folded;
	folded.reserve(text.size());
	for (unsigned char c : text) {
		if (std::isspace(c)) {
			continue;
		}
		folded.push_back(static_cast<char>(std::tolower(c)));
	}
	return folded;
}

int ClampMaxClasses(int max_classes)
{
	if (max_classes < 1) {
		return 1;
	}
	if (max_classes > Class::PLAYER_CLASS_COUNT) {
		return Class::PLAYER_CLASS_COUNT;
	}
	return max_classes;
}

std::string Usage()
{
	return "Usage: #multiclass add|remove|list [Class Name or 1-16]";
}

} // namespace

namespace MultiClass {

uint16 NormalizeClassBitmask(uint8 primary_class, uint16 stored_mask)
{
	const uint16 primary_bit = GetPlayerClassBit(primary_class);
	if (stored_mask == 0) {
		return primary_bit;
	}

	uint16 mask = stored_mask & Class::ALL_CLASSES_BITMASK;
	if (primary_bit) {
		mask |= primary_bit;
	}
	return mask;
}

bool ParsePlayerClass(std::string_view text, uint8& class_id)
{
	std::string trimmed(text);
	Strings::Trim(trimmed);
	if (trimmed.empty()) {
		return false;
	}

	bool all_digits = true;
	for (unsigned char c : trimmed) {
		if (std::isdigit(c) == 0) {
			all_digits = false;
			break;
		}
	}

	if (all_digits) {
		int value = 0;
		const auto* begin = trimmed.data();
		const auto* end = begin + trimmed.size();
		const auto parsed = std::from_chars(begin, end, value);
		if (parsed.ec != std::errc() || parsed.ptr != end) {
			return false;
		}
		if (value < Class::Warrior || value > Class::PLAYER_CLASS_COUNT) {
			return false;
		}
		class_id = static_cast<uint8>(value);
		return true;
	}

	const std::string folded = FoldClassName(trimmed);
	for (const auto& entry : kClassNames) {
		if (folded == FoldClassName(entry.name)) {
			class_id = entry.id;
			return true;
		}
	}

	return false;
}

std::string ClassList(uint16 mask)
{
	std::string list;
	ForEachPlayerClass(mask, [&](uint8 class_id) {
		if (!list.empty()) {
			list += ", ";
		}
		list += GetClassIDName(class_id);
	});
	if (list.empty()) {
		return "none";
	}
	return list;
}

CommandResult AddClass(uint8 primary_class, uint16 stored_mask, uint8 class_id, bool enabled, int max_classes)
{
	CommandResult result;
	result.action = CommandAction::Add;
	result.mask = NormalizeClassBitmask(primary_class, stored_mask);
	result.class_id = class_id;

	if (!enabled) {
		result.code = CommandCode::Disabled;
		result.message = "Multiclassing is disabled. Set rule MultiClass:Enabled to true.";
		return result;
	}

	if (!IsPlayerClass(class_id)) {
		result.code = CommandCode::InvalidClass;
		result.message = "That is not a player class. Use a class name or an id from 1 to 16.";
		return result;
	}

	if (HasClass(result.mask, class_id)) {
		result.code = CommandCode::AlreadyHasClass;
		result.message = fmt::format("This character is already a {}.", GetClassIDName(class_id));
		return result;
	}

	const int limit = ClampMaxClasses(max_classes);
	if (ClassCount(result.mask) >= limit) {
		result.code = CommandCode::AtCap;
		result.message = fmt::format(
			"This character already has {} classes, the maximum set by MultiClass:MaxClasses.",
			limit
		);
		return result;
	}

	result.mask |= GetPlayerClassBit(class_id);
	result.code = CommandCode::Ok;
	result.message = fmt::format("Added {}. Classes: {}.", GetClassIDName(class_id), ClassList(result.mask));
	return result;
}

CommandResult RemoveClass(uint8 primary_class, uint16 stored_mask, uint8 class_id, bool enabled, int max_classes)
{
	(void) max_classes;
	CommandResult result;
	result.action = CommandAction::Remove;
	result.mask = NormalizeClassBitmask(primary_class, stored_mask);
	result.class_id = class_id;

	if (!enabled) {
		result.code = CommandCode::Disabled;
		result.message = "Multiclassing is disabled. Set rule MultiClass:Enabled to true.";
		return result;
	}

	if (!IsPlayerClass(class_id)) {
		result.code = CommandCode::InvalidClass;
		result.message = "That is not a player class. Use a class name or an id from 1 to 16.";
		return result;
	}

	if (class_id == primary_class || class_id == GetPlayerClassValue(primary_class)) {
		result.code = CommandCode::CannotRemovePrimary;
		result.message = fmt::format(
			"You cannot remove the primary class ({}). The client shows that class.",
			GetClassIDName(primary_class)
		);
		return result;
	}

	if (!HasClass(result.mask, class_id)) {
		result.code = CommandCode::NotOwned;
		result.message = "This character does not have that class.";
		return result;
	}

	result.mask = static_cast<uint16>(result.mask & ~GetPlayerClassBit(class_id));
	result.mask = NormalizeClassBitmask(primary_class, result.mask);
	result.code = CommandCode::Ok;
	result.message = fmt::format("Removed {}. Classes: {}.", GetClassIDName(class_id), ClassList(result.mask));
	return result;
}

CommandResult ApplyCommand(
	std::string_view subcommand,
	std::string_view class_text,
	uint8 primary_class,
	uint16 stored_mask,
	bool enabled,
	int max_classes
)
{
	std::string sub(subcommand);
	Strings::Trim(sub);
	sub = Strings::ToLower(sub);

	if (sub.empty() || (sub != "add" && sub != "remove" && sub != "list")) {
		CommandResult result;
		result.code = CommandCode::BadCommand;
		result.message = Usage();
		result.mask = NormalizeClassBitmask(primary_class, stored_mask);
		return result;
	}

	if (sub == "list") {
		CommandResult result;
		result.code = CommandCode::Ok;
		result.action = CommandAction::List;
		result.mask = NormalizeClassBitmask(primary_class, stored_mask);
		const uint16 shown = enabled ? result.mask : GetPlayerClassBit(primary_class);
		result.message = fmt::format(
			"Classes: {}. Primary class: {}.",
			ClassList(shown),
			GetClassIDName(primary_class)
		);
		if (!enabled && ClassCount(result.mask) > 1) {
			result.message += " Multiclassing is disabled, so only the primary class is used.";
		}
		return result;
	}

	uint8 class_id = 0;
	if (!ParsePlayerClass(class_text, class_id)) {
		CommandResult result;
		result.code = CommandCode::InvalidClass;
		result.action = sub == "add" ? CommandAction::Add : CommandAction::Remove;
		result.mask = NormalizeClassBitmask(primary_class, stored_mask);
		result.message = "That is not a player class. Use a class name or an id from 1 to 16.";
		return result;
	}

	if (sub == "add") {
		return AddClass(primary_class, stored_mask, class_id, enabled, max_classes);
	}
	return RemoveClass(primary_class, stored_mask, class_id, enabled, max_classes);
}

uint32 ClassLevelFactor(uint8 class_id, uint8 level)
{
	uint32 multiplier = 0;
	switch (class_id) {
		case Class::Warrior: {
			if (level < 20) {
				multiplier = 220;
			}
			else if (level < 30) {
				multiplier = 230;
			}
			else if (level < 40) {
				multiplier = 250;
			}
			else if (level < 53) {
				multiplier = 270;
			}
			else if (level < 57) {
				multiplier = 280;
			}
			else if (level < 60) {
				multiplier = 290;
			}
			else if (level < 70) {
				multiplier = 300;
			}
			else {
				multiplier = 311;
			}
			break;
		}
		case Class::Druid:
		case Class::Cleric:
		case Class::Shaman: {
			if (level < 70) {
				multiplier = 150;
			}
			else {
				multiplier = 157;
			}
			break;
		}
		case Class::Berserker:
		case Class::Paladin:
		case Class::ShadowKnight: {
			if (level < 35) {
				multiplier = 210;
			}
			else if (level < 45) {
				multiplier = 220;
			}
			else if (level < 51) {
				multiplier = 230;
			}
			else if (level < 56) {
				multiplier = 240;
			}
			else if (level < 60) {
				multiplier = 250;
			}
			else if (level < 68) {
				multiplier = 260;
			}
			else {
				multiplier = 270;
			}
			break;
		}
		case Class::Monk:
		case Class::Bard:
		case Class::Rogue:
		case Class::Beastlord: {
			if (level < 51) {
				multiplier = 180;
			}
			else if (level < 58) {
				multiplier = 190;
			}
			else if (level < 70) {
				multiplier = 200;
			}
			else {
				multiplier = 210;
			}
			break;
		}
		case Class::Ranger: {
			if (level < 58) {
				multiplier = 200;
			}
			else if (level < 70) {
				multiplier = 210;
			}
			else {
				multiplier = 220;
			}
			break;
		}
		case Class::Magician:
		case Class::Wizard:
		case Class::Necromancer:
		case Class::Enchanter: {
			if (level < 70) {
				multiplier = 120;
			}
			else {
				multiplier = 127;
			}
			break;
		}
		default: {
			if (level < 35) {
				multiplier = 210;
			}
			else if (level < 45) {
				multiplier = 220;
			}
			else if (level < 51) {
				multiplier = 230;
			}
			else if (level < 56) {
				multiplier = 240;
			}
			else if (level < 60) {
				multiplier = 250;
			}
			else {
				multiplier = 260;
			}
			break;
		}
	}
	return multiplier;
}

uint32 BestClassLevelFactor(uint16 mask, uint8 level)
{
	if (ClassCount(mask) == 0) {
		return ClassLevelFactor(Class::None, level);
	}

	uint32 best = 0;
	ForEachPlayerClass(mask, [&](uint8 class_id) {
		const uint32 factor = ClassLevelFactor(class_id, level);
		if (factor > best) {
			best = factor;
		}
	});
	return best;
}

bool IsIntelligenceManaClass(uint8 class_id)
{
	switch (class_id) {
		case Class::ShadowKnight:
		case Class::Bard:
		case Class::Necromancer:
		case Class::Wizard:
		case Class::Magician:
		case Class::Enchanter:
		case Class::ShadowKnightGM:
		case Class::BardGM:
		case Class::NecromancerGM:
		case Class::WizardGM:
		case Class::MagicianGM:
		case Class::EnchanterGM:
			return true;
		default:
			return false;
	}
}

bool IsWisdomManaClass(uint8 class_id)
{
	switch (class_id) {
		case Class::Cleric:
		case Class::Paladin:
		case Class::Ranger:
		case Class::Druid:
		case Class::Shaman:
		case Class::Beastlord:
		case Class::ClericGM:
		case Class::PaladinGM:
		case Class::RangerGM:
		case Class::DruidGM:
		case Class::ShamanGM:
		case Class::BeastlordGM:
			return true;
		default:
			return false;
	}
}

bool ClassUsesMana(uint8 class_id)
{
	return IsIntelligenceManaClass(class_id) || IsWisdomManaClass(class_id);
}

bool MaskUsesMana(uint16 mask)
{
	bool uses_mana = false;
	ForEachPlayerClass(mask, [&](uint8 class_id) {
		if (ClassUsesMana(class_id)) {
			uses_mana = true;
		}
	});
	return uses_mana;
}

int64 ClassicBaseMana(int stat, uint8 level)
{
	int mind_lesser = 0;
	if (((stat - 199) / 2) > 0) {
		mind_lesser = (stat - 199) / 2;
	}

	const int mind = stat - mind_lesser;
	if (stat > 100) {
		return (((5 * (mind + 20)) / 2) * 3 * level / 40);
	}
	return (((5 * (mind + 200)) / 2) * 3 * level / 100);
}

SpellClassUse SpellLevelForMask(const uint8* class_levels, uint16 mask)
{
	SpellClassUse best;
	if (!class_levels) {
		return best;
	}

	ForEachPlayerClass(mask, [&](uint8 class_id) {
		const uint8 level = class_levels[class_id - 1];
		if (level == SPELL_LEVEL_CANNOT_USE) {
			return;
		}
		if (best.class_id == 0 || level < best.level) {
			best.class_id = class_id;
			best.level = level;
		}
	});
	return best;
}

bool CanUseSpell(const uint8* class_levels, uint16 mask, uint8 character_level)
{
	const auto use = SpellLevelForMask(class_levels, mask);
	return use.class_id != 0 && use.level <= character_level;
}

} // namespace MultiClass
