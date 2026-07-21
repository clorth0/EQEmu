import { query } from "@/lib/db";
import Link from "next/link";

const PER_PAGE = 50;

interface ZoneRow {
  zoneidnumber: number;
  short_name: string;
  long_name: string;
  min_level: number;
  max_level: number;
  expansion: number;
}

const expansionNames: Record<number, string> = {
  0: "Classic", 1: "Ruins of Kunark", 2: "Scars of Velious", 3: "Shadows of Luclin",
  4: "Planes of Power", 5: "Legacy of Ykesha", 6: "Lost Dungeons", 7: "Gates of Discord",
  8: "Omens of War", 9: "Dragons of Norrath", 10: "Depths of Darkhollow",
  11: "Prophecy of Ro", 12: "The Serpent's Spine", 13: "The Buried Sea",
  14: "Secrets of Faydwer", 15: "Seeds of Destruction", 16: "Underfoot",
  17: "House of Thule", 18: "Veil of Alaris", 19: "Rain of Fear",
  20: "Call of the Forsaken", 21: "The Darkened Sea", 22: "The Broken Mirror",
};

export default async function ZonesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { page: pageStr, search } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1"));
  const offset = (page - 1) * PER_PAGE;

  let zones: ZoneRow[] = [];
  let totalCount = 0;
  let error = "";

  try {
    const whereClause = search ? "WHERE long_name LIKE ? OR short_name LIKE ?" : "";
    const params = search ? [`%${search}%`, `%${search}%`] : [];

    const [countResult, zonesResult] = await Promise.all([
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM zone ${whereClause}`,
        params
      ),
      query<ZoneRow>(
        `SELECT zoneidnumber, short_name, long_name, min_level, max_level, expansion FROM zone ${whereClause} ORDER BY zoneidnumber LIMIT ? OFFSET ?`,
        [...params, PER_PAGE, offset]
      ),
    ]);

    totalCount = countResult[0]?.count ?? 0;
    zones = zonesResult;
  } catch (e: any) {
    error = e.message || "Failed to query zones";
  }

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>Zones</h1>

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
          placeholder="Search zones..."
          className="flex-1 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
        />
        <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium text-black" style={{ backgroundColor: "var(--accent)" }}>
          Search
        </button>
      </form>

      <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
        {totalCount.toLocaleString()} zones found
        {search && <span> matching &quot;{search}&quot;</span>}
      </div>

      <div className="rounded-lg border overflow-x-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--table-header)" }}>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>ID</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Short Name</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Long Name</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Min Level</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Max Level</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Expansion</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <tr key={zone.zoneidnumber} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                <td className="p-3" style={{ color: "var(--muted)" }}>{zone.zoneidnumber}</td>
                <td className="p-3 font-mono text-xs">{zone.short_name}</td>
                <td className="p-3">
                  <Link href={`/zones/${zone.zoneidnumber}`} className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                    {zone.long_name}
                  </Link>
                </td>
                <td className="p-3">{zone.min_level}</td>
                <td className="p-3">{zone.max_level}</td>
                <td className="p-3">{expansionNames[zone.expansion] || zone.expansion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 justify-center">
          {page > 1 && (
            <Link
              href={`/zones?page=${page - 1}${search ? `&search=${search}` : ""}`}
              className="px-3 py-1.5 rounded text-sm border"
              style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
            >
              Previous
            </Link>
          )}
          <span className="text-sm px-3" style={{ color: "var(--muted)" }}>Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link
              href={`/zones?page=${page + 1}${search ? `&search=${search}` : ""}`}
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
