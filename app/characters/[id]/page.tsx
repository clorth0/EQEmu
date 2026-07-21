import { query, queryOne } from "@/lib/db";
import Link from "next/link";
import { SlotEditor } from "./slot-editor";

const classNames: Record<number, string> = {
  1: "Warrior", 2: "Cleric", 3: "Paladin", 4: "Ranger", 5: "Shadow Knight",
  6: "Druid", 7: "Monk", 8: "Bard", 9: "Rogue", 10: "Shaman",
  11: "Necromancer", 12: "Wizard", 13: "Magician", 14: "Enchanter",
  15: "Beastlord", 16: "Berserker",
};

const raceNames: Record<number, string> = {
  1: "Human", 2: "Barbarian", 3: "Erudite", 4: "Wood Elf", 5: "High Elf",
  6: "Dark Elf", 7: "Half Elf", 8: "Dwarf", 9: "Troll", 10: "Ogre",
  11: "Halfling", 12: "Gnome", 13: "Iksar", 14: "Vah Shir", 15: "Froglok",
  16: "Drakkin",
};

const equipSlots: Record<number, string> = {
  0: "Charm", 1: "Left Ear", 2: "Head", 3: "Face", 4: "Right Ear",
  5: "Neck", 6: "Shoulders", 7: "Arms", 8: "Back", 9: "Left Wrist",
  10: "Right Wrist", 11: "Range", 12: "Hands", 13: "Primary",
  14: "Secondary", 15: "Left Ring", 16: "Right Ring", 17: "Chest",
  18: "Legs", 19: "Feet", 20: "Waist", 21: "Ammo",
};

// Paper-doll layout: left column and right column slot IDs
const paperDollLeft = [2, 1, 5, 6, 7, 9, 12, 15, 17, 18, 20];
const paperDollRight = [3, 4, 0, 8, 11, 10, 13, 14, 16, 19, 21];

interface CharData {
  id: number; name: string; level: number; class: number; race: number;
  zone_id: number; x: number; y: number; z: number;
  str: number; sta: number; cha: number; dex: number; int: number;
  agi: number; wis: number; mana: number; endurance: number;
  account_id: number; last_login: number;
}

interface Currency {
  platinum: number; gold: number; silver: number; copper: number;
  platinum_bank: number; gold_bank: number; silver_bank: number; copper_bank: number;
}

interface InvItem {
  slot_id: number; item_id: number; charges: number;
  item_name: string | null; item_icon: number | null;
}

