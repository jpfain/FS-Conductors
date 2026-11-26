  /* --- UNIFIED STATE ARCHITECTURE --- */
  function loadAppState() {
    const saved = cachedScheduleState
      ? JSON.stringify(cachedScheduleState)
      : getLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY);
    if (saved) {
      let parsed = null;
      try {
        parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.roster)) {
          throw new Error("Invalid saved schedule format.");
        }
      } catch (err) {
        parsed = null;
        const recoveryKey = `conductor_schedule_state_recovery_${Date.now()}`;
        if (!setLocalStorageValue(recoveryKey, saved)) {
          const storageErr = new Error("The invalid saved schedule could not be preserved.");
          reportStorageError("Could not preserve invalid schedule data.", storageErr);
          alert("Saved schedule data could not be read, and a recovery copy could not be saved. Do not clear this site's browser data; contact support before continuing.");
          throw storageErr;
        }
        console.error("Saved schedule data is invalid; a recovery copy was preserved.", err);
        alert(`Saved schedule data could not be read. An untouched recovery copy is preserved in this browser as "${recoveryKey}". A new default schedule will be loaded; recover that copy before making changes if you need the previous schedule.`);
      }

      if (parsed) {
        if (!parsed.templates) parsed.templates = { ...DEFAULT_TEMPLATES };
        if (!parsed.rotationStartDate) parsed.rotationStartDate = DEFAULT_ANCHOR_DATE;
        if (!parsed.defaultTime) parsed.defaultTime = DEFAULT_MEETING_TIME;
        if (!parsed.defaultLocation) parsed.defaultLocation = DEFAULT_MEETING_LOCATION;
        if (parsed.lockPastDates === undefined) parsed.lockPastDates = true;
        if (!parsed.lockedHistory) parsed.lockedHistory = {};
        if (!parsed.contacts) parsed.contacts = {};
        if (!parsed.unavailability) parsed.unavailability = {};
        if (!parsed.reminders) parsed.reminders = {};
        if (!parsed.overrides) parsed.overrides = {};
        if (!parsed.blackouts) parsed.blackouts = {};
        if (!parsed.slotDetails) parsed.slotDetails = {};
        if (!parsed.lastModified) parsed.lastModified = "1970-01-01T00:00:00.000Z";

        ensureFieldTimestamps(parsed);
        const historyChanged = snapshotPastDates(parsed);
        cacheScheduleState(parsed);
        if (historyChanged && appStorageInitialized) {
          persistScheduleState(parsed).catch((error) => {
            showStatus(`Past schedule history could not be saved: ${error.message}`);
          });
        }
        return cloneScheduleState(parsed);
      }
    }

    const defaultRoster = ["Julian Ramirez", "Judy Fain", "Dow Stephens", "Martin Tavarez", "Stacy Jaffnson"];
    const newState = ensureFieldTimestamps({
      roster: defaultRoster,
      contacts: {},
      unavailability: {},
      reminders: {},
      overrides: {},
      blackouts: {},
      slotDetails: {},
      lockedHistory: {},
      lockPastDates: true,
      defaultTime: DEFAULT_MEETING_TIME,
      defaultLocation: DEFAULT_MEETING_LOCATION,
      templates: { ...DEFAULT_TEMPLATES },
      rotationStartDate: DEFAULT_ANCHOR_DATE,
      lastModified: "1970-01-01T00:00:00.000Z"
    });
    snapshotPastDates(newState);
    cacheScheduleState(newState);
    return cloneScheduleState(newState);
  }

  function saveAppState(state, skipAutoPush = false) {
    ensureFieldTimestamps(state);
    snapshotPastDates(state);
    state.lastModified = new Date().toISOString();
    persistScheduleState(state).catch((error) => {
      showStatus(`Schedule changes could not be saved: ${error.message}`);
    });
    publishScheduleState(state, "merge");
    renderUI();
    if (!skipAutoPush) {
      scheduleCloudPush();
    }
  }

  function updateRotationStartDate(dateValue) {
    const state = loadAppState();
    recordUndoSnapshot("Change Start #1 Date", state);
    snapshotPastDates(state);
    state.rotationStartDate = dateValue || DEFAULT_ANCHOR_DATE;
    touchCoreState(state);
    saveAppState(state);
    showStatus("Rotation start date updated!");
  }

  function getMeetingSaturdays(year, month) {
    let saturdays = [];
    let date = new Date(year, month, 1);
    while (date.getMonth() === month) {
      if (date.getDay() === 6) saturdays.push(date.getDate());
      date.setDate(date.getDate() + 1);
    }
    return { second: saturdays[1], fourth: saturdays[3], fifth: saturdays[4] };
  }

  function computeRotationalAssignmentInfo(targetYear, targetMonth, targetDay, state) {
    if (!state.roster || state.roster.length === 0) {
      return { conductor: "Unassigned", baseConductor: "Unassigned", skippedUnavailable: [], isLocked: false };
    }

    const anchorDateKey = state.rotationStartDate || DEFAULT_ANCHOR_DATE;
    const anchorYear = parseInt(anchorDateKey.split("-")[0], 10) || START_YEAR;
    const endYear = Math.max(targetYear, anchorYear, new Date().getFullYear() + 3);

    let activeMeetings = [];
    for (let y = START_YEAR; y <= endYear; y++) {
      for (let m = 0; m < 12; m++) {
        const sats = getMeetingSaturdays(y, m);
        [sats.second, sats.fourth, sats.fifth].forEach(day => {
          if (!day) return;
          const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          if (!state.blackouts || !state.blackouts[dateKey]) {
            activeMeetings.push(dateKey);
          }
        });
      }
    }

    const targetKey = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    const targetIndex = activeMeetings.indexOf(targetKey);
    if (targetIndex === -1) {
      return { conductor: state.roster[0], baseConductor: state.roster[0], skippedUnavailable: [], isLocked: false };
    }

    let anchorIndex = activeMeetings.findIndex(k => k >= anchorDateKey);
    if (anchorIndex === -1) anchorIndex = 0;

    const offset = targetIndex - anchorIndex;
    const len = state.roster.length;
    const baseIndex = ((offset % len) + len) % len;
    const baseConductor = state.roster[baseIndex];

    const unavailMap = state.unavailability || {};
    let skipped = [];

    for (let step = 0; step < len; step++) {
      const candidateIndex = (baseIndex + step) % len;
      const candidateName = state.roster[candidateIndex];
      const unavailableDates = unavailMap[candidateName] || [];
      if (!unavailableDates.includes(targetKey)) {
        return { conductor: candidateName, baseConductor, skippedUnavailable: skipped, isLocked: false };
      }
      skipped.push(candidateName);
    }

    return { conductor: baseConductor, baseConductor, skippedUnavailable: [], isLocked: false };
  }

  function getRotationalAssignmentInfo(targetYear, targetMonth, targetDay, state) {
    const targetKey = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    if (isDateLocked(targetKey, state) && state.lockedHistory && state.lockedHistory[targetKey]) {
      const lockedName = state.lockedHistory[targetKey];
      return { conductor: lockedName, baseConductor: lockedName, skippedUnavailable: [], isLocked: true };
    }
    return computeRotationalAssignmentInfo(targetYear, targetMonth, targetDay, state);
  }

  function getRotationalConductor(targetYear, targetMonth, targetDay, state) {
    return getRotationalAssignmentInfo(targetYear, targetMonth, targetDay, state).conductor;
  }

  /* --- FAIRNESS & LAST-SERVED STATS ENGINE --- */
  function computeConductorStats(state, selectedYear) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    const statsStartKey = state.rotationStartDate || DEFAULT_ANCHOR_DATE;
    const allSlots = getAllScheduleSlots(state).filter(s => s.dateKey >= statsStartKey);

    const statsList = state.roster.map(name => {
      const mySlots = allSlots.filter(s => s.conductor === name);
      const pastSlots = mySlots.filter(s => s.slotDate < today);
      const lastSlot = pastSlots.length > 0 ? pastSlots[pastSlots.length - 1] : null;
      const daysSince = lastSlot ? Math.round((today.getTime() - lastSlot.slotDate.getTime()) / msPerDay) : 99999;

      const yearSlots = mySlots.filter(s => s.year === selectedYear);
      const completedYTD = yearSlots.filter(s => s.slotDate < today).length;
      const upcomingYTD = yearSlots.filter(s => s.slotDate >= today).length;
      const skippedYTD = allSlots.filter(
        s => s.year === selectedYear && Array.isArray(s.skippedUnavailable) && s.skippedUnavailable.includes(name)
      ).length;

      return {
        name,
        lastSlot,
        daysSince,
        completedYTD,
        upcomingYTD,
        skippedYTD,
        yearTotal: completedYTD + upcomingYTD
      };
    });

    const maxDays = Math.max(...statsList.map(s => s.daysSince), -1);
    statsList.forEach(s => {
      s.longestWait = statsList.length > 1 && s.daysSince === maxDays && maxDays > 0;
    });

    return statsList;
  }

  function renderStatsPanel(state) {
    const panel = document.getElementById("statsPanel");
    if (!panel) return;
    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10);
    const statsStartKey = state.rotationStartDate || DEFAULT_ANCHOR_DATE;
    const stats = computeConductorStats(state, selectedYear);

    if (stats.length === 0) {
      panel.innerHTML = `<span style="font-size:0.82rem; color:#64748b;">Add conductors to view fairness statistics.</span>`;
      return;
    }

    const rows = stats.map(s => {
      const lastLabel = s.lastSlot
        ? `${formatShortDate(s.lastSlot.dateKey)} (${s.daysSince}d ago)`
        : "No past turns yet";
      const badge = s.longestWait ? `<span class="due-longest-badge">Longest Wait</span>` : "";
      const skippedCell = s.skippedYTD > 0
        ? `<span style="background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:999px; padding:1px 7px; font-size:0.73rem; font-weight:700;" title="Skipped due to saved unavailable dates in ${selectedYear}">${s.skippedYTD}</span>`
        : `<span style="color:#94a3b8;">0</span>`;
      return `
        <tr>
          <td><strong>${escapeHtml(s.name)}</strong>${badge}</td>
          <td>${escapeHtml(lastLabel)}</td>
          <td>${s.completedYTD}</td>
          <td>${s.upcomingYTD}</td>
          <td>${skippedCell}</td>
          <td><strong>${s.yearTotal}&times;</strong></td>
        </tr>
      `;
    }).join("");

    panel.innerHTML = `
      <div style="font-size:0.75rem; color:#64748b; margin-bottom:6px;">Stats calculated from rotation start date: <strong>${escapeHtml(formatShortDate(statsStartKey))}</strong> (${escapeHtml(statsStartKey)})</div>
      <table class="stats-table">
        <thead>
          <tr>
            <th>Conductor</th>
            <th>Last Served</th>
            <th>Completed (${selectedYear})</th>
            <th>Upcoming (${selectedYear})</th>
            <th>Auto-Skipped</th>
            <th>Year Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /* --- TWO-WAY TRADE DATES MODAL CONTROLLERS --- */
  function openTradeModal() {
    const state = loadAppState();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allSlots = getAllScheduleSlots(state);
    const upcomingSlots = allSlots.filter(s => s.slotDate >= today);
    tradeCandidateSlots = upcomingSlots.length >= 2 ? upcomingSlots : allSlots;

    if (tradeCandidateSlots.length < 2) {
      alert("At least two active meeting dates are needed to trade dates.");
      return;
    }

    const sel1 = document.getElementById("tradeDate1Select");
    const sel2 = document.getElementById("tradeDate2Select");
    sel1.innerHTML = "";
    sel2.innerHTML = "";

    tradeCandidateSlots.forEach(slot => {
      const overrideLabel = slot.isOverride ? " [Override]" : "";
      const text = `${slot.formattedDate} — ${slot.conductor}${overrideLabel}`;

      const opt1 = document.createElement("option");
      opt1.value = slot.dateKey;
      opt1.innerText = text;
      sel1.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = slot.dateKey;
      opt2.innerText = text;
      sel2.appendChild(opt2);
    });

    sel1.selectedIndex = 0;
    const firstConductor = tradeCandidateSlots[0].conductor;
    const diffIdx = tradeCandidateSlots.findIndex((s, idx) => idx > 0 && s.conductor !== firstConductor);
    sel2.selectedIndex = diffIdx !== -1 ? diffIdx : 1;

    refreshTradePreview();
    openAccessibleModal("tradeModal", "tradeDate1Select");
    syncModalBodyLock();
  }

  function closeTradeModal() {
    closeAccessibleModal("tradeModal");
    syncModalBodyLock();
  }

  function refreshTradePreview() {
    const key1 = document.getElementById("tradeDate1Select").value;
    const key2 = document.getElementById("tradeDate2Select").value;
    const previewBox = document.getElementById("tradePreviewBox");
    const confirmBtn = document.getElementById("btnConfirmTrade");

    const slot1 = tradeCandidateSlots.find(s => s.dateKey === key1);
    const slot2 = tradeCandidateSlots.find(s => s.dateKey === key2);
    if (!slot1 || !slot2) return;

    if (key1 === key2) {
      confirmBtn.disabled = true;
      previewBox.innerHTML = `<span style="color: var(--danger); font-weight: 600;">Select two different meeting dates to trade.</span>`;
      return;
    }

    if (slot1.conductor === slot2.conductor) {
      confirmBtn.disabled = true;
      previewBox.innerHTML = `<span style="color: var(--warning-text); font-weight: 600;">Both selected dates are already assigned to ${escapeHtml(slot1.conductor)}. Choose a date with a different conductor.</span>`;
      return;
    }

    confirmBtn.disabled = false;
    previewBox.innerHTML = `
      <div class="trade-row">
        <span class="trade-date-label">${escapeHtml(slot1.formattedDate)}</span>
        <span class="trade-shift">${escapeHtml(slot1.conductor)} &rarr; <span class="new-name">${escapeHtml(slot2.conductor)}</span></span>
      </div>
      <div class="trade-row">
        <span class="trade-date-label">${escapeHtml(slot2.formattedDate)}</span>
        <span class="trade-shift">${escapeHtml(slot2.conductor)} &rarr; <span class="new-name">${escapeHtml(slot1.conductor)}</span></span>
      </div>
      <div class="trade-note">
        Yearly assignment counts stay balanced, and all other future rotation dates remain unchanged.
      </div>
    `;
  }

  function applyDateTrade() {
    const key1 = document.getElementById("tradeDate1Select").value;
    const key2 = document.getElementById("tradeDate2Select").value;

    const slot1 = tradeCandidateSlots.find(s => s.dateKey === key1);
    const slot2 = tradeCandidateSlots.find(s => s.dateKey === key2);
    if (!slot1 || !slot2 || key1 === key2 || slot1.conductor === slot2.conductor) return;

    const state = loadAppState();
    recordUndoSnapshot(`Trade ${slot1.conductor} & ${slot2.conductor}`, state);
    if (!state.overrides) state.overrides = {};

    const newCond1 = slot2.conductor;
    const newCond2 = slot1.conductor;

    if (newCond1 === slot1.autoConductor) delete state.overrides[key1];
    else state.overrides[key1] = newCond1;
    touchDateField(state, "overrides", key1);

    if (newCond2 === slot2.autoConductor) delete state.overrides[key2];
    else state.overrides[key2] = newCond2;
    touchDateField(state, "overrides", key2);

    saveAppState(state);
    closeTradeModal();
    showStatus(`Traded ${slot1.conductor} (${slot1.formattedDate}) with ${slot2.conductor} (${slot2.formattedDate})!`);
  }

  /* --- ROSTER, CONTACT & DATE-RANGE UNAVAILABILITY CONTROLLERS --- */
  function addConductor() {
    const nameInput = document.getElementById("newConductorInput");
    const phoneInput = document.getElementById("newConductorPhone");
    const emailInput = document.getElementById("newConductorEmail");

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();

    if (!name) {
      nameInput.focus();
      return;
    }

    const state = loadAppState();
    recordUndoSnapshot(`Add ${name}`, state);
    snapshotPastDates(state);
    if (!state.contacts) state.contacts = {};
    state.roster.push(name);
    if (phone || email) state.contacts[name] = { phone, email };

    toggleAddConductorDrawer(false);
    touchCoreState(state);
    saveAppState(state);
    showStatus(`Added ${name} to roster!`);
  }

  function removeConductorFromModal() {
    if (editingRosterIndex === null) return;
    const state = loadAppState();
    const name = state.roster[editingRosterIndex];
    if (!name) return;

    if (confirm(`Remove "${name}" from the Approved Conductors roster?`)) {
      recordUndoSnapshot(`Remove ${name}`, state);
      snapshotPastDates(state);
      state.roster.splice(editingRosterIndex, 1);
      if (state.contacts) delete state.contacts[name];
      if (state.unavailability) delete state.unavailability[name];
      closeContactModal();
      touchCoreState(state);
      saveAppState(state);
      showStatus(`Removed ${name} from roster.`);
    }
  }

  function moveConductor(index, direction) {
    const state = loadAppState();
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.roster.length) return;

    recordUndoSnapshot(`Reorder ${state.roster[index]}`, state);
    snapshotPastDates(state);
    const temp = state.roster[index];
    state.roster[index] = state.roster[newIndex];
    state.roster[newIndex] = temp;
    touchCoreState(state);
    saveAppState(state);
    return newIndex;
  }

  function reorderFromContactModal(direction) {
    if (editingRosterIndex === null) return;
    const state = loadAppState();
    const nextIdx = editingRosterIndex + direction;
    if (nextIdx < 0 || nextIdx >= state.roster.length) return;
    moveConductor(editingRosterIndex, direction);
    editingRosterIndex = nextIdx;
    const updatedState = loadAppState();
    const earlierBtn = document.getElementById("btnModalMoveEarlier");
    const laterBtn = document.getElementById("btnModalMoveLater");
    if (earlierBtn) earlierBtn.disabled = editingRosterIndex === 0;
    if (laterBtn) laterBtn.disabled = editingRosterIndex === updatedState.roster.length - 1;
    showStatus(`Updated rotation order (#${editingRosterIndex + 1})`);
  }

  function openContactModal(index) {
    const state = loadAppState();
    const name = state.roster[index];
    if (!name) return;

    editingRosterIndex = index;
    const contact = (state.contacts && state.contacts[name]) || { phone: "", email: "" };
    tempUnavailableDates = [...((state.unavailability && state.unavailability[name]) || [])].sort();

    document.getElementById("editConductorName").value = name;
    const earlierBtn = document.getElementById("btnModalMoveEarlier");
    const laterBtn = document.getElementById("btnModalMoveLater");
    if (earlierBtn) earlierBtn.disabled = index === 0;
    if (laterBtn) laterBtn.disabled = index === state.roster.length - 1;
    document.getElementById("editConductorPhone").value = contact.phone || "";
    document.getElementById("editConductorEmail").value = contact.email || "";
    document.getElementById("unavailRangeStart").value = "";
    document.getElementById("unavailRangeEnd").value = "";
    document.getElementById("addUnavailableDateInput").value = "";

    renderUpcomingSaturdayCheckboxes(state);
    renderUnavailableDatesPills();
    openAccessibleModal("contactModal", "editConductorName");
    syncModalBodyLock();
  }

  function renderUpcomingSaturdayCheckboxes(state) {
    const container = document.getElementById("upcomingSatCheckboxes");
    if (!container) return;
    container.innerHTML = "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = getAllScheduleSlots(state).filter(s => s.slotDate >= today).slice(0, 8);
    upcoming.forEach(slot => {
      const checked = tempUnavailableDates.includes(slot.dateKey);
      const label = document.createElement("label");
      label.className = "sat-check-item";
      label.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}><span>${escapeHtml(formatShortDate(slot.dateKey))}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) {
          if (!tempUnavailableDates.includes(slot.dateKey)) {
            tempUnavailableDates.push(slot.dateKey);
            tempUnavailableDates.sort();
          }
        } else {
          tempUnavailableDates = tempUnavailableDates.filter(d => d !== slot.dateKey);
        }
        renderUnavailableDatesPills();
      });
      container.appendChild(label);
    });
  }

  function addUnavailableDateRange() {
    const startVal = document.getElementById("unavailRangeStart").value;
    const endVal = document.getElementById("unavailRangeEnd").value;
    if (!startVal || !endVal) {
      alert("Select both a 'Vacation From' and 'Vacation To' date.");
      return;
    }
    if (endVal < startVal) {
      alert("'Vacation To' date must be on or after 'Vacation From' date.");
      return;
    }

    const startParts = startVal.split("-").map(Number);
    const endParts = endVal.split("-").map(Number);
    let cursor = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    let addedCount = 0;
    while (cursor <= endDate) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const d = cursor.getDate();
      const sats = getMeetingSaturdays(y, m);
      if (d === sats.second || d === sats.fourth || d === sats.fifth || startVal === endVal) {
        const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!tempUnavailableDates.includes(key)) {
          tempUnavailableDates.push(key);
          addedCount++;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    tempUnavailableDates.sort();
    document.getElementById("unavailRangeStart").value = "";
    document.getElementById("unavailRangeEnd").value = "";
    renderUpcomingSaturdayCheckboxes(loadAppState());
    renderUnavailableDatesPills();
    if (addedCount === 0) {
      alert("No meeting Saturdays fell inside that range (or they were already added).");
    }
  }

  function renderUnavailableDatesPills() {
    const container = document.getElementById("unavailableDatesList");
    container.innerHTML = "";
    if (tempUnavailableDates.length === 0) {
      container.innerHTML = `<span style="font-size:0.78rem; color:#94a3b8;">No unavailable dates set.</span>`;
      return;
    }

    tempUnavailableDates.forEach(dateKey => {
      const displayDate = formatShortDate(dateKey);
      const pill = document.createElement("span");
      pill.className = "unavail-pill";
      pill.innerHTML = `<span>${escapeHtml(displayDate)}</span><button type="button" title="Remove date" onclick="removeUnavailableDate('${escapeHtml(dateKey)}')">&times;</button>`;
      container.appendChild(pill);
    });
  }

  function addUnavailableDate() {
    const input = document.getElementById("addUnavailableDateInput");
    const val = input.value;
    if (!val) return;
    if (!tempUnavailableDates.includes(val)) {
      tempUnavailableDates.push(val);
      tempUnavailableDates.sort();
      renderUpcomingSaturdayCheckboxes(loadAppState());
      renderUnavailableDatesPills();
    }
    input.value = "";
  }

  function removeUnavailableDate(dateKey) {
    tempUnavailableDates = tempUnavailableDates.filter(d => d !== dateKey);
    renderUpcomingSaturdayCheckboxes(loadAppState());
    renderUnavailableDatesPills();
  }

  function closeContactModal() {
    closeAccessibleModal("contactModal");
    editingRosterIndex = null;
    tempUnavailableDates = [];
    syncModalBodyLock();
  }

  function saveConductorContact() {
    if (editingRosterIndex === null) return;
    const state = loadAppState();
    recordUndoSnapshot("Edit Conductor Details", state);
    snapshotPastDates(state);

    if (!state.contacts) state.contacts = {};
    if (!state.unavailability) state.unavailability = {};
    if (!state.reminders) state.reminders = {};

    const oldName = state.roster[editingRosterIndex];
    const newName = document.getElementById("editConductorName").value.trim();
    const phone = document.getElementById("editConductorPhone").value.trim();
    const email = document.getElementById("editConductorEmail").value.trim();

    if (!newName) {
      alert("Conductor name cannot be empty.");
      return;
    }

    state.roster[editingRosterIndex] = newName;

    if (oldName !== newName) {
      delete state.contacts[oldName];
      delete state.unavailability[oldName];
      if (state.overrides) {
        Object.keys(state.overrides).forEach(dateKey => {
          if (state.overrides[dateKey] === oldName) {
            state.overrides[dateKey] = newName;
            touchDateField(state, "overrides", dateKey);
          }
        });
      }
      if (state.lockedHistory) {
        Object.keys(state.lockedHistory).forEach(dateKey => {
          if (state.lockedHistory[dateKey] === oldName) {
            state.lockedHistory[dateKey] = newName;
          }
        });
      }
      Object.keys(state.reminders).forEach(dateKey => {
        if (state.reminders[dateKey] && state.reminders[dateKey].conductor === oldName) {
          state.reminders[dateKey].conductor = newName;
          touchDateField(state, "reminders", dateKey);
        }
      });
      if (activeShareContext.conductorName === oldName) {
        activeShareContext.conductorName = newName;
      }
    }

    state.contacts[newName] = { phone, email };
    if (tempUnavailableDates.length > 0) {
      state.unavailability[newName] = [...tempUnavailableDates];
    } else {
      delete state.unavailability[newName];
    }

    touchCoreState(state);
    saveAppState(state);
    closeContactModal();
    showStatus(`Saved details for ${newName}!`);

    if (document.getElementById("shareModal").classList.contains("open")) {
      if (activeShareContext.mode === "single") {
        document.getElementById("shareModalTitle").innerText = `Share Schedule: ${activeShareContext.conductorName}`;
      }
      populateShareRecipients();
      refreshShareModalPreview();
    }
  }

  function renderRoster(state) {
    const dateInput = document.getElementById("rotationStartDateInput");
    if (dateInput) dateInput.value = state.rotationStartDate || DEFAULT_ANCHOR_DATE;

    const countBadge = document.getElementById("rosterCountBadge");
    if (countBadge) countBadge.innerText = state.roster.length;

    const lockBtn = document.getElementById("btnHistoryLock");
    if (lockBtn) {
      const locked = state.lockPastDates !== false;
      lockBtn.className = locked ? "lock-pill-btn" : "lock-pill-btn unlocked";
      lockBtn.innerText = locked ? "🔒 Past Locked" : "🔓 Past Unlocked";
    }

    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10);
    const statsList = computeConductorStats(state, selectedYear);
    const statsByName = {};
    statsList.forEach(s => { statsByName[s.name] = s; });

    if (document.getElementById("statsPanel").classList.contains("open")) {
      renderStatsPanel(state);
    }

    const container = document.getElementById("rosterContainer");
    container.innerHTML = "";
    if (state.roster.length === 0) {
      container.innerHTML = `<span style="font-size:0.85rem; color:#94a3b8;">No conductors added yet. Click "+ Add Conductor" above.</span>`;
      return;
    }

    state.roster.forEach((name, index) => {
      const tag = document.createElement("div");
      tag.className = "tag";
      const contact = (state.contacts && state.contacts[name]) || {};
      const unavail = (state.unavailability && state.unavailability[name]) || [];
      const tally = (statsByName[name] && statsByName[name].yearTotal) || 0;
      const activeReminder = getActiveConductorReminder(name, state);

      let badges = "";
      if (contact.phone) badges += `<span title="Mobile: ${escapeHtml(contact.phone)}">📱</span>`;
      if (contact.email) badges += `<span title="Email: ${escapeHtml(contact.email)}">✉️</span>`;
      if (unavail.length > 0) badges += `<span title="Unavailable dates: ${escapeHtml(unavail.join(', '))}">🚫</span>`;

      const statusClass = activeReminder && activeReminder.status !== "sent" ? ` status-${activeReminder.status}` : "";
      const reminderNoteHtml = activeReminder
        ? `<div class="reminder-sent-pill${statusClass}">
             <button type="button" class="pill-cycle-text" title="Cycle reminder status" aria-label="Cycle reminder status for ${escapeHtml(name)} on ${escapeHtml(activeReminder.dateKey)}" onclick="cycleReminderStatus('${escapeHtml(activeReminder.dateKey)}', event)">${escapeHtml(formatReminderStatusText(activeReminder, false))}</button>
             <button type="button" title="Clear tag" aria-label="Clear reminder status for ${escapeHtml(name)}" onclick="clearReminderTag('${escapeHtml(activeReminder.dateKey)}', event)">&times;</button>
           </div>`
        : "";

      tag.innerHTML = `
        <div class="tag-top-row">
          <div class="tag-identity">
            <span class="tag-num">${index + 1}</span>
            <span class="tag-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          </div>
          <div class="tag-meta">
            ${badges ? `<span class="tag-contact-badges">${badges}</span>` : ""}
            <span class="tag-tally" title="${tally} assigned dates in ${selectedYear}">${tally}&times;</span>
          </div>
        </div>
        ${reminderNoteHtml}
        <div class="tag-actions">
          <button type="button" class="tag-icon-btn share-btn" data-name="${encodeURIComponent(name)}" title="Send Text or Email schedule" aria-label="Send schedule to ${escapeHtml(name)}">${ROSTER_ICONS.message}</button>
          <button type="button" class="tag-icon-btn ics-btn" data-name="${encodeURIComponent(name)}" title="Download personal .ics calendar file" aria-label="Download .ics calendar for ${escapeHtml(name)}">${ROSTER_ICONS.calendarDownload}</button>
          <button type="button" class="tag-icon-btn" onclick="openContactModal(${index})" title="Edit contact, rotation order, unavailable dates, or remove" aria-label="Edit ${escapeHtml(name)}">${ROSTER_ICONS.edit}</button>
        </div>
      `;

      tag.querySelector('.ics-btn').addEventListener('click', (e) => {
        downloadConductorICS(decodeURIComponent(e.currentTarget.dataset.name));
      });
      tag.querySelector('.share-btn').addEventListener('click', (e) => {
        const conductor = decodeURIComponent(e.currentTarget.dataset.name);
        const currentState = loadAppState();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextForConductor = getAllScheduleSlots(currentState).find(
          s => s.slotDate >= today && s.conductor === conductor
        );
        openShareModal('single', conductor, 'text', nextForConductor ? nextForConductor.dateKey : null);
      });

      container.appendChild(tag);
    });
  }

  /* --- UP NEXT QUICK-ACTION BANNER WITH STATS-ENHANCED QUICK REPLACE --- */
  function renderUpNextBanner(state) {
    const banner = document.getElementById("upNextBanner");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allSlots = getAllScheduleSlots(state);
    const nextSlot = allSlots.find(s => s.slotDate >= today);

    if (!nextSlot || !state.roster || state.roster.length === 0) {
      banner.style.display = "none";
      currentUpNextSlot = null;
      return;
    }

    currentUpNextSlot = nextSlot;
    banner.style.display = "flex";

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntil = Math.round((nextSlot.slotDate.getTime() - today.getTime()) / msPerDay);
    const isToday = daysUntil === 0;

    document.getElementById("upNextTodayBadge").style.display = isToday ? "inline-block" : "none";
    document.getElementById("upNextDateLabel").innerText = nextSlot.formattedDate;
    document.getElementById("upNextConductorName").innerText = nextSlot.conductor;

    const slotTL = getSlotTimeLocation(state, nextSlot.dateKey);
    document.getElementById("upNextSubtext").innerHTML = `
      <span>${escapeHtml(slotTL.time)} &bull; ${escapeHtml(slotTL.location)}</span>
      <button type="button" class="btn-link" style="font-size:0.74rem; color:var(--accent);" onclick="openTimeLocModal('${escapeHtml(nextSlot.dateKey)}')">✏️ Edit Time/Loc</button>
    `;

    const contact = (state.contacts && state.contacts[nextSlot.conductor]) || {};
    let badgesHtml = "";
    if (contact.phone) badgesHtml += `<span title="Mobile saved">📱</span> `;
    if (contact.email) badgesHtml += `<span title="Email saved">✉️</span> `;
    if (nextSlot.isOverride) {
      badgesHtml += `<span class="badge badge-override">Override</span>`;
    } else if (nextSlot.skippedUnavailable && nextSlot.skippedUnavailable.length > 0) {
      badgesHtml += `<span class="badge badge-reassigned" title="Auto-reassigned because ${escapeHtml(nextSlot.skippedUnavailable.join(', '))} marked unavailable">Auto-Reassigned</span>`;
    } else {
      badgesHtml += `<span class="badge badge-standard">Auto</span>`;
    }
    document.getElementById("upNextBadges").innerHTML = badgesHtml;

    const remWrap = document.getElementById("upNextReminderTagWrap");
    const activeRem = getReminderForSlot(nextSlot.dateKey, nextSlot.conductor, state);
    if (activeRem) {
      const statusClass = activeRem.status !== "sent" ? ` status-${activeRem.status}` : "";
      remWrap.innerHTML = `
        <div class="reminder-sent-pill${statusClass}" style="margin-top: 2px;">
          <button type="button" class="pill-cycle-text" title="Cycle reminder status" aria-label="Cycle reminder status for ${escapeHtml(nextSlot.conductor)} on ${escapeHtml(nextSlot.dateKey)}" onclick="cycleReminderStatus('${escapeHtml(nextSlot.dateKey)}', event)">${escapeHtml(formatReminderStatusText(activeRem, false))}</button>
          <button type="button" title="Clear tag" aria-label="Clear reminder status for ${escapeHtml(nextSlot.conductor)}" onclick="clearReminderTag('${escapeHtml(nextSlot.dateKey)}', event)">&times;</button>
        </div>
      `;
    } else if (daysUntil >= 0 && daysUntil <= 4) {
      const whenLabel = daysUntil === 0
        ? "Meeting is today"
        : (daysUntil === 1 ? "Tomorrow" : `In ${daysUntil} days`);
      remWrap.innerHTML = `
        <div class="reminder-due-pill" style="margin-top: 2px;">
          <span>⏰ Reminder due (${escapeHtml(whenLabel)})</span>
        </div>
      `;
    } else {
      remWrap.innerHTML = "";
    }

    const replaceSelect = document.getElementById("quickReplaceSelect");
    replaceSelect.innerHTML = "";
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.innerText = `Auto (${nextSlot.autoConductor})`;
    replaceSelect.appendChild(autoOpt);

    const selectedYear = nextSlot.year;
    const stats = computeConductorStats(state, selectedYear);
    stats.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.name;
      const lastHint = s.lastSlot ? `Last: ${formatShortDate(s.lastSlot.dateKey).replace(/,\s*\d{4}$/, '')} (${s.daysSince}d)` : "Last: None";
      opt.innerText = `${s.name} — ${lastHint} • ${s.yearTotal}×`;
      replaceSelect.appendChild(opt);
    });
    replaceSelect.value = (state.overrides && state.overrides[nextSlot.dateKey]) || "";
  }

  function toggleQuickReplace(forceState) {
    const box = document.getElementById("quickReplaceBox");
    const btn = document.getElementById("btnOpenQuickReplace");
    const shouldOpen = typeof forceState === "boolean" ? forceState : !box.classList.contains("open");
    box.classList.toggle("open", shouldOpen);
    btn.style.display = shouldOpen ? "none" : "inline-flex";
  }

  function applyQuickReplace(conductorName) {
    if (!currentUpNextSlot) return;
    setOverride(currentUpNextSlot.dateKey, conductorName);
    toggleQuickReplace(false);
    showStatus(conductorName ? `Replaced ${currentUpNextSlot.formattedDate} with ${conductorName}` : "Restored automatic rotation");
  }

  function remindUpNextConductor() {
    if (!currentUpNextSlot) return;
    openShareModal("single", currentUpNextSlot.conductor, "text", currentUpNextSlot.dateKey);
  }

  /* --- VIEW & CALENDAR CONTROLLERS --- */
  function setViewMode(mode) {
    currentViewMode = mode;
    document.getElementById("btnViewCalendar").className = mode === 'calendar' ? 'active' : 'outline';
    document.getElementById("btnViewTable").className = mode === 'table' ? 'active' : 'outline';
    document.getElementById("calendarViewSection").style.display = mode === 'calendar' ? 'block' : 'none';
    document.getElementById("tableViewSection").style.display = mode === 'table' ? 'block' : 'none';
    renderUI();
  }

  function changeMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    populateYearSelect();
    renderUI();
  }

  function goToToday() {
    currentDate = new Date();
    populateYearSelect();
    renderUI();
  }

  function handleYearChange() {
    const year = parseInt(document.getElementById("yearSelect").value, 10);
    currentDate.setFullYear(year);
    renderUI();
  }

  function setOverride(dateKey, conductorName) {
    const state = loadAppState();
    recordUndoSnapshot(`Assign ${conductorName || "Auto"} on ${formatShortDate(dateKey)}`, state);
    if (!conductorName) {
      delete state.overrides[dateKey];
    } else {
      state.overrides[dateKey] = conductorName;
    }
    touchDateField(state, "overrides", dateKey);
    saveAppState(state);
  }

  function renderUI() {
    const badgeEl = document.getElementById("appVersionBadge");
    if (badgeEl) badgeEl.innerText = APP_VERSION;

    populateYearSelect();
    updateCloudSyncPill();
    updateUndoButton();
    const state = loadAppState();
    renderRoster(state);
    renderUpNextBanner(state);

    if (currentViewMode === "calendar") {
      renderCalendarView(state);
    } else {
      renderTableView(state);
    }
  }

  function renderCalendarView(state) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    document.getElementById("monthYearTitle").innerText = `${monthNames[month]} ${year}`;
    const grid = document.getElementById("calendarGrid");
    grid.innerHTML = "";

    const dayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    dayHeaders.forEach(day => {
      const header = document.createElement("div");
      header.className = "day-header";
      header.innerText = day;
      grid.appendChild(header);
    });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const meetingSaturdays = getMeetingSaturdays(year, month);
    const today = new Date();

    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement("div");
      emptyCell.className = "day-cell empty";
      grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= totalDays; day++) {
      const cell = document.createElement("div");
      cell.className = "day-cell";

      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
      if (isToday) cell.style.border = "2px solid var(--danger)";

      const is2ndSaturday = day === meetingSaturdays.second;
      const is4thSaturday = day === meetingSaturdays.fourth;
      const is5thSaturday = day === meetingSaturdays.fifth;

      const monthStr = String(month + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      const dateKey = `${year}-${monthStr}-${dayStr}`;
      const lockedPast = (is2ndSaturday || is4thSaturday || is5thSaturday) && isDateLocked(dateKey, state);

      const dayNum = document.createElement("div");
      dayNum.className = "day-number";
      dayNum.innerHTML = `<span>${day}</span>${lockedPast ? '<span title="Historical date locked" style="font-size:0.72rem; opacity:0.7;">🔒</span>' : ''}`;
      cell.appendChild(dayNum);

      if (is2ndSaturday || is4thSaturday || is5thSaturday) {
        const blackoutReason = getBlackoutReason(state.blackouts, dateKey);
        const savedOverride = state.overrides[dateKey];
        const autoAssigned = getRotationalConductor(year, month, day, state);

        if (blackoutReason) {
          cell.classList.add("blackout");
          const tag = document.createElement("div");
          tag.className = "blackout-tag";
          tag.innerText = "Cancelled";
          cell.appendChild(tag);

          if (blackoutReason !== "Cancelled") {
            const reasonDiv = document.createElement("div");
            reasonDiv.className = "blackout-reason-text";
            reasonDiv.innerText = blackoutReason;
            cell.appendChild(reasonDiv);
          }
        } else {
          cell.classList.add("meeting");
          if (lockedPast) cell.classList.add("past-locked");

          const tag = document.createElement("div");
          tag.className = "meeting-tag";
          if (is2ndSaturday) tag.innerText = "2nd Sat Meeting";
          else if (is4thSaturday) tag.innerText = "4th Sat Meeting";
          else tag.innerText = "5th Sat Meeting";
          cell.appendChild(tag);

          const slotTL = getSlotTimeLocation(state, dateKey);
          if (slotTL.isCustom) {
            const customPill = document.createElement("div");
            customPill.className = "custom-slot-pill";
            customPill.title = `${slotTL.time} • ${slotTL.location}`;
            customPill.innerText = `📍 ${slotTL.time}`;
            customPill.onclick = () => openTimeLocModal(dateKey);
            cell.appendChild(customPill);
          }

          const activeConductor = savedOverride || autoAssigned;
          const nameParts = (activeConductor || "").trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          const nameDisplay = document.createElement("div");
          nameDisplay.className = "conductor-name-display";
          if (lastName) {
            nameDisplay.innerHTML = `<div class="first-name">${escapeHtml(firstName)}</div><div class="last-name">${escapeHtml(lastName)}</div>`;
          } else {
            nameDisplay.innerHTML = `<div class="first-name">${escapeHtml(firstName)}</div>`;
          }
          cell.appendChild(nameDisplay);

          const remInfo = getReminderForSlot(dateKey, activeConductor, state);
          if (remInfo) {
            const remBadge = document.createElement("div");
            remBadge.className = "cell-reminded-badge" + (remInfo.status !== "sent" ? ` status-${remInfo.status}` : "");
            remBadge.title = "Tap to cycle status: Assignment sent → Reminder sent → Confirmed → Requested Sub";
            remBadge.innerText = formatReminderStatusText(remInfo, true);
            remBadge.onclick = (e) => cycleReminderStatus(dateKey, e);
            cell.appendChild(remBadge);
          }

          const select = document.createElement("select");
          select.className = "conductor-select";
          if (lockedPast) select.disabled = true;

          const autoOpt = document.createElement("option");
          autoOpt.value = "";
          autoOpt.innerText = lockedPast ? `Locked (${autoAssigned})` : `Auto (${autoAssigned})`;
          select.appendChild(autoOpt);

          state.roster.forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.innerText = name;
            select.appendChild(opt);
          });

          select.value = savedOverride || "";
          select.addEventListener("change", (e) => setOverride(dateKey, e.target.value));
          cell.appendChild(select);
        }

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "cell-actions";
        if (!lockedPast) {
          actionsDiv.innerHTML = `
            <button class="btn-link" onclick="handleBlackoutAction('${dateKey}')">${blackoutReason ? 'Restore' : 'Cancel'}</button>
            ${!blackoutReason ? `<button class="btn-link" title="Custom time/location" onclick="openTimeLocModal('${dateKey}')">🕒</button>` : ''}
          `;
        } else {
          actionsDiv.innerHTML = `<span style="font-size:0.68rem; color:#64748b;">Recorded</span>`;
        }
        cell.appendChild(actionsDiv);
      }

      grid.appendChild(cell);
    }
  }

  function renderTableView(state) {
    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10);
    const tbody = document.getElementById("scheduleTableBody");
    const noticeEl = document.getElementById("yearListNotice");
    tbody.innerHTML = "";

    const assignedInYear = new Set();

    for (let month = 0; month < 12; month++) {
      const sats = getMeetingSaturdays(selectedYear, month);
      const meetingDays = [sats.second, sats.fourth, sats.fifth];

      meetingDays.forEach(day => {
        if (!day) return;
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateKey = `${selectedYear}-${monthStr}-${dayStr}`;

        const blackoutReason = getBlackoutReason(state.blackouts, dateKey);
        const override = state.overrides[dateKey];
        const assignInfo = getRotationalAssignmentInfo(selectedYear, month, day, state);
        const autoAssigned = assignInfo.conductor;
        const lockedPast = isDateLocked(dateKey, state);

        const conductor = blackoutReason
          ? (blackoutReason === "Cancelled" ? "CANCELLED / NO MEETING" : `CANCELLED — ${blackoutReason}`)
          : (override || autoAssigned);

        if (!blackoutReason && conductor) {
          assignedInYear.add(conductor);
        }

        let statusBadge = `<span class="badge badge-standard">Standard</span>`;
        if (blackoutReason) statusBadge = `<span class="badge badge-blackout">Cancelled</span>`;
        else if (override) statusBadge = `<span class="badge badge-override">Override</span>`;
        else if (assignInfo.isLocked) statusBadge = `<span class="badge badge-locked">🔒 Locked</span>`;
        else if (assignInfo.skippedUnavailable.length > 0) {
          statusBadge = `<span class="badge badge-reassigned" title="Skipped unavailable: ${escapeHtml(assignInfo.skippedUnavailable.join(', '))}">Reassigned</span>`;
        }

        const remInfo = !blackoutReason ? getReminderForSlot(dateKey, conductor, state) : null;
        if (remInfo) {
          const stClass = remInfo.status !== "sent" ? ` status-${remInfo.status}` : "";
          statusBadge += ` <button type="button" class="badge badge-reminded${stClass}" title="Tap to cycle status" aria-label="Cycle reminder status for ${escapeHtml(conductor)} on ${escapeHtml(dateKey)}" onclick="cycleReminderStatus('${escapeHtml(dateKey)}', event)">${escapeHtml(formatReminderStatusText(remInfo, true))}</button>`;
        }

        const slotTL = !blackoutReason ? getSlotTimeLocation(state, dateKey) : null;
        const customHint = slotTL && slotTL.isCustom ? `<div style="font-size:0.75rem; color:#92400e;">📍 ${escapeHtml(slotTL.time)} • ${escapeHtml(slotTL.location)}</div>` : "";

        const displayDate = new Date(selectedYear, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const satLabel = day === sats.fifth ? ' <span style="font-size:0.75rem; color:#2563eb; font-weight:600;">(5th Sat)</span>' : '';

        const row = document.createElement("tr");
        row.innerHTML = `
          <td><strong>${displayDate}</strong>${satLabel}</td>
          <td>${escapeHtml(conductor)}${customHint}</td>
          <td>${statusBadge}</td>
          <td>
            ${lockedPast
              ? `<span style="font-size:0.78rem; color:#64748b;">Historical</span>`
              : `<button class="outline" style="padding:2px 6px; min-height:auto;" onclick="promptTableOverride('${dateKey}', '${escapeHtml(override || '')}')">Override</button>
                 <button class="outline" style="padding:2px 6px; min-height:auto;" onclick="handleBlackoutAction('${dateKey}')">${blackoutReason ? 'Restore' : 'Cancel'}</button>`}
          </td>
        `;
        tbody.appendChild(row);
      });
    }

    if (noticeEl) {
      const unscheduledInYear = (state.roster || []).filter(name => !assignedInYear.has(name));
      if (unscheduledInYear.length > 0) {
        const nextYear = selectedYear + 1;
        noticeEl.innerHTML = `
          <span><strong>Note:</strong> ${escapeHtml(unscheduledInYear.join(", "))} has no remaining ${selectedYear} Saturdays because earlier ${selectedYear} dates are locked—their next rotation turn appears in <strong>${nextYear}</strong>.</span>
          <button type="button" class="outline" style="min-height: 30px; padding: 3px 10px; font-size: 0.78rem;" onclick="jumpToYear(${nextYear})">View ${nextYear} List &rarr;</button>
        `;
        noticeEl.classList.add("visible");
      } else {
        noticeEl.classList.remove("visible");
        noticeEl.innerHTML = "";
      }
    }
  }

  function promptTableOverride(dateKey, currentOverride) {
    const state = loadAppState();
    const conductorList = state.roster.join(", ");
    const choice = prompt(`Select conductor for ${dateKey}:\nAvailable: ${conductorList}`, currentOverride);
    if (choice !== null) {
      setOverride(dateKey, choice.trim());
    }
  }
