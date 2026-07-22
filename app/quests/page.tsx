import { exec } from "child_process";
import { promisify } from "util";
import { query } from "@/lib/db";
import { parseQuest, type QuestParsed } from "@/lib/quest-parser";
import { saveQuestFile } from "@/app/actions";
import { QuestBuilder } from "./quest-builder";
import Link from "next/link";

const execAsync = promisify(exec);
const CONTAINER = "eqemu-eqemu-server-1";
const QUEST_PATH = "/home/eqemu/server/quests";

async function listZoneFolders(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker exec ${CONTAINER} ls -1 ${QUEST_PATH}`
    );
    return [...new Set(stdout.trim().split("\n").filter(Boolean))].sort();
  } catch {
    return [];
  }
}

async function listFiles(zone: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker exec ${CONTAINER} find ${QUEST_PATH}/${zone} -maxdepth 1 -type f \\( -name '*.pl' -o -name '*.lua' -o -name '*.qst' \\) | sort`
    );
    return [...new Set(stdout.trim().split("\n").filter(Boolean))];
  } catch {
    return [];
  }
}

async function readFile(filePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `docker exec ${CONTAINER} cat "${filePath}"`
    );
    return stdout;
  } catch {
    return "";
  }
}

async function resolveNames(parsed: QuestParsed) {
  const itemIds = parsed.items.map(i => i.id).filter(id => !parsed.items.find(i => i.id === id && i.name));
  const npcIds = parsed.npcs.map(n => n.id);

  const itemNames: Record<number, string> = {};
  const npcNames: Record<number, string> = {};

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = await query<{ id: number; Name: string }>(
      `SELECT id, Name FROM items WHERE id IN (${placeholders})`,
      itemIds
    );
    for (const row of rows) itemNames[row.id] = row.Name;
  }

  if (npcIds.length > 0) {
    const placeholders = npcIds.map(() => "?").join(",");
    const rows = await query<{ id: number; name: string }>(
      `SELECT id, name FROM npc_types WHERE id IN (${placeholders})`,
      npcIds
    );
    for (const row of rows) npcNames[row.id] = row.name;
  }

  // Fill in names
  for (const item of parsed.items) {
    if (!item.name && itemNames[item.id]) item.name = itemNames[item.id];
  }
  for (const npc of parsed.npcs) {
    if (!npc.name && npcNames[npc.id]) npc.name = npcNames[npc.id];
  }
}

