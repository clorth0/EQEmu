import { query } from "@/lib/db";
import Link from "next/link";

const ITEMS_PER_PAGE = 50;

interface Item {
  id: number;
  Name: string;
  itemtype: number;
  ac: number;
  damage: number;
  classes: number;
  races: number;
  slots: number;
}

const itemTypeNames: Record<number, string> = {
  0: "1H Slashing", 1: "2H Slashing", 2: "Piercing", 3: "1H Blunt",
  4: "2H Blunt", 5: "Archery", 6: "Throwing", 7: "Shield",
  10: "Armor", 11: "Gem", 15: "Lockpick", 17: "Food", 18: "Drink",
  20: "Spell", 21: "Potion", 23: "Wind", 24: "String", 25: "Brass",
  26: "Percussion", 27: "Arrow", 35: "2H Piercing", 36: "Fishing Pole",
  37: "Fishing Bait", 38: "Alcohol", 40: "Poison", 42: "Hand to Hand",
  45: "Martial", 52: "Charm", 54: "Augmentation",
};

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { page: pageStr, search } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1"));
  const offset = (page - 1) * ITEMS_PER_PAGE;

  let items: Item[] = [];
  let totalCount = 0;
  let error = "";

  try {
    if (search) {
      const [countResult, itemsResult] = await Promise.all([
        query<{ count: number }>(
          "SELECT COUNT(*) as count FROM items WHERE Name LIKE ?",
          [`%${search}%`]
        ),
        query<Item>(
          "SELECT id, Name, itemtype, ac, damage, classes, races, slots FROM items WHERE Name LIKE ? ORDER BY id LIMIT ? OFFSET ?",
          [`%${search}%`, ITEMS_PER_PAGE, offset]
        ),
      ]);
      totalCount = countResult[0]?.count ?? 0;
      items = itemsResult;
    } else {
      const [countResult, itemsResult] = await Promise.all([
        query<{ count: number }>("SELECT COUNT(*) as count FROM items"),
        query<Item>(
          "SELECT id, Name, itemtype, ac, damage, classes, races, slots FROM items ORDER BY id LIMIT ? OFFSET ?",
          [ITEMS_PER_PAGE, offset]
        ),
      ]);
      totalCount = countResult[0]?.count ?? 0;
      items = itemsResult;
    }
  } catch (e: any) {
    error = e.message || "Failed to query items";
  }

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>
        Items
      </h1>

      {error && (
        <div className="mb-4 p-4 rounded-lg border" style={{ backgroundColor: "#2a1a1a", borderColor: "#5a2a2a", color: "#ff6b6b" }}>
          {error}
        </div>
      )}

      {/* Search */}
      <form className="mb-4 flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search || ""}
          placeholder="Search items by name..."
          className="flex-1 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-medium text-black"
          style={{ backgroundColor: "var(--accent)" }}
        >
          Search
        </button>
      </form>

      <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
        {totalCount.toLocaleString()} items found
        {search && <span> matching &quot;{search}&quot;</span>}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--table-header)" }}>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>ID</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Name</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Type</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>AC</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>DMG</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Classes</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Races</th>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)" }}>Slots</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t transition-colors" style={{ borderColor: "var(--card-border)" }}>
                <td className="p-3" style={{ color: "var(--muted)" }}>{item.id}</td>
                <td className="p-3">
                  <Link href={`/items/${item.id}`} className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                    {item.Name}
                  </Link>
                </td>
                <td className="p-3">{itemTypeNames[item.itemtype] || item.itemtype}</td>
                <td className="p-3">{item.ac || "-"}</td>
                <td className="p-3">{item.damage || "-"}</td>
                <td className="p-3">{item.classes}</td>
                <td className="p-3">{item.races}</td>
                <td className="p-3">{item.slots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 justify-center">
          {page > 1 && (
            <Link
              href={`/items?page=${page - 1}${search ? `&search=${search}` : ""}`}
              className="px-3 py-1.5 rounded text-sm border"
              style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
            >
              Previous
            </Link>
          )}
          <span className="text-sm px-3" style={{ color: "var(--muted)" }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/items?page=${page + 1}${search ? `&search=${search}` : ""}`}
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
