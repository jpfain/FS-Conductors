const test = require("node:test");
const assert = require("node:assert/strict");
const { validate, normalize, mergeDateMap, CURRENT_SCHEMA_VERSION } = require("../js/state-schema.js");

const defaults = {
  roster: [],
  contacts: {},
  unavailability: {},
  reminders: {},
  overrides: {},
  blackouts: {},
  slotDetails: {},
  lockedHistory: {},
  templates: { individualText: "Default" },
  rotationStartDate: "2026-11-14",
  defaultTime: "9:30 AM",
  defaultLocation: "Kingdom Hall",
  lockPastDates: true
};

test("migrates a legacy state by filling defaults and recording the schema version", () => {
  const legacy = { roster: ["A"], rotationStartDate: "2026-11-14" };
  const migrated = normalize(legacy, defaults);

  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(migrated.roster, ["A"]);
  assert.deepEqual(migrated.contacts, {});
  assert.equal(migrated.defaultLocation, "Kingdom Hall");
});

test("rejects malformed roster data, invalid dates, and newer schema versions", () => {
  assert.equal(validate({ roster: [null] }), false);
  assert.equal(validate({ roster: [], rotationStartDate: "2026-02-30" }), false);
  assert.equal(validate({ roster: [], schemaVersion: CURRENT_SCHEMA_VERSION + 1 }), false);
});

test("rejects malformed unavailability maps", () => {
  assert.equal(validate({ roster: [], unavailability: { A: ["not-a-date"] } }), false);
});

test("keeps a timestamped deletion instead of restoring an older remote value", () => {
  const merged = mergeDateMap(
    {},
    { "2026-11-28": "Assigned" },
    { "2026-11-28": 20 },
    { "2026-11-28": 10 },
    1,
    1
  );

  assert.equal(merged.mergedObj["2026-11-28"], undefined);
  assert.equal(merged.mergedTs["2026-11-28"], 20);
});

test("merges independent date keys using their own timestamps", () => {
  const merged = mergeDateMap(
    { local: "kept" },
    { remote: "kept" },
    { local: 3 },
    { remote: 4 },
    1,
    1
  );

  assert.deepEqual(merged.mergedObj, { local: "kept", remote: "kept" });
});
