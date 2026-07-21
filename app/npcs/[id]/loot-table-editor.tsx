"use client";

import { useState, useTransition } from "react";
import {
  addLootDropItem,
  removeLootDropItem,
  updateLootDropItemChance,
  createLootTableForNpc,
} from "@/app/actions";
import Link from "next/link";

interface LootDropItem {
  item_id: number;
  item_name: string;
  chance: number;
  item_charges: number;
  equip_item: number;
}

interface LootDrop {
  lootdrop_id: number;
  lootdrop_name: string;
  multiplier: number;
  droplimit: number;
  mindrop: number;
  probability: number;
  items: LootDropItem[];
}

interface LootTable {
  id: number;
  name: string;
  mincash: number;
  maxcash: number;
  drops: LootDrop[];
}

export function LootTableEditor({
  npcId,
  lootTable,
}: {
  npcId: number;
  lootTable: LootTable | null;
}) {
  if (!lootTable) {
    return <CreateLootTableForm npcId={npcId} />;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Loot Table #{lootTable.id}: {lootTable.name}
        </span>
        {(lootTable.mincash > 0 || lootTable.maxcash > 0) && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Cash: {lootTable.mincash} - {lootTable.maxcash}
          </span>
        )}
      </div>

      {lootTable.drops.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No loot drops configured for this table.
        </p>
      )}

      {lootTable.drops.map((drop) => (
        <LootDropSection key={drop.lootdrop_id} npcId={npcId} drop={drop} />
      ))}
    </div>
  );
}

function LootDropSection({
  npcId,
  drop,
}: {
  npcId: number;
  drop: LootDrop;
}) {
  return (
    <div
      className="rounded border p-3 mb-3"
      style={{
        backgroundColor: "var(--background)",
        borderColor: "var(--card-border)",
      }}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          {drop.lootdrop_name}
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          mult: {drop.multiplier} | droplimit: {drop.droplimit} | mindrop: {drop.mindrop} | prob: {drop.probability}%
        </span>
      </div>

      {drop.items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 70px 60px 40px", gap: "4px 8px", alignItems: "center" }}>
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Item</span>
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Chance %</span>
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Charges</span>
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Equip</span>
          <span />
          {drop.items.map((item) => (
            <LootDropItemRow
              key={item.item_id}
              npcId={npcId}
              lootdropId={drop.lootdrop_id}
              item={item}
            />
          ))}
        </div>
      )}

      {drop.items.length === 0 && (
        <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          No items in this drop.
        </p>
      )}

      <AddItemForm npcId={npcId} lootdropId={drop.lootdrop_id} />
    </div>
  );
}

function LootDropItemRow({
  npcId,
  lootdropId,
  item,
}: {
  npcId: number;
  lootdropId: number;
  item: LootDropItem;
}) {
  const [editingChance, setEditingChance] = useState(false);
  const [chance, setChance] = useState(item.chance.toString());
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Link
        href={`/items/${item.item_id}`}
        className="text-sm hover:underline truncate"
        style={{ color: "var(--accent)" }}
      >
        {item.item_name || `Item #${item.item_id}`}
      </Link>

      {editingChance ? (
        <form
          className="flex items-center gap-1"
          action={(formData) => {
            startTransition(async () => {
              await updateLootDropItemChance(formData);
              setEditingChance(false);
            });
          }}
        >
          <input type="hidden" name="lootdrop_id" value={lootdropId} />
          <input type="hidden" name="item_id" value={item.item_id} />
          <input type="hidden" name="npc_id" value={npcId} />
          <input
            type="number"
            name="chance"
            value={chance}
            onChange={(e) => setChance(e.target.value)}
            step="0.01"
            min="0"
            max="100"
            className="w-16 px-1 py-0.5 text-xs rounded border"
            style={{
              backgroundColor: "var(--input-bg)",
              borderColor: "var(--input-border)",
              color: "var(--foreground)",
            }}
            autoFocus
          />
          <button
            type="submit"
            disabled={isPending}
            className="text-xs px-1"
            style={{ color: "var(--accent)", opacity: isPending ? 0.5 : 1 }}
          >
            {isPending ? "..." : "OK"}
          </button>
          <button
            type="button"
            onClick={() => {
              setChance(item.chance.toString());
              setEditingChance(false);
            }}
            className="text-xs px-1"
            style={{ color: "var(--muted)" }}
          >
            X
          </button>
        </form>
      ) : (
        <button
          onClick={() => setEditingChance(true)}
          className="text-sm text-left hover:underline"
          style={{ color: "var(--foreground)" }}
          title="Click to edit chance"
        >
          {item.chance}%
        </button>
      )}

      <span className="text-sm" style={{ color: "var(--foreground)" }}>
        {item.item_charges}
      </span>
      <span className="text-sm" style={{ color: "var(--foreground)" }}>
        {item.equip_item ? "Yes" : "No"}
      </span>

      <form
        action={(formData) => {
          startTransition(async () => {
            await removeLootDropItem(formData);
          });
        }}
      >
        <input type="hidden" name="lootdrop_id" value={lootdropId} />
        <input type="hidden" name="item_id" value={item.item_id} />
        <input type="hidden" name="npc_id" value={npcId} />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-red-900"
          style={{ color: "#f87171", opacity: isPending ? 0.5 : 1 }}
          title="Remove item"
        >
          X
        </button>
      </form>
    </>
  );
}

