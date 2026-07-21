"use client";

import { useState, useTransition } from "react";
import { replaceInventoryItem } from "@/app/actions";

export function SlotEditor({
  characterId,
  slotId,
  currentItemId,
  currentItemName,
  currentCharges,
}: {
  characterId: number;
  slotId: number;
  currentItemId: number | null;
  currentItemName: string | null;
  currentCharges?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [itemId, setItemId] = useState(currentItemId?.toString() ?? "");
  const [charges, setCharges] = useState(currentCharges?.toString() ?? "1");
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        onClick={() => {
          setItemId(currentItemId?.toString() ?? "");
          setCharges(currentCharges?.toString() ?? "1");
          setEditing(true);
        }}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-30 hover:opacity-100 transition-opacity"
        style={{ color: "var(--muted)" }}
        title="Edit slot"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 1.5l2 2L3.5 10.5H1.5v-2z" />
        </svg>
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1.5 ml-auto"
      action={(formData) => {
        startTransition(async () => {
          await replaceInventoryItem(formData);
          setEditing(false);
        });
      }}
    >
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="slotId" value={slotId} />
      <input
        type="number"
        name="itemId"
        value={itemId}
        onChange={(e) => setItemId(e.target.value)}
        placeholder="Item ID"
        className="w-20 px-1.5 py-0.5 text-xs rounded border"
        style={{
          backgroundColor: "var(--input-bg)",
          borderColor: "var(--input-border)",
          color: "var(--foreground)",
        }}
        autoFocus
        min="0"
      />
      <span style={{ color: "var(--muted)", fontSize: "10px" }}>x</span>
      <input
        type="number"
        name="charges"
        value={charges}
        onChange={(e) => setCharges(e.target.value)}
        placeholder="Qty"
        className="w-14 px-1.5 py-0.5 text-xs rounded border"
        style={{
          backgroundColor: "var(--input-bg)",
          borderColor: "var(--input-border)",
          color: "var(--foreground)",
        }}
        min="0"
      />
      <button
        type="submit"
        disabled={isPending}
        className="px-2 py-0.5 text-xs rounded font-medium"
        style={{
          backgroundColor: "var(--accent)",
          color: "#000",
          opacity: isPending ? 0.5 : 1,
        }}
      >
        {isPending ? "..." : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="px-1.5 py-0.5 text-xs rounded"
        style={{ color: "var(--muted)" }}
      >
        X
      </button>
    </form>
  );
}
