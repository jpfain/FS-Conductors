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
    prepareSafariPrintLink();
    openAccessibleModal("printModal", "printScopeSelect");
    syncModalBodyLock();
  }

  function closePrintModal() {
    closeAccessibleModal("printModal");
    syncModalBodyLock();
  }

  function prepareSafariPrintLink() {
    const scopeEl = document.getElementById("printScopeSelect");
    const scope = (scopeEl && scopeEl.value) || "3";
    const printDate = scope === "12" ? new Date() : currentDate;
    const y = printDate.getFullYear();
    const m = printDate.getMonth();
    const anchor = document.getElementById("safariPrintAnchor");
    if (anchor) {
      anchor.href = `./index.html?print=${encodeURIComponent(scope)}&y=${y}&m=${m}`;
    }
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

  /* --- ZERO-DEPENDENCY VECTOR PDF GENERATOR --- */
  function toPdfAscii(str) {
    return String(str || "")
      .replace(/[–—]/g, "-")
      .replace(/•/g, "|")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function wrapPdfText(str, maxChars) {
    const words = String(str || "").split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      if ((current + " " + words[i]).length <= maxChars) {
        current += " " + words[i];
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
    return lines;
  }

  function generateBoardPDFBlob(scope) {
    const printDate = scope === "12" ? new Date() : currentDate;
    const data = getPrintMonthsData(scope, printDate.getFullYear(), printDate.getMonth());
    const pageW = 612;
    const pageH = 792;
    const marginL = 54;
    const marginR = 54;
    const contentW = pageW - marginL - marginR;
    const colWidths = [152, 114, 132, 106];
    const colMaxChars = [27, 20, 23, 18];

    let pages = [];
    let ops = [];
    let y = pageH - 52;

    const pushPageHeader = (continued) => {
      ops.push("0.118 0.227 0.541 rg");
      ops.push("BT /F2 15 Tf " + marginL + " " + y + " Td (" + toPdfAscii("Field Service Conductor Schedule" + (continued ? " (Cont.)" : "")) + ") Tj ET");
      ops.push("0.278 0.333 0.412 rg");
      ops.push("BT /F1 8.5 Tf " + (pageW - marginR - 110) + " " + y + " Td (" + toPdfAscii("Printed " + data.printedOn) + ") Tj ET");
      y -= 15;
      ops.push("0.200 0.255 0.333 rg");
      ops.push("BT /F2 9 Tf " + marginL + " " + y + " Td (" + toPdfAscii(data.scopeSubtitle + " | " + data.defTime + " | " + data.defLoc) + ") Tj ET");
      y -= 8;
      ops.push("0.118 0.227 0.541 RG 1.5 w " + marginL + " " + y + " m " + (pageW - marginR) + " " + y + " l S");
      y -= 18;
    };

    const startNewPage = (continued) => {
      if (ops.length > 0) pages.push(ops.join("\n"));
      ops = [];
      y = pageH - 52;
      pushPageHeader(continued);
    };

    startNewPage(false);

    data.blocks.forEach(block => {
      const estBlockH = 38 + block.rows.length * 24;
      if (y - estBlockH < 64) {
        startNewPage(true);
      }

      ops.push("0.945 0.961 0.976 rg 0.796 0.835 0.882 RG 0.7 w");
      ops.push(marginL + " " + (y - 18) + " " + contentW + " 18 re B");
      ops.push("0.059 0.090 0.165 rg");
      ops.push("BT /F2 10 Tf " + (marginL + 6) + " " + (y - 13) + " Td (" + toPdfAscii(block.heading) + ") Tj ET");
      y -= 18;

      const headers = ["Date", "Conductor", "Time & Location", "Assignment Status"];
      ops.push("0.973 0.980 0.988 rg 0.796 0.835 0.882 RG 0.7 w");
      ops.push(marginL + " " + (y - 17) + " " + contentW + " 17 re B");
      let cx = marginL;
      ops.push("0.118 0.161 0.231 rg");
      headers.forEach((h, idx) => {
        ops.push("BT /F2 8.2 Tf " + (cx + 5) + " " + (y - 12) + " Td (" + toPdfAscii(h) + ") Tj ET");
        if (idx > 0) {
          ops.push("0.796 0.835 0.882 RG 0.7 w " + cx + " " + y + " m " + cx + " " + (y - 17) + " l S");
        }
        cx += colWidths[idx];
      });
      y -= 17;

      block.rows.forEach(r => {
        const cells = [r.dateText, r.conductorText, r.timeLocText, r.statusText];
        const wrapped = cells.map((txt, idx) => wrapPdfText(txt, colMaxChars[idx]));
        const maxLines = Math.max(...wrapped.map(w => w.length), 1);
        const rowH = Math.max(18, maxLines * 10.5 + 7);

        if (y - rowH < 56) {
          startNewPage(true);
        }

        if (r.cancelled) {
          ops.push("0.996 0.949 0.949 rg 0.796 0.835 0.882 RG 0.7 w");
        } else {
          ops.push("1 1 1 rg 0.796 0.835 0.882 RG 0.7 w");
        }
        ops.push(marginL + " " + (y - rowH) + " " + contentW + " " + rowH + " re B");

        let rx = marginL;
        wrapped.forEach((linesArr, idx) => {
          if (idx > 0) {
            ops.push("0.796 0.835 0.882 RG 0.7 w " + rx + " " + y + " m " + rx + " " + (y - rowH) + " l S");
          }
          if (r.cancelled) {
            ops.push("0.600 0.106 0.106 rg");
          } else {
            ops.push("0 0 0 rg");
          }
          const fontTag = (idx === 0 || idx === 1) ? "/F2" : "/F1";
          linesArr.forEach((lineStr, lineIdx) => {
            const ty = y - 11.5 - (lineIdx * 10.5);
            ops.push("BT " + fontTag + " 8.2 Tf " + (rx + 5) + " " + ty + " Td (" + toPdfAscii(lineStr) + ") Tj ET");
          });
          rx += colWidths[idx];
        });

        y -= rowH;
      });

      y -= 12;
    });

    if (y < 64) startNewPage(true);
    ops.push("0.796 0.835 0.882 RG 0.7 w " + marginL + " " + y + " m " + (pageW - marginR) + " " + y + " l S");
    y -= 12;
    ops.push("0.278 0.333 0.412 rg");
    ops.push("BT /F1 7.5 Tf " + marginL + " " + y + " Td (" + toPdfAscii("Preparation References: (1) mwb21 November p. 7 'Tips for Making Meetings for Field Service Practical' | (2) km 3/15 pp. 3-6.") + ") Tj ET");
    y -= 10;
    ops.push("BT /F1 7.5 Tf " + marginL + " " + y + " Td (" + toPdfAscii("If a scheduling conflict arises, please notify the schedule coordinator early to arrange a replacement or trade.") + ") Tj ET");

    pages.push(ops.join("\n"));

    const objects = [];
    const addObj = (body) => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = addObj("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = addObj("");
    const fontRegId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const fontBoldId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

    const pageIds = [];
    pages.forEach(streamContent => {
      const contentId = addObj("<< /Length " + streamContent.length + " >>\nstream\n" + streamContent + "\nendstream");
      const pageId = addObj(
        "<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 " + fontRegId + " 0 R /F2 " + fontBoldId + " 0 R >> >> " +
        "/Contents " + contentId + " 0 R >>"
      );
      pageIds.push(pageId);
    });

    objects[pagesId - 1] = "<< /Type /Pages /Kids [" + pageIds.map(id => id + " 0 R").join(" ") + "] /Count " + pageIds.length + " >>";

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((objBody, idx) => {
      offsets.push(pdf.length);
      pdf += (idx + 1) + " 0 obj\n" + objBody + "\nendobj\n";
    });

    const xrefPos = pdf.length;
    pdf += "xref\n0 " + (objects.length + 1) + "\n";
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i++) {
      pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    }
    pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root " + catalogId + " 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF";

    return new Blob([pdf], { type: "application/pdf" });
  }

  async function shareOrDownloadBoardPDF() {
    const scopeEl = document.getElementById("printScopeSelect");
    const scope = (scopeEl && scopeEl.value) || "3";
    const pdfBlob = generateBoardPDFBlob(scope);
    const fileName = `FS_Conductor_Schedule_${scope}Mo.pdf`;
    closePrintModal();

    try {
      const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: "Field Service Conductor Schedule",
          files: [pdfFile]
        });
        showStatus("📄 Shared PDF — tap Print or Save to Files in the iOS sheet!");
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }

    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showStatus("📄 Downloaded " + fileName + "!");
  }

  function enterStandalonePrintMode(scopeParam, yearParam, monthParam) {
    const baseYear = !isNaN(yearParam) ? yearParam : currentDate.getFullYear();
    const baseMonth = !isNaN(monthParam) ? monthParam : currentDate.getMonth();
    const container = document.getElementById("printSheetContainer");
    document.body.classList.add("standalone-print-mode");
    container.innerHTML = `
      <div class="standalone-print-bar">
        <span>Tap Print below or Safari Share (↑) → Print</span>
        <div class="controls-group">
          <a href="./index.html" style="text-decoration: none; padding: 6px 10px; border-radius: 7px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-size: 0.8rem; font-weight: 600;">← App</a>
          <button type="button" class="primary" style="min-height: 34px; padding: 6px 12px;" onclick="window.print()">🖨️ Print</button>
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
