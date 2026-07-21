import { query } from "@/lib/db";
import Link from "next/link";

const PER_PAGE = 50;

interface NpcRow {
  id: number;
  name: string;
  level: number;
  race: number;
  class: number;
  hp: number;
  maxdmg: number;
  loottable_id: number;
}

const classNames: Record<number, string> = {
  1: "Warrior", 2: "Cleric", 3: "Paladin", 4: "Ranger", 5: "Shadow Knight",
  6: "Druid", 7: "Monk", 8: "Bard", 9: "Rogue", 10: "Shaman",
  11: "Necromancer", 12: "Wizard", 13: "Magician", 14: "Enchanter",
  15: "Beastlord", 16: "Berserker",
};

export default async function NpcsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; zone?: string; item?: string }>;
}) {
  const { page: pageStr, search, zone, item } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1"));
  const offset = (page - 1) * PER_PAGE;

  let npcs: NpcRow[] = [];
  let totalCount = 0;
  let error = "";

  try {
    const conditions: string[] = [];
    const params: any[] = [];

    if (search) {
      conditions.push("n.name LIKE ?");
      params.push(`%${search}%`);
    }
    if (zone) {
      conditions.push("n.id IN (SELECT se.npcID FROM spawnentry se JOIN spawngroup sg ON se.spawngroupID = sg.id JOIN spawn2 s ON s.spawngroupID = sg.id WHERE s.zone = ?)");
      params.push(zone);
    }
    if (item) {
      conditions.push("n.loottable_id IN (SELECT lte.loottable_id FROM loottable_entries lte JOIN lootdrop_entries lde ON lde.lootdrop_id = lte.lootdrop_id WHERE lde.item_id = ?)");
      params.push(parseInt(item, 10));
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const [countResult, npcResult] = await Promise.all([
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM npc_types n ${whereClause}`,
        params
      ),
      query<NpcRow>(
        `SELECT n.id, n.name, n.level, n.race, n.class, n.hp, n.maxdmg, n.loottable_id FROM npc_types n ${whereClause} ORDER BY n.id LIMIT ? OFFSET ?`,
        [...params, PER_PAGE, offset]
      ),
    ]);

    totalCount = countResult[0]?.count ?? 0;
    npcs = npcResult;
  } catch (e: any) {
    error = e.message || "Failed to query NPCs";
  }

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>NPCs</h1>

      {error && (
        <div className="mb-4 p-4 rounded-lg border" style={{ backgroundColor: "#2a1a1a", borderColor: "#5a2a2a", color: "#ff6b6b" }}>
          {error}
        </div>
      )}

      <form className="mb-4 flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search || ""}
          placeholder="Search by name..."
          className="flex-1 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
        />
        <input
          type="text"
          name="zone"
          defaultValue={zone || ""}
          placeholder="Zone (e.g. ecommons)"
          className="w-44 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
        />
        <input
          type="text"
          name="item"
          defaultValue={item || ""}
          placeholder="Item ID"
          className="w-28 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
        />
        <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium text-black" style={{ backgroundColor: "var(--accent)" }}>
          Search
        </button>
      </form>

      <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
        {totalCount.toLocaleString()} NPCs found
        {search && <span> matching &quot;{search}&quot;</span>}
        {zone && <span> in zone &quot;{zone}&quot;</span>}
        {item && <span> dropping item #{item}</span>}
      </div>

      <div className="rounded-lg border overflow-x-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--table-header)" }}>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>ID</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Name</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Level</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Race</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Class</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>HP</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Max DMG</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Loot Table</th>
            </tr>
          </thead>
          <tbody>
            {npcs.map((npc) => (
              <tr key={npc.id} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                <td className="p-3" style={{ color: "var(--muted)" }}>{npc.id}</td>
                <td className="p-3">
                  <Link href={`/npcs/${npc.id}`} className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                    {npc.name}
                  </Link>
                </td>
                <td className="p-3">{npc.level}</td>
                <td className="p-3">{npc.race}</td>
                <td className="p-3">{classNames[npc.class] || npc.class}</td>
                <td className="p-3">{npc.hp?.toLocaleString()}</td>
                <td className="p-3">{npc.maxdmg}</td>
                <td className="p-3">{npc.loottable_id || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 justify-center">
          {page > 1 && (
            <Link
              href={`/npcs?page=${page - 1}${search ? `&search=${search}` : ""}${zone ? `&zone=${zone}` : ""}${item ? `&item=${item}` : ""}`}
              className="px-3 py-1.5 rounded text-sm border"
              style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
            >
              Previous
            </Link>
          )}
          <span className="text-sm px-3" style={{ color: "var(--muted)" }}>Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link
              href={`/npcs?page=${page + 1}${search ? `&search=${search}` : ""}${zone ? `&zone=${zone}` : ""}${item ? `&item=${item}` : ""}`}
              className="px-3 py-1.5 rounded text-sm border"
              style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
