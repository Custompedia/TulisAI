import { describe, expect, it } from 'vitest';
import { overflowingGroups } from '@/components/workspace/toolbar/overflow';

// Widths close to the real Halaman toolbar at 100% zoom (UX 4 browser check: the content needed ~876px).
const groups = [
  { id: 'history', width: 100, pinned: true }, { id: 'style', width: 121 }, { id: 'marks', width: 141, pinned: true }, { id: 'link', width: 41 },
  { id: 'paragraph', width: 209 }, { id: 'indent', width: 66 }, { id: 'insert', width: 101 }, { id: 'layout', width: 104 },
  { id: 'text', width: 46 }, { id: 'zoom', width: 81 }, { id: 'tools', width: 66 },
];
const total = groups.reduce((sum, group) => sum + group.width, 0) + 2 * (groups.length - 1);

describe('UX 4 finding 6: the Halaman toolbar keeps ⋮ on the bar', () => {
  it('keeps every group and no ⋮ when they all fit', () => {
    expect(overflowingGroups(groups, total, 2, 41)).toEqual([]);
  });
  it('moves groups into ⋮ from the right until the groups and ⋮ fit, for every width from 300 to 1,140px', () => {
    for (let available = 300; available <= 1140; available++) {
      const hidden = overflowingGroups(groups, available, 2, 41);
      const shown = groups.filter((group) => !hidden.includes(group.id));
      const used = shown.reduce((sum, group) => sum + group.width, 0) + 2 * (shown.length - 1) + (hidden.length ? 2 + 41 : 0);
      if (available >= total) expect(hidden).toEqual([]);
      else { expect(hidden.length).toBeGreaterThan(0); expect(used).toBeLessThanOrEqual(available); }
    }
  });
  it('collapses right to left and never moves undo/redo or bold/italic', () => {
    expect(overflowingGroups(groups, 846, 2, 41)).toEqual(['layout', 'text', 'zoom', 'tools']);
    expect(overflowingGroups(groups, 300, 2, 41)).toEqual(['style', 'link', 'paragraph', 'indent', 'insert', 'layout', 'text', 'zoom', 'tools']);
  });
});
