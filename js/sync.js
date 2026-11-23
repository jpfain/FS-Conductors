  function loadGistConfig() {
    try {
      const raw = localStorage.getItem(GIST_CONFIG_KEY);
      if (raw) {
        return {
          token: "",
          gistId: "",
          autoSync: true,
          lastSyncedAt: "",
          pendingOfflineSync: false,
          ...JSON.parse(raw)
        };
      }
    } catch (e) {}
    return { token: "", gistId: "", autoSync: true, lastSyncedAt: "", pendingOfflineSync: false };
  }

  function saveGistConfig(cfg) {
    localStorage.setItem(GIST_CONFIG_KEY, JSON.stringify(cfg));
    updateCloudSyncPill();
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
      pill.innerText = "☁️ Local Only";
      pill.title = "Configure or check GitHub Gist Cloud Sync";
    }
  }

  function copySyncCredentials() {
    const token = document.getElementById("gistTokenInput").value.trim();
    const gistId = document.getElementById("gistIdInput").value.trim();
    if (!token && !gistId) {
      alert("Enter your Token and Gist ID first.");
      return;
    }
    const bundle = `Conductor Schedule Sync\nToken: ${token}\nGist ID: ${gistId}`;
    navigator.clipboard.writeText(bundle).then(() => {
      const detail = document.getElementById("cloudSyncStatusDetail");
      if (detail) {
        detail.style.color = "#065f46";
        detail.innerText = "📋 Copied Token & Gist ID! Paste into either box on your other device.";
      }
      showStatus("📋 Copied Cloud Sync credentials!");
    }).catch(() => { alert(bundle); });
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
    if (cfg.pendingOfflineSync) {
      detail.style.color = "#92400e";
      detail.innerText = "📴 Offline changes saved locally — will upload automatically as soon as Wi-Fi or cellular reconnects.";
    } else if (!navigator.onLine && cfg.token && cfg.gistId) {
      detail.style.color = "#92400e";
      detail.innerText = "📴 Currently offline. Any edits will save locally and upload automatically when reconnected.";
    } else if (cfg.lastSyncedAt) {
      detail.innerText = `Last synced: ${new Date(cfg.lastSyncedAt).toLocaleString()}`;
    } else if (cfg.token && cfg.gistId) {
      detail.innerText = "Connected. Tap Pull or Push to sync immediately.";
    } else {
      detail.innerText = "Not connected yet. Data is currently stored locally on this device.";
    }

    document.getElementById("cloudSyncModal").classList.add("open");
    syncModalBodyLock();
  }

  function closeCloudSyncModal() {
    document.getElementById("cloudSyncModal").classList.remove("open");
    syncModalBodyLock();
  }

  async function saveCloudSyncSettings() {
    const token = document.getElementById("gistTokenInput").value.trim();
    let gistId = document.getElementById("gistIdInput").value.trim();
    const autoSync = document.getElementById("gistAutoSyncCheckbox").checked;

    if (!token) {
      saveGistConfig({ token: "", gistId: "", autoSync: false, lastSyncedAt: "", pendingOfflineSync: false });
      closeCloudSyncModal();
      showStatus("Cloud sync disconnected (Local mode).");
      return;
    }

    const detail = document.getElementById("cloudSyncStatusDetail");
    detail.style.color = "#475569";
    detail.innerText = "Connecting to GitHub...";

    try {
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
        saveGistConfig({ token, gistId, autoSync, lastSyncedAt: new Date().toISOString(), pendingOfflineSync: false });
        detail.style.color = "#065f46";
        detail.innerText = `✅ Created private Gist (${gistId}) and uploaded schedule!`;
        showStatus("☁️ Connected & created private sync Gist!");
      } else {
        const existingCfg = loadGistConfig();
        saveGistConfig({
          token, gistId, autoSync,
          lastSyncedAt: existingCfg.lastSyncedAt,
          pendingOfflineSync: existingCfg.pendingOfflineSync
        });
        await pullFromGitHubGist(true, false);
      }
    } catch (err) {
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
      // Safe Merge-Before-Push: if offline edits were queued or pre-merge is enabled, fetch remote Gist first so other devices' edits aren't overwritten
      if (cfg.pendingOfflineSync && !skipPreMerge) {
        updateCloudSyncPill("☁️ Merging...", "connected");
        const preRes = await fetch(`https://api.github.com/gists/${cfg.gistId}?t=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Authorization": `Bearer ${cfg.token}`,
            "Accept": "application/vnd.github+json"
          }
        });
        if (preRes.ok) {
          const preData = await preRes.json();
          const preFile = preData.files && preData.files[GIST_FILENAME];
          if (preFile && preFile.content) {
            const remoteState = JSON.parse(preFile.content);
            if (remoteState && Array.isArray(remoteState.roster)) {
              const merged = mergeScheduleStates(state, remoteState);
              snapshotPastDates(merged);
              if (statesDiffer(state, merged)) {
                merged.lastModified = new Date().toISOString();
                localStorage.setItem("conductor_schedule_state", JSON.stringify(merged));
                renderUI();
              }
              state = merged;
            }
          }
        }
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
        if (!silent) showStatus("📴 Offline Saved — will upload when reconnected.");
      } else {
        updateCloudSyncPill("☁️ Sync Error", "error");
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
        localStorage.setItem("conductor_schedule_state", JSON.stringify(normalizedRemote));
        cfg.lastSyncedAt = now.toISOString();
        cfg.pendingOfflineSync = false;
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

        if (localChanged) {
          mergedState.lastModified = now.toISOString();
          localStorage.setItem("conductor_schedule_state", JSON.stringify(mergedState));
          renderUI();
          showStatus("☁️ Synced latest schedule from cloud!");
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
        if (!silent) alert("Cloud pull failed: " + err.message);
      }
    } finally {
      isSyncingNow = false;
    }
  }

  async function syncWithGitHubGist(silent = true, throttleMs = 0) {
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

  /* --- AUTOMATIC & MANUAL PWA UPDATE HANDLERS --- */
  function activateWaitingServiceWorker(registration) {
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ action: 'skipWaiting' });
      return true;
    }
    return false;
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
      if (activateWaitingServiceWorker(reg)) return;
      await reg.update();
      activateWaitingServiceWorker(reg);
    } catch (err) {}
  }

  async function forceAppUpdate() {
    if (!navigator.onLine) {
      showStatus("📴 Connect to Wi-Fi or cellular data to check for app updates.");
      return;
    }
    showStatus("Checking for updates...");
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          try { await reg.update(); } catch (e) {}
          await reg.unregister();
        }
      }
      showStatus("Reloading latest version...");
      setTimeout(() => { window.location.reload(); }, 450);
    } catch (err) {
      window.location.reload();
    }
  }
