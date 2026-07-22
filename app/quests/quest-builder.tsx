"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { saveQuestFile, searchItems, searchNpcsByZone } from "@/app/actions";
import type { QuestParsed } from "@/lib/quest-parser";

// Types
interface DialogueNode {
  id: string;
  keyword: string;
  response: string;
  actions: QuestAction[];
}

interface QuestAction {
  id: string;
  type: "give_item" | "require_item" | "require_item_value" | "give_cash" | "give_xp" | "set_faction" | "say" | "emote" | "spawn_npc" | "depop" | "cast_spell" | "set_global" | "start_timer";
  params: Record<string, string>;
}

interface QuestEvent {
  id: string;
  type: string;
  dialogues: DialogueNode[];
  actions: QuestAction[];
}

interface QuestData {
  events: QuestEvent[];
}

const EVENT_TYPES = [
  { value: "event_say", label: "Player speaks to NPC", icon: "💬" },
  { value: "event_trade", label: "Player gives item to NPC", icon: "🤝" },
  { value: "event_spawn", label: "NPC spawns into world", icon: "✨" },
  { value: "event_death", label: "NPC is killed", icon: "💀" },
  { value: "event_combat", label: "NPC enters combat", icon: "⚔️" },
  { value: "event_timer", label: "Timer fires", icon: "⏱️" },
  { value: "event_signal", label: "NPC receives signal", icon: "📡" },
  { value: "event_hp", label: "NPC reaches HP threshold", icon: "❤️" },
];

