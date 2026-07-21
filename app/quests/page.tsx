import { exec } from "child_process";
import { promisify } from "util";
import { saveQuestFile } from "@/app/actions";
import Link from "next/link";

const execAsync = promisify(exec);
const CONTAINER = "eqemu-eqemu-1";
const QUEST_PATH = "/home/eqemu/server/quests";

async function listZoneFolders(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker exec ${CONTAINER} ls -1 ${QUEST_PATH}`
    );
    return stdout.trim().split("\n").filter(Boolean).sort();
  } catch {
    return [];
  }
}

async function listFiles(zone: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker exec ${CONTAINER} find ${QUEST_PATH}/${zone} -maxdepth 1 -type f -name '*.pl' -o -name '*.lua' -o -name '*.qst' | sort`
    );
    return stdout.trim().split("\n").filter(Boolean);
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

export default async function QuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string; file?: string }>;
}) {
  const { zone: selectedZone, file: selectedFile } = await searchParams;

  let zones: string[] = [];
  let files: string[] = [];
  let fileContent = "";
  let error = "";

  try {
    zones = await listZoneFolders();

    if (selectedZone) {
      files = await listFiles(selectedZone);
    }

    if (selectedFile) {
      fileContent = await readFile(selectedFile);
    }
  } catch (e: any) {
    error = e.message || "Failed to connect to Docker container";
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>Quest Scripts</h1>

      {error && (
        <div className="mb-4 p-4 rounded-lg border" style={{ backgroundColor: "#2a1a1a", borderColor: "#5a2a2a", color: "#ff6b6b" }}>
          {error}
        </div>
      )}

      <div className="flex gap-4" style={{ minHeight: "600px" }}>
        {/* Zone List */}
        <div className="w-48 flex-shrink-0 rounded-lg border overflow-y-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", maxHeight: "700px" }}>
          <div className="p-3 border-b text-sm font-semibold" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
            Zones ({zones.length})
          </div>
          {zones.length === 0 ? (
            <div className="p-3 text-sm" style={{ color: "var(--muted)" }}>
              No zones found. Is the Docker container running?
            </div>
          ) : (
            zones.map((zone) => (
              <Link
                key={zone}
                href={`/quests?zone=${zone}`}
                className={`block px-3 py-1.5 text-sm border-b transition-colors ${
                  selectedZone === zone ? "font-medium" : ""
                }`}
                style={{
                  borderColor: "var(--card-border)",
                  color: selectedZone === zone ? "var(--accent)" : "var(--foreground)",
                  backgroundColor: selectedZone === zone ? "var(--input-bg)" : "transparent",
                }}
              >
                {zone}
              </Link>
            ))
          )}
        </div>

        {/* File List */}
        {selectedZone && (
          <div className="w-60 flex-shrink-0 rounded-lg border overflow-y-auto" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", maxHeight: "700px" }}>
            <div className="p-3 border-b text-sm font-semibold" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
              {selectedZone} ({files.length} files)
            </div>
            {files.length === 0 ? (
              <div className="p-3 text-sm" style={{ color: "var(--muted)" }}>No quest files</div>
            ) : (
              files.map((file) => {
                const fileName = file.split("/").pop() || file;
                return (
                  <Link
                    key={file}
                    href={`/quests?zone=${selectedZone}&file=${encodeURIComponent(file)}`}
                    className={`block px-3 py-1.5 text-sm border-b font-mono transition-colors ${
                      selectedFile === file ? "font-medium" : ""
                    }`}
                    style={{
                      borderColor: "var(--card-border)",
                      color: selectedFile === file ? "var(--accent)" : "var(--foreground)",
                      backgroundColor: selectedFile === file ? "var(--input-bg)" : "transparent",
                      fontSize: "0.75rem",
                    }}
                  >
                    {fileName}
                  </Link>
                );
              })
            )}
          </div>
        )}

        {/* File Editor */}
        <div className="flex-1 rounded-lg border" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          {selectedFile ? (
            <form action={saveQuestFile}>
              <input type="hidden" name="filePath" value={selectedFile} />
              <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "var(--card-border)" }}>
                <span className="text-sm font-mono" style={{ color: "var(--accent)" }}>
                  {selectedFile}
                </span>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded text-sm font-medium text-black"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  Save
                </button>
              </div>
              <textarea
                name="content"
                defaultValue={fileContent}
                className="w-full p-4 font-mono text-sm border-0 resize-none"
                style={{
                  backgroundColor: "var(--input-bg)",
                  color: "var(--foreground)",
                  minHeight: "600px",
                  outline: "none",
                }}
                spellCheck={false}
              />
            </form>
          ) : (
            <div className="flex items-center justify-center h-full" style={{ color: "var(--muted)" }}>
              <p className="text-sm">
                {selectedZone ? "Select a file to view/edit" : "Select a zone to browse quest files"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
