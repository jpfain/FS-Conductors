  /* --- UI DRAWERS & DROPDOWN MENUS --- */
  function openUserManual() {
    const manualWin = window.open('./manual.html', '_blank');
    if (!manualWin) {
      window.location.href = './manual.html';
    }
  }

  function toggleStatsPanel() {
    const panel = document.getElementById("statsPanel");
    const isOpen = panel.classList.toggle("open");
    if (isOpen) {
      renderStatsPanel(loadAppState());
    }
  }

  function toggleAddConductorDrawer(forceState) {
    const drawer = document.getElementById("addConductorDrawer");
    const btn = document.getElementById("btnToggleAddConductor");
    const shouldOpen = typeof forceState === "boolean" ? forceState : !drawer.classList.contains("open");

    if (shouldOpen) {
      drawer.classList.add("open");
      btn.style.display = "none";
      setTimeout(() => document.getElementById("newConductorInput").focus(), 40);
    } else {
      drawer.classList.remove("open");
      btn.style.display = "inline-flex";
      document.getElementById("newConductorInput").value = "";
      document.getElementById("newConductorPhone").value = "";
      document.getElementById("newConductorEmail").value = "";
    }
  }

  function toggleDropdown(menuId, event) {
    if (event) event.stopPropagation();
    const target = document.getElementById(menuId);
    const wasOpen = target.classList.contains("open");
    closeAllDropdowns();
    if (!wasOpen) {
      target.classList.add("open");
      document.getElementById("menuBackdrop").classList.add("open");
    }
  }

  function closeAllDropdowns() {
    document.querySelectorAll(".dropdown-menu.open").forEach(menu => {
      menu.classList.remove("open");
    });
    const backdrop = document.getElementById("menuBackdrop");
    if (backdrop) backdrop.classList.remove("open");
  }

  /* --- CUSTOM TIME & LOCATION MODAL CONTROLLERS --- */
  function openTimeLocModal(preselectDateKey = null) {
    const state = loadAppState();
    document.getElementById("defaultTimeInput").value = state.defaultTime || DEFAULT_MEETING_TIME;
    document.getElementById("defaultLocationInput").value = state.defaultLocation || DEFAULT_MEETING_LOCATION;
    tempSlotDetails = JSON.parse(JSON.stringify(state.slotDetails || {}));

    const select = document.getElementById("customSlotDateSelect");
    select.innerHTML = "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const slots = getAllScheduleSlots(state).filter(s => s.slotDate >= today).slice(0, 36);

    slots.forEach(slot => {
      const opt = document.createElement("option");
      opt.value = slot.dateKey;
      const hasCustom = !!tempSlotDetails[slot.dateKey];
      opt.innerText = `${slot.formattedDate} — ${slot.conductor}${hasCustom ? " [Custom]" : ""}`;
      select.appendChild(opt);
    });

    if (preselectDateKey && slots.some(s => s.dateKey === preselectDateKey)) {
      select.value = preselectDateKey;
    }

    loadSelectedSlotTimeLoc();
    renderCustomSlotOverridesList();
    openAccessibleModal("timeLocModal", "defaultTimeInput");
    syncModalBodyLock();
  }

  function closeTimeLocModal() {
    closeAccessibleModal("timeLocModal");
    tempSlotDetails = {};
    syncModalBodyLock();
  }

  function loadSelectedSlotTimeLoc() {
    const dateKey = document.getElementById("customSlotDateSelect").value;
    const entry = (dateKey && tempSlotDetails[dateKey]) || {};
    document.getElementById("customSlotTimeInput").value = entry.time || "";
    document.getElementById("customSlotLocationInput").value = entry.location || "";
  }

  function stageCurrentSlotTimeLoc() {
    const dateKey = document.getElementById("customSlotDateSelect").value;
    if (!dateKey) return;
    const t = document.getElementById("customSlotTimeInput").value.trim();
    const l = document.getElementById("customSlotLocationInput").value.trim();
    if (t || l) {
      tempSlotDetails[dateKey] = { time: t, location: l };
    } else {
      delete tempSlotDetails[dateKey];
    }
  }

  function removeCustomSlotDetail(dateKey) {
    delete tempSlotDetails[dateKey];
    if (document.getElementById("customSlotDateSelect").value === dateKey) {
      document.getElementById("customSlotTimeInput").value = "";
      document.getElementById("customSlotLocationInput").value = "";
    }
    renderCustomSlotOverridesList();
  }

  function renderCustomSlotOverridesList() {
    const listEl = document.getElementById("customSlotOverridesList");
    const keys = Object.keys(tempSlotDetails).sort();
    listEl.innerHTML = "";
    if (keys.length === 0) {
      listEl.innerHTML = `<span style="font-size:0.78rem; color:#94a3b8;">No per-date overrides active.</span>`;
      return;
    }
    keys.forEach(dateKey => {
      const info = tempSlotDetails[dateKey];
      const label = [formatShortDate(dateKey), info.time, info.location].filter(Boolean).join(" • ");
      const pill = document.createElement("span");
      pill.className = "unavail-pill";
      pill.style.background = "#eff6ff";
      pill.style.color = "#1e40af";
      pill.style.borderColor = "#bfdbfe";
      pill.innerHTML = `<span>${escapeHtml(label)}</span><button type="button" style="color:#1e40af;" onclick="removeCustomSlotDetail('${escapeHtml(dateKey)}')">&times;</button>`;
      listEl.appendChild(pill);
    });
  }

  function saveTimeLocSettings() {
    stageCurrentSlotTimeLoc();
    const state = loadAppState();
    recordUndoSnapshot("Time & Location Update", state);

    state.defaultTime = document.getElementById("defaultTimeInput").value.trim() || DEFAULT_MEETING_TIME;
    state.defaultLocation = document.getElementById("defaultLocationInput").value.trim() || DEFAULT_MEETING_LOCATION;

    const oldKeys = Object.keys(state.slotDetails || {});
    const newKeys = Object.keys(tempSlotDetails || {});
    const allChangedKeys = new Set([...oldKeys, ...newKeys]);

    state.slotDetails = { ...tempSlotDetails };
    allChangedKeys.forEach(k => touchDateField(state, "slotDetails", k));
    touchCoreState(state);

    saveAppState(state);
    closeTimeLocModal();
    showStatus("Saved time & location settings!");
  }

  /* --- NAMED CANCELLATION MODAL CONTROLLERS --- */
  function handleBlackoutAction(dateKey) {
    const state = loadAppState();
    if (state.blackouts && state.blackouts[dateKey]) {
      recordUndoSnapshot(`Restore ${formatShortDate(dateKey)}`, state);
      delete state.blackouts[dateKey];
      touchDateField(state, "blackouts", dateKey);
      saveAppState(state);
      showStatus(`Restored meeting on ${formatShortDate(dateKey)}.`);
    } else {
      openCancelModal(dateKey);
    }
  }

  function openCancelModal(dateKey) {
    pendingCancelDateKey = dateKey;
    document.getElementById("cancelModalDateText").innerText = `Meeting Date: ${formatFullDateWithDay(dateKey)}`;
    const input = document.getElementById("cancelReasonInput");
    input.value = "Circuit Assembly";

    document.querySelectorAll("#cancelPresetChips .preset-chip").forEach((chip, idx) => {
      chip.classList.toggle("selected", idx === 0);
    });

    openAccessibleModal("cancelModal", "cancelReasonInput");
    syncModalBodyLock();
  }

  function closeCancelModal() {
    closeAccessibleModal("cancelModal");
    pendingCancelDateKey = null;
    syncModalBodyLock();
  }

  function selectCancelPreset(reason, btnEl) {
    document.getElementById("cancelReasonInput").value = reason;
    document.querySelectorAll("#cancelPresetChips .preset-chip").forEach(chip => {
      chip.classList.remove("selected");
    });
    if (btnEl) btnEl.classList.add("selected");
  }

  function confirmCancelMeeting() {
    if (!pendingCancelDateKey) return;
    const rawReason = document.getElementById("cancelReasonInput").value.trim();
    const reason = rawReason || "Cancelled";

    const state = loadAppState();
    recordUndoSnapshot(`Cancel ${formatShortDate(pendingCancelDateKey)}`, state);
    if (!state.blackouts) state.blackouts = {};
    state.blackouts[pendingCancelDateKey] = reason;
    touchDateField(state, "blackouts", pendingCancelDateKey);

    const savedKey = pendingCancelDateKey;
    closeCancelModal();
    saveAppState(state);
    showStatus(`Cancelled ${formatShortDate(savedKey)} (${reason}).`);
  }

  /* --- BOARD-READY PRINT / SAVE PDF CONTROLLERS --- */
  function openPrintModal() {
    prepareStandalonePrintLink();
    openAccessibleModal("printModal", "printScopeSelect");
    syncModalBodyLock();
  }

  function closePrintModal() {
    closeAccessibleModal("printModal");
    syncModalBodyLock();
  }

  function prepareStandalonePrintLink() {
    const scopeEl = document.getElementById("printScopeSelect");
    const scope = (scopeEl && scopeEl.value) || "3";
    const printDate = scope === "12" ? new Date() : currentDate;
    const y = printDate.getFullYear();
    const m = printDate.getMonth();
    const anchor = document.getElementById("printViewAnchor");
    if (anchor) {
      anchor.href = `./index.html?print=${encodeURIComponent(scope)}&y=${y}&m=${m}`;
    }
  }

  function printOrSaveBoardSchedule(event) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      prepareStandalonePrintLink();
      closePrintModal();
      return true;
    }

    if (event) event.preventDefault();
    executeBoardPrint();
    return false;
  }

  function getPrintMonthsData(scope, baseYear, baseMonth) {
    const state = loadAppState();
    const defTime = state.defaultTime || DEFAULT_MEETING_TIME;
    const defLoc = state.defaultLocation || DEFAULT_MEETING_LOCATION;

    const legacyMap = { month: 1, quarter: 3, year: 12 };
    const monthCount = legacyMap[scope] || parseInt(scope, 10) || 3;

    let monthsToRender = [];
    for (let offset = 0; offset < monthCount; offset++) {
      const d = new Date(baseYear, baseMonth + offset, 1);
      monthsToRender.push({ year: d.getFullYear(), month: d.getMonth() });
    }

    const first = monthsToRender[0];
    const last = monthsToRender[monthsToRender.length - 1];
    const scopeSubtitle = monthCount === 1
      ? `${monthNames[first.month]} ${first.year}`
      : (first.year === last.year
          ? `${monthNames[first.month]} – ${monthNames[last.month]} ${first.year}`
          : `${monthNames[first.month]} ${first.year} – ${monthNames[last.month]} ${last.year}`);

    const blocks = monthsToRender.map(({ year, month }) => {
      const sats = getMeetingSaturdays(year, month);
      const slots = [
        { day: sats.second, label: "2nd Saturday" },
        { day: sats.fourth, label: "4th Saturday" },
        { day: sats.fifth, label: "5th Saturday" }
      ].filter(s => !!s.day);

      const rows = slots.map(({ day, label }) => {
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateKey = `${year}-${monthStr}-${dayStr}`;
        const displayDate = new Date(year, month, day).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        const blackoutReason = getBlackoutReason(state.blackouts, dateKey);
        if (blackoutReason) {
          return {
            cancelled: true,
            dateText: `${displayDate} (${label})`,
            conductorText: `CANCELLED — ${blackoutReason}`,
            timeLocText: "—",
            statusText: "No Meeting"
          };
        }

        const override = state.overrides && state.overrides[dateKey];
        const autoAssigned = getRotationalConductor(year, month, day, state);
        const conductor = override || autoAssigned;
        const slotTL = getSlotTimeLocation(state, dateKey);
        const remInfo = getReminderForSlot(dateKey, conductor, state);
        const statusText = remInfo
          ? formatReminderStatusText(remInfo, false, true)
          : "Scheduled";

        return {
          cancelled: false,
          dateText: `${displayDate} (${label})`,
          conductorText: conductor,
          timeLocText: `${slotTL.time} • ${slotTL.location}`,
          statusText
        };
      });

      return {
        heading: `${monthNames[month]} ${year}`,
        rows
      };
    });

    const printedOn = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return { scopeSubtitle, defTime, defLoc, blocks, printedOn };
  }

  function buildPrintSheetHTML(scope, baseYear = currentDate.getFullYear(), baseMonth = currentDate.getMonth()) {
    const data = getPrintMonthsData(scope, baseYear, baseMonth);
    let blocksHtml = "";

    data.blocks.forEach(block => {
      let rowsHtml = "";
      block.rows.forEach(r => {
        if (r.cancelled) {
          rowsHtml += `
            <tr class="print-row-cancelled">
              <td><strong>${escapeHtml(r.dateText)}</strong></td>
              <td><strong>${escapeHtml(r.conductorText)}</strong></td>
              <td>—</td>
              <td>No Meeting</td>
            </tr>
          `;
        } else {
          rowsHtml += `
            <tr>
              <td><strong>${escapeHtml(r.dateText)}</strong></td>
              <td><strong>${escapeHtml(r.conductorText)}</strong></td>
              <td>${escapeHtml(r.timeLocText)}</td>
              <td>${escapeHtml(r.statusText)}</td>
            </tr>
          `;
        }
      });

      blocksHtml += `
        <div class="print-month-block">
          <h3 class="print-month-heading">${escapeHtml(block.heading)}</h3>
          <table class="print-table">
            <thead>
              <tr>
                <th style="width: 29%;">Date</th>
                <th style="width: 22%;">Conductor</th>
                <th style="width: 27%;">Time &amp; Location</th>
                <th style="width: 22%;">Assignment Status</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    });

    return `
      <div class="print-doc-header">
        <div>
          <h1 class="print-doc-title">Field Service Conductor Schedule</h1>
          <p class="print-doc-subtitle">${escapeHtml(data.scopeSubtitle)} • ${escapeHtml(data.defTime)} • ${escapeHtml(data.defLoc)}</p>
        </div>
        <div class="print-doc-meta">Printed ${escapeHtml(data.printedOn)}</div>
      </div>
      ${blocksHtml}
      <div class="print-footer-note">
        <strong>Preparation References:</strong> (1) <em>mwb21</em> November p. 7 "Tips for Making Meetings for Field Service Practical" &nbsp;|&nbsp; (2) <em>km</em> 3/15 pp. 3–6 "Meetings for Field Service That Accomplish Their Purpose."<br>
        If a scheduling conflict arises, please notify the schedule coordinator early to arrange a replacement or trade.
      </div>
    `;
  }

  function executeBoardPrint() {
    const scopeEl = document.getElementById("printScopeSelect");
    const scope = (scopeEl && scopeEl.value) || "3";
    const printDate = scope === "12" ? new Date() : currentDate;
    document.getElementById("printSheetContainer").innerHTML = buildPrintSheetHTML(
      scope,
      printDate.getFullYear(),
      printDate.getMonth()
    );
    closePrintModal();
    window.print();
  }

  function enterStandalonePrintMode(scopeParam, yearParam, monthParam) {
    const baseYear = !isNaN(yearParam) ? yearParam : currentDate.getFullYear();
    const baseMonth = !isNaN(monthParam) ? monthParam : currentDate.getMonth();
    const container = document.getElementById("printSheetContainer");
    document.body.classList.add("standalone-print-mode");
    container.innerHTML = `
      <div class="standalone-print-bar">
        <span>Use Print or Share → Print to print or save as PDF.</span>
        <div class="controls-group">
          <a href="./index.html" style="text-decoration: none; padding: 6px 10px; border-radius: 7px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-size: 0.8rem; font-weight: 600;">← App</a>
          <button type="button" class="primary" style="min-height: 34px; padding: 6px 12px;" onclick="window.print()">🖨️ Print / Save PDF</button>
        </div>
      </div>
      ${buildPrintSheetHTML(scopeParam || "3", baseYear, baseMonth)}
    `;
  }

  window.addEventListener("beforeprint", () => {
    const container = document.getElementById("printSheetContainer");
    const scopeEl = document.getElementById("printScopeSelect");
    const selectedScope = (scopeEl && scopeEl.value) || "3";
    if (container && !container.innerHTML.trim()) {
      container.innerHTML = buildPrintSheetHTML(selectedScope);
    }
  });

  window.addEventListener("afterprint", () => {
    if (document.body.classList.contains("standalone-print-mode")) return;
    const container = document.getElementById("printSheetContainer");
    if (container) container.innerHTML = "";
  });
