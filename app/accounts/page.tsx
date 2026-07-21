import { query } from "@/lib/db";
import Link from "next/link";

interface AccountRow {
  id: number;
  name: string;
  status: number;
  ls_id: string;
}

interface CharacterRow {
  id: number;
  name: string;
  level: number;
  class: number;
  race: number;
  zone_id: number;
  zone_name: string | null;
  account_id: number;
  deleted_at: string | null;
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

const statusNames: Record<number, string> = {
  0: "Player", 10: "Guide", 20: "QuestTroupe", 50: "SeniorGuide",
  80: "GM-Tester", 85: "GM-Leader", 100: "QuestMaster", 150: "GM-Area",
  200: "GM-Admin", 250: "GM-LeadAdmin", 255: "ServerOP",
};

const PER_PAGE = 50;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { page: pageStr, search } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1"));
  const offset = (page - 1) * PER_PAGE;

  let accounts: AccountRow[] = [];
  let characters: CharacterRow[] = [];
  let totalCount = 0;
  let error = "";

  try {
    const whereClause = search ? "WHERE a.name LIKE ?" : "";
    const params = search ? [`%${search}%`] : [];

    const [countResult, accountResult] = await Promise.all([
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM account a ${whereClause}`,
        params
      ),
      query<AccountRow>(
        `SELECT a.id, a.name, a.status, a.ls_id FROM account a ${whereClause} ORDER BY a.id LIMIT ? OFFSET ?`,
        [...params, PER_PAGE, offset]
      ),
    ]);

    totalCount = countResult[0]?.count ?? 0;
    accounts = accountResult;

    // Fetch characters for displayed accounts
    if (accounts.length > 0) {
      const accountIds = accounts.map((a) => a.id);
      const placeholders = accountIds.map(() => "?").join(",");
      characters = await query<CharacterRow>(
        `SELECT cd.id, cd.name, cd.level, cd.class, cd.race, cd.zone_id, z.long_name as zone_name, cd.account_id, cd.deleted_at FROM character_data cd LEFT JOIN zone z ON z.zoneidnumber = cd.zone_id AND z.version = 0 WHERE cd.account_id IN (${placeholders}) ORDER BY cd.account_id, cd.deleted_at IS NOT NULL, cd.level DESC`,
        accountIds
      );
    }
  } catch (e: any) {
    error = e.message || "Failed to query accounts";
  }

  const totalPages = Math.ceil(totalCount / PER_PAGE);
  const charsByAccount = characters.reduce((acc, char) => {
    if (!acc[char.account_id]) acc[char.account_id] = [];
    acc[char.account_id].push(char);
    return acc;
  }, {} as Record<number, CharacterRow[]>);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>Accounts</h1>

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
          placeholder="Search accounts..."
          className="flex-1 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
        />
        <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium text-black" style={{ backgroundColor: "var(--accent)" }}>
          Search
        </button>
      </form>

      <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
        {totalCount.toLocaleString()} accounts found
        {search && <span> matching &quot;{search}&quot;</span>}
      </div>

      <div className="space-y-3">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-lg border" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            {/* Account Header */}
            <div className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-semibold" style={{ color: "var(--accent)" }}>{account.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--muted)" }}>
                    ID: {account.id}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded" style={{
                    backgroundColor: account.status > 0 ? "#2a2a1a" : "var(--input-bg)",
                    color: account.status > 0 ? "var(--accent)" : "var(--muted)",
                  }}>
                    {statusNames[account.status] || `Status ${account.status}`}
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  LS ID: {account.ls_id || "N/A"}
                </div>
              </div>
            </div>

            {/* Characters */}
            {charsByAccount[account.id] && charsByAccount[account.id].length > 0 && (() => {
              const activeChars = charsByAccount[account.id].filter(c => !c.deleted_at);
              const deletedChars = charsByAccount[account.id].filter(c => c.deleted_at);
              return (
                <div className="border-t" style={{ borderColor: "var(--card-border)" }}>
                  {activeChars.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ backgroundColor: "var(--table-header)" }}>
                          <th className="text-left p-2 pl-4 font-medium text-xs" style={{ color: "var(--muted)" }}>Character</th>
                          <th className="text-left p-2 font-medium text-xs" style={{ color: "var(--muted)" }}>Level</th>
                          <th className="text-left p-2 font-medium text-xs" style={{ color: "var(--muted)" }}>Class</th>
                          <th className="text-left p-2 font-medium text-xs" style={{ color: "var(--muted)" }}>Race</th>
                          <th className="text-left p-2 font-medium text-xs" style={{ color: "var(--muted)" }}>Zone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeChars.map((char) => (
                          <tr key={char.id} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                            <td className="p-2 pl-4">
                              <Link href={`/characters/${char.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                                {char.name}
                              </Link>
                            </td>
                            <td className="p-2">{char.level}</td>
                            <td className="p-2">{classNames[char.class] || char.class}</td>
                            <td className="p-2">{raceNames[char.race] || char.race}</td>
                            <td className="p-2">{char.zone_name || `Zone ${char.zone_id}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {deletedChars.length > 0 && (
                    <>
                      <div className="px-4 py-2 text-xs font-medium border-t" style={{ color: "var(--muted)", borderColor: "var(--card-border)", backgroundColor: "var(--table-header)" }}>
                        Deleted ({deletedChars.length})
                      </div>
                      <table className="w-full text-sm" style={{ opacity: 0.5 }}>
                        <tbody>
                          {deletedChars.map((char) => (
                            <tr key={char.id} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                              <td className="p-2 pl-4">
                                <Link href={`/characters/${char.id}`} className="hover:underline" style={{ color: "var(--muted)" }}>
                                  {char.name}
                                </Link>
                              </td>
                              <td className="p-2">{char.level}</td>
                              <td className="p-2">{classNames[char.class] || char.class}</td>
                              <td className="p-2">{raceNames[char.race] || char.race}</td>
                              <td className="p-2">{char.zone_name || `Zone ${char.zone_id}`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 justify-center">
          {page > 1 && (
            <Link
              href={`/accounts?page=${page - 1}${search ? `&search=${search}` : ""}`}
              className="px-3 py-1.5 rounded text-sm border"
              style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
            >
              Previous
            </Link>
          )}
          <span className="text-sm px-3" style={{ color: "var(--muted)" }}>Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link
              href={`/accounts?page=${page + 1}${search ? `&search=${search}` : ""}`}
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
