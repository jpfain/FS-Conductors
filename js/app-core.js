  const APP_VERSION = "v53";
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
  let appUpdateRequested = false;

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
  let allowRosterShrinkOnce = false;
  let crossTabChannel = null;
  const crossTabInstanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
    const anyModalOpen = document.querySelectorAll(".modal-backdrop.open").length > 0;
    document.body.classList.toggle("modal-open", anyModalOpen);
  }

  const modalReturnFocus = new WeakMap();

  function configureModalAccessibility() {
    document.querySelectorAll(".modal-backdrop").forEach(modal => {
      const card = modal.querySelector(".modal-card");
      const heading = card && card.querySelector("h3");
      if (!card || !heading) return;

      if (!heading.id) heading.id = `${modal.id}Title`;
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "false");
      card.setAttribute("aria-labelledby", heading.id);
      card.tabIndex = -1;
      modal.setAttribute("aria-hidden", "true");
    });
  }

  function getTopmostModal() {
    return [...document.querySelectorAll(".modal-backdrop.open")]
      .reduce((topmost, modal) => {
        const modalZIndex = Number.parseInt(getComputedStyle(modal).zIndex, 10) || 0;
        const topmostZIndex = topmost
          ? Number.parseInt(getComputedStyle(topmost).zIndex, 10) || 0
          : -1;
        return modalZIndex >= topmostZIndex ? modal : topmost;
      }, null);
  }

  function syncAccessibleModalState() {
    const topmostModal = getTopmostModal();
    document.querySelectorAll(".modal-backdrop").forEach(modal => {
      const isTopmost = modal === topmostModal;
      modal.setAttribute("aria-hidden", String(!isTopmost));
      const card = modal.querySelector(".modal-card");
      if (card) card.setAttribute("aria-modal", String(isTopmost));
    });
  }

  function focusModal(modal, preferredTargetId) {
    const card = modal.querySelector(".modal-card");
    const preferredTarget = preferredTargetId && document.getElementById(preferredTargetId);
    const target = preferredTarget && modal.contains(preferredTarget)
      ? preferredTarget
      : card.querySelector("input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]");
    (target || card).focus({ preventScroll: true });
  }

  function openAccessibleModal(modalId, preferredTargetId) {
    const modal = document.getElementById(modalId);
    if (!modal.classList.contains("open")) {
      const activeElement = document.activeElement;
      modalReturnFocus.set(modal, {
        element: activeElement,
        id: activeElement.id,
        ariaLabel: activeElement.getAttribute("aria-label")
      });
    }
    modal.classList.add("open");
    syncAccessibleModalState();
    focusModal(modal, preferredTargetId);
  }

  function closeAccessibleModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove("open");
    syncAccessibleModalState();

    const focusSnapshot = modalReturnFocus.get(modal);
    modalReturnFocus.delete(modal);
    const topmostModal = getTopmostModal();
    let previousFocus = focusSnapshot && focusSnapshot.element;
    if ((!previousFocus || !previousFocus.isConnected) && focusSnapshot && focusSnapshot.id) {
      previousFocus = document.getElementById(focusSnapshot.id);
    }
    if ((!previousFocus || !previousFocus.isConnected) && focusSnapshot && focusSnapshot.ariaLabel) {
      previousFocus = [...document.querySelectorAll("[aria-label]")]
        .find(element => element.getAttribute("aria-label") === focusSnapshot.ariaLabel);
    }
    const previousFocusIsAvailable = previousFocus &&
      previousFocus.isConnected &&
      !previousFocus.closest(".modal-backdrop[aria-hidden='true']");

    if (previousFocusIsAvailable) {
      previousFocus.focus({ preventScroll: true });
    } else if (topmostModal) {
      focusModal(topmostModal);
    }
  }

  function trapModalFocus(event) {
    if (event.key !== "Tab") return;
    const modal = getTopmostModal();
    if (!modal) return;

    const focusable = [...modal.querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )].filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first) {
      event.preventDefault();
      modal.querySelector(".modal-card").focus();
    } else if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

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

    allowRosterShrinkOnce = true;
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

  function jumpToYear(targetYear) {
    currentDate.setFullYear(targetYear);
    populateYearSelect();
    renderUI();
  }

  /* --- DATE-LEVEL FIELD TIMESTAMP HELPERS & ROSTER PROTECTION --- */
  function ensureFieldTimestamps(state) {
    const fallback = Date.parse(state.lastModified || "1970-01-01T00:00:00.000Z") || 0;
    if (!state.fieldTimestamps || typeof state.fieldTimestamps !== "object") {
      state.fieldTimestamps = {
        reminders: {},
        overrides: {},
        blackouts: {},
        slotDetails: {},
        core: fallback
      };
    }
    if (!state.fieldTimestamps.reminders) state.fieldTimestamps.reminders = {};
    if (!state.fieldTimestamps.overrides) state.fieldTimestamps.overrides = {};
    if (!state.fieldTimestamps.blackouts) state.fieldTimestamps.blackouts = {};
    if (!state.fieldTimestamps.slotDetails) state.fieldTimestamps.slotDetails = {};
    if (typeof state.fieldTimestamps.core !== "number") state.fieldTimestamps.core = fallback;
    return state;
  }

  function touchDateField(state, category, dateKey) {
    ensureFieldTimestamps(state);
    if (!state.fieldTimestamps[category]) state.fieldTimestamps[category] = {};
    state.fieldTimestamps[category][dateKey] = Date.now();
  }

  function touchCoreState(state) {
    ensureFieldTimestamps(state);
    state.fieldTimestamps.core = Date.now();
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

    allKeys.forEach(dateKey => {
      const hasLocalTs = localTsMap && typeof localTsMap[dateKey] === "number";
      const hasRemoteTs = remoteTsMap && typeof remoteTsMap[dateKey] === "number";
      const lTime = hasLocalTs ? localTsMap[dateKey] : localCoreTs;
      const rTime = hasRemoteTs ? remoteTsMap[dateKey] : remoteCoreTs;

      if (rTime > lTime) {
        if (remoteObj && remoteObj[dateKey] !== undefined) {
          mergedObj[dateKey] = remoteObj[dateKey];
        }
        mergedTs[dateKey] = rTime;
      } else {
        if (localObj && localObj[dateKey] !== undefined) {
          mergedObj[dateKey] = localObj[dateKey];
        }
        mergedTs[dateKey] = lTime;
      }
    });

    return { mergedObj, mergedTs };
  }

  function mergeScheduleStates(localRaw, remoteRaw) {
    const local = ensureFieldTimestamps(JSON.parse(JSON.stringify(localRaw)));
    const remote = ensureFieldTimestamps(JSON.parse(JSON.stringify(remoteRaw)));

    const lCore = local.fieldTimestamps.core;
    const rCore = remote.fieldTimestamps.core;
    const useRemoteCore = rCore > lCore;
    const base = useRemoteCore ? remote : local;

    // Safeguard: never allow a stale/smaller remote roster to silently shrink a fuller local roster
    const localRoster = Array.isArray(local.roster) ? local.roster : [];
    const remoteRoster = Array.isArray(remote.roster) ? remote.roster : [];
    let safeRoster = base.roster || [];
    if (useRemoteCore && remoteRoster.length < localRoster.length) {
      safeRoster = localRoster;
    }

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
      roster: safeRoster,
      contacts: { ...(local.contacts || {}), ...(remote.contacts || {}) },
      unavailability: base.unavailability || {},
      templates: base.templates || { ...DEFAULT_TEMPLATES },
      rotationStartDate: base.rotationStartDate || DEFAULT_ANCHOR_DATE,
      defaultTime: base.defaultTime || DEFAULT_MEETING_TIME,
      defaultLocation: base.defaultLocation || DEFAULT_MEETING_LOCATION,
      lockPastDates: base.lockPastDates !== false,
      lockedHistory: { ...(local.lockedHistory || {}), ...(remote.lockedHistory || {}) },
      reminders: remMerge.mergedObj,
      overrides: ovrMerge.mergedObj,
      blackouts: blkMerge.mergedObj,
      slotDetails: slotMerge.mergedObj,
      fieldTimestamps: {
        core: Math.max(lCore, rCore),
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

  function publishScheduleState(state, mode = "merge") {
    if (!crossTabChannel) return;
    try {
      crossTabChannel.postMessage({
        type: "conductor-schedule-update",
        senderId: crossTabInstanceId,
        mode,
        state
      });
    } catch (err) {
      console.error("Could not notify other app tabs:", err);
    }
  }

  async function setScheduleStateFromCrossTab(state, mode = "merge", notifyUser = true) {
    if (!state || !Array.isArray(state.roster)) {
      console.error("Ignored an invalid schedule update from another tab.");
      showStatus("Another tab sent an invalid schedule update.");
      return;
    }

    try {
      const incoming = ensureFieldTimestamps(JSON.parse(JSON.stringify(state)));
      const local = loadAppState();
      let nextState = mode === "replace" ? incoming : mergeScheduleStates(local, incoming);
      snapshotPastDates(nextState);

      if (!statesDiffer(local, nextState)) return;

      nextState.lastModified = new Date().toISOString();
      await persistScheduleState(nextState);
      publishScheduleState(nextState, "merge");
      renderUI();
      if (notifyUser) showStatus("Schedule updated by another open tab.");
    } catch (err) {
      console.error("Could not merge schedule update from another tab:", err);
      showStatus(`Could not apply schedule update from another tab: ${err.message}`);
    }
  }

  function setupCrossTabSync() {
    if ("BroadcastChannel" in window) {
      crossTabChannel = new BroadcastChannel("fs-conductors-schedule");
      crossTabChannel.addEventListener("message", (event) => {
        const message = event.data;
        if (!message ||
            message.type !== "conductor-schedule-update" ||
            message.senderId === crossTabInstanceId) return;
        setScheduleStateFromCrossTab(message.state, message.mode || "merge");
      });
    }

    window.addEventListener("storage", (event) => {
      if (event.key === SCHEDULE_STATE_REVISION_KEY) {
        readSharedScheduleState()
          .then(state => setScheduleStateFromCrossTab(state, "merge"))
          .catch(err => {
            console.error("Could not read the schedule update from another tab:", err);
            showStatus("Could not load a schedule update from another tab.");
          });
        return;
      }

      if (event.key !== SCHEDULE_STATE_STORAGE_KEY || !event.newValue) return;
      try {
        setScheduleStateFromCrossTab(JSON.parse(event.newValue), "merge");
      } catch (err) {
        console.error("Could not read schedule update from another tab:", err);
      }
    });
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
    touchCoreState(state);
    saveAppState(state);
    showStatus(state.lockPastDates
      ? "🔒 Past Saturdays locked — historical assignments are now protected."
      : "🔓 Past Saturdays unlocked — historical dates follow live rotation.");
  }

  /* --- CONFIRMATION STATUS & REMINDER TRACKING HELPERS --- */
  function getReminderForSlot(dateKey, conductorName, state) {
    if (!state.reminders || !dateKey || !conductorName) return null;
    const entry = state.reminders[dateKey];
    if (entry && entry.conductor === conductorName && entry.sentDate) {
      const normalizedStatus = entry.status === "needs_sub" ? "requested_sub" : (entry.status || "assignment_sent");
      return {
        conductor: entry.conductor,
        sentDate: entry.sentDate,
        statusDate: entry.statusDate || entry.sentDate,
        status: normalizedStatus
      };
    }
    return null;
  }

  function formatReminderStatusText(remInfo, compact = false, forPrint = false) {
    if (!remInfo) return "";
    const statusDateStr = formatShortDate(remInfo.statusDate || remInfo.sentDate);
    const sentDateStr = formatShortDate(remInfo.sentDate);

    if (remInfo.status === "confirmed") {
      if (forPrint && sentDateStr && sentDateStr !== statusDateStr) {
        return `Confirmed ${statusDateStr} (Sent ${sentDateStr})`;
      }
      return `Confirmed ${statusDateStr}`;
    }
    if (remInfo.status === "requested_sub") {
      return forPrint ? `Requested Sub (Sent ${sentDateStr})` : "Requested Sub";
    }
    if (remInfo.status === "sent") {
      if (forPrint && sentDateStr && sentDateStr !== statusDateStr) {
        return `Reminder sent ${statusDateStr} (Sent ${sentDateStr})`;
      }
      return `Reminder sent ${statusDateStr}`;
    }
    return `Assignment sent ${sentDateStr}`;
  }

  function getActiveConductorReminder(conductorName, state) {
    if (!state.reminders || !conductorName) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcomingSlots = getAllScheduleSlots(state).filter(
      s => s.slotDate >= today && s.conductor === conductorName
    );
    for (const slot of upcomingSlots) {
      const rem = getReminderForSlot(slot.dateKey, conductorName, state);
      if (rem) {
        return {
          dateKey: slot.dateKey,
          formattedDate: slot.formattedDate,
          sentDate: rem.sentDate,
          statusDate: rem.statusDate,
          status: rem.status
        };
      }
    }
    return null;
  }

  function recordReminderSent(dateKey, conductorName, silent = false, skipAutoPush = false) {
    if (!dateKey || !conductorName) return;
    const state = loadAppState();
    recordUndoSnapshot("Tag Assignment Sent", state);
    if (!state.reminders) state.reminders = {};
    const todayStr = getTodayLocalKey();
    const existing = state.reminders[dateKey];
    const keepExisting = existing && existing.conductor === conductorName;
    state.reminders[dateKey] = {
      conductor: conductorName,
      sentDate: keepExisting && existing.sentDate ? existing.sentDate : todayStr,
      statusDate: keepExisting && existing.statusDate ? existing.statusDate : todayStr,
      status: keepExisting && existing.status ? (existing.status === "needs_sub" ? "requested_sub" : existing.status) : "assignment_sent"
    };
    touchDateField(state, "reminders", dateKey);
    saveAppState(state, skipAutoPush);
    refreshShareReminderBanner();
    if (!silent) {
      showStatus(`Tagged ${conductorName}: ${formatReminderStatusText(state.reminders[dateKey])}`);
    }
  }

  function cycleReminderStatus(dateKey, event) {
    if (event) event.stopPropagation();
    if (!dateKey) return;
    const state = loadAppState();
    const entry = state.reminders && state.reminders[dateKey];
    if (!entry) return;

    recordUndoSnapshot("Update Assignment Status", state);
    const order = ["assignment_sent", "sent", "confirmed", "requested_sub"];
    const current = entry.status === "needs_sub" ? "requested_sub" : (entry.status || "assignment_sent");
    const nextIndex = order.indexOf(current) === -1 ? 0 : (order.indexOf(current) + 1) % order.length;
    const nextStatus = order[nextIndex];
    const todayStr = getTodayLocalKey();

    entry.status = nextStatus;
    entry.statusDate = todayStr;
    if (!entry.sentDate) entry.sentDate = todayStr;

    touchDateField(state, "reminders", dateKey);
    saveAppState(state);
    refreshShareReminderBanner();

    const formatted = formatReminderStatusText(entry);
    showStatus(`${entry.conductor}: ${formatted}`);
  }

  function clearReminderTag(dateKey, event) {
    if (event) event.stopPropagation();
    if (!dateKey) return;
    const state = loadAppState();
    if (state.reminders && state.reminders[dateKey]) {
      recordUndoSnapshot("Clear Reminder Tag", state);
      delete state.reminders[dateKey];
      touchDateField(state, "reminders", dateKey);
      saveAppState(state);
      refreshShareReminderBanner();
      showStatus("Cleared reminder tag.");
    }
  }

  function getShareTargetSlotInfo(state) {
    if (activeShareContext.mode === "single" && activeShareContext.conductorName) {
      return {
        conductorName: activeShareContext.conductorName,
        dateKey: activeShareContext.targetDateKey
      };
    }
    if (isQueueActive()) {
      const item = activeShareContext.queueItems[activeShareContext.queueIndex];
      if (item && item.dates && item.dates.length > 0) {
        return {
          conductorName: item.name,
          dateKey: item.dates[0].dateKey
        };
      }
    }
    return { conductorName: null, dateKey: null };
  }

  function refreshShareReminderBanner() {
    const banner = document.getElementById("shareReminderStatusBanner");
    const textEl = document.getElementById("shareReminderStatusText");
    const markBtn = document.getElementById("btnMarkReminderSent");
    if (!banner || !textEl || !markBtn) return;

    const state = loadAppState();
    const { conductorName, dateKey } = getShareTargetSlotInfo(state);

    if (!conductorName || !dateKey) {
      banner.classList.remove("open", "status-confirmed", "status-needs_sub");
      markBtn.style.display = "none";
      return;
    }

    markBtn.style.display = "inline-flex";
    const rem = getReminderForSlot(dateKey, conductorName, state);
    banner.classList.remove("status-confirmed", "status-requested_sub", "status-needs_sub");
    if (rem) {
      textEl.innerText = formatReminderStatusText(rem, false, false);
      if (rem.status === "confirmed") banner.classList.add("status-confirmed");
      if (rem.status === "requested_sub" || rem.status === "needs_sub") banner.classList.add("status-requested_sub");
      banner.classList.add("open");
    } else {
      banner.classList.remove("open");
    }
  }

  function manualMarkReminderSent() {
    const state = loadAppState();
    const { conductorName, dateKey } = getShareTargetSlotInfo(state);
    if (conductorName && dateKey) {
      recordReminderSent(dateKey, conductorName, false);
    }
  }

  function cycleActiveShareReminderStatus() {
    const state = loadAppState();
    const { dateKey } = getShareTargetSlotInfo(state);
    if (dateKey) {
      cycleReminderStatus(dateKey);
    }
  }

  function clearActiveShareReminder() {
    const state = loadAppState();
    const { dateKey } = getShareTargetSlotInfo(state);
    if (dateKey) {
      clearReminderTag(dateKey);
    }
  }
