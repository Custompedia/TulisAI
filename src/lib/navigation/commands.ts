// The Ctrl K palette: three groups in a fixed order, filtered by every typed word.
export type CommandGroup = 'actions' | 'notebooks' | 'skills';
export const COMMAND_GROUPS: CommandGroup[] = ['actions', 'notebooks', 'skills'];
// The "Terbaru" group lists at most this many notebooks, from the first page of GET /api/documents.
export const PALETTE_NOTEBOOK_LIMIT = 50;
// Without a query each list group is trimmed so the quick actions stay in view.
const IDLE_PER_GROUP = 6;
const MATCH_PER_GROUP = 20;

export type Command = { id: string; group: CommandGroup; label: string; description?: string; keywords?: string };

export const normalizeQuery = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id-ID').trim();

export function filterCommands<T extends Command>(commands: T[], query: string): T[] {
  const terms = normalizeQuery(query).split(/\s+/).filter(Boolean);
  const matches = terms.length === 0 ? commands : commands.filter((command) => {
    const haystack = normalizeQuery(`${command.label} ${command.description ?? ''} ${command.keywords ?? ''}`);
    return terms.every((term) => haystack.includes(term));
  });
  return COMMAND_GROUPS.flatMap((group) => {
    const inGroup = matches.filter((command) => command.group === group);
    // Quick actions are few and always shown whole; long lists are capped.
    return group === 'actions' ? inGroup : inGroup.slice(0, terms.length === 0 ? IDLE_PER_GROUP : MATCH_PER_GROUP);
  });
}

// Arrow keys wrap around the visible list.
export function moveActive(index: number, length: number, key: string): number {
  if (length === 0) return 0;
  if (key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return index;
}
