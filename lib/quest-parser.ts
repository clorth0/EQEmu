// Parse quest script files (Lua and Perl) to extract structured info

export interface QuestRef {
  type: "item" | "npc" | "spell";
  id: number;
  name?: string;
  context: string; // the line or snippet where it was found
}

export interface QuestEvent {
  name: string;
  label: string;
  lineNumber: number;
}

export interface QuestDialogue {
  trigger: string; // "hail", keyword, etc.
  text: string;
  lineNumber: number;
}

export interface QuestParsed {
  events: QuestEvent[];
  items: QuestRef[];
  npcs: QuestRef[];
  spells: QuestRef[];
  dialogues: QuestDialogue[];
  language: "lua" | "perl" | "unknown";
}

const EVENT_LABELS: Record<string, string> = {
  event_say: "Player speaks to NPC",
  event_trade: "Player gives item to NPC",
  event_combat: "NPC enters/leaves combat",
  event_slay: "NPC kills a player",
  event_death: "NPC dies",
  event_spawn: "NPC spawns",
  event_timer: "Timer fires",
  event_signal: "NPC receives signal",
  event_waypoint_arrive: "NPC arrives at waypoint",
  event_hp: "NPC reaches HP threshold",
  event_enter: "Player enters proximity",
  event_exit: "Player exits proximity",
  event_aggro: "NPC aggros",
  event_attack: "NPC is attacked",
  EVENT_SAY: "Player speaks to NPC",
  EVENT_ITEM: "Player gives item to NPC",
  EVENT_DEATH: "NPC dies",
  EVENT_SPAWN: "NPC spawns",
  EVENT_COMBAT: "NPC enters/leaves combat",
  EVENT_TIMER: "Timer fires",
  EVENT_SIGNAL: "NPC receives signal",
  EVENT_SLAY: "NPC kills a player",
  EVENT_HP: "NPC reaches HP threshold",
  EVENT_WAYPOINT: "NPC arrives at waypoint",
  EVENT_AGGRO: "NPC aggros",
  EVENT_ATTACK: "NPC is attacked",
  EVENT_ENTER: "Player enters proximity",
  EVENT_EXIT: "Player exits proximity",
};

export function parseQuest(content: string, fileName: string): QuestParsed {
  const isLua = fileName.endsWith(".lua");
  const isPerl = fileName.endsWith(".pl");
  const language = isLua ? "lua" : isPerl ? "perl" : "unknown";

  const lines = content.split("\n");
  const events: QuestEvent[] = [];
  const items: QuestRef[] = [];
  const npcs: QuestRef[] = [];
  const spells: QuestRef[] = [];
  const dialogues: QuestDialogue[] = [];
  const seenItems = new Set<number>();
  const seenNpcs = new Set<number>();
  const seenSpells = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Detect events
    if (isLua) {
      const luaEvent = line.match(/^function\s+(event_\w+)/);
      if (luaEvent) {
        events.push({
          name: luaEvent[1],
          label: EVENT_LABELS[luaEvent[1]] || luaEvent[1],
          lineNumber: lineNum,
        });
      }
    } else if (isPerl) {
      const perlEvent = line.match(/^sub\s+(EVENT_\w+)/);
      if (perlEvent) {
        events.push({
          name: perlEvent[1],
          label: EVENT_LABELS[perlEvent[1]] || perlEvent[1],
          lineNumber: lineNum,
        });
      }
    }

    // Extract item IDs — various patterns
    // Lua: item1 = 41000, SummonItem(40999), item_id = 1234, check_turn_in({item1 = 41000})
    // Perl: quest::summonitem(1234), plugin::check_handin, item references
    const itemPatterns = [
      /item\d?\s*=\s*(\d{4,})/gi,
      /SummonItem\((\d+)\)/gi,
      /summonitem\((\d+)\)/gi,
      /item_id\s*(?:=|==)\s*(\d{4,})/gi,
      /quest::(?:summonitem|givecash_item)\((\d+)/gi,
    ];

    for (const pat of itemPatterns) {
      let m;
      while ((m = pat.exec(line)) !== null) {
        const id = parseInt(m[1], 10);
        if (id > 0 && !seenItems.has(id)) {
          seenItems.add(id);
          const comment = line.match(/--\s*Item:\s*(.+)|#\s*Item:\s*(.+)/i);
          items.push({
            type: "item",
            id,
            name: comment ? (comment[1] || comment[2])?.trim() : undefined,
            context: line.trim(),
          });
        }
      }
    }

    // Extract NPC/spawn IDs
    const npcPatterns = [
      /(?:eq\.)?spawn2?\((\d{4,})/gi,
      /npcid\s*(?:=|==)\s*(\d{4,})/gi,
    ];
    for (const pat of npcPatterns) {
      let m;
      while ((m = pat.exec(line)) !== null) {
        const id = parseInt(m[1], 10);
        if (id > 0 && !seenNpcs.has(id)) {
          seenNpcs.add(id);
          const comment = line.match(/--\s*NPC:\s*(.+)|#\s*NPC:\s*(.+)/i);
          npcs.push({
            type: "npc",
            id,
            name: comment ? (comment[1] || comment[2])?.trim() : undefined,
            context: line.trim(),
          });
        }
      }
    }

    // Extract spell IDs
    const spellPatterns = [
      /CastSpell\((\d+)/gi,
      /quest::selfcast\((\d+)\)/gi,
      /quest::castspell\(\d+,\s*(\d+)\)/gi,
    ];
    for (const pat of spellPatterns) {
      let m;
      while ((m = pat.exec(line)) !== null) {
        const id = parseInt(m[1], 10);
        if (id > 0 && !seenSpells.has(id)) {
          seenSpells.add(id);
          const comment = line.match(/--\s*Spell:\s*(.+)|#\s*Spell:\s*(.+)/i);
          spells.push({
            type: "spell",
            id,
            name: comment ? (comment[1] || comment[2])?.trim() : undefined,
            context: line.trim(),
          });
        }
      }
    }

    // Extract dialogue
    if (isLua) {
      // Match findi("keyword") patterns to get triggers
      const triggerMatch = line.match(/findi\(["'](\w+)["']\)/i);
      if (triggerMatch) {
        // Look for Say/Message on this or next few lines
        const trigger = triggerMatch[1];
        const textMatch = line.match(/['"]([^'"]{20,})['"]/);
        if (textMatch) {
          dialogues.push({
            trigger,
            text: cleanDialogue(textMatch[1]),
            lineNumber: lineNum,
          });
        }
      }
    } else if (isPerl) {
      const triggerMatch = line.match(/\$text\s*=~\s*\/(\w+)\/i/);
      if (triggerMatch) {
        const trigger = triggerMatch[1];
        // Search nearby lines for quest::say
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          const sayMatch = lines[j].match(/quest::say\(["'](.+?)["']\)/);
          if (sayMatch) {
            dialogues.push({
              trigger,
              text: cleanDialogue(sayMatch[1]),
              lineNumber: j + 1,
            });
            break;
          }
        }
      }
    }
  }

  return { events, items, npcs, spells, dialogues, language };
}

function cleanDialogue(text: string): string {
  return text
    .replace(/\\"/g, '"')
    .replace(/\$\{?(\w+)\}?/g, '{$1}') // Perl vars
    .replace(/%s/g, '{player}')
    .replace(/\s+/g, ' ')
    .trim();
}
