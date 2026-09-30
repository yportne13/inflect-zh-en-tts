/** Symbol inventory loading and phoneme-string -> token ids conversion. */

export interface SymbolTable {
  symbols: string[];
  index: Map<string, number>;
}

interface SymbolsFile {
  count?: number;
  symbols: string[];
}

export async function loadSymbols(url: string): Promise<SymbolTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const payload = (await response.json()) as SymbolsFile;
  const symbols = payload.symbols;
  const index = new Map<string, number>();
  symbols.forEach((symbol, position) => {
    if (!index.has(symbol)) index.set(symbol, position);
  });
  return { symbols, index };
}

/**
 * Mirror the runtime's tokenisation: map each character to its symbol id and
 * (when the model was trained with add_blank) surround every token with the
 * blank id 0.
 */
export function textToIds(table: SymbolTable, phonemes: string, addBlank = true): number[] {
  const ids: number[] = [];
  for (const character of phonemes) {
    const id = table.index.get(character);
    if (id === undefined) continue;
    ids.push(id);
  }
  if (!addBlank) return ids;
  const expanded: number[] = new Array(ids.length * 2 + 1).fill(0);
  ids.forEach((id, position) => {
    expanded[position * 2 + 1] = id;
  });
  return expanded;
}
