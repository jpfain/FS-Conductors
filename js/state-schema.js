(function (global) {
  const CURRENT_SCHEMA_VERSION = 1;
  const MAP_FIELDS = [
    "contacts",
    "unavailability",
    "reminders",
    "overrides",
    "blackouts",
    "slotDetails",
    "lockedHistory"
  ];

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isValidDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function validate(state) {
    if (!isRecord(state) || !Array.isArray(state.roster)) return false;
    if (state.roster.some(name => typeof name !== "string" || !name.trim())) return false;
    if (state.schemaVersion !== undefined &&
        (!Number.isInteger(state.schemaVersion) || state.schemaVersion > CURRENT_SCHEMA_VERSION)) return false;
    if (state.rotationStartDate !== undefined && !isValidDateKey(state.rotationStartDate)) return false;
    if (state.defaultTime !== undefined && typeof state.defaultTime !== "string") return false;
    if (state.defaultLocation !== undefined && typeof state.defaultLocation !== "string") return false;
    if (state.lockPastDates !== undefined && typeof state.lockPastDates !== "boolean") return false;
    if (state.lastModified !== undefined && typeof state.lastModified !== "string") return false;

    for (const field of MAP_FIELDS) {
      if (state[field] !== undefined && !isRecord(state[field])) return false;
    }

    if (state.unavailability &&
        Object.values(state.unavailability).some(dates =>
          !Array.isArray(dates) || dates.some(dateKey => !isValidDateKey(dateKey)))) return false;

    if (state.templates !== undefined &&
        (!isRecord(state.templates) || Object.values(state.templates).some(value => typeof value !== "string"))) return false;

    if (state.fieldTimestamps !== undefined && !isRecord(state.fieldTimestamps)) return false;
    return true;
  }

  function normalize(state, defaults) {
    if (!validate(state)) throw new TypeError("Schedule data is invalid or uses an unsupported schema version.");
    const normalized = { ...defaults, ...JSON.parse(JSON.stringify(state)) };

    for (const field of MAP_FIELDS) {
      normalized[field] = { ...(defaults[field] || {}), ...(state[field] || {}) };
    }
    normalized.templates = { ...(defaults.templates || {}), ...(state.templates || {}) };
    normalized.schemaVersion = CURRENT_SCHEMA_VERSION;
    return normalized;
  }

  function mergeDateMap(localObj, remoteObj, localTsMap, remoteTsMap, localCoreTs, remoteCoreTs) {
    const mergedObj = {};
    const mergedTs = {};
    const allKeys = new Set([
      ...Object.keys(localObj || {}),
      ...Object.keys(remoteObj || {}),
      ...Object.keys(localTsMap || {}),
      ...Object.keys(remoteTsMap || {})
    ]);

    allKeys.forEach(key => {
      const localTime = typeof localTsMap?.[key] === "number" ? localTsMap[key] : localCoreTs;
      const remoteTime = typeof remoteTsMap?.[key] === "number" ? remoteTsMap[key] : remoteCoreTs;
      const useRemote = remoteTime > localTime;
      const source = useRemote ? remoteObj : localObj;
      if (source && source[key] !== undefined) mergedObj[key] = source[key];
      mergedTs[key] = useRemote ? remoteTime : localTime;
    });

    return { mergedObj, mergedTs };
  }

  const api = { CURRENT_SCHEMA_VERSION, validate, normalize, mergeDateMap };
  global.ScheduleStateSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
