export type CapacityRow = {
  pinned: boolean;
  held: boolean;
  exclusive: boolean;
  task: { oneOff: boolean; important?: boolean };
};

/** Pins count toward the cap. These are the only rows allowed to sit over it. */
export function mayExceedCapacity(row: CapacityRow) {
  if (row.task.oneOff) return true;
  if (row.held && !row.pinned) return true;
  if (row.task.important && row.exclusive) return true;
  return false;
}

export function canSpillForCapacity(row: CapacityRow) {
  if (row.pinned) return false;
  return !mayExceedCapacity(row);
}

export function rankForSpill<T extends CapacityRow & { dirt: number }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (a.task.important !== b.task.important) return a.task.important ? 1 : -1;
    return a.dirt - b.dirt;
  });
}
