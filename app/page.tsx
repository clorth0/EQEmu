import { query } from "@/lib/db";

interface CountResult {
  count: number;
}

interface OnlineCharacter {
  id: number;
  name: string;
  level: number;
  class: number;
  race: number;
  zone_id: number;
  zone_name: string | null;
  bind_zone_name: string | null;
}

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

export default async function DashboardPage() {
  let itemCount = 0, npcCount = 0, zoneCount = 0, accountCount = 0, charCount = 0;
  let onlinePlayers: OnlineCharacter[] = [];
  let error = "";

  try {
    const [items, npcs, zones, accounts, chars, online] = await Promise.all([
      query<CountResult>("SELECT COUNT(*) as count FROM items"),
      query<CountResult>("SELECT COUNT(*) as count FROM npc_types"),
      query<CountResult>("SELECT COUNT(*) as count FROM zone"),
      query<CountResult>("SELECT COUNT(*) as count FROM account"),
      query<CountResult>("SELECT COUNT(*) as count FROM character_data"),
      query<OnlineCharacter>(
        "SELECT cd.id, cd.name, cd.level, cd.class, cd.race, cd.zone_id, z.long_name as zone_name, bz.long_name as bind_zone_name FROM character_data cd LEFT JOIN zone z ON z.zoneidnumber = cd.zone_id AND z.version = 0 LEFT JOIN character_bind cb ON cb.id = cd.id AND cb.slot = 0 LEFT JOIN zone bz ON bz.zoneidnumber = cb.zone_id AND bz.version = 0 WHERE cd.last_login > UNIX_TIMESTAMP() - 3600 ORDER BY cd.last_login DESC LIMIT 20"
      ),
    ]);

    itemCount = items[0]?.count ?? 0;
    npcCount = npcs[0]?.count ?? 0;
    zoneCount = zones[0]?.count ?? 0;
    accountCount = accounts[0]?.count ?? 0;
    charCount = chars[0]?.count ?? 0;
    onlinePlayers = online;
  } catch (e: any) {
    error = e.message || "Failed to connect to database";
  }

  const stats = [
    { label: "Items", value: itemCount.toLocaleString(), href: "/items" },
    { label: "NPCs", value: npcCount.toLocaleString(), href: "/npcs" },
    { label: "Zones", value: zoneCount.toLocaleString(), href: "/zones" },
    { label: "Accounts", value: accountCount.toLocaleString(), href: "/accounts" },
    { label: "Characters", value: charCount.toLocaleString(), href: "/accounts" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>
        Dashboard
      </h1>

      {error && (
        <div className="mb-6 p-4 rounded-lg border" style={{ backgroundColor: "#2a1a1a", borderColor: "#5a2a2a", color: "#ff6b6b" }}>
          Database Error: {error}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {stats.map((stat) => (
          <a
            key={stat.label}
            href={stat.href}
            className="p-4 rounded-lg border transition-colors"
            style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}
          >
            <div className="text-sm" style={{ color: "var(--muted)" }}>{stat.label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color: "var(--accent)" }}>
              {stat.value}
            </div>
          </a>
        ))}
      </div>

      {/* Online Players */}
      <div className="rounded-lg border" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <div className="p-4 border-b" style={{ borderColor: "var(--card-border)" }}>
          <h2 className="text-lg font-semibold">
            Recently Active Players
            <span className="ml-2 text-sm font-normal" style={{ color: "var(--muted)" }}>
              ({onlinePlayers.length})
            </span>
          </h2>
        </div>
        {onlinePlayers.length === 0 ? (
          <div className="p-8 text-center" style={{ color: "var(--muted)" }}>
            No players currently online
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--table-header)" }}>
                  <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Name</th>
                  <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Level</th>
                  <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Class</th>
                  <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Race</th>
                  <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Zone</th>
                  <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Bound</th>
                </tr>
              </thead>
              <tbody>
                {onlinePlayers.map((player) => (
                  <tr key={player.id} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                    <td className="p-3 font-medium">
                      <a href={`/characters/${player.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>{player.name}</a>
                    </td>
                    <td className="p-3">{player.level}</td>
                    <td className="p-3">{classNames[player.class] || player.class}</td>
                    <td className="p-3">{raceNames[player.race] || player.race}</td>
                    <td className="p-3">{player.zone_name || `Zone ${player.zone_id}`}</td>
                    <td className="p-3">{player.bind_zone_name || "Unknown"}</td>
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
