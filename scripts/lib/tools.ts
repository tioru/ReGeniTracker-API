type LuaValue = number | string | string[];

const LUA_BLOCK_START_REGEX = /\['([^']+)'\]\s*=\s*\{/g;
const LUA_FIELD_REGEX = /\['(\w+)'\]\s*=\s*(.+)$/;

function splitLuaTableBlocks(lua: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  const matches = lua.matchAll(LUA_BLOCK_START_REGEX);
  for (const match of matches) {
    const name = match[1];
    let depth = 1;
    let i = match.index! + match[0].length;
    const start = i;
    while (depth > 0 && i < lua.length) {
      if (lua[i] === '{') depth++;
      else if (lua[i] === '}') depth--;
      i++;
    }
    blocks[name] = lua.slice(start, i - 1);
  }
  return blocks;
}

function parseLuaValue(raw: string): LuaValue {
  const value = raw.trim().replace(/,$/, '');
  if (value.startsWith('{')) return [...value.matchAll(/'([^']*)'/g)].map(m => m[1]);
  if (value.startsWith("'")) return value.slice(1, -1);
  return Number(value);
}

function parseLuaFields(block: string): Record<string, LuaValue> {
  const fields: Record<string, LuaValue> = {};
  for (const line of block.split('\n')) {
    const m = LUA_FIELD_REGEX.exec(line);
    if (m) fields[m[1]] = parseLuaValue(m[2]);
  }
  return fields;
}

export function convertLua(lua: string): Record<string, Record<string, LuaValue>> {
  const blocks = splitLuaTableBlocks(lua);
  return Object.fromEntries(
    Object.entries(blocks).map(([name, block]) => [name, parseLuaFields(block)]),
  );
}
