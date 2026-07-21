import { query, queryOne } from "@/lib/db";
import { updateItem } from "@/app/actions";
import Link from "next/link";

interface NpcDrop {
  npc_id: number;
  npc_name: string;
  npc_level: number;
  chance: number;
  lootdrop_name: string;
}

interface ItemRow {
  id: number;
  Name: string;
  itemtype: number;
  ac: number;
  damage: number;
  hp: number;
  mana: number;
  classes: number;
  races: number;
  slots: number;
  weight: number;
  price: number;
  aagi: number;
  asta: number;
  acha: number;
  adex: number;
  aint: number;
  awis: number;
  cr: number;
  dr: number;
  fr: number;
  mr: number;
  pr: number;
  heroic_str: number;
  heroic_sta: number;
  heroic_agi: number;
  heroic_dex: number;
  heroic_int: number;
  heroic_wis: number;
  heroic_cha: number;
  attack: number;
  haste: number;
  regen: number;
  manaregen: number;
  mindmg: number;
  maxdmg: number;
  delay: number;
  reqlevel: number;
  reclevel: number;
  reqskill: number;
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

export default async function ItemEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [item, npcDrops] = await Promise.all([
    queryOne<ItemRow>("SELECT * FROM items WHERE id = ?", [id]),
    query<NpcDrop>(
      `SELECT DISTINCT n.id as npc_id, n.name as npc_name, n.level as npc_level, lde.chance, ld.name as lootdrop_name
       FROM lootdrop_entries lde
       JOIN lootdrop ld ON ld.id = lde.lootdrop_id
       JOIN loottable_entries lte ON lte.lootdrop_id = lde.lootdrop_id
       JOIN npc_types n ON n.loottable_id = lte.loottable_id
       WHERE lde.item_id = ?
       ORDER BY lde.chance DESC, n.level DESC
       LIMIT 50`,
      [id]
    ),
  ]);

  if (!item) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--accent)" }}>Item Not Found</h1>
        <Link href="/items" style={{ color: "var(--accent)" }}>Back to Items</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/items" className="text-sm hover:underline" style={{ color: "var(--muted)" }}>
          Items
        </Link>
        <span style={{ color: "var(--muted)" }}>/</span>
        <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
          {item.Name}
        </h1>
        <span className="text-sm" style={{ color: "var(--muted)" }}>#{item.id}</span>
      </div>

      <form action={updateItem}>
        <input type="hidden" name="id" value={item.id} />

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Basic Info</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <Field label="Name" name="Name" value={item.Name} type="text" />
              </div>
              <Field label="Item Type" name="itemtype" value={item.itemtype} />
              <Field label="Weight" name="weight" value={item.weight} />
              <Field label="Price" name="price" value={item.price} />
              <Field label="Req Level" name="reqlevel" value={item.reqlevel} />
              <Field label="Rec Level" name="reclevel" value={item.reclevel} />
              <Field label="Req Skill" name="reqskill" value={item.reqskill} />
            </div>
          </div>

          {/* Equipment */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Equipment</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Classes" name="classes" value={item.classes} />
              <Field label="Races" name="races" value={item.races} />
              <Field label="Slots" name="slots" value={item.slots} />
            </div>
          </div>

          {/* Combat Stats */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Combat</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="AC" name="ac" value={item.ac} />
              <Field label="Damage" name="damage" value={item.damage} />
              <Field label="Min Damage" name="mindmg" value={item.mindmg} />
              <Field label="Max Damage" name="maxdmg" value={item.maxdmg} />
              <Field label="Delay" name="delay" value={item.delay} />
              <Field label="HP" name="hp" value={item.hp} />
              <Field label="Mana" name="mana" value={item.mana} />
              <Field label="Haste" name="haste" value={item.haste} />
              <Field label="Attack" name="attack" value={item.attack} />
              <Field label="Regen" name="regen" value={item.regen} />
              <Field label="Mana Regen" name="manaregen" value={item.manaregen} />
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Stats</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="AGI" name="aagi" value={item.aagi} />
              <Field label="STA" name="asta" value={item.asta} />
              <Field label="CHA" name="acha" value={item.acha} />
              <Field label="DEX" name="adex" value={item.adex} />
              <Field label="INT" name="aint" value={item.aint} />
              <Field label="WIS" name="awis" value={item.awis} />
            </div>
          </div>

          {/* Resists */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Resists</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Field label="Cold" name="cr" value={item.cr} />
              <Field label="Disease" name="dr" value={item.dr} />
              <Field label="Fire" name="fr" value={item.fr} />
              <Field label="Magic" name="mr" value={item.mr} />
              <Field label="Poison" name="pr" value={item.pr} />
            </div>
          </div>

          {/* Heroic Stats */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Heroic Stats</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="H.STR" name="heroic_str" value={item.heroic_str} />
              <Field label="H.STA" name="heroic_sta" value={item.heroic_sta} />
              <Field label="H.AGI" name="heroic_agi" value={item.heroic_agi} />
              <Field label="H.DEX" name="heroic_dex" value={item.heroic_dex} />
              <Field label="H.INT" name="heroic_int" value={item.heroic_int} />
              <Field label="H.WIS" name="heroic_wis" value={item.heroic_wis} />
              <Field label="H.CHA" name="heroic_cha" value={item.heroic_cha} />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            className="px-6 py-2 rounded-lg text-sm font-medium text-black"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Save Changes
          </button>
          <Link
            href="/items"
            className="px-6 py-2 rounded-lg text-sm border"
            style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Dropped By */}
      <div className="mt-6 rounded-lg border p-4" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: "var(--accent)" }}>
          Dropped By ({npcDrops.length}{npcDrops.length === 50 ? "+" : ""} NPCs)
        </h2>
        {npcDrops.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>No NPCs drop this item</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--table-header)" }}>
                  <th className="text-left p-2 font-medium" style={{ color: "var(--muted)" }}>NPC</th>
                  <th className="text-left p-2 font-medium" style={{ color: "var(--muted)" }}>Level</th>
                  <th className="text-left p-2 font-medium" style={{ color: "var(--muted)" }}>Drop Chance</th>
                  <th className="text-left p-2 font-medium" style={{ color: "var(--muted)" }}>Loot Drop</th>
                </tr>
              </thead>
              <tbody>
                {npcDrops.map((npc) => (
                  <tr key={`${npc.npc_id}-${npc.lootdrop_name}`} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                    <td className="p-2">
                      <Link href={`/npcs/${npc.npc_id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                        {npc.npc_name}
                      </Link>
                    </td>
                    <td className="p-2">{npc.npc_level}</td>
                    <td className="p-2">{npc.chance}%</td>
                    <td className="p-2" style={{ color: "var(--muted)" }}>{npc.lootdrop_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
