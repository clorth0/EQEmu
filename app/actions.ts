"use server";

import { execute, query } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Items
export async function updateItem(formData: FormData) {
  const id = formData.get("id") as string;
  const fields = [
    "Name", "itemtype", "ac", "damage", "hp", "mana",
    "classes", "races", "slots", "weight", "price",
    "aagi", "asta", "acha", "adex", "aint", "awis",
    "cr", "dr", "fr", "mr", "pr",
    "heroic_str", "heroic_sta", "heroic_agi", "heroic_dex", "heroic_int", "heroic_wis", "heroic_cha",
    "attack", "haste", "regen", "manaregen",
    "delay",
    "reqlevel", "reclevel", "reqskill",
  ];

  const setClauses: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    const val = formData.get(field);
    if (val !== null) {
      setClauses.push(`\`${field}\` = ?`);
      values.push(val);
    }
  }

  if (setClauses.length > 0) {
    values.push(id);
    await execute(
      `UPDATE items SET ${setClauses.join(", ")} WHERE id = ?`,
      values
    );
  }

  revalidatePath(`/items/${id}`);
  revalidatePath("/items");
  redirect(`/items/${id}`);
}

// NPCs
export async function updateNpc(formData: FormData) {
  const id = formData.get("id") as string;
  const fields = [
    "name", "level", "race", "class", "hp", "mana",
    "mindmg", "maxdmg", "attack_speed", "attack_delay",
    "ac", "npc_aggro", "accuracy", "runspeed",
    "loottable_id", "merchant_id", "npc_spells_id",
    "d_melee_texture1", "d_melee_texture2",
    "str", "sta", "agi", "dex", "int", "wis", "cha",
    "cr", "dr", "fr", "mr", "pr",
    "see_invis", "see_invis_undead", "see_hide", "see_improved_hide",
    "trackable", "bodytype", "hp_regen_rate", "mana_regen_rate",
  ];

  const setClauses: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    const val = formData.get(field);
    if (val !== null) {
      setClauses.push(`\`${field}\` = ?`);
      values.push(val);
    }
  }

  if (setClauses.length > 0) {
    values.push(id);
    await execute(
      `UPDATE npc_types SET ${setClauses.join(", ")} WHERE id = ?`,
      values
    );
  }

  revalidatePath(`/npcs/${id}`);
  revalidatePath("/npcs");
  redirect(`/npcs/${id}`);
}

// Zones
export async function updateZone(formData: FormData) {
  const id = formData.get("id") as string;
  const fields = [
    "long_name", "min_level", "max_level", "min_status",
    "safe_x", "safe_y", "safe_z",
    "underworld", "graveyard_id", "max_clients",
    "ruleset", "expansion", "suspendbuffs",
    "rain_chance1", "rain_chance2", "rain_chance3", "rain_chance4",
    "rain_duration1", "rain_duration2", "rain_duration3", "rain_duration4",
    "hot_zone", "peqzone", "shutdowndelay",
  ];

  const setClauses: string[] = [];
  const values: any[] = [];

  for (const field of fields) {
    const val = formData.get(field);
    if (val !== null) {
      setClauses.push(`\`${field}\` = ?`);
      values.push(val);
    }
  }

  if (setClauses.length > 0) {
    values.push(id);
    await execute(
      `UPDATE zone SET ${setClauses.join(", ")} WHERE zoneidnumber = ?`,
      values
    );
  }

  revalidatePath(`/zones/${id}`);
  revalidatePath("/zones");
  redirect(`/zones/${id}`);
}

// Server controls
export async function serverAction(formData: FormData) {
  const action = formData.get("action") as string;
  const container = "eqemu-eqemu-1";

  try {
    switch (action) {
      case "restart":
        await execAsync(`docker restart ${container}`);
        break;
      case "stop":
        await execAsync(`docker stop ${container}`);
        break;
      case "start":
        await execAsync(`docker start ${container}`);
        break;
    }
  } catch (e) {
    // Container may not exist or docker may not be available
    console.error("Server action failed:", e);
  }

  revalidatePath("/server");
}

