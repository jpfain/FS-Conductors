  const APP_VERSION = "v54";
  let currentDate = new Date();
  let currentViewMode = "calendar";
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const START_YEAR = 2026;
  const DEFAULT_ANCHOR_DATE = "2026-11-14";
  const DEFAULT_MEETING_TIME = "9:30 - 9:37 AM";
  const DEFAULT_MEETING_LOCATION = "Kingdom Hall";
  const GIST_FILENAME = "conductor-schedule-data.json";
  const GIST_CONFIG_KEY = "conductor_gist_config";
  const MAX_UNDO_STEPS = 15;

  const ROSTER_ICONS = {
    prev: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`,
    next: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`,
    message: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
    calendarDownload: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 14v5"/><path d="m9.5 16.5 2.5 2.5 2.5-2.5"/></svg>`,
    edit: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`
  };

  const DEFAULT_TEMPLATES = {
    individualText:
      "Hi {firstName}, here are your upcoming FS Conductor dates ({defaultTime} at the {defaultLocation}):\n\n" +
      "{dates}\n\n" +
      "Please read ahead:\n" +
      "1. mwb21 November p. 7 \"Tips for Making Meetings for Field Service Practical\"\n" +
      "2. km 3/15 pp. 3-6 \"Meetings for Field Service That Accomplish Their Purpose.\"\n\n" +
      "Please let me know early if you need a replacement or trade. Thank you!",
    individualEmail:
      "Hi {firstName},\n\n" +
      "Here is your upcoming FS Conductor schedule:\n\n" +
      "{dates}\n\n" +
      "Time: {defaultTime}\n" +
      "Location: {defaultLocation}\n\n" +
      "Please read ahead:\n" +
      "1. mwb21 November p. 7 \"Tips for Making Meetings for Field Service Practical\"\n" +
      "2. km 3/15 pp. 3-6 \"Meetings for Field Service That Accomplish Their Purpose.\"\n\n" +
      "If a conflict comes up, please let me know as early as possible so we can arrange a replacement or trade. Thank you for your willing spirit!",
    groupText:
      "Updated FS Conductor Schedule ({timeframe} — {defaultTime}, {defaultLocation}):\n\n" +
      "{schedules}\n\n" +
      "Please read ahead:\n" +
      "1. mwb21 November p. 7 \"Tips for Making Meetings for Field Service Practical\"\n" +
      "2. km 3/15 pp. 3-6 \"Meetings for Field Service That Accomplish Their Purpose.\"\n\n" +
      "Please let me know early if you need a replacement or trade. Thanks, Brothers!",
    groupEmail:
      "Hello Brothers,\n\n" +
      "Here is the updated FS Conductor schedule ({timeframe}):\n\n" +
      "{schedules}\n\n" +
      "Time: {defaultTime}\n" +
      "Location: {defaultLocation}\n\n" +
      "Please read ahead:\n" +
      "1. mwb21 November p. 7 \"Tips for Making Meetings for Field Service Practical\"\n" +
      "2. km 3/15 pp. 3-6 \"Meetings for Field Service That Accomplish Their Purpose.\"\n\n" +
      "If you are unavailable for any of your assigned dates, please let me know early so we can arrange a replacement or trade. Thank you for your willing spirit!"
  };

  let activeShareContext = {
    mode: "single",
    conductorName: null,
    targetDateKey: null,
    format: "text",
    allTextMode: "group",
    queueIndex: 0,
    queueItems: [],
    lastRenderedDates: "",
    lastRenderedSchedules: ""
  };

  let undoStack = [];
  let editingRosterIndex = null;
  let tempUnavailableDates = [];
  let currentUpNextSlot = null;
  let tradeCandidateSlots = [];
  let pendingCancelDateKey = null;
  let tempSlotDetails = {};
  let swRegistration = null;
  let lastAutoUpdateCheck = 0;
  let lastAutoCloudPull = 0;
  let isSyncingNow = false;
  let lastModalFocus = null;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getTodayLocalKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatShortDate(dateKey) {
    if (!dateKey) return "";
    const parts = dateKey.split("-");
    if (parts.length !== 3) return dateKey;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatFullDateWithDay(dateKey) {
    if (!dateKey) return "";
    const parts = dateKey.split("-");
    if (parts.length !== 3) return dateKey;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getBlackoutReason(blackouts, dateKey) {
    if (!blackouts || !blackouts[dateKey]) return null;
    if (typeof blackouts[dateKey] === "string" && blackouts[dateKey].trim()) {
      return blackouts[dateKey].trim();
    }
    return "Cancelled";
  }

  function getSlotTimeLocation(state, dateKey) {
    const defTime = (state.defaultTime && state.defaultTime.trim()) || DEFAULT_MEETING_TIME;
    const defLoc = (state.defaultLocation && state.defaultLocation.trim()) || DEFAULT_MEETING_LOCATION;
    const custom = (state.slotDetails && dateKey && state.slotDetails[dateKey]) || null;
    const customTime = custom && custom.time && custom.time.trim();
    const customLoc = custom && custom.location && custom.location.trim();
    return {
      time: customTime || defTime,
      location: customLoc || defLoc,
      isCustom: !!(customTime || customLoc),
      defaultTime: defTime,
      defaultLocation: defLoc
    };
  }

  function syncModalBodyLock() {
    const openModals = document.querySelectorAll(".modal-backdrop.open");
    const anyModalOpen = openModals.length > 0;
    document.body.classList.toggle("modal-open", anyModalOpen);

    if (anyModalOpen) {
      const activeModal = openModals[openModals.length - 1];
      if (!activeModal.contains(document.activeElement)) {
        lastModalFocus = document.activeElement;
        const dialog = activeModal.querySelector('[role="dialog"]') || activeModal;
        const firstFocusable = dialog.querySelector(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        (firstFocusable || dialog).focus();
      }
    } else if (lastModalFocus && lastModalFocus.isConnected) {
      lastModalFocus.focus();
      lastModalFocus = null;
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const openModals = document.querySelectorAll(".modal-backdrop.open");
    if (!openModals.length) return;
    const dialog = openModals[openModals.length - 1].querySelector('[role="dialog"]');
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  /* --- ONE-TAP UNDO STACK --- */
  function recordUndoSnapshot(label, existingState = null) {
    const snapState = existingState ? JSON.parse(JSON.stringify(existingState)) : loadAppState();
    undoStack.push({
      label: label || "Change",
      state: snapState
    });
    if (undoStack.length > MAX_UNDO_STEPS) {
      undoStack.shift();
    }
    updateUndoButton();
  }

  function updateUndoButton() {
    const btn = document.getElementById("btnUndo");
    if (!btn) return;
    if (undoStack.length > 0) {
      const top = undoStack[undoStack.length - 1];
      btn.disabled = false;
      btn.title = `Undo: ${top.label}`;
      btn.innerText = `↩ Undo (${undoStack.length})`;
    } else {
      btn.disabled = true;
      btn.title = "Nothing to undo";
      btn.innerText = "↩ Undo";
    }
  }

  function undoLastChange() {
    if (undoStack.length === 0) return;
    const entry = undoStack.pop();
    const restored = ensureFieldTimestamps(entry.state);
    const nowTs = Date.now();
    restored.fieldTimestamps.core = nowTs;
    Object.keys(restored.reminders || {}).forEach(k => { restored.fieldTimestamps.reminders[k] = nowTs; });
    Object.keys(restored.overrides || {}).forEach(k => { restored.fieldTimestamps.overrides[k] = nowTs; });
    Object.keys(restored.blackouts || {}).forEach(k => { restored.fieldTimestamps.blackouts[k] = nowTs; });
    Object.keys(restored.slotDetails || {}).forEach(k => { restored.fieldTimestamps.slotDetails[k] = nowTs; });

    saveAppState(restored);
    updateUndoButton();
    showStatus(`↩ Undid: ${entry.label}`);
  }

  /* --- AUTO-ADVANCING YEAR SELECTOR --- */
  function populateYearSelect() {
    const select = document.getElementById("yearSelect");
    if (!select) return;
    const nowYear = new Date().getFullYear();
    const maxYear = Math.max(nowYear + 3, 2030);
    const activeYear = currentDate.getFullYear();

    select.innerHTML = "";
    for (let y = START_YEAR; y <= maxYear; y++) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.innerText = String(y);
      if (y === activeYear) opt.selected = true;
      select.appendChild(opt);
    }
  }

  /* --- DATE-LEVEL FIELD TIMESTAMP HELPERS --- */
  function ensureFieldTimestamps(state) {
    const fallback = Date.parse(state.lastModified || "1970-01-01T00:00:00.000Z") || 0;
    if (!state.fieldTimestamps || typeof state.fieldTimestamps !== "object") state.fieldTimestamps = {};
    ["reminders", "overrides", "blackouts", "slotDetails", "contacts", "unavailability", "templates"].forEach(field => {
      if (!state.fieldTimestamps[field] || typeof state.fieldTimestamps[field] !== "object") {
        state.fieldTimestamps[field] = {};
      }
    });
    ["core", "roster", "settings"].forEach(field => {
      if (typeof state.fieldTimestamps[field] !== "number") state.fieldTimestamps[field] = fallback;
    });
    return state;
  }

  function touchDateField(state, category, dateKey) {
    ensureFieldTimestamps(state);
    if (!state.fieldTimestamps[category]) state.fieldTimestamps[category] = {};
    state.fieldTimestamps[category][dateKey] = Date.now();
  }

  function touchCoreState(state, category = "core") {
    ensureFieldTimestamps(state);
    const now = Date.now();
    state.fieldTimestamps.core = now;
    if (category === "roster" || category === "settings") {
      state.fieldTimestamps[category] = now;
    }
  }

  function mergeDateMap(localObj, remoteObj, localTsMap, remoteTsMap, localCoreTs, remoteCoreTs) {
    return ScheduleStateSchema.mergeDateMap(
      localObj, remoteObj, localTsMap, remoteTsMap, localCoreTs, remoteCoreTs
    );
  }

  function mergeScheduleStates(localRaw, remoteRaw) {
    const local = ensureFieldTimestamps(JSON.parse(JSON.stringify(localRaw)));
    const remote = ensureFieldTimestamps(JSON.parse(JSON.stringify(remoteRaw)));

    const lCore = local.fieldTimestamps.core;
    const rCore = remote.fieldTimestamps.core;
    const useRemoteRoster = remote.fieldTimestamps.roster > local.fieldTimestamps.roster;
    const useRemoteSettings = remote.fieldTimestamps.settings > local.fieldTimestamps.settings;
    const rosterBase = useRemoteRoster ? remote : local;
    const settingsBase = useRemoteSettings ? remote : local;
    const contactMerge = mergeDateMap(
      local.contacts, remote.contacts,
      local.fieldTimestamps.contacts, remote.fieldTimestamps.contacts,
      lCore, rCore
    );
    const unavailableMerge = mergeDateMap(
      local.unavailability, remote.unavailability,
      local.fieldTimestamps.unavailability, remote.fieldTimestamps.unavailability,
      lCore, rCore
    );
    const templateMerge = mergeDateMap(
      local.templates, remote.templates,
      local.fieldTimestamps.templates, remote.fieldTimestamps.templates,
      lCore, rCore
    );

    const remMerge = mergeDateMap(
      local.reminders, remote.reminders,
      local.fieldTimestamps.reminders, remote.fieldTimestamps.reminders,
      lCore, rCore
    );
    const ovrMerge = mergeDateMap(
      local.overrides, remote.overrides,
      local.fieldTimestamps.overrides, remote.fieldTimestamps.overrides,
      lCore, rCore
    );
    const blkMerge = mergeDateMap(
      local.blackouts, remote.blackouts,
      local.fieldTimestamps.blackouts, remote.fieldTimestamps.blackouts,
      lCore, rCore
    );
    const slotMerge = mergeDateMap(
      local.slotDetails, remote.slotDetails,
      local.fieldTimestamps.slotDetails, remote.fieldTimestamps.slotDetails,
      lCore, rCore
    );

    const maxMod = Math.max(
      Date.parse(local.lastModified || "1970-01-01T00:00:00.000Z") || 0,
      Date.parse(remote.lastModified || "1970-01-01T00:00:00.000Z") || 0
    );

    return {
      schemaVersion: ScheduleStateSchema.CURRENT_SCHEMA_VERSION,
      roster: rosterBase.roster || [],
      contacts: contactMerge.mergedObj,
      unavailability: unavailableMerge.mergedObj,
      templates: { ...DEFAULT_TEMPLATES, ...templateMerge.mergedObj },
      rotationStartDate: settingsBase.rotationStartDate || DEFAULT_ANCHOR_DATE,
      defaultTime: settingsBase.defaultTime || DEFAULT_MEETING_TIME,
      defaultLocation: settingsBase.defaultLocation || DEFAULT_MEETING_LOCATION,
      lockPastDates: settingsBase.lockPastDates !== false,
      lockedHistory: { ...(local.lockedHistory || {}), ...(remote.lockedHistory || {}) },
      reminders: remMerge.mergedObj,
      overrides: ovrMerge.mergedObj,
      blackouts: blkMerge.mergedObj,
      slotDetails: slotMerge.mergedObj,
      fieldTimestamps: {
        core: Math.max(lCore, rCore),
        roster: Math.max(local.fieldTimestamps.roster, remote.fieldTimestamps.roster),
        settings: Math.max(local.fieldTimestamps.settings, remote.fieldTimestamps.settings),
        contacts: contactMerge.mergedTs,
        unavailability: unavailableMerge.mergedTs,
        templates: templateMerge.mergedTs,
        reminders: remMerge.mergedTs,
        overrides: ovrMerge.mergedTs,
        blackouts: blkMerge.mergedTs,
        slotDetails: slotMerge.mergedTs
      },
      lastModified: new Date(maxMod || Date.now()).toISOString()
    };
  }

  function statesDiffer(a, b) {
    const stripMeta = (s) => JSON.stringify({
      schemaVersion: ScheduleStateSchema.CURRENT_SCHEMA_VERSION,
      roster: s.roster || [],
      contacts: s.contacts || {},
      unavailability: s.unavailability || {},
      templates: s.templates || {},
      rotationStartDate: s.rotationStartDate || DEFAULT_ANCHOR_DATE,
      defaultTime: s.defaultTime || DEFAULT_MEETING_TIME,
      defaultLocation: s.defaultLocation || DEFAULT_MEETING_LOCATION,
      lockPastDates: s.lockPastDates !== false,
      lockedHistory: s.lockedHistory || {},
      reminders: s.reminders || {},
      overrides: s.overrides || {},
      blackouts: s.blackouts || {},
      slotDetails: s.slotDetails || {}
    });
    return stripMeta(a) !== stripMeta(b);
  }

  /* --- PAST-DATE HISTORY LOCK ENGINE --- */
  function snapshotPastDates(state) {
    if (state.lockPastDates === false) return false;
    if (!state.lockedHistory) state.lockedHistory = {};
    const todayKey = getTodayLocalKey();
    const nowYear = new Date().getFullYear();
    let changed = false;

    for (let y = START_YEAR; y <= nowYear; y++) {
      for (let m = 0; m < 12; m++) {
        const sats = getMeetingSaturdays(y, m);
        [sats.second, sats.fourth, sats.fifth].forEach(day => {
          if (!day) return;
          const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          if (dateKey >= todayKey) return;
          if (state.blackouts && state.blackouts[dateKey]) return;
          if (!state.lockedHistory[dateKey]) {
            const effective = (state.overrides && state.overrides[dateKey]) || computeRotationalAssignmentInfo(y, m, day, state).conductor;
            if (effective && effective !== "Unassigned") {
              state.lockedHistory[dateKey] = effective;
              changed = true;
            }
          }
        });
      }
    }
    return changed;
  }

  function isDateLocked(dateKey, state) {
    if (state.lockPastDates === false) return false;
    return dateKey < getTodayLocalKey();
  }

  function toggleHistoryLock() {
    const state = loadAppState();
    recordUndoSnapshot("Toggle History Lock", state);
    state.lockPastDates = state.lockPastDates === false ? true : false;
    if (state.lockPastDates) {
      snapshotPastDates(state);
    }
    touchCoreState(state, "settings");
    saveAppState(state);
    showStatus(state.lockPastDates
      ? "🔒 Past Saturdays locked — historical assignments are now protected."
      : "🔓 Past Saturdays unlocked — historical dates follow live rotation.");
  }

  /* --- CONFIRMATION STATUS & REMINDER TRACKING HELPERS --- */
