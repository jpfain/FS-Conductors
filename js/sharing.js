  const MAX_EXTERNAL_MESSAGE_URI_LENGTH = 1800;

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

    if (rangeOption === "6") {
      return getNextTwelveMonthScheduleSlots(conductorSlots);
    } else if (rangeOption === "1") {
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
    if (rangeOption === "6") {
      filteredSlots = getNextTwelveMonthScheduleSlots(allSlots);
    } else if (rangeOption === "1") {
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

  function getNextTwelveMonthScheduleSlots(slots) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const endMonth = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    return slots.filter(slot => slot.slotDate >= monthStart && slot.slotDate < endMonth);
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
    document.getElementById("queueActionHint").style.display = deliveryMode === "queue" ? "block" : "none";

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
        .filter(Boolean)
        .filter((value, index, values) => {
          const normalized = isText ? value.replace(/[^\d+]/g, "") : value.toLowerCase();
          return values.findIndex(candidate => {
            const normalizedCandidate = isText
              ? candidate.replace(/[^\d+]/g, "")
              : candidate.toLowerCase();
            return normalizedCandidate === normalized;
          }) === index;
        });

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
    document.getElementById("queueActionHint").style.display = "none";

    setShareFormat(initialFormat);
    openAccessibleModal("shareModal", "shareRecipientInput");
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
    closeAccessibleModal("shareModal");
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
        smsBtn.innerText = `💬 Text ${firstName} (${idx + 1}/${grouped.length})`;

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
      smsBtn.innerText = "💬 Send Group Text";
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

    touchCoreState(state);
    saveAppState(state);
    refreshShareModalPreview();
    showStatus("Template reset to original default.");
  }

  async function shareModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const title = activeShareContext.format === "email"
      ? (document.getElementById("shareEmailSubject").value || "FS Conductor Schedule")
      : (activeShareContext.mode === "single"
          ? `FS Conductor Schedule - ${activeShareContext.conductorName}`
          : "FS Conductor Schedule - All Conductors");

    if (!navigator.share) {
      await copyModalMessage("Copied. Paste the message into your chosen app and add recipients.");
      return;
    }

    try {
      await navigator.share({ title, text });
      showStatus("Share sheet closed. If you sent the schedule, tap Tag Sent Today to record it.");
    } catch (err) {
      if (err && err.name === "AbortError") {
        showStatus("Sharing cancelled.");
      } else {
        console.error("Web Share error:", err);
        showStatus(`Could not open the share sheet: ${err.message || "Unknown error"}`);
      }
    }
  }

  function isAppleMobileDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function buildSmsLink(phones, text) {
    const body = encodeURIComponent(text);
    if (phones.length === 1) return `sms:${phones[0]}?body=${body}`;
    return `sms://open?addresses=${phones.map(encodeURIComponent).join(",")}&body=${body}`;
  }

  async function shareTextWithFallback(text, title, successMessage, fallbackMessage) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        showStatus(successMessage);
      } catch (err) {
        if (err && err.name === "AbortError") {
          showStatus("Sharing cancelled.");
        } else {
          console.error("Web Share error:", err);
          showStatus(`Could not open the share sheet: ${err.message || "Unknown error"}`);
        }
      }
      return;
    }

    await copyModalMessage(fallbackMessage);
  }

  async function smsModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const rawRecipients = document.getElementById("shareRecipientInput").value;
    const phones = [...new Set(rawRecipients.split(/[,;\n]+/).map(p => p.replace(/[^\d+]/g, "")).filter(Boolean))];
    if (phones.length === 0) {
      showStatus("No mobile numbers found. Add or enter at least one recipient.");
      return;
    }

    const title = activeShareContext.mode === "single"
      ? `FS Conductor Schedule - ${activeShareContext.conductorName}`
      : "FS Conductor Schedule - All Conductors";
    const groupSmsUnsupported = phones.length > 1 && !isAppleMobileDevice();
    const smsLink = groupSmsUnsupported ? "" : buildSmsLink(phones, text);

    if (groupSmsUnsupported || smsLink.length > MAX_EXTERNAL_MESSAGE_URI_LENGTH) {
      const reason = groupSmsUnsupported
        ? "This browser cannot reliably prefill multiple text recipients."
        : "This message is too long to open reliably in a text app.";
      await shareTextWithFallback(
        text,
        title,
        `${reason} The share sheet closed; recipients were not prefilled. Check the To field before sending.`,
        `${reason} The message was copied. Open Messages, add recipients from the To field, and paste it.`
      );
      return;
    }

    window.location.href = smsLink;
    showStatus("Opening Messages. Sending is not confirmed; return here to mark it sent if appropriate.");
  }

  function parseEmailRecipients(rawRecipients) {
    return rawRecipients.split(/[,;\n]+/).map(email => email.trim()).filter(Boolean);
  }

  async function emailModalMessage() {
    const text = document.getElementById("shareMessageTextarea").value;
    const subject = document.getElementById("shareEmailSubject").value || "FS Conductor Schedule";
    const rawRecipients = document.getElementById("shareRecipientInput").value;
    const emails = parseEmailRecipients(rawRecipients);
    if (emails.length === 0) {
      showStatus("No email addresses found. Add or enter at least one recipient.");
      return;
    }
    if (emails.some(email => !/^[^\s@,;]+@[^\s@,;]+$/.test(email))) {
      showStatus("Check the email addresses. Separate valid addresses with commas or semicolons.");
      return;
    }

    const gmailUrl = new URL("https://mail.google.com/mail/");
    gmailUrl.searchParams.set("view", "cm");
    gmailUrl.searchParams.set("fs", "1");
    gmailUrl.searchParams.set("to", emails.join(","));
    gmailUrl.searchParams.set("su", subject);
    gmailUrl.searchParams.set("body", text);

    window.open(gmailUrl.toString(), "_blank", "noopener,noreferrer");
    showStatus("Opening Gmail compose. Sending is not confirmed; return here to mark it sent if appropriate.");
  }

  async function copyModalMessage(statusMessage = "Copied to clipboard!") {
    const text = document.getElementById("shareMessageTextarea").value;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showStatus("Clipboard access is unavailable. Select and copy the message manually.");
      alert(text);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showStatus(statusMessage);
      alert("Copied to clipboard! You can now paste (Cmd + V / Tap Paste) into Messages or Email.");
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      showStatus("Could not copy the message. Select and copy it manually.");
      alert(text);
    }
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