export default async function QuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string; file?: string; tab?: string }>;
}) {
  const { zone: selectedZone, file: selectedFile, tab } = await searchParams;
  const activeTab = tab || "summary";

  let zones: string[] = [];
  let files: string[] = [];
  let fileContent = "";
  let parsed: QuestParsed | null = null;
  let error = "";

  try {
    zones = await listZoneFolders();

    if (selectedZone) {
      files = await listFiles(selectedZone);
    }

    if (selectedFile) {
      fileContent = await readFile(selectedFile);
      const fileName = selectedFile.split("/").pop() || selectedFile;
      parsed = parseQuest(fileContent, fileName);
      await resolveNames(parsed);
    }
  } catch (e: any) {
    error = e.message || "Failed to connect to Docker container";
  }

  const npcName = selectedFile?.split("/").pop()?.replace(/\.(lua|pl|qst)$/, "").replace(/_/g, " ") || "";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--accent)" }}>Quest Scripts</h1>

      {error && (
        <div className="mb-4 p-3 rounded border" style={{ backgroundColor: "#2a1a1a", borderColor: "#5a2a2a", color: "#ff6b6b" }}>
          {error}
        </div>
      )}

      <div className="flex gap-3" style={{ minHeight: "600px" }}>
        {/* Zone List */}
        <div className="w-44 flex-shrink-0 rounded border overflow-y-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", maxHeight: "80vh" }}>
          <div className="p-2 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
            Zones ({zones.length})
          </div>
          {zones.length === 0 ? (
            <div className="p-2 text-xs" style={{ color: "var(--muted)" }}>
              No zones found
            </div>
          ) : (
            zones.map((zone) => (
              <Link
                key={zone}
                href={`/quests?zone=${zone}`}
                className="block px-2 py-1 text-xs border-b transition-colors"
                style={{
                  borderColor: "var(--card-border)",
                  color: selectedZone === zone ? "var(--accent)" : "var(--foreground)",
                  backgroundColor: selectedZone === zone ? "var(--input-bg)" : "transparent",
                  fontWeight: selectedZone === zone ? 600 : 400,
                }}
              >
                {zone}
              </Link>
            ))
          )}
        </div>

        {/* File List */}
        {selectedZone && (
          <div className="w-52 flex-shrink-0 rounded border overflow-y-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", maxHeight: "80vh" }}>
            <div className="p-2 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
              {selectedZone} ({files.length})
            </div>
            <Link
              href={`/quests?zone=${selectedZone}&tab=build`}
              className="block px-2 py-1.5 text-xs border-b text-center font-medium"
              style={{
                borderColor: "var(--card-border)",
                color: activeTab === "build" && !selectedFile ? "#000" : "var(--accent)",
                backgroundColor: activeTab === "build" && !selectedFile ? "var(--accent)" : "transparent",
              }}
            >
              + New Quest
            </Link>
            {files.length === 0 ? (
              <div className="p-2 text-xs" style={{ color: "var(--muted)" }}>No quest files</div>
            ) : (
              files.map((file) => {
                const fileName = file.split("/").pop() || file;
                const displayName = fileName.replace(/\.(lua|pl|qst)$/, "").replace(/_/g, " ");
                const ext = fileName.split(".").pop();
                return (
                  <Link
                    key={file}
                    href={`/quests?zone=${selectedZone}&file=${encodeURIComponent(file)}`}
                    className="block px-2 py-1 text-xs border-b transition-colors"
                    style={{
                      borderColor: "var(--card-border)",
                      color: selectedFile === file ? "var(--accent)" : "var(--foreground)",
                      backgroundColor: selectedFile === file ? "var(--input-bg)" : "transparent",
                      fontWeight: selectedFile === file ? 600 : 400,
                    }}
                  >
                    <span>{displayName}</span>
                    <span className="ml-1" style={{ color: "var(--muted)", fontSize: "10px" }}>.{ext}</span>
                  </Link>
                );
              })
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 rounded border" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          {/* New Quest Builder */}
          {selectedZone && !selectedFile && activeTab === "build" ? (
            <QuestBuilder zone={selectedZone} />
          ) : selectedFile && parsed ? (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-2 border-b flex items-center justify-between" style={{ borderColor: "var(--card-border)" }}>
                <div>
                  <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>{npcName}</span>
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--muted)" }}>
                    {parsed.language.toUpperCase()}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Link
                    href={`/quests?zone=${selectedZone}&file=${encodeURIComponent(selectedFile)}&tab=summary`}
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: activeTab === "summary" ? "var(--accent)" : "var(--input-bg)",
                      color: activeTab === "summary" ? "#000" : "var(--foreground)",
                      fontWeight: activeTab === "summary" ? 600 : 400,
                    }}
                  >
                    Summary
                  </Link>
                  <Link
                    href={`/quests?zone=${selectedZone}&file=${encodeURIComponent(selectedFile)}&tab=build`}
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: activeTab === "build" ? "var(--accent)" : "var(--input-bg)",
                      color: activeTab === "build" ? "#000" : "var(--foreground)",
                      fontWeight: activeTab === "build" ? 600 : 400,
                    }}
                  >
                    Builder
                  </Link>
                  <Link
                    href={`/quests?zone=${selectedZone}&file=${encodeURIComponent(selectedFile)}&tab=edit`}
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: activeTab === "edit" ? "var(--accent)" : "var(--input-bg)",
                      color: activeTab === "edit" ? "#000" : "var(--foreground)",
                      fontWeight: activeTab === "edit" ? 600 : 400,
                    }}
                  >
                    Edit Source
                  </Link>
                </div>
              </div>

              {activeTab === "build" ? (
                <QuestBuilder zone={selectedZone!} filePath={selectedFile} initialCode={fileContent} />
              ) : activeTab === "summary" ? (
                <div className="p-3 overflow-y-auto" style={{ maxHeight: "calc(80vh - 40px)" }}>
                  {/* Events */}
                  {parsed.events.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--accent)" }}>Events</h3>
                      <div className="space-y-0.5">
                        {parsed.events.map((evt, i) => (
                          <div key={`evt-${i}-${evt.lineNumber}`} className="flex items-center gap-2 text-xs">
                            <span className="font-mono px-1 py-0.5 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--foreground)" }}>
                              {evt.name}
                            </span>
                            <span style={{ color: "var(--muted)" }}>{evt.label}</span>
                            <span style={{ color: "var(--muted)", fontSize: "10px" }}>L{evt.lineNumber}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dialogue */}
                  {parsed.dialogues.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--accent)" }}>Dialogue</h3>
                      <div className="space-y-1.5">
                        {parsed.dialogues.map((dlg, i) => (
                          <div key={`dlg-${i}-${dlg.lineNumber}`} className="rounded border p-2" style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--card-border)" }}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono px-1 rounded" style={{ backgroundColor: "var(--card-bg)", color: "var(--accent)" }}>
                                [{dlg.trigger}]
                              </span>
                              <span style={{ color: "var(--muted)", fontSize: "10px" }}>L{dlg.lineNumber}</span>
                            </div>
                            <p className="text-xs leading-relaxed" style={{ color: "var(--foreground)" }}>
                              {dlg.text.length > 300 ? dlg.text.substring(0, 300) + "..." : dlg.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  {parsed.items.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--accent)" }}>Items Referenced</h3>
                      <div className="space-y-0.5">
                        {parsed.items.map((item, i) => (
                          <div key={`item-${item.id}-${i}`} className="flex items-center gap-2 text-xs">
                            <Link href={`/items/${item.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                              {item.name || `Item #${item.id}`}
                            </Link>
                            <span style={{ color: "var(--muted)" }}>#{item.id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* NPCs */}
                  {parsed.npcs.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--accent)" }}>NPCs Referenced</h3>
                      <div className="space-y-0.5">
                        {parsed.npcs.map((npc, i) => (
                          <div key={`npc-${npc.id}-${i}`} className="flex items-center gap-2 text-xs">
                            <Link href={`/npcs/${npc.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                              {npc.name || `NPC #${npc.id}`}
                            </Link>
                            <span style={{ color: "var(--muted)" }}>#{npc.id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Spells */}
                  {parsed.spells.length > 0 && (
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--accent)" }}>Spells Referenced</h3>
                      <div className="space-y-0.5">
                        {parsed.spells.map((spell, i) => (
                          <div key={`spell-${spell.id}-${i}`} className="flex items-center gap-2 text-xs">
                            <span style={{ color: "var(--foreground)" }}>
                              {spell.name || `Spell #${spell.id}`}
                            </span>
                            <span style={{ color: "var(--muted)" }}>#{spell.id}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {parsed.events.length === 0 && parsed.dialogues.length === 0 && parsed.items.length === 0 && parsed.npcs.length === 0 && (
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      No structured data found. Switch to Edit Source to view the raw script.
                    </div>
                  )}
                </div>
              ) : (
                <form action={saveQuestFile} className="flex flex-col" style={{ height: "calc(80vh - 40px)" }}>
                  <input type="hidden" name="filePath" value={selectedFile} />
                  <textarea
                    name="content"
                    defaultValue={fileContent}
                    className="flex-1 w-full p-3 font-mono text-xs border-0 resize-none"
                    style={{
                      backgroundColor: "var(--input-bg)",
                      color: "var(--foreground)",
                      outline: "none",
                      tabSize: 2,
                    }}
                    spellCheck={false}
                  />
                  <div className="p-2 border-t flex gap-2" style={{ borderColor: "var(--card-border)" }}>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded text-xs font-medium text-black"
                      style={{ backgroundColor: "var(--accent)" }}
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full" style={{ color: "var(--muted)" }}>
              <p className="text-sm">
                {selectedZone ? "Select a file to view" : "Select a zone to browse quest files"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
