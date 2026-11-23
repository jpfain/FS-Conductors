(function (global) {
  function getMeetingSaturdays(year, month) {
    const saturdays = [];
    const date = new Date(year, month, 1);
    while (date.getMonth() === month) {
      if (date.getDay() === 6) saturdays.push(date.getDate());
      date.setDate(date.getDate() + 1);
    }
    return { second: saturdays[1], fourth: saturdays[3], fifth: saturdays[4] };
  }

  function computeRotationalAssignmentInfo(targetYear, targetMonth, targetDay, state, startYear, currentYear) {
    if (!state.roster || state.roster.length === 0) {
      return { conductor: "Unassigned", baseConductor: "Unassigned", skippedUnavailable: [], isLocked: false };
    }

    const anchorDateKey = state.rotationStartDate || `${startYear}-01-01`;
    const anchorYear = parseInt(anchorDateKey.split("-")[0], 10) || startYear;
    const endYear = Math.max(targetYear, anchorYear, currentYear + 3);
    const activeMeetings = [];

    for (let year = startYear; year <= endYear; year++) {
      for (let month = 0; month < 12; month++) {
        const saturdays = getMeetingSaturdays(year, month);
        [saturdays.second, saturdays.fourth, saturdays.fifth].forEach(day => {
          if (!day) return;
          const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          if (!state.blackouts || !state.blackouts[dateKey]) activeMeetings.push(dateKey);
        });
      }
    }

    const targetKey = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
    const targetIndex = activeMeetings.indexOf(targetKey);
    if (targetIndex === -1) {
      return { conductor: state.roster[0], baseConductor: state.roster[0], skippedUnavailable: [], isLocked: false };
    }

    let anchorIndex = activeMeetings.findIndex(key => key >= anchorDateKey);
    if (anchorIndex === -1) anchorIndex = 0;

    const offset = targetIndex - anchorIndex;
    const baseIndex = ((offset % state.roster.length) + state.roster.length) % state.roster.length;
    const baseConductor = state.roster[baseIndex];
    const skipped = [];

    for (let step = 0; step < state.roster.length; step++) {
      const candidate = state.roster[(baseIndex + step) % state.roster.length];
      if (!(state.unavailability?.[candidate] || []).includes(targetKey)) {
        return { conductor: candidate, baseConductor, skippedUnavailable: skipped, isLocked: false };
      }
      skipped.push(candidate);
    }

    return { conductor: baseConductor, baseConductor, skippedUnavailable: [], isLocked: false };
  }

  const api = { getMeetingSaturdays, computeRotationalAssignmentInfo };
  global.ScheduleDomain = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
