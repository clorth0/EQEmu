import { queryOne, query } from "@/lib/db";
import { updateNpc } from "@/app/actions";
import Link from "next/link";
import { LootTableEditor } from "./loot-table-editor";

interface NpcRow {
  id: number;
  name: string;
  level: number;
  race: number;
  class: number;
  hp: number;
  mana: number;
  mindmg: number;
  maxdmg: number;
  attack_speed: number;
  attack_delay: number;
  ac: number;
  npc_aggro: number;
  accuracy: number;
  runspeed: number;
  loottable_id: number;
  merchant_id: number;
  npc_spells_id: number;
  d_melee_texture1: number;
  d_melee_texture2: number;
  str: number;
  sta: number;
  agi: number;
  dex: number;
  int: number;
  wis: number;
  cha: number;
  cr: number;
  dr: number;
  fr: number;
  mr: number;
  pr: number;
  see_invis: number;
  see_invis_undead: number;
  see_hide: number;
  see_improved_hide: number;
  trackable: number;
  bodytype: number;
  hp_regen_rate: number;
  mana_regen_rate: number;
}

function Field({ label, name, value, type = "number" }: { label: string; name: string; value: any; type?: string }) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: "var(--muted)" }}>{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ""}
        className="w-full px-2 py-1.5 rounded border text-sm"
        style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
      />
    </div>
  );
}

export default async function NpcEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const npc = await queryOne<NpcRow>("SELECT * FROM npc_types WHERE id = ?", [id]);

  if (!npc) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--accent)" }}>NPC Not Found</h1>
        <Link href="/npcs" style={{ color: "var(--accent)" }}>Back to NPCs</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/npcs" className="text-sm hover:underline" style={{ color: "var(--muted)" }}>NPCs</Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{npc.name}</h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>#{npc.id}</span>
      </div>

      <form action={updateNpc}>
        <input type="hidden" name="id" value={npc.id} />

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Basic Info</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <Field label="Name" name="name" value={npc.name} type="text" />
              </div>
              <Field label="Level" name="level" value={npc.level} />
              <Field label="Race" name="race" value={npc.race} />
              <Field label="Class" name="class" value={npc.class} />
              <Field label="Body Type" name="bodytype" value={npc.bodytype} />
              <Field label="Run Speed" name="runspeed" value={npc.runspeed} />
              <Field label="Trackable" name="trackable" value={npc.trackable} />
            </div>
          </div>

          {/* Combat */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Combat</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="HP" name="hp" value={npc.hp} />
              <Field label="Mana" name="mana" value={npc.mana} />
              <Field label="AC" name="ac" value={npc.ac} />
              <Field label="Min Damage" name="mindmg" value={npc.mindmg} />
              <Field label="Max Damage" name="maxdmg" value={npc.maxdmg} />
              <Field label="Attack Speed" name="attack_speed" value={npc.attack_speed} />
              <Field label="Attack Delay" name="attack_delay" value={npc.attack_delay} />
              <Field label="Accuracy" name="accuracy" value={npc.accuracy} />
              <Field label="Aggro" name="npc_aggro" value={npc.npc_aggro} />
              <Field label="HP Regen" name="hp_regen_rate" value={npc.hp_regen_rate} />
              <Field label="Mana Regen" name="mana_regen_rate" value={npc.mana_regen_rate} />
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Stats</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="STR" name="str" value={npc.str} />
              <Field label="STA" name="sta" value={npc.sta} />
              <Field label="AGI" name="agi" value={npc.agi} />
              <Field label="DEX" name="dex" value={npc.dex} />
              <Field label="INT" name="int" value={npc.int} />
              <Field label="WIS" name="wis" value={npc.wis} />
              <Field label="CHA" name="cha" value={npc.cha} />
            </div>
          </div>

          {/* Resists */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Resists</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Field label="Cold" name="cr" value={npc.cr} />
              <Field label="Disease" name="dr" value={npc.dr} />
              <Field label="Fire" name="fr" value={npc.fr} />
              <Field label="Magic" name="mr" value={npc.mr} />
              <Field label="Poison" name="pr" value={npc.pr} />
            </div>
          </div>

          {/* Abilities */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Abilities</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="See Invis" name="see_invis" value={npc.see_invis} />
              <Field label="See Invis Undead" name="see_invis_undead" value={npc.see_invis_undead} />
              <Field label="See Hide" name="see_hide" value={npc.see_hide} />
              <Field label="See Improved Hide" name="see_improved_hide" value={npc.see_improved_hide} />
            </div>
          </div>

          {/* References */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>References</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Loot Table ID" name="loottable_id" value={npc.loottable_id} />
              <Field label="Merchant ID" name="merchant_id" value={npc.merchant_id} />
              <Field label="Spells ID" name="npc_spells_id" value={npc.npc_spells_id} />
              <Field label="Melee Texture 1" name="d_melee_texture1" value={npc.d_melee_texture1} />
              <Field label="Melee Texture 2" name="d_melee_texture2" value={npc.d_melee_texture2} />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="submit" className="px-6 py-2 rounded-lg text-sm font-medium text-black" style={{ backgroundColor: "var(--accent)" }}>
            Save Changes
          </button>
          <Link href="/npcs" className="px-6 py-2 rounded-lg text-sm border" style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}>
            Cancel
          </Link>
        </div>
      </form>

      {/* Loot Table Section */}
      <LootTableSection npcId={npc.id} loottableId={npc.loottable_id} />
    </div>
  );
}

async function LootTableSection({ npcId, loottableId }: { npcId: number; loottableId: number }) {
  let lootTable = null;

  if (loottableId > 0) {
    const lt = await queryOne<{ id: number; name: string; mincash: number; maxcash: number }>(
      "SELECT id, name, mincash, maxcash FROM loottable WHERE id = ?",
      [loottableId]
    );

    if (lt) {
      const entries = await query<{
        lootdrop_id: number;
        lootdrop_name: string;
        multiplier: number;
        droplimit: number;
        mindrop: number;
        probability: number;
      }>(
        `SELECT ld.id as lootdrop_id, ld.name as lootdrop_name,
                lte.multiplier, lte.droplimit, lte.mindrop, lte.probability
         FROM loottable_entries lte
         JOIN lootdrop ld ON ld.id = lte.lootdrop_id
         WHERE lte.loottable_id = ?`,
        [loottableId]
      );

      const drops = [];
      for (const entry of entries) {
        const items = await query<{
          item_id: number;
          item_name: string;
          chance: number;
          item_charges: number;
          equip_item: number;
        }>(
          `SELECT lde.item_id, COALESCE(i.Name, CONCAT('Unknown #', lde.item_id)) as item_name,
                  lde.chance, lde.item_charges, lde.equip_item
           FROM lootdrop_entries lde
           LEFT JOIN items i ON i.id = lde.item_id
           WHERE lde.lootdrop_id = ?
           ORDER BY lde.chance DESC`,
          [entry.lootdrop_id]
        );

        drops.push({
          lootdrop_id: entry.lootdrop_id,
          lootdrop_name: entry.lootdrop_name,
          multiplier: entry.multiplier,
          droplimit: entry.droplimit,
          mindrop: entry.mindrop,
          probability: entry.probability,
          items,
        });
      }

      lootTable = {
        id: lt.id,
        name: lt.name,
        mincash: lt.mincash,
        maxcash: lt.maxcash,
        drops,
      };
    }
  }

  return (
    <div className="mt-6 rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Loot Table</h2>
      <LootTableEditor npcId={npcId} lootTable={lootTable} />
    </div>
  );
}
