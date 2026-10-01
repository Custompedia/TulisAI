// Which Halaman toolbar groups move into ⋮ "Opsi lainnya". Measured, not guessed: the widths come from the rendered
// groups, so a reorder, a longer label or another locale never pushes ⋮ off the bar. Groups collapse from the right;
// `pinned` groups (undo/redo, bold/italic) always stay. When anything collapses, ⋮ takes `more` pixels of the row.
export type ToolbarGroupSize = { id: string; width: number; pinned?: boolean };
export function overflowingGroups(groups: ToolbarGroupSize[], available: number, gap: number, more: number): string[] {
  const total = (list: ToolbarGroupSize[]) => list.reduce((sum, group) => sum + group.width, 0) + gap * Math.max(0, list.length - 1);
  if (total(groups) <= available) return [];
  const shown = [...groups]; const hidden: string[] = [];
  // ⋮ sits after the last shown group with one gap before it.
  const fits = () => total(shown) + gap + more <= available;
  for (let index = shown.length - 1; index >= 0 && !fits(); index--) {
    if (shown[index]!.pinned) continue;
    hidden.unshift(shown[index]!.id); shown.splice(index, 1);
  }
  return hidden;
}
