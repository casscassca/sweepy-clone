import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSpillForCapacity, mayExceedCapacity, rankForSpill } from "./capacity-policy";

const chore = (over: Partial<{ pinned: boolean; held: boolean; exclusive: boolean; oneOff: boolean; important: boolean }>) => ({
  pinned: over.pinned ?? false,
  held: over.held ?? false,
  exclusive: over.exclusive ?? false,
  task: { oneOff: over.oneOff ?? false, important: over.important ?? false },
});

describe("capacity overrides", () => {
  it("counts a pin toward the cap and will not spill it", () => {
    const pin = chore({ pinned: true, held: true });
    assert.equal(mayExceedCapacity(pin), false);
    assert.equal(canSpillForCapacity(pin), false);
  });

  it("lets a dragged chore sit over the cap", () => {
    const moved = chore({ held: true });
    assert.equal(mayExceedCapacity(moved), true);
    assert.equal(canSpillForCapacity(moved), false);
  });

  it("lets exclusive important chores sit over the cap", () => {
    const onlyTheirs = chore({ important: true, exclusive: true });
    assert.equal(mayExceedCapacity(onlyTheirs), true);
    assert.equal(canSpillForCapacity(onlyTheirs), false);
  });

  it("spills a regular or due-only auto once the cap is hit", () => {
    assert.equal(canSpillForCapacity(chore({})), true);
    assert.equal(canSpillForCapacity(chore({ important: true })), true);
    assert.equal(canSpillForCapacity(chore({ exclusive: true })), true);
  });

  it("spills clean regulars before important ones", () => {
    const dirty = { ...chore({}), dirt: 2 };
    const important = { ...chore({ important: true }), dirt: 0.4 };
    const clean = { ...chore({}), dirt: 0.5 };
    assert.deepEqual(
      rankForSpill([important, dirty, clean]).map((r) => r.dirt),
      [0.5, 2, 0.4],
    );
  });
});
