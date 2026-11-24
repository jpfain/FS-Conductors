  const SYNC_HISTORY_KEY = "conductor_sync_history";
  let gistConfigCache = null;
  let cloudPushTimer = null;
  let queuedCloudPush = false;

  function loadGistConfig() {
    if (!gistConfigCache) {
      try {
        gistConfigCache = {
          token: "",
          gistId: "",
          autoSync: true,
          lastSyncedAt: "",
          pendingOfflineSync: false,
          ...JSON.parse(localStorage.getItem(GIST_CONFIG_KEY) || "{}")
        };
      } catch (error) {
        gistConfigCache = { token: "", gistId: "", autoSync: true, lastSyncedAt: "", pendingOfflineSync: false };
      }
      delete gistConfigCache.sessionToken;
    }
    return { ...gistConfigCache };
  }

  function saveGistConfig(cfg) {
    gistConfigCache = {
      token: cfg.token || "",
      gistId: cfg.gistId || "",
      autoSync: cfg.autoSync !== false,
      lastSyncedAt: cfg.lastSyncedAt || "",
      pendingOfflineSync: cfg.pendingOfflineSync === true
    };
    try {
      localStorage.setItem(GIST_CONFIG_KEY, JSON.stringify(gistConfigCache));
    } catch (error) {
      showStatus(`⚠️ Cloud preferences could not be saved in this browser: ${error.message}`);
    }
    updateCloudSyncPill();
  }

  async function initializeSyncConfig() {
    try {
      await ScheduleStorage.clearLegacySyncSession();
    } catch (error) {
      showStatus(`⚠️ Previous cloud session could not be cleared from this browser: ${error.message}`);
    }
    try {
      const oldConfig = JSON.parse(localStorage.getItem(GIST_CONFIG_KEY) || "{}");
      if (oldConfig.sessionToken) {
        delete oldConfig.sessionToken;
        localStorage.setItem(GIST_CONFIG_KEY, JSON.stringify(oldConfig));
      }
    } catch (error) {
      showStatus(`⚠️ Existing cloud settings could not be updated; local schedule remains available: ${error.message}`);
    }
    gistConfigCache = null;
    loadGistConfig();
  }

  function getSyncHistory() {
    try {
      const entries = JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY) || "[]");
      return Array.isArray(entries) ? entries : [];
    } catch (error) {
      return [];
    }
  }

  function recordSyncHistory(summary) {
    const entries = getSyncHistory();
    entries.unshift({ at: new Date().toISOString(), summary });
    try {
      localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(entries.slice(0, 20)));
    } catch (error) {
      showStatus(`⚠️ Sync completed, but its history could not be saved: ${error.message}`);
    }
  }

  function openSyncHistory() {
    const list = document.getElementById("syncHistoryList");
    const entries = getSyncHistory();
    list.innerHTML = entries.length
      ? entries.map(entry => `<li><strong>${escapeHtml(new Date(entry.at).toLocaleString())}</strong><br>${escapeHtml(entry.summary)}</li>`).join("")
      : "<li>No merges recorded yet.</li>";
    document.getElementById("cloudSyncModal").classList.remove("open");
    syncModalBodyLock();
    document.getElementById("syncHistoryModal").classList.add("open");
    syncModalBodyLock();
  }

  function closeSyncHistory() {
    document.getElementById("syncHistoryModal").classList.remove("open");
    syncModalBodyLock();
  }

  async function githubGistRequest(path, options = {}) {
    const cfg = loadGistConfig();
    if (!cfg.token) throw new Error("Enter your GitHub Personal Access Token before syncing.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${cfg.token}`);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      if (response.status === 401) {
        updateCloudSyncPill("☁️ Check GitHub Token", "error");
      }
      let detail = "";
      try {
        const body = await response.json();
        detail = body.message || body.error || "";
      } catch (error) {}
      throw new Error(detail || `GitHub API returned HTTP ${response.status}.`);
    }
    return response;
  }

  function updateCloudSyncPill(overrideText, stateClass) {
    const pill = document.getElementById("cloudSyncPill");
    if (!pill) return;
    const cfg = loadGistConfig();

    pill.className = "sync-pill";
    if (overrideText) {
      pill.innerText = overrideText;
      if (stateClass) pill.classList.add(stateClass);
      return;
    }

    if (cfg.token && cfg.gistId) {
      const syncedTitle = cfg.lastSyncedAt
        ? `Last synced: ${new Date(cfg.lastSyncedAt).toLocaleString()}`
        : "Connected to GitHub Gist";
      if (cfg.pendingOfflineSync) {
        pill.classList.add("offline");
        pill.innerText = "☁️ Offline Saved";
        pill.title = `Offline edits waiting to merge & sync (${syncedTitle})`;
      } else if (!navigator.onLine) {
        pill.classList.add("offline");
        pill.innerText = "☁️ Offline";
        pill.title = `Currently offline (${syncedTitle})`;
      } else {
        pill.classList.add("connected");
        if (cfg.lastSyncedAt) {
          const tStr = new Date(cfg.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          pill.innerText = cfg.autoSync ? `☁️ Synced ${tStr}` : "☁️ Cloud Ready";
        } else {
          pill.innerText = cfg.autoSync ? "☁️ Auto-Sync On" : "☁️ Cloud Ready";
        }
        pill.title = syncedTitle;
      }
    } else {
      pill.innerText = cfg.token ? "☁️ Cloud Ready" : "☁️ Local Only";
      pill.title = cfg.token
        ? "GitHub token saved; enter a private Gist ID to sync"
        : "Enter a GitHub Personal Access Token to configure cloud sync";
    }
  }

  function updateNetworkStatus() {
    const indicator = document.getElementById("networkStatusPill");
    if (indicator) indicator.hidden = navigator.onLine;
  }

  function copySyncCredentials() {
    const gistId = document.getElementById("gistIdInput").value.trim();
    if (!gistId) {
      alert("Enter or create a private Gist ID first.");
      return;
    }
    navigator.clipboard.writeText(gistId).then(() => {
      const detail = document.getElementById("cloudSyncStatusDetail");
      if (detail) {
        detail.style.color = "#065f46";
        detail.innerText = "📋 Copied the Gist ID. Enter your GitHub token separately on each device.";
      }
      showStatus("📋 Copied private Gist ID.");
    }).catch(error => { showStatus(`Could not copy Gist ID: ${error.message}`); });
  }

  function openCloudSyncModal() {
    const cfg = loadGistConfig();
    document.getElementById("gistTokenInput").value = cfg.token || "";
    document.getElementById("gistIdInput").value = cfg.gistId || "";
    document.getElementById("gistAutoSyncCheckbox").checked = cfg.autoSync !== false;

    const detail = document.getElementById("cloudSyncStatusDetail");
    detail.style.color = "#475569";
    if (!cfg.token) {
      detail.innerText = "Enter a GitHub Personal Access Token with the gist scope to enable cloud sync. Your schedule remains available locally.";
    } else if (!cfg.gistId) {
      detail.innerText = "GitHub token saved. Enter a shared private Gist ID or leave it blank to create one.";
    } else if (cfg.pendingOfflineSync) {
      detail.style.color = "#92400e";
      detail.innerText = "📴 Offline changes saved locally — will upload when connectivity returns.";
    } else if (!navigator.onLine) {
      detail.style.color = "#92400e";
      detail.innerText = "📴 Currently offline. Changes remain saved locally.";
    } else if (cfg.lastSyncedAt) {
      detail.innerText = `Last synced: ${new Date(cfg.lastSyncedAt).toLocaleString()}`;
    } else {
      detail.innerText = "Connected. Save the Gist settings, then use Pull or Push to sync.";
    }

    document.getElementById("cloudSyncModal").classList.add("open");
    syncModalBodyLock();
  }

  function closeCloudSyncModal() {
    document.getElementById("cloudSyncModal").classList.remove("open");
    syncModalBodyLock();
  }

  async function saveCloudSyncSettings() {
    let gistId = document.getElementById("gistIdInput").value.trim();
    const autoSync = document.getElementById("gistAutoSyncCheckbox").checked;

    const cfg = loadGistConfig();
    const token = document.getElementById("gistTokenInput").value.trim();
    if (!token) {
      saveGistConfig({ ...cfg, token: "", autoSync: false, pendingOfflineSync: false });
      closeCloudSyncModal();
      showStatus("GitHub disconnected. The schedule remains saved on this device.");
      return;
    }

    const detail = document.getElementById("cloudSyncStatusDetail");
    detail.style.color = "#475569";
    detail.innerText = "Saving cloud sync settings...";

    try {
      if (!gistId) {
        const state = loadAppState();
        saveGistConfig({ ...cfg, token, gistId, autoSync });
        const res = await githubGistRequest("/gists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: "Conductor Schedule PWA Sync Data",
            public: false,
            files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } }
          })
        });
        const data = await res.json();
        gistId = data.id;
        document.getElementById("gistIdInput").value = gistId;
        saveGistConfig({ ...cfg, token, gistId, autoSync, lastSyncedAt: new Date().toISOString(), pendingOfflineSync: false });
        detail.style.color = "#065f46";
        detail.innerText = `✅ Created private Gist (${gistId}) and uploaded schedule!`;
        showStatus("☁️ Connected & created private sync Gist!");
      } else {
        saveGistConfig({ ...cfg, token, gistId, autoSync });
        await pullFromGitHubGist(false, false);
      }
    } catch (err) {
      detail.style.color = "#991b1b";
      detail.innerText = `❌ Error: ${err.message}`;
      updateCloudSyncPill("☁️ Sync Error", "error");
    }
  }

  async function disconnectCloudSync() {
    const cfg = loadGistConfig();
    saveGistConfig({
      ...cfg,
      token: "",
      autoSync: false,
      pendingOfflineSync: false
    });
    closeCloudSyncModal();
    showStatus("GitHub disconnected. The schedule remains saved on this device.");
  }

  function scheduleCloudPush() {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId || !cfg.autoSync) return;

    if (!navigator.onLine) {
      cfg.pendingOfflineSync = true;
      saveGistConfig(cfg);
      showStatus("📴 Offline Saved — will upload automatically when Wi-Fi/data reconnects.");
      return;
    }

    queuedCloudPush = true;
    clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(flushScheduledCloudPush, 2000);
  }

  async function flushScheduledCloudPush() {
    clearTimeout(cloudPushTimer);
    cloudPushTimer = null;
    if (!queuedCloudPush) return;
    if (!navigator.onLine) {
      const cfg = loadGistConfig();
      cfg.pendingOfflineSync = true;
      saveGistConfig(cfg);
      return;
    }
    if (isSyncingNow) return;
    queuedCloudPush = false;
    await pushToGitHubGist(true);
  }

  async function pushToGitHubGist(silent = false, skipPreMerge = false) {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId) return;
    if (isSyncingNow) {
      queuedCloudPush = true;
      return;
    }

    const detail = document.getElementById("cloudSyncStatusDetail");
    if (!navigator.onLine) {
      cfg.pendingOfflineSync = true;
      saveGistConfig(cfg);
      if (detail) {
        detail.style.color = "#92400e";
        detail.innerText = "📴 Offline Saved — will merge & upload automatically when connection returns.";
      }
      if (!silent) showStatus("📴 Offline Saved — will upload when reconnected.");
      return;
    }

    isSyncingNow = true;
    updateCloudSyncPill("☁️ Saving...", "connected");
    let state = loadAppState();

    try {
      if (!skipPreMerge) {
        updateCloudSyncPill("☁️ Merging...", "connected");
        const preRes = await githubGistRequest(`/gists/${encodeURIComponent(cfg.gistId)}`);
        const preData = await preRes.json();
        const preFile = preData.files && preData.files[GIST_FILENAME];
        if (!preFile || !preFile.content) throw new Error("Schedule data was not found in the private Gist; push cancelled.");
        const remoteState = JSON.parse(preFile.content);
        if (!ScheduleStateSchema.validate(remoteState)) {
          throw new Error("Remote schedule data is invalid; push cancelled to avoid overwriting it.");
        }
        const merged = mergeScheduleStates(state, remoteState);
        snapshotPastDates(merged);
        const localChanged = statesDiffer(state, merged);
        const remoteChanged = statesDiffer(remoteState, merged);
        if (localChanged) {
          merged.lastModified = new Date().toISOString();
          await replaceAppState(merged);
        }
        if (localChanged && remoteChanged) {
          recordSyncHistory(`Merged local and cloud edits before pushing to Gist ${cfg.gistId.slice(0, 8)}. Newer per-field changes were retained.`);
        }
        state = merged;
        updateCloudSyncPill("☁️ Saving...", "connected");
      }

      const payloadStr = JSON.stringify({
        files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } }
      });
      const res = await githubGistRequest(`/gists/${encodeURIComponent(cfg.gistId)}`, {
        method: "PATCH",
        keepalive: payloadStr.length < 60000,
        headers: { "Content-Type": "application/json" },
        body: payloadStr
      });

      const now = new Date();
      cfg.lastSyncedAt = now.toISOString();
      cfg.pendingOfflineSync = false;
      lastAutoCloudPull = Date.now();
      saveGistConfig(cfg);

      if (detail) {
        detail.style.color = "#065f46";
        detail.innerText = `✅ Uploaded schedule to GitHub Gist! (${now.toLocaleTimeString()})`;
      }
      if (!silent) showStatus("☁️ Uploaded schedule to GitHub Gist!");
    } catch (err) {
      if (!navigator.onLine || err.name === "TypeError") {
        cfg.pendingOfflineSync = true;
        saveGistConfig(cfg);
        showStatus("📴 Cloud sync unavailable — changes remain saved locally and will retry when connected.");
      } else {
        updateCloudSyncPill("☁️ Sync Error", "error");
        if (detail) detail.innerText = `❌ Cloud push failed: ${err.message}`;
        if (!silent) alert("Cloud push failed: " + err.message);
      }
    } finally {
      isSyncingNow = false;
      if (queuedCloudPush) cloudPushTimer = setTimeout(flushScheduledCloudPush, 500);
    }
  }

  async function pullFromGitHubGist(forceOverwrite = false, silent = false) {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId || isSyncingNow) return;

    if (!navigator.onLine) {
      updateCloudSyncPill();
      if (!silent) showStatus("📴 Currently offline — using local schedule.");
      return;
    }

    isSyncingNow = true;
    lastAutoCloudPull = Date.now();
    updateCloudSyncPill("☁️ Checking...", "connected");
    const detail = document.getElementById("cloudSyncStatusDetail");

    try {
      const res = await githubGistRequest(`/gists/${encodeURIComponent(cfg.gistId)}`);
      const data = await res.json();
      const fileObj = data.files && data.files[GIST_FILENAME];
      if (!fileObj || !fileObj.content) throw new Error("Sync file not found inside Gist.");

      const remoteState = JSON.parse(fileObj.content);
      if (!ScheduleStateSchema.validate(remoteState)) throw new Error("Invalid schedule data in Gist.");

      const localState = loadAppState();
      const now = new Date();

      if (forceOverwrite) {
        const normalizedRemote = ScheduleStateSchema.normalize(remoteState, createDefaultAppState());
        ensureFieldTimestamps(normalizedRemote);
        snapshotPastDates(normalizedRemote);
        await replaceAppState(normalizedRemote);
        cfg.lastSyncedAt = now.toISOString();
        cfg.pendingOfflineSync = false;
        saveGistConfig(cfg);
        if (detail) {
          detail.style.color = "#065f46";
          detail.innerText = `✅ Synced latest schedule from cloud! (${now.toLocaleTimeString()})`;
        }
        if (!silent) showStatus("☁️ Synced latest schedule from cloud!");
      } else {
        const mergedState = mergeScheduleStates(localState, remoteState);
        snapshotPastDates(mergedState);
        const localChanged = statesDiffer(localState, mergedState);
        const remoteNeedsUpdate = statesDiffer(remoteState, mergedState);

        if (localChanged) {
          mergedState.lastModified = now.toISOString();
          await replaceAppState(mergedState);
          showStatus("☁️ Synced latest schedule from cloud!");
        }

        if (localChanged && remoteNeedsUpdate) {
          recordSyncHistory(`Reconciled divergent local and cloud schedules for Gist ${cfg.gistId.slice(0, 8)} using field timestamps. Newer per-date values and core-field updates were retained.`);
        }

        if (remoteNeedsUpdate && cfg.autoSync) {
          isSyncingNow = false;
          await pushToGitHubGist(true, true);
          return;
        }

        cfg.lastSyncedAt = now.toISOString();
        cfg.pendingOfflineSync = false;
        saveGistConfig(cfg);
        if (detail) {
          detail.style.color = "#065f46";
          detail.innerText = localChanged
            ? `✅ Merged latest updates from cloud! (${now.toLocaleTimeString()})`
            : `✅ Schedule is already up to date! (${now.toLocaleTimeString()})`;
        }
        if (!silent && !localChanged) showStatus("☁️ Schedule is already up to date!");
      }
    } catch (err) {
      if (!navigator.onLine || err.name === "TypeError") {
        updateCloudSyncPill();
        if (!silent) showStatus("📴 Currently offline — using local schedule.");
      } else {
        updateCloudSyncPill("☁️ Sync Error", "error");
        if (detail) detail.innerText = `❌ Cloud pull failed: ${err.message}`;
        if (!silent) alert("Cloud pull failed: " + err.message);
      }
    } finally {
      isSyncingNow = false;
      if (queuedCloudPush) cloudPushTimer = setTimeout(flushScheduledCloudPush, 500);
    }
  }

  async function syncWithGitHubGist(silent = true, throttleMs = 0) {
    const cfg = loadGistConfig();
    if (!appStateCache) return;
    if (!cfg.token || !cfg.gistId || !cfg.autoSync) return;
    if (!navigator.onLine) {
      updateCloudSyncPill();
      return;
    }
    if (!cfg.pendingOfflineSync && throttleMs > 0 && Date.now() - lastAutoCloudPull < throttleMs) return;
    await pullFromGitHubGist(false, silent);
  }

  function manualPushToGist() {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId) {
      alert("Enter your GitHub Personal Access Token and a private Gist ID first.");
      return;
    }
    pushToGitHubGist(false);
  }

  function manualPullFromGist() {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId) {
      alert("Enter your GitHub Personal Access Token and a private Gist ID first.");
      return;
    }
    if (confirm("Replace this device's schedule with the latest cloud schedule? This will overwrite local schedule data.")) {
      pullFromGitHubGist(true, false);
    }
  }

  /* --- AUTOMATIC & MANUAL PWA UPDATE HANDLERS --- */
  let waitingServiceWorker = null;
  let appUpdateReloadRequested = false;

  function showAppUpdateAvailable(registration) {
    if (!registration || !registration.waiting) return;
    waitingServiceWorker = registration.waiting;
    document.getElementById("appUpdateBanner").hidden = false;
  }

  function dismissAppUpdate() {
    document.getElementById("appUpdateBanner").hidden = true;
  }

  function applyAppUpdate() {
    if (!waitingServiceWorker && swRegistration) waitingServiceWorker = swRegistration.waiting;
    if (!waitingServiceWorker) {
      showStatus("The update is no longer waiting. Use Check for App Update to try again.");
      dismissAppUpdate();
      return;
    }
    appUpdateReloadRequested = true;
    waitingServiceWorker.postMessage({ action: "skipWaiting" });
    showStatus("Applying update…");
  }

  async function checkForServiceWorkerUpdate() {
    if (!('serviceWorker' in navigator) || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastAutoUpdateCheck < 15000) return;
    lastAutoUpdateCheck = now;

    try {
      const reg = swRegistration || await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      swRegistration = reg;
      if (reg.waiting) {
        showAppUpdateAvailable(reg);
        return;
      }
      await reg.update();
      showAppUpdateAvailable(reg);
    } catch (error) {
      showStatus(`Could not check for app updates: ${error.message}`);
    }
  }

  async function forceAppUpdate() {
    if (!navigator.onLine) {
      showStatus("📴 Connect to Wi-Fi or cellular data to check for app updates.");
      return;
    }
    showStatus("Checking for updates...");
    try {
      if ('serviceWorker' in navigator) {
        const reg = swRegistration || await navigator.serviceWorker.getRegistration();
        if (!reg) throw new Error("The app service worker is not registered.");
        swRegistration = reg;
        await reg.update();
        showAppUpdateAvailable(reg);
        if (reg.waiting) showStatus("A new version is ready. Choose Reload to Update when convenient.");
        else showStatus("The app is up to date.");
      } else {
        throw new Error("This browser does not support service worker updates.");
      }
    } catch (error) {
      showStatus(`Could not check for app updates: ${error.message}`);
    }
  }
