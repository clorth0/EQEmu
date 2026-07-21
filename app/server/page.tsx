import { exec } from "child_process";
import { promisify } from "util";
import { serverAction } from "@/app/actions";

const execAsync = promisify(exec);
const CONTAINER = "eqemu-eqemu-1";

async function getContainerStatus(): Promise<{ running: boolean; status: string }> {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format='{{.State.Status}}' ${CONTAINER} 2>/dev/null`
    );
    const status = stdout.trim();
    return { running: status === "running", status };
  } catch {
    return { running: false, status: "not found" };
  }
}

async function getProcessList(): Promise<string> {
  try {
    const { stdout } = await execAsync(`docker top ${CONTAINER} -eo pid,comm`);
    return stdout;
  } catch {
    return "Unable to get process list";
  }
}

async function getRecentLogs(): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `docker logs --tail 50 ${CONTAINER} 2>&1`
    );
    return stdout;
  } catch {
    return "Unable to get logs";
  }
}

export default async function ServerPage() {
  const containerStatus = await getContainerStatus();
  const processList = containerStatus.running ? await getProcessList() : "";
  const logs = await getRecentLogs();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--accent)" }}>Server Management</h1>

      {/* Status Card */}
      <div className="rounded-lg border p-4 mb-6" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--accent)" }}>Container Status</h2>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: containerStatus.running ? "#4ade80" : "#f87171" }}
          />
          <span className="text-lg font-medium">
            {containerStatus.running ? "Running" : "Stopped"}
          </span>
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            ({containerStatus.status})
          </span>
        </div>

        {/* Control Buttons */}
        <div className="flex gap-3">
          <form action={serverAction}>
            <input type="hidden" name="action" value="start" />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{
                backgroundColor: containerStatus.running ? "var(--input-bg)" : "#1a3a1a",
                borderColor: containerStatus.running ? "var(--card-border)" : "#2a5a2a",
                color: containerStatus.running ? "var(--muted)" : "#4ade80",
              }}
            >
              Start Server
            </button>
          </form>
          <form action={serverAction}>
            <input type="hidden" name="action" value="stop" />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{
                backgroundColor: "#2a1a1a",
                borderColor: "#5a2a2a",
                color: "#f87171",
              }}
            >
              Stop Server
            </button>
          </form>
          <form action={serverAction}>
            <input type="hidden" name="action" value="restart" />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium text-black"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Restart Server
            </button>
          </form>
        </div>
      </div>

      {/* Process List */}
      {containerStatus.running && processList && (
        <div className="rounded-lg border mb-6" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
          <div className="p-3 border-b text-sm font-semibold" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
            Running Processes
          </div>
          <pre
            className="p-4 text-xs font-mono overflow-x-auto whitespace-pre"
            style={{ color: "var(--foreground)" }}
          >
            {processList}
          </pre>
        </div>
      )}

      {/* Logs */}
      <div className="rounded-lg border" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)" }}>
        <div className="p-3 border-b text-sm font-semibold" style={{ borderColor: "var(--card-border)", color: "var(--accent)" }}>
          Recent Logs (last 50 lines)
        </div>
        <pre
          className="p-4 text-xs font-mono overflow-x-auto whitespace-pre max-h-96 overflow-y-auto"
          style={{ color: "var(--foreground)", backgroundColor: "var(--input-bg)" }}
        >
          {logs || "No logs available"}
        </pre>
      </div>
    </div>
  );
}