// Character inventory
export async function replaceInventoryItem(formData: FormData) {
  const characterId = formData.get("characterId") as string;
  const slotId = formData.get("slotId") as string;
  const itemId = formData.get("itemId") as string;
  const chargesStr = formData.get("charges") as string;

  const itemIdNum = parseInt(itemId, 10);
  const charges = Math.max(0, parseInt(chargesStr, 10) || 1);

  if (!characterId || !slotId || isNaN(itemIdNum)) {
    throw new Error("Invalid parameters");
  }

  if (itemIdNum <= 0) {
    // Clear the slot
    await execute(
      "DELETE FROM inventory WHERE character_id = ? AND slot_id = ?",
      [characterId, slotId]
    );
  } else {
    // Insert or replace the item with charges
    await execute(
      `REPLACE INTO inventory (character_id, slot_id, item_id, charges, color, augment_one, augment_two, augment_three, augment_four, augment_five, augment_six, instnodrop) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [characterId, slotId, itemIdNum, charges]
    );
  }

  revalidatePath(`/characters/${characterId}`);
}

// Loot table actions
export async function addLootDropItem(formData: FormData) {
  const lootdrop_id = parseInt(formData.get("lootdrop_id") as string, 10);
  const item_id = parseInt(formData.get("item_id") as string, 10);
  const chance = parseFloat(formData.get("chance") as string) || 1.0;
  const item_charges = parseInt(formData.get("item_charges") as string, 10) || 1;
  const npc_id = formData.get("npc_id") as string;

  if (isNaN(lootdrop_id) || isNaN(item_id) || item_id <= 0) {
    throw new Error("Invalid parameters");
  }

  await execute(
    "INSERT INTO lootdrop_entries (lootdrop_id, item_id, chance, item_charges, equip_item) VALUES (?, ?, ?, ?, 0)",
    [lootdrop_id, item_id, chance, item_charges]
  );

  revalidatePath(`/npcs/${npc_id}`);
}

export async function removeLootDropItem(formData: FormData) {
  const lootdrop_id = parseInt(formData.get("lootdrop_id") as string, 10);
  const item_id = parseInt(formData.get("item_id") as string, 10);
  const npc_id = formData.get("npc_id") as string;

  if (isNaN(lootdrop_id) || isNaN(item_id)) {
    throw new Error("Invalid parameters");
  }

  await execute(
    "DELETE FROM lootdrop_entries WHERE lootdrop_id = ? AND item_id = ?",
    [lootdrop_id, item_id]
  );

  revalidatePath(`/npcs/${npc_id}`);
}

export async function updateLootDropItemChance(formData: FormData) {
  const lootdrop_id = parseInt(formData.get("lootdrop_id") as string, 10);
  const item_id = parseInt(formData.get("item_id") as string, 10);
  const chance = parseFloat(formData.get("chance") as string);
  const npc_id = formData.get("npc_id") as string;

  if (isNaN(lootdrop_id) || isNaN(item_id) || isNaN(chance)) {
    throw new Error("Invalid parameters");
  }

  await execute(
    "UPDATE lootdrop_entries SET chance = ? WHERE lootdrop_id = ? AND item_id = ?",
    [chance, lootdrop_id, item_id]
  );

  revalidatePath(`/npcs/${npc_id}`);
}

export async function createLootTableForNpc(formData: FormData) {
  const npc_id = formData.get("npc_id") as string;
  const table_name = (formData.get("table_name") as string) || `NPC_${npc_id}_Loot`;

  if (!npc_id) {
    throw new Error("Invalid parameters");
  }

  // Create the loottable
  const ltResult: any = await execute(
    "INSERT INTO loottable (name, mincash, maxcash) VALUES (?, 0, 0)",
    [table_name]
  );
  const loottable_id = ltResult.insertId;

  // Create a lootdrop
  const ldResult: any = await execute(
    "INSERT INTO lootdrop (name) VALUES (?)",
    [`${table_name}_drop`]
  );
  const lootdrop_id = ldResult.insertId;

  // Link them via loottable_entries
  await execute(
    "INSERT INTO loottable_entries (loottable_id, lootdrop_id, multiplier, droplimit, mindrop, probability) VALUES (?, ?, 1, 0, 0, 100)",
    [loottable_id, lootdrop_id]
  );

  // Update the NPC to use this loottable
  await execute(
    "UPDATE npc_types SET loottable_id = ? WHERE id = ?",
    [loottable_id, npc_id]
  );

  revalidatePath(`/npcs/${npc_id}`);
}

// Quest file save
export async function saveQuestFile(formData: FormData) {
  const filePath = formData.get("filePath") as string;
  const content = formData.get("content") as string;
  const container = "eqemu-eqemu-1";

  // Sanitize the file path to prevent injection
  if (!filePath.startsWith("/home/eqemu/server/quests/")) {
    throw new Error("Invalid file path");
  }

  // Escape content for shell
  const escaped = content.replace(/'/g, "'\\''");
  await execAsync(
    `docker exec ${container} bash -c 'cat > ${filePath}' <<'EQEOF'\n${content}\nEQEOF`
  );

  revalidatePath("/quests");
}

// Item search
export async function searchItems(searchTerm: string): Promise<{ id: number; Name: string }[]> {
  if (!searchTerm || searchTerm.length < 2) return [];

  // id:1234 — exact ID lookup
  const idMatch = searchTerm.match(/^id:(\d+)$/);
  if (idMatch) {
    return query<{ id: number; Name: string }>(
      "SELECT id, Name FROM items WHERE id = ?",
      [idMatch[1]]
    );
  }

  const words = searchTerm.trim().split(/\s+/);
  const includes: string[] = [];
  const excludes: string[] = [];

  for (const word of words) {
    if (word.startsWith("-") && word.length > 1) {
      excludes.push(word.slice(1));
    } else if (word.length >= 2) {
      includes.push(word);
    }
  }

  if (includes.length === 0) return [];

  const conditions: string[] = [];
  const params: any[] = [];

  for (const word of includes) {
    conditions.push("Name LIKE ?");
    params.push(`%${word}%`);
  }
  for (const word of excludes) {
    conditions.push("Name NOT LIKE ?");
    params.push(`%${word}%`);
  }

  // Sort: exact match first, then starts-with, then shortest name
  const firstInclude = includes[0];
  params.push(firstInclude, `${firstInclude}%`);

  const results = await query<{ id: number; Name: string }>(
    `SELECT id, Name FROM items WHERE ${conditions.join(" AND ")} ORDER BY Name = ? DESC, Name LIKE ? DESC, LENGTH(Name), Name LIMIT 50`,
    params
  );
  return results;
}
