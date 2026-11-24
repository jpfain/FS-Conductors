  /* --- UNIFIED STATE ARCHITECTURE --- */
  let appStateCache = null;
  let storageRecoveryData = "";

  function createDefaultAppState() {
    return ensureFieldTimestamps({
      schemaVersion: ScheduleStateSchema.CURRENT_SCHEMA_VERSION,
      roster: ["Julian Ramirez", "Judy Fain", "Dow Stephens", "Martin Tavarez", "Stacy Jaffnson"],
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
  }

  async function initializeAppStorage() {
    const result = await ScheduleStorage.open({
      createDefaultState: createDefaultAppState,
      validate: ScheduleStateSchema.validate,
      normalize: state => ensureFieldTimestamps(ScheduleStateSchema.normalize(state, createDefaultAppState()))
    });
    appStateCache = result.state;
    storageRecoveryData = result.recoveredRaw;

    if (snapshotPastDates(appStateCache)) {
      await ScheduleStorage.persistSchedule(appStateCache);
    }

    const recoveryNotice = document.getElementById("storageRecoveryNotice");
    if (recoveryNotice) recoveryNotice.hidden = !storageRecoveryData;
    if (result.storageError) {
      showStatus(`⚠️ Storage warning: ${result.storageError}. Schedule changes will use local storage when possible.`);
    } else if (!result.usingIndexedDB) {
      showStatus("⚠️ IndexedDB is unavailable. Schedule data is using local storage on this device.");
    }
    return result;
  }

  function downloadStorageRecovery() {
    if (!storageRecoveryData) return;
    const blob = new Blob([storageRecoveryData], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `conductor-schedule-recovery-${getTodayLocalKey()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function loadAppState() {
    if (!appStateCache) throw new Error("Schedule storage has not finished initializing.");
    return appStateCache;
  }

  function saveAppState(state, skipAutoPush = false) {
    ensureFieldTimestamps(state);
    snapshotPastDates(state);
    state.schemaVersion = ScheduleStateSchema.CURRENT_SCHEMA_VERSION;
    state.lastModified = new Date().toISOString();
    appStateCache = state;
    ScheduleStorage.persistSchedule(state).then(result => {
      if (result.fallback) {
        showStatus(`⚠️ ${result.reason} Schedule saved using local storage.`);
      }
    }).catch(error => {
      showStatus(`❌ Schedule storage failed: ${error.message}. Changes may not persist.`);
    });
    renderUI();
    if (!skipAutoPush) {
      scheduleCloudPush();
    }
  }

  async function replaceAppState(state) {
    const normalized = ensureFieldTimestamps(
      ScheduleStateSchema.normalize(state, createDefaultAppState())
    );
    snapshotPastDates(normalized);
    appStateCache = normalized;
    const result = await ScheduleStorage.persistSchedule(normalized);
    if (result.fallback) {
      showStatus(`⚠️ ${result.reason} Schedule saved using local storage.`);
    }
    renderUI();
  }

  function updateRotationStartDate(dateValue) {
    const state = loadAppState();
    recordUndoSnapshot("Change Start #1 Date", state);
    snapshotPastDates(state);
    state.rotationStartDate = dateValue || DEFAULT_ANCHOR_DATE;
    touchCoreState(state, "settings");
    saveAppState(state);
    showStatus("Rotation start date updated!");
  }

  function getMeetingSaturdays(year, month) {
    return ScheduleDomain.getMeetingSaturdays(year, month);
  }

  // Raw rotational calculation (before checking past-date lock)
  function computeRotationalAssignmentInfo(targetYear, targetMonth, targetDay, state) {
    return ScheduleDomain.computeRotationalAssignmentInfo(
      targetYear, targetMonth, targetDay, state, START_YEAR, new Date().getFullYear()
    );
  }

  // Respects Past-Date History Lock for dates before today
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
    document.getElementById("tradeModal").classList.add("open");
    syncModalBodyLock();
  }

  function closeTradeModal() {
    document.getElementById("tradeModal").classList.remove("open");
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
        ${(() => {
          const c1 = getCandidateConflictNote(slot2.conductor, key1, state);
          const c2 = getCandidateConflictNote(slot1.conductor, key2, state);
          const warnings = [c1 ? `${slot2.conductor} on ${formatShortDate(key1)}: ${c1}` : "", c2 ? `${slot1.conductor} on ${formatShortDate(key2)}: ${c2}` : ""].filter(Boolean);
          return warnings.length > 0
            ? `<div style="color:#92400e; font-weight:700; margin-bottom:4px;">⚠️ Note: ${escapeHtml(warnings.join(" | "))}</div>`
            : "";
        })()}Yearly assignment counts stay balanced, and all other future rotation dates remain unchanged.
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
    touchCoreState(state, "roster");
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
      touchCoreState(state, "roster");
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
    touchCoreState(state, "roster");
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
    document.getElementById("contactModal").classList.add("open");
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
    document.getElementById("contactModal").classList.remove("open");
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
      touchDateField(state, "contacts", oldName);
      touchDateField(state, "unavailability", oldName);
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
    touchDateField(state, "contacts", newName);
    if (tempUnavailableDates.length > 0) {
      state.unavailability[newName] = [...tempUnavailableDates];
    } else {
      delete state.unavailability[newName];
    }
    touchDateField(state, "unavailability", newName);

    touchCoreState(state, oldName !== newName ? "roster" : "core");
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
      const isFirst = index === 0;
      const isLast = index === state.roster.length - 1;
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
        ? `<div class="reminder-sent-pill${statusClass}" title="Tap to cycle status: Assignment sent → Reminder sent → Confirmed → Requested Sub" onclick="cycleReminderStatus('${escapeHtml(activeReminder.dateKey)}', event)">
             <span class="pill-cycle-text">${escapeHtml(formatReminderStatusText(activeReminder, false))}</span>
             <button type="button" title="Clear tag" aria-label="Clear tag" onclick="clearReminderTag('${escapeHtml(activeReminder.dateKey)}', event)">&times;</button>
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
        <div class="reminder-sent-pill${statusClass}" style="margin-top: 2px;" title="Tap to cycle status: Assignment sent → Reminder sent → Confirmed → Requested Sub" onclick="cycleReminderStatus('${escapeHtml(nextSlot.dateKey)}', event)">
          <span class="pill-cycle-text">${escapeHtml(formatReminderStatusText(activeRem, false))}</span>
          <button type="button" title="Clear tag" aria-label="Clear tag" onclick="clearReminderTag('${escapeHtml(nextSlot.dateKey)}', event)">&times;</button>
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

    // Populate Quick Replace with Last-Served & Fairness Stats
    const replaceSelect = document.getElementById("quickReplaceSelect");
    replaceSelect.innerHTML = "";
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.innerText = `Auto (${nextSlot.autoConductor})`;
    replaceSelect.appendChild(autoOpt);

    const selectedYear = nextSlot.year;
    const statsStartKey = state.rotationStartDate || DEFAULT_ANCHOR_DATE;
    const stats = computeConductorStats(state, selectedYear);
    stats.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.name;
      const lastHint = s.lastSlot ? `Last: ${formatShortDate(s.lastSlot.dateKey).replace(/,\s*\d{4}$/, '')} (${s.daysSince}d)` : "Last: None";
      const conflictNote = getCandidateConflictNote(s.name, nextSlot.dateKey, state);
      const conflictSuffix = conflictNote ? ` [${conflictNote}]` : "";
      opt.innerText = `${s.name} — ${lastHint} • ${s.yearTotal}×${conflictSuffix}`;
      replaceSelect.appendChild(opt);
    });
    replaceSelect.value = (state.overrides && state.overrides[nextSlot.dateKey]) || "";
    const followupsBtn = document.getElementById("btnPendingFollowups");
    if (followupsBtn) {
      const pendingCount = getUpcomingFollowupQueue(state).length;
      followupsBtn.innerText = pendingCount > 0 ? `📋 Follow-Ups (${pendingCount})` : "📋 Follow-Ups";
    }
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
            const customPill = document.createElement("button");
            customPill.type = "button";
            customPill.className = "custom-slot-pill";
            customPill.title = `${slotTL.time} • ${slotTL.location}`;
            customPill.setAttribute("aria-label", `Edit meeting time and location for ${formatFullDateWithDay(dateKey)}`);
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
            remBadge.title = "Tap to cycle status: Sent → Confirmed → Needs Sub";
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
            const cNote = getCandidateConflictNote(name, dateKey, state);
            opt.innerText = cNote ? `${name} (${cNote})` : name;
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
            ${!blackoutReason ? `<button class="btn-link" aria-label="Edit meeting time and location for ${dateKey}" title="Custom time/location" onclick="openTimeLocModal('${dateKey}')">🕒</button>` : ''}
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
    tbody.innerHTML = "";

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
          statusBadge += ` <span class="badge badge-reminded${stClass}" title="Tap to cycle status" onclick="cycleReminderStatus('${dateKey}', event)">${escapeHtml(formatReminderStatusText(remInfo, true))}</span>`;
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
  }

  function promptTableOverride(dateKey, currentOverride) {
    const state = loadAppState();
    const conductorList = state.roster.join(", ");
    const choice = prompt(`Select conductor for ${dateKey}:\nAvailable: ${conductorList}`, currentOverride);
    if (choice !== null) {
      setOverride(dateKey, choice.trim());
    }
  }

  /* --- SCHEDULE FILTERING & TEMPLATE HELPERS --- */
  function getAllScheduleSlots(state) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10) || today.getFullYear();
    const maxYear = Math.max(today.getFullYear(), selectedYear) + 2;

    let allSlots = [];
    for (let y = START_YEAR; y <= maxYear; y++) {
      for (let month = 0; month < 12; month++) {
        const sats = getMeetingSaturdays(y, month);
        [sats.second, sats.fourth, sats.fifth].forEach(day => {
          if (!day) return;
          const monthStr = String(month + 1).padStart(2, '0');
          const dayStr = String(day).padStart(2, '0');
          const dateKey = `${y}-${monthStr}-${dayStr}`;
          const slotDate = new Date(y, month, day);

          if (state.blackouts && state.blackouts[dateKey]) return;

          const assignInfo = getRotationalAssignmentInfo(y, month, day, state);
          const autoConductor = assignInfo.conductor;
          const isOverride = !!(state.overrides && state.overrides[dateKey]);
          const conductor = isOverride ? state.overrides[dateKey] : autoConductor;

          const formattedDate = slotDate.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });

          allSlots.push({
            dateKey,
            slotDate,
            monthStr,
            dayStr,
            day,
            month,
            year: y,
            conductor,
            autoConductor,
            isOverride,
            skippedUnavailable: assignInfo.skippedUnavailable,
            formattedDate
          });
        });
      }
    }
    return allSlots;
  }

  function getConductorAssignedDates(conductorName, rangeOption, state) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10);

    const conductorSlots = getAllScheduleSlots(state).filter(s => s.conductor === conductorName);
    const upcoming = conductorSlots.filter(s => s.slotDate >= today);

    if (rangeOption === "1") {
      if (upcoming.length === 0) return [];
      const first = upcoming[0].slotDate;
      const cutoff = new Date(first.getFullYear(), first.getMonth() + 1, first.getDate() + 6);
      return upcoming.filter(d => d.slotDate <= cutoff);
    } else if (rangeOption === "2") {
      if (upcoming.length === 0) return [];
      const first = upcoming[0].slotDate;
      const cutoff = new Date(first.getFullYear(), first.getMonth() + 3, first.getDate() + 6);
      return upcoming.filter(d => d.slotDate <= cutoff);
    } else if (rangeOption === "3") {
      if (upcoming.length === 0) return [];
      const first = upcoming[0].slotDate;
      const cutoff = new Date(first.getFullYear(), first.getMonth() + 6, first.getDate() + 6);
      return upcoming.filter(d => d.slotDate <= cutoff);
    } else if (rangeOption === "4") {
      return upcoming.filter(d => d.year === selectedYear);
    } else if (rangeOption === "5") {
      return conductorSlots.filter(d => d.year === selectedYear);
    }
    return upcoming;
  }

  function getAllConductorsGroupedSchedules(rangeOption, state) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10);

    const allSlots = getAllScheduleSlots(state);
    const globalUpcoming = allSlots.filter(s => s.slotDate >= today);

    let filteredSlots = [];
    if (rangeOption === "1") {
      if (globalUpcoming.length > 0) {
        const first = globalUpcoming[0].slotDate;
        const cutoff = new Date(first.getFullYear(), first.getMonth() + 1, first.getDate() + 6);
        filteredSlots = globalUpcoming.filter(d => d.slotDate <= cutoff);
      }
    } else if (rangeOption === "2") {
      if (globalUpcoming.length > 0) {
        const first = globalUpcoming[0].slotDate;
        const cutoff = new Date(first.getFullYear(), first.getMonth() + 3, first.getDate() + 6);
        filteredSlots = globalUpcoming.filter(d => d.slotDate <= cutoff);
      }
    } else if (rangeOption === "3") {
      if (globalUpcoming.length > 0) {
        const first = globalUpcoming[0].slotDate;
        const cutoff = new Date(first.getFullYear(), first.getMonth() + 6, first.getDate() + 6);
        filteredSlots = globalUpcoming.filter(d => d.slotDate <= cutoff);
      }
    } else if (rangeOption === "4") {
      filteredSlots = globalUpcoming.filter(d => d.year === selectedYear);
    } else if (rangeOption === "5") {
      filteredSlots = allSlots.filter(d => d.year === selectedYear);
    }

    return state.roster.map(name => {
      const dates = filteredSlots.filter(s => s.conductor === name);
      return { name, dates };
    }).filter(entry => entry.dates.length > 0);
  }

  /* --- SHARE, TEMPLATE & 1-BY-1 QUEUE CONTROLLERS --- */
  function isQueueActive() {
    return activeShareContext.mode === "all" &&
           activeShareContext.format === "text" &&
           activeShareContext.allTextMode === "queue";
  }

  function getActiveTemplateKey() {
    const isSingle = activeShareContext.mode === "single" || isQueueActive();
    const isText = activeShareContext.format === "text";
    if (isSingle && isText) return "individualText";
    if (isSingle && !isText) return "individualEmail";
    if (!isSingle && isText) return "groupText";
    return "groupEmail";
  }

  function setAllTextDeliveryMode(deliveryMode) {
    activeShareContext.allTextMode = deliveryMode;
    activeShareContext.queueIndex = 0;

    document.getElementById("btnQueueModeGroup").className = deliveryMode === "group" ? "active" : "outline";
    document.getElementById("btnQueueModeQueue").className = deliveryMode === "queue" ? "active" : "outline";
    document.getElementById("queueStepperRow").style.display = deliveryMode === "queue" ? "flex" : "none";

    const hintEl = document.getElementById("sharePlaceholdersHint");
    hintEl.innerText = deliveryMode === "queue"
      ? "Dynamic tags: {firstName}, {fullName}, {dates}, {defaultTime}, {defaultLocation}"
      : "Dynamic tags: {schedules}, {timeframe}, {defaultTime}, {defaultLocation}";

    refreshShareModalPreview();
  }

  function stepQueue(delta) {
    const items = activeShareContext.queueItems || [];
    if (items.length === 0) return;
    activeShareContext.queueIndex = (activeShareContext.queueIndex + delta + items.length) % items.length;
    refreshShareModalPreview();
  }

  function populateShareRecipients() {
    const state = loadAppState();
    const isText = activeShareContext.format === "text";
    const labelEl = document.getElementById("shareRecipientLabel");
    const inputEl = document.getElementById("shareRecipientInput");
    const editBtn = document.getElementById("btnQuickEditContact");

    labelEl.innerText = isText ? "To (Mobile Number):" : "To (Email Address):";

    if (activeShareContext.mode === "single") {
      editBtn.style.display = "inline-block";
      const contact = (state.contacts && state.contacts[activeShareContext.conductorName]) || {};
      const val = isText ? (contact.phone || "") : (contact.email || "");
      inputEl.value = val;
      inputEl.placeholder = isText
        ? "No mobile # saved (click Edit Saved Contact or type here)"
        : "No email saved (click Edit Saved Contact or type here)";
    } else if (isQueueActive()) {
      editBtn.style.display = "none";
      const items = activeShareContext.queueItems || [];
      const current = items[activeShareContext.queueIndex];
      if (current) {
        const contact = (state.contacts && state.contacts[current.name]) || {};
        inputEl.value = contact.phone || "";
        inputEl.placeholder = `No mobile # saved for ${current.name}`;
      } else {
        inputEl.value = "";
        inputEl.placeholder = "No conductors scheduled in this timeframe";
      }
    } else {
      editBtn.style.display = "none";
      const list = state.roster
        .map(name => {
          const contact = (state.contacts && state.contacts[name]) || {};
          return isText ? (contact.phone || "") : (contact.email || "");
        })
        .map(v => v.trim())
        .filter(Boolean);

      inputEl.value = list.join(", ");
      inputEl.placeholder = isText
        ? "Add mobile numbers to conductors in roster to auto-fill..."
        : "Add emails to conductors in roster to auto-fill...";
    }
  }

  function editContactFromShareModal() {
    if (activeShareContext.mode !== "single") return;
    const state = loadAppState();
    const idx = state.roster.indexOf(activeShareContext.conductorName);
    if (idx !== -1) openContactModal(idx);
  }

  function openShareModal(mode, conductorName, initialFormat = "text", targetDateKey = null) {
    activeShareContext = {
      mode,
      conductorName,
      targetDateKey,
      format: initialFormat,
      allTextMode: "group",
      queueIndex: 0,
      queueItems: [],
      lastRenderedDates: "",
      lastRenderedSchedules: ""
    };

    const titleEl = document.getElementById("shareModalTitle");
    const hintEl = document.getElementById("sharePlaceholdersHint");

    if (mode === "single") {
      titleEl.innerText = `Share Schedule: ${conductorName}`;
      hintEl.innerText = "Dynamic tags: {firstName}, {fullName}, {dates}, {defaultTime}, {defaultLocation}";
    } else {
      titleEl.innerText = "Share Schedule: All Conductors";
      hintEl.innerText = "Dynamic tags: {schedules}, {timeframe}, {defaultTime}, {defaultLocation}";
    }

    document.getElementById("btnQueueModeGroup").className = "active";
    document.getElementById("btnQueueModeQueue").className = "outline";
    document.getElementById("queueStepperRow").style.display = "none";

    setShareFormat(initialFormat);
    document.getElementById("shareModal").classList.add("open");
    syncModalBodyLock();
  }

  function setShareFormat(format) {
    activeShareContext.format = format;
    const isText = format === "text";

    document.getElementById("btnFormatText").className = isText ? "active" : "outline";
    document.getElementById("btnFormatEmail").className = !isText ? "active" : "outline";

    const showQueuePanel = activeShareContext.mode === "all" && isText;
    document.getElementById("allTextQueuePanel").style.display = showQueuePanel ? "block" : "none";

    document.getElementById("emailSubjectField").style.display = isText ? "none" : "block";
    document.getElementById("btnActionSms").style.display = isText ? "inline-flex" : "none";
    document.getElementById("btnActionEmail").style.display = !isText ? "inline-flex" : "none";
    document.getElementById("shareMessageLabel").innerText = isText ? "Short Text Message" : "Longer Email Message";

    refreshShareModalPreview();
  }

  function closeShareModal() {
    document.getElementById("shareModal").classList.remove("open");
    syncModalBodyLock();
  }

  function updateCharCounter() {
    const countEl = document.getElementById("shareCharCount");
    const textarea = document.getElementById("shareMessageTextarea");
    if (activeShareContext.format === "text") {
      countEl.innerText = `${textarea.value.length} chars`;
    } else {
      countEl.innerText = "Email format";
    }
  }

  function formatDateLineForMessage(d, state) {
    const slotTL = getSlotTimeLocation(state, d.dateKey);
    const locSuffix = slotTL.location !== slotTL.defaultLocation ? ` @ ${slotTL.location}` : "";
    return `• ${d.formattedDate} (${slotTL.time}${locSuffix})`;
  }

  function refreshShareModalPreview() {
    const state = loadAppState();
    const defTime = state.defaultTime || DEFAULT_MEETING_TIME;
    const defLoc = state.defaultLocation || DEFAULT_MEETING_LOCATION;
    const rangeSelect = document.getElementById("shareTimeframeSelect");
    const rangeOption = rangeSelect.value;
    const timeframeLabel = rangeSelect.options[rangeSelect.selectedIndex].text;
    const textarea = document.getElementById("shareMessageTextarea");
    const subjectInput = document.getElementById("shareEmailSubject");
    const smsBtn = document.getElementById("btnActionSms");
    const scopeLabel = document.getElementById("templateScopeLabel");
    const templateKey = getActiveTemplateKey();

    if (activeShareContext.mode === "single") {
      const name = activeShareContext.conductorName;
      const firstName = name.trim().split(/\s+/)[0] || name;
      const dates = getConductorAssignedDates(name, rangeOption, state);
      if (!activeShareContext.targetDateKey && dates.length > 0) {
        activeShareContext.targetDateKey = dates[0].dateKey;
      }

      const dateList = dates.length > 0
        ? dates.map(d => formatDateLineForMessage(d, state)).join("\n")
        : "• No scheduled dates found in this timeframe.";

      activeShareContext.lastRenderedDates = dateList;
      subjectInput.value = `FS Conductor Schedule - ${name}`;
      smsBtn.innerText = "💬 Open in Messages";
      scopeLabel.innerText = activeShareContext.format === "text" ? "Short Text Template:" : "Longer Email Template:";

      const template = (state.templates && state.templates[templateKey]) || DEFAULT_TEMPLATES[templateKey];
      textarea.value = template
        .replace(/\{firstName\}/g, firstName)
        .replace(/\{fullName\}/g, name)
        .replace(/\{dates\}/g, dateList)
        .replace(/\{defaultTime\}/g, defTime)
        .replace(/\{defaultLocation\}/g, defLoc);

      populateShareRecipients();
    } else if (isQueueActive()) {
      const grouped = getAllConductorsGroupedSchedules(rangeOption, state);
      activeShareContext.queueItems = grouped;
      if (activeShareContext.queueIndex >= grouped.length) activeShareContext.queueIndex = 0;

      const progressEl = document.getElementById("queueProgressLabel");
      scopeLabel.innerText = "Individual Text Template:";

      if (grouped.length === 0) {
        progressEl.innerText = "No conductors scheduled in this timeframe";
        textarea.value = "No scheduled dates found in this timeframe.";
        smsBtn.innerText = "💬 Open in Messages";
      } else {
        const idx = activeShareContext.queueIndex;
        const item = grouped[idx];
        const firstName = item.name.trim().split(/\s+/)[0] || item.name;
        const dateList = item.dates.map(d => formatDateLineForMessage(d, state)).join("\n");

        activeShareContext.lastRenderedDates = dateList;
        progressEl.innerText = `Brother ${idx + 1} of ${grouped.length}: ${item.name}`;
        smsBtn.innerText = idx + 1 < grouped.length
          ? `💬 Text ${firstName} (${idx + 1}/${grouped.length}) & Next`
          : `💬 Text ${firstName} (${idx + 1}/${grouped.length})`;

        const template = (state.templates && state.templates.individualText) || DEFAULT_TEMPLATES.individualText;
        textarea.value = template
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{fullName\}/g, item.name)
          .replace(/\{dates\}/g, dateList)
          .replace(/\{defaultTime\}/g, defTime)
          .replace(/\{defaultLocation\}/g, defLoc);
      }

      populateShareRecipients();
    } else {
      const grouped = getAllConductorsGroupedSchedules(rangeOption, state);
      const scheduleBlocks = grouped.length > 0
        ? grouped.map(g => {
            const lines = g.dates.map(d => "  " + formatDateLineForMessage(d, state)).join("\n");
            return `${g.name}:\n${lines}`;
          }).join("\n\n")
        : "No scheduled dates found in this timeframe.";

      activeShareContext.lastRenderedSchedules = scheduleBlocks;
      subjectInput.value = `Updated FS Conductor Schedule (${timeframeLabel})`;
      smsBtn.innerText = "💬 Open in Messages";
      scopeLabel.innerText = activeShareContext.format === "text" ? "Group Text Template:" : "Longer Email Template:";

      const template = (state.templates && state.templates[templateKey]) || DEFAULT_TEMPLATES[templateKey];
      textarea.value = template
        .replace(/\{schedules\}/g, scheduleBlocks)
        .replace(/\{timeframe\}/g, timeframeLabel)
        .replace(/\{defaultTime\}/g, defTime)
        .replace(/\{defaultLocation\}/g, defLoc);

      populateShareRecipients();
    }

    refreshShareReminderBanner();
    updateCharCounter();
  }

  function saveModalAsDefaultTemplate() {
    const state = loadAppState();
    recordUndoSnapshot("Save Default Template", state);
    if (!state.templates) state.templates = { ...DEFAULT_TEMPLATES };

    const templateKey = getActiveTemplateKey();
    let templateToSave = document.getElementById("shareMessageTextarea").value;

    if (activeShareContext.mode === "single" || isQueueActive()) {
      const fullName = activeShareContext.mode === "single"
        ? activeShareContext.conductorName
        : (activeShareContext.queueItems[activeShareContext.queueIndex]?.name || "");
      const firstName = fullName.trim().split(/\s+/)[0] || fullName;

      if (activeShareContext.lastRenderedDates && !templateToSave.includes("{dates}")) {
        templateToSave = templateToSave.replace(activeShareContext.lastRenderedDates, "{dates}");
      }
      if (fullName && !templateToSave.includes("{fullName}")) {
        templateToSave = templateToSave.split(fullName).join("{fullName}");
      }
      if (firstName && !templateToSave.includes("{firstName}")) {
        const escapedFirst = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        templateToSave = templateToSave.replace(new RegExp(`\\b${escapedFirst}\\b`), "{firstName}");
      }
    } else {
      if (activeShareContext.lastRenderedSchedules && !templateToSave.includes("{schedules}")) {
        templateToSave = templateToSave.replace(activeShareContext.lastRenderedSchedules, "{schedules}");
      }
    }

    state.templates[templateKey] = templateToSave;
    touchDateField(state, "templates", templateKey);
    touchCoreState(state);
    saveAppState(state);

    const label = activeShareContext.format === "text" ? "Short Text" : "Longer Email";
    showStatus(`Default ${label} template saved!`);
    alert(`Saved! Your updated wording is now the default ${label} template.`);
  }

  function resetModalDefaultTemplate() {
    const state = loadAppState();
    recordUndoSnapshot("Reset Default Template", state);
    if (!state.templates) state.templates = { ...DEFAULT_TEMPLATES };

    const templateKey = getActiveTemplateKey();
    state.templates[templateKey] = DEFAULT_TEMPLATES[templateKey];

    touchDateField(state, "templates", templateKey);
    touchCoreState(state);
    saveAppState(state);
    refreshShareModalPreview();
    showStatus("Template reset to original default.");
  }

  async function flushReminderToCloud(targetInfo) {
    if (!targetInfo || !targetInfo.conductorName || !targetInfo.dateKey) return;
    recordReminderSent(targetInfo.dateKey, targetInfo.conductorName, true, true);
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId || !cfg.autoSync) return;
    if (!navigator.onLine) {
      cfg.pendingOfflineSync = true;
      saveGistConfig(cfg);
      return;
    }
    showStatus(`☁️ Syncing ${targetInfo.conductorName} to cloud...`);
    await pushToGitHubGist(true);
  }

  async function shareModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const title = activeShareContext.format === "email"
      ? (document.getElementById("shareEmailSubject").value || "FS Conductor Schedule")
      : (activeShareContext.mode === "single"
          ? `FS Conductor Schedule - ${activeShareContext.conductorName}`
          : "FS Conductor Schedule - All Conductors");

    const state = loadAppState();
    const targetInfo = getShareTargetSlotInfo(state);

    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        await flushReminderToCloud(targetInfo);
        showStatus("Schedule shared & reminder synced!");
        if (isQueueActive() && activeShareContext.queueIndex + 1 < activeShareContext.queueItems.length) {
          stepQueue(1);
        } else {
          closeShareModal();
        }
      } catch (err) {
        if (err.name !== "AbortError") console.error("Web Share error:", err);
      }
    } else {
      copyModalMessage();
    }
  }

  async function smsModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const rawRecipients = document.getElementById("shareRecipientInput").value;
    const phones = rawRecipients.split(",").map(p => p.replace(/[^\d+]/g, "")).filter(Boolean);

    const state = loadAppState();
    const targetInfo = getShareTargetSlotInfo(state);
    await flushReminderToCloud(targetInfo);

    if (phones.length === 1) {
      window.location.href = `sms:${phones[0]}?&body=${encodeURIComponent(text)}`;
    } else if (phones.length > 1) {
      window.location.href = `sms://open?addresses=${phones.join(",")}&body=${encodeURIComponent(text)}`;
    } else {
      window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
    }

    if (isQueueActive() && activeShareContext.queueItems.length > 0) {
      const currentIdx = activeShareContext.queueIndex;
      const total = activeShareContext.queueItems.length;
      const sentName = activeShareContext.queueItems[currentIdx].name;
      showStatus(`Opened Messages & synced ${sentName} (${currentIdx + 1}/${total})`);
      if (currentIdx + 1 < total) setTimeout(() => stepQueue(1), 400);
    } else if (targetInfo.conductorName) {
      showStatus(`Opened Messages & synced ${targetInfo.conductorName} (${formatShortDate(getTodayLocalKey())})`);
    } else {
      showStatus("Opened in Messages app!");
    }
  }

  async function emailModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const subject = document.getElementById("shareEmailSubject").value || "FS Conductor Schedule";
    const rawRecipients = document.getElementById("shareRecipientInput").value;
    const emails = rawRecipients.split(",").map(e => e.trim()).filter(Boolean);

    const state = loadAppState();
    const targetInfo = getShareTargetSlotInfo(state);
    await flushReminderToCloud(targetInfo);

    const toParam = emails.map(e => encodeURIComponent(e)).join(",");
    window.location.href = `mailto:${toParam}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    showStatus(targetInfo.conductorName ? `Opened Email & synced ${targetInfo.conductorName}!` : "Opened in Email app!");
  }

  function copyModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const state = loadAppState();
    const targetInfo = getShareTargetSlotInfo(state);
    if (targetInfo.conductorName && targetInfo.dateKey) {
      recordReminderSent(targetInfo.dateKey, targetInfo.conductorName, true);
    }

    navigator.clipboard.writeText(text).then(() => {
      showStatus(targetInfo.conductorName ? `Copied & tagged ${targetInfo.conductorName}!` : "Copied to clipboard!");
      alert("Copied to clipboard! You can now paste (Cmd + V / Tap Paste) into Messages or Email.");
    }).catch(() => { alert(text); });
  }

  /* --- .ICS & BACKUP HANDLERS --- */
  function showStatus(msg) {
    const el = document.getElementById("statusMsg");
    el.innerText = msg;
    el.classList.add("visible");
    setTimeout(() => {
      el.classList.remove("visible");
      el.innerText = "";
    }, 3600);
  }

  function downloadConductorICS(conductorName) {
    const state = loadAppState();
    const choice = prompt(
      `Select .ics calendar timeframe for ${conductorName}:\n\n` +
      `1 = Next 1 Month\n` +
      `2 = Next 3 Months\n` +
      `3 = Next 6 Months\n` +
      `4 = Rest of Year (Upcoming Only)\n` +
      `5 = Entire Year (All Dates)\n\n` +
      `Enter option number (1-5):`,
      "2"
    );

    if (choice === null) return;
    const nowString = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const dates = getConductorAssignedDates(conductorName, choice.trim(), state);

    if (dates.length === 0) {
      alert(`No scheduled dates found for ${conductorName}.`);
      return;
    }

    let icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Conductor Schedule Generator//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${conductorName} - FS Conductor Schedule`
    ];

    dates.forEach(d => {
      const dateStr = `${d.year}${d.monthStr}${d.dayStr}`;
      const slotTL = getSlotTimeLocation(state, d.dateKey);
      icsLines.push(
        "BEGIN:VEVENT",
        `UID:conductor-${d.dateKey}@conductorschedule.local`,
        `DTSTAMP:${nowString}`,
        `DTSTART;VALUE=DATE:${dateStr}`,
        `DTEND;VALUE=DATE:${dateStr}`,
        `SUMMARY:FS Conductor: ${conductorName} (${slotTL.time})`,
        `LOCATION:${slotTL.location}`,
        `DESCRIPTION:Please read ahead: 1. mwb21 November p. 7 "Tips for Making Meetings for Field Service Practical" and 2. km 3/15 pp. 3-6 "Meetings for Field Service That Accomplish Their Purpose."`,
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:-PT24H",
        "ACTION:DISPLAY",
        `DESCRIPTION:Reminder: FS Conductor Duty Tomorrow - ${conductorName}`,
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-PT12H",
        "ACTION:DISPLAY",
        `DESCRIPTION:Reminder: FS Conductor Duty in 12 Hours - ${conductorName}`,
        "END:VALARM",
        "END:VEVENT"
      );
    });

    icsLines.push("END:VCALENDAR");
    const blob = new Blob([icsLines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FS_Conductor_${conductorName.replace(/\s+/g, '_')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus(`Downloaded .ics for ${conductorName}!`);
  }

  function exportMasterICS() {
    const state = loadAppState();
    const selectedYear = parseInt(document.getElementById("yearSelect").value, 10);
    const nowString = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    let icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Conductor Schedule Generator//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:Conductor Schedule ${selectedYear}`
    ];

    for (let month = 0; month < 12; month++) {
      const sats = getMeetingSaturdays(selectedYear, month);
      [sats.second, sats.fourth, sats.fifth].forEach(day => {
        if (!day) return;
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateKey = `${selectedYear}-${monthStr}-${dayStr}`;

        if (state.blackouts && state.blackouts[dateKey]) return;

        const conductor = (state.overrides && state.overrides[dateKey]) || getRotationalConductor(selectedYear, month, day, state);
        const slotTL = getSlotTimeLocation(state, dateKey);
        const dateStr = `${selectedYear}${monthStr}${dayStr}`;

        icsLines.push(
          "BEGIN:VEVENT",
          `UID:conductor-${dateKey}@conductorschedule.local`,
          `DTSTAMP:${nowString}`,
          `DTSTART;VALUE=DATE:${dateStr}`,
          `DTEND;VALUE=DATE:${dateStr}`,
          `SUMMARY:FS Conductor: ${conductor} (${slotTL.time})`,
          `LOCATION:${slotTL.location}`,
          `DESCRIPTION:Please read ahead: 1. mwb21 November p. 7 "Tips for Making Meetings for Field Service Practical" and 2. km 3/15 pp. 3-6 "Meetings for Field Service That Accomplish Their Purpose."`,
          "STATUS:CONFIRMED",
          "BEGIN:VALARM",
          "TRIGGER:-PT24H",
          "ACTION:DISPLAY",
          `DESCRIPTION:Reminder: FS Conductor Duty Tomorrow - ${conductor}`,
          "END:VALARM",
          "BEGIN:VALARM",
          "TRIGGER:-PT12H",
          "ACTION:DISPLAY",
          `DESCRIPTION:Reminder: FS Conductor Duty in 12 Hours - ${conductor}`,
          "END:VALARM",
          "END:VEVENT"
        );
      });
    }

    icsLines.push("END:VCALENDAR");
    const blob = new Blob([icsLines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Conductor_Schedule_${selectedYear}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus(`Exported ${selectedYear} Master .ics!`);
  }

  function exportMonthICS() {
    const state = loadAppState();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const sats = getMeetingSaturdays(year, month);
    const nowString = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    let icsLines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Conductor Schedule//EN"];

    [sats.second, sats.fourth, sats.fifth].forEach(day => {
      if (!day) return;
      const monthStr = String(month + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      const dateKey = `${year}-${monthStr}-${dayStr}`;

      if (state.blackouts && state.blackouts[dateKey]) return;

      const conductor = (state.overrides && state.overrides[dateKey]) || getRotationalConductor(year, month, day, state);
      const slotTL = getSlotTimeLocation(state, dateKey);
      const dateStr = `${year}${monthStr}${dayStr}`;

      icsLines.push(
        "BEGIN:VEVENT",
        `UID:conductor-${dateKey}@conductorschedule.local`,
        `DTSTAMP:${nowString}`,
        `DTSTART;VALUE=DATE:${dateStr}`,
        `DTEND;VALUE=DATE:${dateStr}`,
        `SUMMARY:FS Conductor: ${conductor} (${slotTL.time})`,
        `LOCATION:${slotTL.location}`,
        `DESCRIPTION:Please read ahead: 1. mwb21 November p. 7 "Tips for Making Meetings for Field Service Practical" and 2. km 3/15 pp. 3-6 "Meetings for Field Service That Accomplish Their Purpose."`,
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:-PT24H",
        "ACTION:DISPLAY",
        `DESCRIPTION:Reminder: FS Conductor Duty Tomorrow - ${conductor}`,
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-PT12H",
        "ACTION:DISPLAY",
        `DESCRIPTION:Reminder: FS Conductor Duty in 12 Hours - ${conductor}`,
        "END:VALARM",
        "END:VEVENT"
      );
    });

    icsLines.push("END:VCALENDAR");
    const blob = new Blob([icsLines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Conductor_Schedule_${monthNames[month]}_${year}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus(`Exported ${monthNames[month]} .ics!`);
  }

  /* --- JSON BACKUP & RESTORE HANDLERS --- */
  function exportJSONBackup() {
    const state = loadAppState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `conductor-schedule-backup-${getTodayLocalKey()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus("Backup JSON downloaded!");
  }

  function importJSONBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedData = JSON.parse(e.target.result);
        if (ScheduleStateSchema.validate(importedData)) {
          recordUndoSnapshot("Restore JSON Backup", loadAppState());
          const restored = ScheduleStateSchema.normalize(importedData, createDefaultAppState());
          ensureFieldTimestamps(restored);
          const nowTs = Date.now();
          restored.fieldTimestamps.core = nowTs;
          restored.fieldTimestamps.roster = nowTs;
          restored.fieldTimestamps.settings = nowTs;
          ["reminders", "overrides", "blackouts", "slotDetails", "contacts", "unavailability", "templates"].forEach(category => {
            Object.keys(restored[category] || {}).forEach(key => { restored.fieldTimestamps[category][key] = nowTs; });
          });
          saveAppState(restored);
          showStatus("Schedule restored successfully!");
        } else {
          alert("Invalid or unsupported backup. The roster, dates, or stored fields did not pass validation.");
        }
      } catch (err) {
        alert("Error reading JSON backup file: " + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  // Close modals, drawers, and dropdowns on Escape key
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllDropdowns();
      if (document.getElementById("timeLocModal").classList.contains("open")) {
        closeTimeLocModal();
      } else if (document.getElementById("cancelModal").classList.contains("open")) {
        closeCancelModal();
      } else if (document.getElementById("printModal").classList.contains("open")) {
        closePrintModal();
      } else if (document.getElementById("tradeModal").classList.contains("open")) {
        closeTradeModal();
      } else if (document.getElementById("cloudSyncModal").classList.contains("open")) {
        closeCloudSyncModal();
      } else if (document.getElementById("syncHistoryModal").classList.contains("open")) {
        closeSyncHistory();
      } else if (document.getElementById("contactModal").classList.contains("open")) {
        closeContactModal();
      } else if (document.getElementById("shareModal").classList.contains("open")) {
        closeShareModal();
      } else if (document.getElementById("addConductorDrawer").classList.contains("open")) {
        toggleAddConductorDrawer(false);
      }
    }
  });

  // Automatically upload queued offline changes when connection returns
  window.addEventListener('online', () => {
    const cfg = loadGistConfig();
    updateNetworkStatus();
    updateCloudSyncPill();
    if (cfg.token && cfg.gistId && cfg.autoSync) {
      if (cfg.pendingOfflineSync) showStatus("📶 Back online — uploading offline changes...");
      syncWithGitHubGist(true, 0);
    }
  });

  window.addEventListener('offline', () => {
    updateNetworkStatus();
    updateCloudSyncPill();
  });

  function handleUserInteractionSync() {
    syncWithGitHubGist(true, 6000);
  }

  window.addEventListener('touchstart', handleUserInteractionSync, { passive: true, capture: true });
  window.addEventListener('pointerdown', handleUserInteractionSync, { passive: true, capture: true });
  document.addEventListener('click', handleUserInteractionSync, { passive: true, capture: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForServiceWorkerUpdate();
      syncWithGitHubGist(true);
    } else {
      flushScheduledCloudPush();
    }
  });

  window.addEventListener("pagehide", () => {
    flushScheduledCloudPush();
  });

  window.addEventListener('pageshow', () => {
    checkForServiceWorkerUpdate();
    syncWithGitHubGist(true);
  });

  window.addEventListener('focus', () => {
    checkForServiceWorkerUpdate();
    syncWithGitHubGist(true);
  });

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
        swRegistration = registration;
        lastAutoUpdateCheck = Date.now();
        showAppUpdateAvailable(registration);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showAppUpdateAvailable(registration);
              } else if (newWorker.state === 'installed' && !navigator.serviceWorker.controller) {
                newWorker.postMessage({ action: 'skipWaiting' });
              }
            });
          }
        });
      }).catch((error) => {
        showStatus(`Could not register offline support: ${error.message}`);
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (appUpdateReloadRequested) {
        appUpdateReloadRequested = false;
        window.location.reload();
      }
    });
  }

  window.addEventListener("DOMContentLoaded", async () => {
    window.scrollTo(0, 0);
    const params = new URLSearchParams(window.location.search);
    try {
      await initializeAppStorage();
      await initializeSyncConfig();
    } catch (error) {
      showStatus(`❌ App startup failed: ${error.message}`);
      return;
    }

    const printScope = params.get("print");
    if (printScope) {
      enterStandalonePrintMode(
        printScope,
        parseInt(params.get("y"), 10),
        parseInt(params.get("m"), 10)
      );
      return;
    }
    renderUI();
    updateNetworkStatus();
    syncWithGitHubGist(true);
  });