interface ZoneInfo { short_name: string; long_name: string; }
interface BindInfo { slot: number; zone_id: number; x: number; y: number; z: number; }

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const char = await queryOne<CharData>(
    "SELECT id, name, level, class, race, zone_id, x, y, z, str, sta, cha, dex, `int`, agi, wis, mana, endurance, account_id, last_login FROM character_data WHERE id = ?",
    [id]
  );

  if (!char) {
    return <div className="p-8 text-center" style={{ color: "var(--muted)" }}>Character not found</div>;
  }

  interface AARow { aa_id: number; aa_value: number; charges: number; name: string | null; }

  const [currency, zone, binds, equipment, general, bank, aas] = await Promise.all([
    queryOne<Currency>("SELECT platinum, gold, silver, copper, platinum_bank, gold_bank, silver_bank, copper_bank FROM character_currency WHERE id = ?", [id]),
    queryOne<ZoneInfo>("SELECT short_name, long_name FROM zone WHERE zoneidnumber = ? LIMIT 1", [char.zone_id]),
    query<BindInfo>("SELECT slot, zone_id, x, y, z FROM character_bind WHERE id = ? ORDER BY slot", [id]),
    query<InvItem>(
      `SELECT i.slot_id, i.item_id, i.charges, it.Name as item_name, it.icon as item_icon
       FROM inventory i LEFT JOIN items it ON i.item_id = it.id
       WHERE i.character_id = ? AND i.slot_id >= 0 AND i.slot_id <= 21 ORDER BY i.slot_id`, [id]
    ),
    query<InvItem>(
      `SELECT i.slot_id, i.item_id, i.charges, it.Name as item_name, it.icon as item_icon
       FROM inventory i LEFT JOIN items it ON i.item_id = it.id
       WHERE i.character_id = ? AND ((i.slot_id >= 22 AND i.slot_id <= 29) OR (i.slot_id >= 251 AND i.slot_id <= 340))
       ORDER BY i.slot_id`, [id]
    ),
    query<InvItem>(
      `SELECT i.slot_id, i.item_id, i.charges, it.Name as item_name, it.icon as item_icon
       FROM inventory i LEFT JOIN items it ON i.item_id = it.id
       WHERE i.character_id = ? AND i.slot_id >= 2000 AND i.slot_id <= 2270
       ORDER BY i.slot_id`, [id]
    ),
    query<AARow>(
      `SELECT caa.aa_id, caa.aa_value, caa.charges, aa.name
       FROM character_alternate_abilities caa
       LEFT JOIN aa_ability aa ON caa.aa_id = aa.first_rank_id
       WHERE caa.id = ? ORDER BY aa.name`, [id]
    ),
  ]);

  const lastLogin = char.last_login ? new Date(char.last_login * 1000).toLocaleString() : "Never";

  const generalSlots = general.filter(i => i.slot_id >= 22 && i.slot_id <= 29);
  const generalBagItems = general.filter(i => i.slot_id >= 251);
  const bankSlots = bank.filter(i => i.slot_id >= 2000 && i.slot_id <= 2023);
  const bankBagItems = bank.filter(i => i.slot_id > 2023);

  const equipMap = new Map(equipment.map(e => [e.slot_id, e]));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/accounts" className="text-sm px-3 py-1 rounded border" style={{ borderColor: "var(--card-border)", color: "var(--muted)" }}>
          &larr; Accounts
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
          {char.name}
        </h1>
        <span className="text-sm px-2 py-1 rounded" style={{ backgroundColor: "var(--card-bg)", color: "var(--muted)" }}>
          Level {char.level} {raceNames[char.race] || char.race} {classNames[char.class] || char.class}
        </span>
      </div>

      {/* Top row: Location, Stats, Currency, Binds */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        {/* Location */}
        <Section title="Location">
          <InfoRow label="Zone" value={zone ? `${zone.long_name}` : `Zone ${char.zone_id}`} />
          <InfoRow label="Coords" value={`${char.x.toFixed(0)}, ${char.y.toFixed(0)}, ${char.z.toFixed(0)}`} />
          <InfoRow label="Last Login" value={lastLogin} />
          <InfoRow label="Account" value={String(char.account_id)} />
        </Section>

        {/* Stats */}
        <Section title="Stats">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "6px" }}>
            {([
              ["STR", char.str], ["STA", char.sta], ["AGI", char.agi], ["DEX", char.dex],
              ["WIS", char.wis], ["INT", char.int], ["CHA", char.cha], ["Mana", char.mana],
            ] as [string, number][]).map(([label, val]) => (
              <div key={label} style={{ backgroundColor: "var(--input-bg)", textAlign: "center", padding: "4px", borderRadius: "4px" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                <div style={{ fontSize: "14px", fontWeight: "bold", color: label === "Mana" ? "#60a5fa" : "var(--accent)" }}>{val}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Currency */}
        <Section title="Currency">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", marginBottom: "4px" }}>On Hand</div>
              <CurrencyDisplay pp={currency?.platinum ?? 0} gp={currency?.gold ?? 0} sp={currency?.silver ?? 0} cp={currency?.copper ?? 0} />
            </div>
            <div>
              <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", marginBottom: "4px" }}>Bank</div>
              <CurrencyDisplay pp={currency?.platinum_bank ?? 0} gp={currency?.gold_bank ?? 0} sp={currency?.silver_bank ?? 0} cp={currency?.copper_bank ?? 0} />
            </div>
          </div>
        </Section>

        {/* Bind Points */}
        <Section title="Bind Points">
          {binds.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>No bind points</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {binds.map(b => (
                <div key={b.slot} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Slot {b.slot}</span>
                  <span>Zone {b.zone_id} ({b.x.toFixed(0)}, {b.y.toFixed(0)}, {b.z.toFixed(0)})</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Equipment - paper doll layout */}
      <Section title="Equipment">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {paperDollLeft.map(slotId => (
              <EquipSlotRow key={slotId} slotId={slotId} item={equipMap.get(slotId) ?? null} characterId={char.id} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {paperDollRight.map(slotId => (
              <EquipSlotRow key={slotId} slotId={slotId} item={equipMap.get(slotId) ?? null} characterId={char.id} />
            ))}
          </div>
        </div>
      </Section>

      {/* Inventory and Bank side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
        {/* General Inventory */}
        <Section title="General Inventory">
          <CompactItemGrid
            items={generalSlots}
            bagItems={generalBagItems}
            slotOffset={22}
            slotCount={8}
            slotLabel="Slot"
            bagBase={251}
            bagSize={10}
            characterId={char.id}
          />
        </Section>

        {/* Bank */}
        <Section title="Bank">
          <CompactItemGrid
            items={bankSlots}
            bagItems={bankBagItems}
            slotOffset={2000}
            slotCount={24}
            slotLabel="Bank"
            bagBase={2031}
            bagSize={10}
            characterId={char.id}
          />
        </Section>
      </div>

      {/* Alternate Abilities */}
      <div style={{ marginTop: "16px" }}>
        <Section title={`Alternate Abilities (${aas.length})`}>
          {aas.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>No AAs purchased</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "2px" }}>
              {aas.map(aa => (
                <div key={aa.aa_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", padding: "3px 8px", borderRadius: "4px", backgroundColor: "var(--input-bg)" }}>
                  <span style={{ color: "var(--accent)" }}>{aa.name || `AA ${aa.aa_id}`}</span>
                  <span style={{ color: "var(--muted)", fontSize: "11px" }}>Rank {aa.aa_value}{aa.charges > 0 ? ` (${aa.charges})` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
      <h2 className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--accent)" }}>{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span className="text-right truncate ml-2">{value}</span>
    </div>
  );
}

function CurrencyDisplay({ pp, gp, sp, cp }: { pp: number; gp: number; sp: number; cp: number }) {
  return (
    <div className="flex gap-3 text-xs">
      <span><span className="text-yellow-300 font-medium">{pp.toLocaleString()}</span> <span style={{ color: "var(--muted)" }}>pp</span></span>
      <span><span className="text-yellow-500">{gp}</span> <span style={{ color: "var(--muted)" }}>gp</span></span>
      <span><span className="text-gray-400">{sp}</span> <span style={{ color: "var(--muted)" }}>sp</span></span>
      <span><span className="text-orange-700">{cp}</span> <span style={{ color: "var(--muted)" }}>cp</span></span>
    </div>
  );
}

function EquipSlotRow({ slotId, item, characterId }: { slotId: number; item: InvItem | null; characterId: number }) {
  const slotName = equipSlots[slotId];
  const hasItem = item !== null;

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 rounded text-xs"
      style={{
        backgroundColor: hasItem ? "var(--input-bg)" : "transparent",
        opacity: hasItem ? 1 : 0.4,
      }}
    >
      <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {slotName}
      </span>
      <span className="flex-1 truncate min-w-0">
        {hasItem ? (
          <Link href={`/items/${item.item_id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
            {item.item_name || `Item ${item.item_id}`}
          </Link>
        ) : (
          <span style={{ color: "#444" }}>--</span>
        )}
      </span>
      <SlotEditor
        characterId={characterId}
        slotId={slotId}
        currentItemId={item?.item_id ?? null}
        currentItemName={item?.item_name ?? null}
        currentCharges={item?.charges ?? 0}
      />
    </div>
  );
}

function CompactItemGrid({ items, bagItems, slotOffset, slotCount, slotLabel, bagBase, bagSize, characterId }: {
  items: InvItem[]; bagItems: InvItem[]; slotOffset: number; slotCount: number;
  slotLabel: string; bagBase: number; bagSize: number; characterId: number;
}) {
  if (items.length === 0) {
    return <div className="text-xs" style={{ color: "var(--muted)" }}>Empty</div>;
  }

  return (
    <div className="space-y-0.5">
      {items.map(item => {
        const slotNum = item.slot_id - slotOffset;
        const bagStart = bagBase + slotNum * bagSize;
        const bagEnd = bagStart + bagSize;
        const contents = bagItems.filter(b => b.slot_id >= bagStart && b.slot_id < bagEnd);

        return (
          <div key={item.slot_id}>
            <div className="flex items-center gap-2 px-2 py-1 rounded text-xs" style={{ backgroundColor: "var(--input-bg)" }}>
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {slotLabel} {slotNum + 1}
              </span>
              <span className="flex-1 truncate min-w-0">
                <Link href={`/items/${item.item_id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                  {item.item_name || `Item ${item.item_id}`}
                </Link>
              </span>
              {item.charges > 0 && <span className="text-[10px] shrink-0" style={{ color: "var(--muted)" }}>x{item.charges}</span>}
              <SlotEditor
                characterId={characterId}
                slotId={item.slot_id}
                currentItemId={item.item_id}
                currentItemName={item.item_name}
                currentCharges={item.charges}
              />
            </div>
            {contents.length > 0 && (
              <div className="ml-6 border-l pl-2 space-y-0" style={{ borderColor: "var(--card-border)" }}>
                {contents.map(bi => (
                  <div key={bi.slot_id} className="flex items-center gap-2 px-1 py-0.5 text-[11px]">
                    <span className="flex-1 truncate min-w-0">
                      <Link href={`/items/${bi.item_id}`} className="hover:underline" style={{ color: "#9ca3af" }}>
                        {bi.item_name || `Item ${bi.item_id}`}
                      </Link>
                    </span>
                    {bi.charges > 0 && <span style={{ color: "var(--muted)" }} className="text-[10px]">x{bi.charges}</span>}
                    <SlotEditor
                      characterId={characterId}
                      slotId={bi.slot_id}
                      currentItemId={bi.item_id}
                      currentItemName={bi.item_name}
                    currentCharges={bi.charges}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
