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
#include "zone/client.h"

#include "common/multiclass.h"
#include "common/rulesys.h"

void command_multiclass(Client* c, const Seperator* sep)
{
	if (!c || !sep) {
		return;
	}

	auto target = c;
	if (c->GetTarget() && c->GetTarget()->IsClient()) {
		target = c->GetTarget()->CastToClient();
	}
	else if (c->GetTarget() && !c->GetTarget()->IsClient()) {
		c->Message(Chat::White, "You can only change classes on a player.");
		return;
	}

	std::string class_text;
	for (int index = 2; index <= sep->argnum; ++index) {
		if (!class_text.empty()) {
			class_text.push_back(' ');
		}
		class_text += sep->arg[index];
	}

	const auto result = MultiClass::ApplyCommand(
		sep->arg[1] ? sep->arg[1] : "",
		class_text,
		target->GetClass(),
		target->GetStoredClassBitmask(),
		RuleB(MultiClass, Enabled),
		RuleI(MultiClass, MaxClasses)
	);

	c->Message(Chat::White, result.message.c_str());
	if (result.code != MultiClass::CommandCode::Ok) {
		return;
	}

	if (result.action != MultiClass::CommandAction::Add && result.action != MultiClass::CommandAction::Remove) {
		return;
	}

	target->CommitClassBitmask(result.mask);
	if (target != c) {
		target->Message(Chat::White, result.message.c_str());
	}
}