function AddItemForm({
  npcId,
  lootdropId,
}: {
  npcId: number;
  lootdropId: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [itemId, setItemId] = useState("");
  const [chance, setChance] = useState("100");
  const [charges, setCharges] = useState("1");

  return (
    <form
      className="flex items-center gap-2 mt-2 pt-2"
      style={{ borderTop: "1px solid var(--card-border)" }}
      action={(formData) => {
        startTransition(async () => {
          await addLootDropItem(formData);
          setItemId("");
          setChance("100");
          setCharges("1");
        });
      }}
    >
      <input type="hidden" name="lootdrop_id" value={lootdropId} />
      <input type="hidden" name="npc_id" value={npcId} />
      <input
        type="number"
        name="item_id"
        value={itemId}
        onChange={(e) => setItemId(e.target.value)}
        placeholder="Item ID"
        className="w-24 px-2 py-1 text-xs rounded border"
        style={{
          backgroundColor: "var(--input-bg)",
          borderColor: "var(--input-border)",
          color: "var(--foreground)",
        }}
        min="1"
        required
      />
      <input
        type="number"
        name="chance"
        value={chance}
        onChange={(e) => setChance(e.target.value)}
        placeholder="Chance %"
        step="0.01"
        min="0"
        max="100"
        className="w-20 px-2 py-1 text-xs rounded border"
        style={{
          backgroundColor: "var(--input-bg)",
          borderColor: "var(--input-border)",
          color: "var(--foreground)",
        }}
      />
      <input
        type="number"
        name="item_charges"
        value={charges}
        onChange={(e) => setCharges(e.target.value)}
        placeholder="Charges"
        min="0"
        className="w-16 px-2 py-1 text-xs rounded border"
        style={{
          backgroundColor: "var(--input-bg)",
          borderColor: "var(--input-border)",
          color: "var(--foreground)",
        }}
      />
      <button
        type="submit"
        disabled={isPending}
        className="px-3 py-1 text-xs rounded font-medium"
        style={{
          backgroundColor: "var(--accent)",
          color: "#000",
          opacity: isPending ? 0.5 : 1,
        }}
      >
        {isPending ? "Adding..." : "Add Item"}
      </button>
    </form>
  );
}

function CreateLootTableForm({ npcId }: { npcId: number }) {
  const [isPending, startTransition] = useTransition();
  const [tableName, setTableName] = useState(`NPC_${npcId}_Loot`);

  return (
    <div className="text-sm" style={{ color: "var(--muted)" }}>
      <p className="mb-2">This NPC has no loot table assigned.</p>
      <form
        className="flex items-center gap-2"
        action={(formData) => {
          startTransition(async () => {
            await createLootTableForNpc(formData);
          });
        }}
      >
        <input type="hidden" name="npc_id" value={npcId} />
        <input
          type="text"
          name="table_name"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="Table name"
          className="w-48 px-2 py-1 text-xs rounded border"
          style={{
            backgroundColor: "var(--input-bg)",
            borderColor: "var(--input-border)",
            color: "var(--foreground)",
          }}
        />
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1 text-xs rounded font-medium"
          style={{
            backgroundColor: "var(--accent)",
            color: "#000",
            opacity: isPending ? 0.5 : 1,
          }}
        >
          {isPending ? "Creating..." : "Create Loot Table"}
        </button>
      </form>
    </div>
  );
}
