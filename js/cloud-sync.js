  /* --- GITHUB GIST CLOUD SYNC --- */

  function loadGistConfig() {
    const defaults = {
      gistId: "",
      autoSync: true,
      lastSyncedAt: "",
      lastPullAt: "",
      lastPushAt: "",
      lastSyncError: "",
      lastSyncConflictAt: "",
      pendingOfflineSync: false,
      pendingPush: false
    };
    const raw = getLocalStorageValue(GIST_CONFIG_KEY);
    if (!raw) return { ...defaults, token: "" };

    let stored;
    try {
      stored = { ...defaults, ...JSON.parse(raw) };
    } catch (error) {
      reportStorageError("Saved cloud sync settings are invalid.", error);
      return { ...defaults, token: "" };
    }

    if (typeof stored.token !== "string") stored.token = "";
    return stored;
  }

  function saveGistConfig(cfg) {
    const storedConfig = { ...cfg };
    if (typeof storedConfig.token !== "string" || !storedConfig.token) {
      delete storedConfig.token;
    }
    const saved = setLocalStorageValue(GIST_CONFIG_KEY, JSON.stringify(storedConfig));
    updateCloudSyncPill();
    return saved;
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
      if (cfg.lastSyncError) {
        pill.classList.add("error");
        pill.innerText = "☁️ Sync Error";
        pill.title = `Last sync error: ${cfg.lastSyncError}`;
      } else if (cfg.pendingOfflineSync) {
        pill.classList.add("offline");
        pill.innerText = "☁️ Offline Saved";
        pill.title = `Offline edits waiting to merge & sync (${syncedTitle})`;
      } else if (cfg.pendingPush) {
        pill.classList.add("offline");
        pill.innerText = "☁️ Push Needed";
        pill.title = "Merged schedule changes are waiting to be pushed to GitHub Gist.";
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
      pill.innerText = "☁️ Local Only";
      pill.title = "Configure or check GitHub Gist Cloud Sync";
    }
  }

  function copySyncCredentials() {
    const gistId = document.getElementById("gistIdInput").value.trim() || loadGistConfig().gistId;
    if (!gistId) {
      alert("Save or enter a Gist ID first.");
      return;
    }
    navigator.clipboard.writeText(gistId).then(() => {
      const detail = document.getElementById("cloudSyncStatusDetail");
      if (detail) {
        detail.style.color = "#065f46";
        detail.innerText = "📋 Copied the Gist ID. Enter your GitHub token separately on each device.";
      }
      showStatus("📋 Copied the Gist ID.");
    }).catch((error) => {
      console.error("Could not copy the Gist ID:", error);
      alert(`Could not copy the Gist ID: ${error.message}`);
    });
  }

  function handleSmartSyncPaste(rawValue) {
    if (!rawValue) return;
    const tokenMatch = rawValue.match(/Token:\s*([^\s\r\n]+)/i) || rawValue.match(/\b(gh[ps]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/);
    const gistMatch = rawValue.match(/Gist\s*ID:\s*([a-f0-9]{20,40})/i) || rawValue.match(/\b([a-f0-9]{32})\b/i);

    if (tokenMatch && gistMatch) {
      document.getElementById("gistTokenInput").value = tokenMatch[1].trim();
      document.getElementById("gistIdInput").value = gistMatch[1].trim();
      const detail = document.getElementById("cloudSyncStatusDetail");
      if (detail) {
        detail.style.color = "#065f46";
        detail.innerText = "✅ Auto-filled both Token and Private Gist ID! Tap Save & Connect.";
      }
    }
  }

  function openCloudSyncModal() {
    const cfg = loadGistConfig();
    document.getElementById("gistTokenInput").value = cfg.token || "";
    document.getElementById("gistIdInput").value = cfg.gistId || "";
    document.getElementById("gistAutoSyncCheckbox").checked = cfg.autoSync !== false;

    const detail = document.getElementById("cloudSyncStatusDetail");
    detail.style.color = "#475569";
    const statusLines = [];
    if (cfg.lastPullAt) statusLines.push(`Last pull: ${new Date(cfg.lastPullAt).toLocaleString()}`);
    if (cfg.lastPushAt) statusLines.push(`Last push: ${new Date(cfg.lastPushAt).toLocaleString()}`);
    if (cfg.lastSyncConflictAt) {
      statusLines.push(`Concurrent edits were merged: ${new Date(cfg.lastSyncConflictAt).toLocaleString()}`);
    }
    if (cfg.lastSyncError) {
      detail.style.color = "#991b1b";
      statusLines.push(`Last sync error: ${cfg.lastSyncError}`);
    }

    if (cfg.pendingOfflineSync) {
      detail.style.color = "#92400e";
      statusLines.unshift("📴 Offline changes saved locally — will upload when reconnected.");
    } else if (cfg.pendingPush) {
      detail.style.color = "#92400e";
      statusLines.unshift("Merged changes are waiting to be pushed to GitHub Gist.");
    } else if (!navigator.onLine && cfg.token && cfg.gistId) {
      detail.style.color = "#92400e";
      statusLines.unshift("📴 Currently offline. Edits are saved locally.");
    } else if (!cfg.token && cfg.gistId) {
      detail.style.color = "#92400e";
      statusLines.unshift("Enter your GitHub token to sync.");
    } else if (cfg.lastSyncedAt) {
      statusLines.unshift(`Last synced: ${new Date(cfg.lastSyncedAt).toLocaleString()}`);
    } else if (cfg.token && cfg.gistId) {
      statusLines.unshift("Connected. Tap Pull or Push to sync immediately.");
    } else {
      statusLines.unshift("Not connected yet. Data is currently stored locally on this device.");
    }
    detail.innerText = statusLines.join("\n");

    openAccessibleModal("cloudSyncModal", "gistTokenInput");
    syncModalBodyLock();
  }

  function closeCloudSyncModal() {
    closeAccessibleModal("cloudSyncModal");
    syncModalBodyLock();
  }

  async function saveCloudSyncSettings() {
    const token = document.getElementById("gistTokenInput").value.trim();
    let gistId = document.getElementById("gistIdInput").value.trim();
    const autoSync = document.getElementById("gistAutoSyncCheckbox").checked;

    if (!token) {
      const saved = saveGistConfig({
        token: "", gistId: "", autoSync: false, lastSyncedAt: "",
        lastPullAt: "", lastPushAt: "", lastSyncError: "",
        lastSyncConflictAt: "", pendingOfflineSync: false, pendingPush: false
      });
      closeCloudSyncModal();
      showStatus(saved
        ? "Cloud sync disconnected (Local mode)."
        : "Cloud sync was disabled for this session, but the saved token could not be removed from browser storage.");
      return;
    }

    const detail = document.getElementById("cloudSyncStatusDetail");
    detail.style.color = "#475569";
    detail.innerText = "Connecting to GitHub...";

    try {
      const existingCfg = loadGistConfig();
      const configToSave = {
        ...existingCfg,
        token,
        gistId,
        autoSync,
        lastSyncError: ""
      };
      if (!saveGistConfig(configToSave)) {
        throw new Error("Cloud sync settings could not be saved in this browser.");
      }

      if (!gistId) {
        const state = loadAppState();
        const res = await fetch("https://api.github.com/gists", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            description: "Conductor Schedule PWA Sync Data",
            public: false,
            files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } }
          })
        });

        if (!res.ok) throw new Error(`GitHub API error (${res.status}). Check that your token has 'gist' permission.`);

        const data = await res.json();
        gistId = data.id;
        document.getElementById("gistIdInput").value = gistId;
        const now = new Date().toISOString();
        if (!saveGistConfig({
          ...configToSave,
          gistId,
          lastSyncedAt: now,
          lastPushAt: now,
          lastSyncError: "",
          pendingOfflineSync: false,
          pendingPush: false
        })) {
          throw new Error("The new Gist was created, but its ID could not be saved in this browser.");
        }
        detail.style.color = "#065f46";
        detail.innerText = `✅ Created private Gist (${gistId}) and uploaded schedule!`;
        showStatus("☁️ Connected & created private sync Gist!");
      } else {
        await pullFromGitHubGist(true, false);
      }
    } catch (err) {
      const cfg = loadGistConfig();
      cfg.lastSyncError = err.message;
      saveGistConfig(cfg);
      detail.style.color = "#991b1b";
      detail.innerText = `❌ Error: ${err.message}`;
      updateCloudSyncPill("☁️ Sync Error", "error");
    }
  }

  function scheduleCloudPush() {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId || !cfg.autoSync) return;

    if (!navigator.onLine) {
      cfg.pendingOfflineSync = true;
      cfg.pendingPush = true;
      cfg.lastSyncError = "";
      saveGistConfig(cfg);
      showStatus("📴 Offline Saved — will upload automatically when Wi-Fi/data reconnects.");
      return;
    }

    pushToGitHubGist(true);
  }

  async function pushToGitHubGist(silent = false, skipPreMerge = false) {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId) return;

    const detail = document.getElementById("cloudSyncStatusDetail");
    if (!navigator.onLine) {
      cfg.pendingOfflineSync = true;
      cfg.pendingPush = true;
      cfg.lastSyncError = "";
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
      if (cfg.pendingOfflineSync && !skipPreMerge) {
        updateCloudSyncPill("☁️ Merging...", "connected");
        const preRes = await fetch(`https://api.github.com/gists/${cfg.gistId}?t=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Authorization": `Bearer ${cfg.token}`,
            "Accept": "application/vnd.github+json"
          }
        });
        if (!preRes.ok) throw new Error(`Could not merge offline changes (HTTP ${preRes.status}).`);
        const preData = await preRes.json();
        const preFile = preData.files && preData.files[GIST_FILENAME];
        if (!preFile || !preFile.content) throw new Error("Sync file not found while merging offline changes.");
        const remoteState = JSON.parse(preFile.content);
        if (!remoteState || !Array.isArray(remoteState.roster)) {
          throw new Error("Invalid schedule data in Gist while merging offline changes.");
        }
        const merged = mergeScheduleStates(state, remoteState);
        snapshotPastDates(merged);
        if (statesDiffer(state, merged)) {
          merged.lastModified = new Date().toISOString();
          await persistScheduleState(merged);
          publishScheduleState(merged, "merge");
          renderUI();
        }
        state = merged;
        updateCloudSyncPill("☁️ Saving...", "connected");
      }

      const payloadStr = JSON.stringify({
        files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } }
      });
      const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
        method: "PATCH",
        cache: "no-store",
        keepalive: payloadStr.length < 60000,
        headers: {
          "Authorization": `Bearer ${cfg.token}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: payloadStr
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const now = new Date();
      cfg.lastSyncedAt = now.toISOString();
      cfg.lastPushAt = now.toISOString();
      cfg.lastSyncError = "";
      cfg.pendingOfflineSync = false;
      cfg.pendingPush = false;
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
        cfg.pendingPush = true;
        cfg.lastSyncError = "";
        saveGistConfig(cfg);
        if (!silent) showStatus("📴 Offline Saved — will upload when reconnected.");
      } else {
        cfg.lastSyncError = err.message;
        saveGistConfig(cfg);
        if (!silent) alert("Cloud push failed: " + err.message);
      }
    } finally {
      isSyncingNow = false;
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
      const res = await fetch(`https://api.github.com/gists/${cfg.gistId}?t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Authorization": `Bearer ${cfg.token}`,
          "Accept": "application/vnd.github+json"
        }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fileObj = data.files && data.files[GIST_FILENAME];
      if (!fileObj || !fileObj.content) throw new Error("Sync file not found inside Gist.");

      const remoteState = JSON.parse(fileObj.content);
      if (!remoteState || !Array.isArray(remoteState.roster)) throw new Error("Invalid schedule data in Gist.");

      const localState = loadAppState();
      const now = new Date();

      if (forceOverwrite) {
        const normalizedRemote = ensureFieldTimestamps(remoteState);
        snapshotPastDates(normalizedRemote);
        await persistScheduleState(normalizedRemote);
        publishScheduleState(normalizedRemote, "replace");
        cfg.lastSyncedAt = now.toISOString();
        cfg.lastPullAt = now.toISOString();
        cfg.lastSyncError = "";
        cfg.pendingOfflineSync = false;
        cfg.pendingPush = false;
        saveGistConfig(cfg);
        renderUI();
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
        const concurrentEdits = localChanged && remoteNeedsUpdate && statesDiffer(localState, remoteState);
        cfg.lastPullAt = now.toISOString();
        cfg.lastSyncError = "";
        if (concurrentEdits) cfg.lastSyncConflictAt = now.toISOString();

        if (localChanged) {
          mergedState.lastModified = now.toISOString();
          await persistScheduleState(mergedState);
          publishScheduleState(mergedState, "merge");
          renderUI();
          showStatus("☁️ Synced latest schedule from cloud!");
        }

        if (remoteNeedsUpdate && cfg.autoSync) {
          cfg.pendingPush = true;
          saveGistConfig(cfg);
          isSyncingNow = false;
          await pushToGitHubGist(true, true);
          const syncedCfg = loadGistConfig();
          if (concurrentEdits && !syncedCfg.pendingPush && !syncedCfg.lastSyncError && detail) {
            detail.style.color = "#065f46";
            detail.innerText = `✅ Concurrent edits merged and synchronized. (${now.toLocaleTimeString()})`;
          }
          return;
        }

        cfg.pendingOfflineSync = false;
        cfg.pendingPush = remoteNeedsUpdate;
        if (!remoteNeedsUpdate) cfg.lastSyncedAt = now.toISOString();
        saveGistConfig(cfg);
        if (detail) {
          detail.style.color = "#065f46";
          detail.innerText = remoteNeedsUpdate
            ? `✅ Pulled updates. Push the merged schedule to finish syncing. (${now.toLocaleTimeString()})`
            : concurrentEdits
            ? `✅ Concurrent edits merged. (${now.toLocaleTimeString()})`
            : localChanged
            ? `✅ Merged latest updates from cloud! (${now.toLocaleTimeString()})`
            : `✅ Schedule is already up to date! (${now.toLocaleTimeString()})`;
        }
        if (!silent && !localChanged) showStatus("☁️ Schedule is already up to date!");
      }
    } catch (err) {
      if (!navigator.onLine || err.name === "TypeError") {
        cfg.lastSyncError = "";
        saveGistConfig(cfg);
        updateCloudSyncPill();
        if (!silent) showStatus("📴 Currently offline — using local schedule.");
      } else {
        cfg.lastSyncError = err.message;
        saveGistConfig(cfg);
        if (!silent) alert("Cloud pull failed: " + err.message);
      }
    } finally {
      isSyncingNow = false;
    }
  }

  async function syncWithGitHubGist(silent = true, throttleMs = 0) {
    if (!appStorageInitialized) return;
    const cfg = loadGistConfig();
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
      alert("Enter your GitHub Token and tap Save & Connect first.");
      return;
    }
    pushToGitHubGist(false);
  }

  function manualPullFromGist() {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId) {
      alert("Enter your GitHub Token and Gist ID, then tap Save & Connect first.");
      return;
    }
    pullFromGitHubGist(true, false);
  }

  function retryCloudSync() {
    const cfg = loadGistConfig();
    if (!cfg.token || !cfg.gistId) {
      openCloudSyncModal();
      return;
    }
    if (cfg.pendingOfflineSync || cfg.pendingPush) {
      pushToGitHubGist(false);
    } else {
      pullFromGitHubGist(false, false);
    }
  }

  /* --- SERVICE WORKER UPDATE HANDLERS --- */
  let appUpdatePromptDismissed = false;

  function showAppUpdatePrompt() {
    const banner = document.getElementById("appUpdateBanner");
    if (banner && !appUpdatePromptDismissed) banner.hidden = false;
  }

  function dismissAppUpdatePrompt() {
    appUpdatePromptDismissed = true;
    const banner = document.getElementById("appUpdateBanner");
    if (banner) banner.hidden = true;
  }

  function activateWaitingServiceWorker(registration) {
    if (registration && registration.waiting) {
      const banner = document.getElementById("appUpdateBanner");
      if (banner) banner.hidden = true;
      appUpdatePromptDismissed = false;
      appUpdateRequested = true;
      registration.waiting.postMessage({ action: 'skipWaiting' });
      return true;
    }
    return false;
  }

  async function checkForServiceWorkerUpdate(force = false) {
    if (force) appUpdatePromptDismissed = false;
    if (!('serviceWorker' in navigator) || !navigator.onLine) {
      if (force) showStatus("Updates require service worker support and an internet connection.");
      return;
    }
    const now = Date.now();
    if (!force && now - lastAutoUpdateCheck < 15000) return;
    lastAutoUpdateCheck = now;

    try {
      const reg = swRegistration || await navigator.serviceWorker.getRegistration();
      if (!reg) {
        if (force) showStatus("No app update registration was found. Reload the page and try again.");
        return;
      }
      swRegistration = reg;
      if (reg.waiting) {
        showAppUpdatePrompt();
        return;
      }
      await reg.update();
      if (reg.waiting) {
        showAppUpdatePrompt();
      } else if (force && reg.installing) {
        showStatus("A new version is downloading. You can keep using the app.");
      } else if (force) {
        showStatus("The app is up to date.");
      }
    } catch (err) {
      console.error('Service worker update check failed:', err);
      if (force) showStatus(`Could not check for app updates: ${err.message}`);
    }
  }

  async function forceAppUpdate() {
    if (!navigator.onLine) {
      showStatus("📴 Connect to Wi-Fi or cellular data to check for app updates.");
      return;
    }
    await checkForServiceWorkerUpdate(true);
  }

  function installAppUpdate() {
    const registration = swRegistration;
    if (!activateWaitingServiceWorker(registration)) {
      showStatus("The new version is no longer waiting. Check for updates again.");
    }
  }
