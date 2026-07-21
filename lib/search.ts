// Shared search query parser
// Supports: multiple words (AND), -word (exclude), id:1234 (exact ID)

export function parseSearch(search: string, nameColumn: string = "Name") {
  const words = search.trim().split(/\s+/);
  const includes: string[] = [];
  const excludes: string[] = [];
  let exactId: string | null = null;

  for (const word of words) {
    const idMatch = word.match(/^id:(\d+)$/);
    if (idMatch) {
      exactId = idMatch[1];
    } else if (word.startsWith("-") && word.length > 1) {
      excludes.push(word.slice(1));
    } else if (word.length >= 2) {
      includes.push(word);
    }
  }

  if (exactId) {
    return { conditions: ["id = ?"], params: [exactId] };
  }

  if (includes.length === 0 && excludes.length === 0) {
    return { conditions: [], params: [] };
  }

  const conditions: string[] = [];
  const params: any[] = [];

  for (const word of includes) {
    conditions.push(`${nameColumn} LIKE ?`);
    params.push(`%${word}%`);
  }
  for (const word of excludes) {
    conditions.push(`${nameColumn} NOT LIKE ?`);
    params.push(`%${word}%`);
  }

  return { conditions, params };
}