const ACTION_TYPES = [
  { value: "say", label: "NPC says...", fields: [{ key: "text", label: "Text", type: "textarea" }] },
  { value: "emote", label: "NPC emotes...", fields: [{ key: "text", label: "Text", type: "textarea" }] },
  { value: "give_item", label: "Give item to player", fields: [{ key: "item_id", label: "Item", type: "item_search" }, { key: "charges", label: "Qty", type: "number" }] },
  { value: "require_item", label: "Require specific item", fields: [{ key: "item_id", label: "Item", type: "item_search" }, { key: "text", label: "NPC response", type: "textarea" }] },
  { value: "require_item_value", label: "Require any item by value", fields: [{ key: "min_value", label: "Min value (copper)", type: "number" }, { key: "text_success", label: "NPC says on success", type: "textarea" }, { key: "text_fail", label: "NPC says if too cheap", type: "textarea" }] },
  { value: "give_cash", label: "Give cash", fields: [{ key: "platinum", label: "PP", type: "number" }, { key: "gold", label: "GP", type: "number" }, { key: "silver", label: "SP", type: "number" }, { key: "copper", label: "CP", type: "number" }] },
  { value: "give_xp", label: "Give experience", fields: [{ key: "amount", label: "XP Amount", type: "number" }] },
  { value: "set_faction", label: "Adjust faction", fields: [{ key: "faction_id", label: "Faction ID", type: "number" }, { key: "amount", label: "Amount", type: "number" }] },
  { value: "cast_spell", label: "Cast spell on player", fields: [{ key: "spell_id", label: "Spell ID", type: "number" }] },
  { value: "depop", label: "Despawn NPC", fields: [] },
  { value: "set_global", label: "Set quest global", fields: [{ key: "name", label: "Name", type: "text" }, { key: "value", label: "Value", type: "text" }] },
  { value: "start_timer", label: "Start timer", fields: [{ key: "name", label: "Timer Name", type: "text" }, { key: "ms", label: "Milliseconds", type: "number" }] },
];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Generate Lua from quest data
function generateLua(data: QuestData): string {
  const lines: string[] = [];

  for (const event of data.events) {
    if (event.type === "event_say") {
      lines.push(`function event_say(e)`);
      for (let i = 0; i < event.dialogues.length; i++) {
        const dlg = event.dialogues[i];
        const kw = dlg.keyword.toLowerCase();
        const prefix = i === 0 ? "  if" : "  elseif";

        // Build say links from other dialogue keywords
        const otherKeywords = event.dialogues
          .filter(d => d.id !== dlg.id)
          .map(d => d.keyword);

        let response = dlg.response;
        // Auto-linkify keywords mentioned in brackets
        for (const ok of otherKeywords) {
          const bracketPattern = new RegExp(`\\[${ok}\\]`, "gi");
          response = response.replace(bracketPattern, `' .. eq.say_link("${ok}") .. '`);
        }

        lines.push(`${prefix} e.message:findi("${kw}") then`);
        if (dlg.response) {
          lines.push(`    e.self:Say("${escapeLua(response)}")`);
        }
        for (const action of dlg.actions) {
          lines.push(...generateActionLua(action, "    "));
        }
      }
      if (event.dialogues.length > 0) {
        lines.push(`  end`);
      }
      // Top-level actions for event_say
      for (const action of event.actions) {
        lines.push(...generateActionLua(action, "  "));
      }
      lines.push(`end`);
    } else if (event.type === "event_trade") {
      lines.push(`function event_trade(e)`);
      lines.push(`  local item_lib = require("items")`);

      const hasValueCheck = event.actions.some(a => a.type === "require_item_value");
      const hasItemCheck = event.actions.some(a => a.type === "require_item");
      const rewardActions = event.actions.filter(a => a.type !== "require_item" && a.type !== "require_item_value");

      if (hasValueCheck) {
        const valueAction = event.actions.find(a => a.type === "require_item_value")!;
        const minVal = valueAction.params.min_value || "100";
        lines.push(``);
        lines.push(`  -- Calculate total value of turned-in items`);
        lines.push(`  local total_value = 0`);
        lines.push(`  for item_id, count in pairs(e.trade) do`);
        lines.push(`    if item_id > 0 and type(count) == "number" and count > 0 then`);
        lines.push(`      local price = e.self:GetItemStat(item_id, "price") or 0`);
        lines.push(`      total_value = total_value + (price * count)`);
        lines.push(`    end`);
        lines.push(`  end`);
        lines.push(``);
        lines.push(`  if total_value >= ${minVal} then`);
        if (valueAction.params.text_success) {
          lines.push(`    e.self:Say("${escapeLua(valueAction.params.text_success)}")`);
        }
        for (const ga of rewardActions) {
          lines.push(...generateActionLua(ga, "    "));
        }
        lines.push(`  else`);
        if (valueAction.params.text_fail) {
          lines.push(`    e.self:Say("${escapeLua(valueAction.params.text_fail)}")`);
        }
        lines.push(`  end`);
      } else if (hasItemCheck) {
        for (const action of event.actions) {
          if (action.type === "require_item") {
            lines.push(`  if item_lib.check_turn_in(e.trade, {item1 = ${action.params.item_id || 0}}) then`);
            if (action.params.text) {
              lines.push(`    e.self:Say("${escapeLua(action.params.text)}")`);
            }
            for (const ga of rewardActions) {
              lines.push(...generateActionLua(ga, "    "));
            }
            lines.push(`  end`);
          }
        }
      }

      lines.push(`  item_lib.return_items(e.self, e.other, e.trade)`);
      lines.push(`end`);
    } else {
      lines.push(`function ${event.type}(e)`);
      for (const action of event.actions) {
        lines.push(...generateActionLua(action, "  "));
      }
      lines.push(`end`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function generateActionLua(action: QuestAction, indent: string): string[] {
  const p = action.params;
  switch (action.type) {
    case "say":
      return [`${indent}e.self:Say("${escapeLua(p.text || "")}")`];
    case "emote":
      return [`${indent}e.self:Emote("${escapeLua(p.text || "")}")`];
    case "give_item":
      return [`${indent}e.other:SummonItem(${p.item_id || 0})${p.item_name ? ` -- Item: ${p.item_name}` : ""}`];
    case "give_cash":
      return [`${indent}e.other:AddMoneyToPP(${p.copper || 0}, ${p.silver || 0}, ${p.gold || 0}, ${p.platinum || 0})`];
    case "give_xp":
      return [`${indent}e.other:AddEXP(${p.amount || 0})`];
    case "set_faction":
      return [`${indent}e.other:SetFactionLevel2(e.other:CharacterID(), ${p.faction_id || 0}, 0, 0, 0, 0, 0)`];
    case "cast_spell":
      return [`${indent}e.self:CastSpell(${p.spell_id || 0}, e.other:GetID())`];
    case "depop":
      return [`${indent}eq.depop()`];
    case "set_global":
      return [`${indent}eq.set_global("${p.name || ""}", "${p.value || ""}", 5, "F")`];
    case "start_timer":
      return [`${indent}eq.set_timer("${p.name || ""}", ${p.ms || 1000})`];
    case "require_item":
      return []; // handled in event_trade
    default:
      return [];
  }
}

function escapeLua(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// Item search dropdown component
function ItemSearchField({ value, itemName, onChange }: {
  value: string;
  itemName: string;
  onChange: (id: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: number; Name: string }[]>([]);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };

  const doSearch = (term: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (term.length < 2) { setResults([]); setShowResults(false); return; }
    debounceRef.current = setTimeout(async () => {
      const items = await searchItems(term);
      setResults(items);
      setShowResults(true);
    }, 200);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value ? `[${value}] ${itemName}` : query}
        onChange={(e) => {
          if (value) { onChange("", ""); }
          setQuery(e.target.value);
          doSearch(e.target.value);
        }}
        onFocus={() => { if (results.length > 0) setShowResults(true); }}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        placeholder="Search item..."
        className="w-full px-2 py-1 text-xs rounded border"
        style={{ backgroundColor: "var(--input-bg)", borderColor: value ? "var(--accent)" : "var(--input-border)", color: "var(--foreground)" }}
      />
      {showResults && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 rounded border overflow-auto z-50" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", maxHeight: "160px" }}>
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full text-left px-2 py-1 text-xs hover:bg-white/10 flex justify-between"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(item.id.toString(), item.Name);
                setQuery("");
                setShowResults(false);
              }}
            >
              <span style={{ color: "var(--accent)" }}>{item.Name}</span>
              <span style={{ color: "var(--muted)" }}>#{item.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parsedToBuilderData(parsed: QuestParsed): QuestData {
  const events: QuestEvent[] = [];

  // Group parsed events
  const eventNames = new Set(parsed.events.map(e => e.name));

  // Build event_say
  if (eventNames.has("event_say") || eventNames.has("EVENT_SAY")) {
    const dialogues: DialogueNode[] = parsed.dialogues.map(dlg => ({
      id: uid(),
      keyword: dlg.trigger,
      response: dlg.text,
      actions: [],
    }));
    events.push({ id: uid(), type: "event_say", dialogues, actions: [] });
  }

  // Build event_trade from parsed items
  if (eventNames.has("event_trade") || eventNames.has("EVENT_ITEM")) {
    const actions: QuestAction[] = [];
    for (const item of parsed.items) {
      actions.push({
        id: uid(),
        type: "require_item",
        params: { item_id: item.id.toString(), item_name: item.name || "", text: "" },
      });
    }
    events.push({ id: uid(), type: "event_trade", dialogues: [], actions });
  }

  // Other events
  for (const evt of parsed.events) {
    const name = evt.name.toLowerCase();
    if (name === "event_say" || name === "event_trade" || name === "event_item") continue;
    if (events.some(e => e.type === name)) continue;
    events.push({ id: uid(), type: name, dialogues: [], actions: [] });
  }

  return { events };
}

// Main component
export function QuestBuilder({
  zone,
  filePath,
  initialCode,
  parsedData,
}: {
  zone: string;
  filePath?: string;
  initialCode?: string;
  parsedData?: QuestParsed | null;
}) {
  const [data, setData] = useState<QuestData>(() => {
    if (parsedData && (parsedData.events.length > 0 || parsedData.dialogues.length > 0)) {
      return parsedToBuilderData(parsedData);
    }
    return { events: [] };
  });
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [npcName, setNpcName] = useState(
    filePath?.split("/").pop()?.replace(/\.(lua|pl|qst)$/, "") || ""
  );
  const [npcSearch, setNpcSearch] = useState("");
  const [npcResults, setNpcResults] = useState<{ id: number; name: string }[]>([]);
  const [showNpcPicker, setShowNpcPicker] = useState(!filePath && !npcName);
  const [npcId, setNpcId] = useState<number | null>(null);

  const generatedCode = generateLua(data);
  const savePath = filePath || `/home/eqemu/server/quests/${zone}/${npcName || "new_npc"}.lua`;

  // Load NPCs for zone on mount
  const loadedZone = useRef("");
  useEffect(() => {
    if (zone && zone !== loadedZone.current && !filePath) {
      loadedZone.current = zone;
      searchNpcsByZone(zone, "").then(setNpcResults);
    }
  }, [zone, filePath]);

  function handleNpcSearch(term: string) {
    setNpcSearch(term);
    searchNpcsByZone(zone, term).then(setNpcResults);
  }

  function selectNpc(npc: { id: number; name: string }) {
    // Convert NPC name to filename format: "Guard_Tolus" from "Guard_Tolus" or "#Guard_Tolus"
    const cleanName = npc.name.replace(/^#/, "");
    setNpcName(cleanName);
    setNpcId(npc.id);
    setShowNpcPicker(false);
  }

  function addEvent() {
    setData(prev => ({
      events: [...prev.events, { id: uid(), type: "event_say", dialogues: [], actions: [] }],
    }));
  }

  function updateEvent(eventId: string, updates: Partial<QuestEvent>) {
    setData(prev => ({
      events: prev.events.map(e => e.id === eventId ? { ...e, ...updates } : e),
    }));
  }

  function removeEvent(eventId: string) {
    setData(prev => ({ events: prev.events.filter(e => e.id !== eventId) }));
  }

  function addDialogue(eventId: string, keyword?: string) {
    setData(prev => ({
      events: prev.events.map(e =>
        e.id === eventId
          ? { ...e, dialogues: [...e.dialogues, { id: uid(), keyword: keyword || "hail", response: "", actions: [] }] }
          : e
      ),
    }));
  }

  function updateDialogue(eventId: string, dlgId: string, updates: Partial<DialogueNode>) {
    setData(prev => ({
      events: prev.events.map(e =>
        e.id === eventId
          ? { ...e, dialogues: e.dialogues.map(d => d.id === dlgId ? { ...d, ...updates } : d) }
          : e
      ),
    }));
  }

  function removeDialogue(eventId: string, dlgId: string) {
    setData(prev => ({
      events: prev.events.map(e =>
        e.id === eventId
          ? { ...e, dialogues: e.dialogues.filter(d => d.id !== dlgId) }
          : e
      ),
    }));
  }

  function addAction(eventId: string, dlgId?: string, actionType?: string) {
    const newAction: QuestAction = { id: uid(), type: (actionType || "say") as QuestAction["type"], params: {} };
    setData(prev => ({
      events: prev.events.map(e => {
        if (e.id !== eventId) return e;
        if (dlgId) {
          return { ...e, dialogues: e.dialogues.map(d => d.id === dlgId ? { ...d, actions: [...d.actions, newAction] } : d) };
        }
        return { ...e, actions: [...e.actions, newAction] };
      }),
    }));
  }

  function updateAction(eventId: string, actionId: string, updates: Partial<QuestAction>, dlgId?: string) {
    setData(prev => ({
      events: prev.events.map(e => {
        if (e.id !== eventId) return e;
        if (dlgId) {
          return {
            ...e,
            dialogues: e.dialogues.map(d =>
              d.id === dlgId
                ? { ...d, actions: d.actions.map(a => a.id === actionId ? { ...a, ...updates } : a) }
                : d
            ),
          };
        }
        return { ...e, actions: e.actions.map(a => a.id === actionId ? { ...a, ...updates } : a) };
      }),
    }));
  }

  function removeAction(eventId: string, actionId: string, dlgId?: string) {
    setData(prev => ({
      events: prev.events.map(e => {
        if (e.id !== eventId) return e;
        if (dlgId) {
          return { ...e, dialogues: e.dialogues.map(d => d.id === dlgId ? { ...d, actions: d.actions.filter(a => a.id !== actionId) } : d) };
        }
        return { ...e, actions: e.actions.filter(a => a.id !== actionId) };
      }),
    }));
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("filePath", savePath);
    formData.set("content", generatedCode);
    startTransition(async () => {
      await saveQuestFile(formData);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-2 border-b" style={{ borderColor: "var(--card-border)" }}>
        <div className="flex items-center justify-between gap-2">
          {npcName && !showNpcPicker ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                {npcName.replace(/_/g, " ")}
              </span>
              {npcId && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--muted)" }}>
                  NPC #{npcId}
                </span>
              )}
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                → {zone}/{npcName}.lua
              </span>
              <button
                type="button"
                onClick={() => setShowNpcPicker(true)}
                className="text-xs underline"
                style={{ color: "var(--muted)" }}
              >
                change
              </button>
            </div>
          ) : (
            <span className="text-xs" style={{ color: "var(--muted)" }}>Select an NPC for this quest</span>
          )}
          <div className="flex items-center gap-2">
            {npcName && (
              <button
                type="button"
                onClick={() => setPreview(!preview)}
                className="px-2 py-1 text-xs rounded"
                style={{ backgroundColor: "var(--input-bg)", color: "var(--foreground)" }}
              >
                {preview ? "Builder" : "Preview Code"}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !npcName || data.events.length === 0}
              className="px-3 py-1 text-xs rounded font-medium"
              style={{
                backgroundColor: saved ? "#4ade80" : "var(--accent)",
                color: "#000",
                opacity: isPending || !npcName || data.events.length === 0 ? 0.5 : 1,
              }}
            >
              {isPending ? "Saving..." : saved ? "Saved!" : "Save Quest"}
            </button>
          </div>
        </div>
      </div>

      {showNpcPicker || !npcName ? (
        /* NPC Picker */
        <div className="p-3">
          <div className="mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
              Select NPC in {zone}
            </span>
          </div>
          <input
            type="text"
            value={npcSearch}
            onChange={(e) => handleNpcSearch(e.target.value)}
            placeholder="Search NPCs in this zone..."
            className="w-full px-2 py-1.5 text-xs rounded border mb-2"
            style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
            autoFocus
          />
          <div className="rounded border overflow-y-auto" style={{ backgroundColor: "var(--background)", borderColor: "var(--card-border)", maxHeight: "400px" }}>
            {npcResults.length === 0 ? (
              <div className="p-3 text-xs text-center" style={{ color: "var(--muted)" }}>No NPCs found in this zone</div>
            ) : (
              npcResults.map((npc) => (
                <button
                  key={npc.id}
                  type="button"
                  onClick={() => selectNpc(npc)}
                  className="w-full text-left px-3 py-1.5 text-xs border-b hover:bg-white/5 flex justify-between items-center"
                  style={{ borderColor: "var(--card-border)", color: "var(--foreground)" }}
                >
                  <span style={{ color: "var(--accent)" }}>{npc.name.replace(/_/g, " ").replace(/^#/, "")}</span>
                  <span style={{ color: "var(--muted)" }}>#{npc.id}</span>
                </button>
              ))
            )}
          </div>
          <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--card-border)" }}>
            <span className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Or enter a custom NPC name:</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={npcName}
                onChange={(e) => setNpcName(e.target.value)}
                placeholder="Custom_NPC_Name"
                className="flex-1 px-2 py-1 text-xs rounded border font-mono"
                style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
              />
              <button
                type="button"
                onClick={() => { if (npcName) setShowNpcPicker(false); }}
                disabled={!npcName}
                className="px-3 py-1 text-xs rounded font-medium"
                style={{ backgroundColor: "var(--accent)", color: "#000", opacity: npcName ? 1 : 0.5 }}
              >
                Use This Name
              </button>
            </div>
          </div>
        </div>
      ) : preview ? (
        /* Code Preview */
        <pre className="flex-1 p-3 overflow-auto font-mono text-xs" style={{ backgroundColor: "var(--input-bg)", color: "var(--foreground)", tabSize: 2 }}>
          {generatedCode || "-- Add events to generate code"}
        </pre>
      ) : (
        /* Builder */
        <div className="flex-1 p-3 overflow-y-auto" style={{ maxHeight: "calc(80vh - 50px)" }}>
          {data.events.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>
                Start building your quest by adding an event.
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                Events are triggers — what causes the quest logic to run.
              </p>
            </div>
          )}

          {data.events.map((event) => (
            <EventBlock
              key={event.id}
              event={event}
              allEvents={data.events}
              onUpdate={(u) => updateEvent(event.id, u)}
              onRemove={() => removeEvent(event.id)}
              onAddDialogue={(keyword) => addDialogue(event.id, keyword)}
              onUpdateDialogue={(dlgId, u) => updateDialogue(event.id, dlgId, u)}
              onRemoveDialogue={(dlgId) => removeDialogue(event.id, dlgId)}
              onAddAction={(dlgId, actionType) => addAction(event.id, dlgId, actionType)}
              onUpdateAction={(actionId, u, dlgId) => updateAction(event.id, actionId, u, dlgId)}
              onRemoveAction={(actionId, dlgId) => removeAction(event.id, actionId, dlgId)}
            />
          ))}

          {/* Smart suggestions */}
          {data.events.some(e => e.type === "event_say") && !data.events.some(e => e.type === "event_trade") && (
            <button
              type="button"
              onClick={() => {
                setData(prev => ({
                  events: [...prev.events, {
                    id: uid(),
                    type: "event_trade",
                    dialogues: [],
                    actions: [
                      { id: uid(), type: "require_item", params: {} },
                      { id: uid(), type: "say", params: { text: "Thank you! Here is your reward." } },
                    ],
                  }],
                }));
              }}
              className="w-full py-2 mb-2 rounded border text-xs"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", backgroundColor: "rgba(212, 168, 67, 0.1)" }}
            >
              + Add Item Turn-in (player gives item → NPC gives reward)
            </button>
          )}

          <button
            type="button"
            onClick={addEvent}
            className="w-full py-2 rounded border border-dashed text-xs"
            style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
          >
            + Add Other Event
          </button>
        </div>
      )}
    </div>
  );
}

// Event block component
function EventBlock({
  event,
  allEvents,
  onUpdate,
  onRemove,
  onAddDialogue,
  onUpdateDialogue,
  onRemoveDialogue,
  onAddAction,
  onUpdateAction,
  onRemoveAction,
}: {
  event: QuestEvent;
  allEvents: QuestEvent[];
  onUpdate: (u: Partial<QuestEvent>) => void;
  onRemove: () => void;
  onAddDialogue: (keyword?: string) => void;
  onUpdateDialogue: (dlgId: string, u: Partial<DialogueNode>) => void;
  onRemoveDialogue: (dlgId: string) => void;
  onAddAction: (dlgId?: string, actionType?: string) => void;
  onUpdateAction: (actionId: string, u: Partial<QuestAction>, dlgId?: string) => void;
  onRemoveAction: (actionId: string, dlgId?: string) => void;
}) {
  const eventInfo = EVENT_TYPES.find(t => t.value === event.type);
  const showDialogues = event.type === "event_say";

  return (
    <div className="mb-3 rounded border" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--background)" }}>
      {/* Event header */}
      <div className="p-2 flex items-center justify-between" style={{ borderBottom: "1px solid var(--card-border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{eventInfo?.icon}</span>
          <select
            value={event.type}
            onChange={(e) => onUpdate({ type: e.target.value })}
            className="text-xs rounded border px-1 py-0.5"
            style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
          >
            {EVENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <button onClick={onRemove} className="text-xs px-1.5 py-0.5 rounded hover:bg-red-900" style={{ color: "#f87171" }}>
          Remove
        </button>
      </div>

      <div className="p-2 space-y-2">
        {/* Dialogue branches (for event_say) */}
        {showDialogues && (() => {
          // Find all [keywords] referenced in responses
          const existingKeywords = new Set(event.dialogues.map(d => d.keyword.toLowerCase()));
          const allLinkedKeywords = new Set<string>();
          for (const dlg of event.dialogues) {
            const matches = dlg.response.matchAll(/\[(\w+)\]/g);
            for (const m of matches) allLinkedKeywords.add(m[1].toLowerCase());
          }
          const missingKeywords = [...allLinkedKeywords].filter(k => !existingKeywords.has(k));

          return (
            <>
              {event.dialogues.length === 0 && (
                <div className="text-xs p-2 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--muted)" }}>
                  Start by adding a dialogue branch. The first one is usually <strong>hail</strong> — what happens when the player greets this NPC.
                </div>
              )}

              {event.dialogues.map((dlg, idx) => {
                // Find keywords in THIS response that link to other branches
                const linkedInResponse = [...(dlg.response.matchAll(/\[(\w+)\]/g))].map(m => m[1]);
                const hasLinks = linkedInResponse.length > 0;

                return (
                  <div key={dlg.id}>
                    {/* Step indicator */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--accent)", color: "#000", fontWeight: 700 }}>
                        {idx + 1}
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        Player says <strong style={{ color: "var(--accent)" }}>&quot;{dlg.keyword}&quot;</strong>
                        {idx === 0 && dlg.keyword.toLowerCase() === "hail" && " (greets the NPC)"}
                      </span>
                      <button onClick={() => onRemoveDialogue(dlg.id)} className="ml-auto text-xs" style={{ color: "#f87171" }}>×</button>
                    </div>

                    <div className="rounded border p-2 ml-4" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)", borderLeft: "3px solid var(--accent)" }}>
                      {/* Keyword input */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs" style={{ color: "var(--muted)" }}>Trigger keyword:</span>
                        <input
                          type="text"
                          value={dlg.keyword}
                          onChange={(e) => onUpdateDialogue(dlg.id, { keyword: e.target.value })}
                          placeholder="keyword"
                          className="px-2 py-0.5 text-xs rounded border w-28 font-mono"
                          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--accent)", color: "var(--accent)" }}
                        />
                      </div>

                      {/* Response */}
                      <div className="mb-1.5">
                        <span className="text-xs block mb-0.5" style={{ color: "var(--muted)" }}>
                          NPC responds:
                          {!hasLinks && <span className="ml-1" style={{ fontStyle: "italic" }}>(tip: use [keyword] to add clickable options for the player)</span>}
                        </span>
                        <textarea
                          value={dlg.response}
                          onChange={(e) => onUpdateDialogue(dlg.id, { response: e.target.value })}
                          placeholder='Example: "Welcome traveler! Would you like to [help] me with something? Or perhaps you want to [trade]?"'
                          className="w-full px-2 py-1 text-xs rounded border resize-none"
                          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)", minHeight: "50px" }}
                        />
                      </div>

                      {/* Show linked keywords */}
                      {hasLinks && (
                        <div className="mb-1.5 flex flex-wrap gap-1 items-center">
                          <span className="text-xs" style={{ color: "var(--muted)" }}>Links to:</span>
                          {linkedInResponse.map((kw, ki) => {
                            const exists = existingKeywords.has(kw.toLowerCase());
                            return (
                              <span key={ki} className="text-xs px-1.5 py-0.5 rounded font-mono flex items-center gap-1" style={{
                                backgroundColor: exists ? "var(--input-bg)" : "#2a1a1a",
                                color: exists ? "var(--accent)" : "#f87171",
                                border: exists ? "1px solid var(--card-border)" : "1px solid #5a2a2a",
                              }}>
                                [{kw}]
                                {exists ? " ✓" : (
                                  <button
                                    type="button"
                                    onClick={() => onAddDialogue(kw)}
                                    className="text-xs underline ml-0.5"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    create
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Actions within this dialogue */}
                      {dlg.actions.map((action) => (
                        <ActionBlock
                          key={action.id}
                          action={action}
                          onUpdate={(u) => onUpdateAction(action.id, u, dlg.id)}
                          onRemove={() => onRemoveAction(action.id, dlg.id)}
                        />
                      ))}

                      <button
                        type="button"
                        onClick={() => onAddAction(dlg.id)}
                        className="text-xs px-2 py-0.5 rounded border border-dashed mt-1"
                        style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
                      >
                        + Add Action (give item, XP, cash, etc.)
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Missing keyword warning */}
              {missingKeywords.length > 0 && (
                <div className="rounded border p-2" style={{ backgroundColor: "#2a1a1a", borderColor: "#5a2a2a" }}>
                  <span className="text-xs" style={{ color: "#f87171" }}>Missing dialogue branches:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {missingKeywords.map(kw => (
                      <button
                        key={kw}
                        type="button"
                        onClick={() => onAddDialogue(kw)}
                        className="text-xs px-2 py-0.5 rounded font-mono"
                        style={{ backgroundColor: "var(--accent)", color: "#000" }}
                      >
                        + Create [{kw}] branch
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => onAddDialogue()}
                className="text-xs px-2 py-1 rounded border border-dashed w-full"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                + Add Dialogue Branch
              </button>
            </>
          );
        })()}

        {/* Trade event - special UI */}
        {event.type === "event_trade" && (() => {
          const requireItem = event.actions.filter(a => a.type === "require_item");
          const requireValue = event.actions.filter(a => a.type === "require_item_value");
          const rewardActions = event.actions.filter(a => a.type !== "require_item" && a.type !== "require_item_value");
          const hasRequirement = requireItem.length > 0 || requireValue.length > 0;

          return (
            <div className="space-y-2">
              {/* Requirement section */}
              <div className="rounded border p-2" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)", borderLeft: "3px solid #f59e0b" }}>
                <div className="text-xs font-semibold mb-1.5" style={{ color: "#f59e0b" }}>What must the player give?</div>

                {/* Specific item requirements */}
                {requireItem.map((action) => (
                  <div key={action.id} className="mb-1.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--muted)" }}>Specific item:</span>
                      <div className="flex-1">
                        <ItemSearchField
                          value={action.params.item_id || ""}
                          itemName={action.params.item_name || ""}
                          onChange={(id, name) => onUpdateAction(action.id, { params: { ...action.params, item_id: id, item_name: name } })}
                        />
                      </div>
                      <button onClick={() => onRemoveAction(action.id)} className="text-xs shrink-0" style={{ color: "#f87171" }}>×</button>
                    </div>
                  </div>
                ))}

                {/* Value-based requirements */}
                {requireValue.map((action) => (
                  <div key={action.id} className="mb-1.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--input-bg)", color: "var(--muted)" }}>Any item worth at least:</span>
                      <input
                        type="number"
                        value={action.params.min_value || ""}
                        onChange={(e) => onUpdateAction(action.id, { params: { ...action.params, min_value: e.target.value } })}
                        placeholder="100"
                        className="w-24 px-2 py-0.5 text-xs rounded border"
                        style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
                      />
                      <span className="text-xs" style={{ color: "var(--muted)" }}>copper</span>
                      <button onClick={() => onRemoveAction(action.id)} className="text-xs shrink-0 ml-auto" style={{ color: "#f87171" }}>×</button>
                    </div>
                  </div>
                ))}

                {/* Add requirement buttons */}
                {!hasRequirement && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onAddAction(undefined, "require_item")}
                      className="flex-1 text-xs px-2 py-1.5 rounded border border-dashed"
                      style={{ borderColor: "#f59e0b", color: "#f59e0b" }}
                    >
                      Specific Item (e.g. Crushbone Belt)
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddAction(undefined, "require_item_value")}
                      className="flex-1 text-xs px-2 py-1.5 rounded border border-dashed"
                      style={{ borderColor: "#f59e0b", color: "#f59e0b" }}
                    >
                      Any Item by Value (e.g. worth 100+ copper)
                    </button>
                  </div>
                )}
              </div>

              {/* Response + Rewards section */}
              {hasRequirement && (
                <div className="rounded border p-2" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)", borderLeft: "3px solid var(--accent)" }}>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--accent)" }}>
                    When accepted — NPC response + rewards
                  </div>

                  {/* NPC response text for specific item */}
                  {requireItem.map((action) => (
                    <div key={`say-${action.id}`} className="mb-1.5">
                      <span className="text-xs" style={{ color: "var(--muted)" }}>NPC says on success:</span>
                      <textarea
                        value={action.params.text || ""}
                        onChange={(e) => onUpdateAction(action.id, { params: { ...action.params, text: e.target.value } })}
                        placeholder="Thank you for bringing me this item!"
                        className="w-full px-2 py-1 text-xs rounded border resize-none mt-0.5"
                        style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)", minHeight: "36px" }}
                      />
                    </div>
                  ))}

                  {/* NPC response text for value-based */}
                  {requireValue.map((action) => (
                    <div key={`val-${action.id}`} className="space-y-1.5">
                      <div>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>NPC says if item is valuable enough:</span>
                        <textarea
                          value={action.params.text_success || ""}
                          onChange={(e) => onUpdateAction(action.id, { params: { ...action.params, text_success: e.target.value } })}
                          placeholder="Excellent! This is worth something. Here is your payment."
                          className="w-full px-2 py-1 text-xs rounded border resize-none mt-0.5"
                          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)", minHeight: "36px" }}
                        />
                      </div>
                      <div>
                        <span className="text-xs" style={{ color: "#f87171" }}>NPC says if item is too cheap:</span>
                        <textarea
                          value={action.params.text_fail || ""}
                          onChange={(e) => onUpdateAction(action.id, { params: { ...action.params, text_fail: e.target.value } })}
                          placeholder="This is worthless to me. Take it back."
                          className="w-full px-2 py-1 text-xs rounded border resize-none mt-0.5"
                          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--foreground)", minHeight: "36px" }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Reward actions */}
                  {rewardActions.map((action) => (
                    <ActionBlock
                      key={action.id}
                      action={action}
                      onUpdate={(u) => onUpdateAction(action.id, u)}
                      onRemove={() => onRemoveAction(action.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => onAddAction()}
                    className="text-xs px-2 py-0.5 rounded border border-dashed mt-1"
                    style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
                  >
                    + Add Reward (give item, cash, XP, etc.)
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Actions (for other events, not say or trade) */}
        {!showDialogues && event.type !== "event_trade" && (
          <>
            {event.actions.map((action) => (
              <ActionBlock
                key={action.id}
                action={action}
                onUpdate={(u) => onUpdateAction(action.id, u)}
                onRemove={() => onRemoveAction(action.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => onAddAction()}
              className="text-xs px-2 py-1 rounded border border-dashed w-full"
              style={{ borderColor: "var(--muted)", color: "var(--muted)" }}
            >
              + Add Action
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Action block component
function ActionBlock({
  action,
  onUpdate,
  onRemove,
}: {
  action: QuestAction;
  onUpdate: (u: Partial<QuestAction>) => void;
  onRemove: () => void;
}) {
  const actionDef = ACTION_TYPES.find(t => t.value === action.type);

  return (
    <div className="flex items-start gap-2 rounded p-1.5 mb-1" style={{ backgroundColor: "var(--input-bg)" }}>
      <select
        value={action.type}
        onChange={(e) => onUpdate({ type: e.target.value as QuestAction["type"], params: {} })}
        className="text-xs rounded border px-1 py-0.5 shrink-0"
        style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
      >
        {ACTION_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <div className="flex-1 flex flex-wrap gap-1.5">
        {actionDef?.fields.map((field) => (
          <div key={field.key} className="flex-1" style={{ minWidth: field.type === "textarea" ? "100%" : "60px" }}>
            {field.type === "textarea" ? (
              <textarea
                value={action.params[field.key] || ""}
                onChange={(e) => onUpdate({ params: { ...action.params, [field.key]: e.target.value } })}
                placeholder={field.label}
                className="w-full px-2 py-1 text-xs rounded border resize-none"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--input-border)", color: "var(--foreground)", minHeight: "32px" }}
              />
            ) : field.type === "item_search" ? (
              <ItemSearchField
                value={action.params[field.key] || ""}
                itemName={action.params.item_name || ""}
                onChange={(id, name) => onUpdate({ params: { ...action.params, [field.key]: id, item_name: name } })}
              />
            ) : (
              <input
                type={field.type}
                value={action.params[field.key] || ""}
                onChange={(e) => onUpdate({ params: { ...action.params, [field.key]: e.target.value } })}
                placeholder={field.label}
                className="w-full px-2 py-0.5 text-xs rounded border"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--input-border)", color: "var(--foreground)" }}
              />
            )}
          </div>
        ))}
      </div>

      <button onClick={onRemove} className="text-xs shrink-0" style={{ color: "#f87171" }}>×</button>
    </div>
  );
}
