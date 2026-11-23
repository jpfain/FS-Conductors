const test = require("node:test");
const assert = require("node:assert/strict");
const { getMeetingSaturdays, computeRotationalAssignmentInfo } = require("../js/schedule-domain.js");

test("finds the second, fourth, and fifth Saturday when present", () => {
  assert.deepEqual(getMeetingSaturdays(2026, 4), { second: 9, fourth: 23, fifth: 30 });
  assert.deepEqual(getMeetingSaturdays(2026, 1), { second: 14, fourth: 28, fifth: undefined });
});

test("skips an unavailable conductor for one date without shifting the next rotation slot", () => {
  const state = {
    roster: ["A", "B", "C"],
    rotationStartDate: "2026-11-14",
    unavailability: { A: ["2026-11-14"] },
    blackouts: {}
  };

  const firstSlot = computeRotationalAssignmentInfo(2026, 10, 14, state, 2026, 2026);
  const nextSlot = computeRotationalAssignmentInfo(2026, 10, 28, state, 2026, 2026);

  assert.deepEqual(firstSlot.skippedUnavailable, ["A"]);
  assert.equal(firstSlot.conductor, "B");
  assert.equal(nextSlot.conductor, "B");
});

test("a blackout does not consume a rotation slot", () => {
  const state = {
    roster: ["A", "B"],
    rotationStartDate: "2026-11-14",
    blackouts: { "2026-11-28": "No Meeting" }
  };

  const afterBlackout = computeRotationalAssignmentInfo(2026, 11, 12, state, 2026, 2026);
  assert.equal(afterBlackout.conductor, "B");
});
