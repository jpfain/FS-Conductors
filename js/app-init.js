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
        if (importedData && Array.isArray(importedData.roster)) {
          recordUndoSnapshot("Restore JSON Backup", loadAppState());
          ensureFieldTimestamps(importedData);
          const nowTs = Date.now();
          importedData.fieldTimestamps.core = nowTs;
          Object.keys(importedData.reminders || {}).forEach(k => { importedData.fieldTimestamps.reminders[k] = nowTs; });
          Object.keys(importedData.overrides || {}).forEach(k => { importedData.fieldTimestamps.overrides[k] = nowTs; });
          Object.keys(importedData.blackouts || {}).forEach(k => { importedData.fieldTimestamps.blackouts[k] = nowTs; });
          Object.keys(importedData.slotDetails || {}).forEach(k => { importedData.fieldTimestamps.slotDetails[k] = nowTs; });
          saveAppState(importedData);
          showStatus("Schedule restored successfully!");
        } else {
          alert("Invalid backup file format. Expected a conductor schedule backup object.");
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
    trapModalFocus(e);
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
      } else if (document.getElementById("contactModal").classList.contains("open")) {
        closeContactModal();
      } else if (document.getElementById("shareModal").classList.contains("open")) {
        closeShareModal();
      } else if (document.getElementById("addConductorDrawer").classList.contains("open")) {
        toggleAddConductorDrawer(false);
      }
    }
  });

  configureModalAccessibility();

  let deferredInstallPrompt = null;
  const installBanner = document.getElementById("installAppBanner");
  const installMessage = document.getElementById("installAppMessage");
  const installButton = document.getElementById("installAppButton");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function showInstallPrompt() {
    if (!isStandalone && installBanner && (deferredInstallPrompt || isIOS)) {
      installBanner.hidden = false;
      if (isIOS) {
        installMessage.innerText = "In Safari, tap Share, then Add to Home Screen.";
        installButton.innerText = "How to install";
      }
    }
  }

  function dismissInstallPrompt() {
    if (installBanner) installBanner.hidden = true;
  }

  async function promptInstallApp() {
    if (!deferredInstallPrompt) {
      if (isIOS) alert("In Safari, tap the Share button, then choose “Add to Home Screen.”");
      return;
    }
    try {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      dismissInstallPrompt();
      if (choice.outcome === "accepted") showStatus("Conductor Schedule was added to your home screen.");
    } catch (error) {
      deferredInstallPrompt = null;
      dismissInstallPrompt();
      console.error("Could not start app installation:", error);
      showStatus(`Could not start app installation: ${error.message}`);
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallPrompt();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    dismissInstallPrompt();
    showStatus("Conductor Schedule was installed.");
  });
  showInstallPrompt();

  // Register the service worker and wait for user confirmation before activating updates.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          swRegistration = reg;
          if (reg.waiting) showAppUpdatePrompt();
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showAppUpdatePrompt();
              }
            });
          });
          setInterval(() => checkForServiceWorkerUpdate(), 60000);
        })
        .catch(err => {
          console.error('Service Worker failed:', err);
          showStatus(`Offline support could not start: ${err.message}`);
        });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing || !appUpdateRequested) return;
        refreshing = true;
        appUpdateRequested = false;
        window.location.reload();
      });
    });
  }

  // Re-sync across devices when tab/app becomes active or network returns
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForServiceWorkerUpdate();
      syncWithGitHubGist(true, 10000);
    }
  });
  window.addEventListener('focus', () => {
    checkForServiceWorkerUpdate();
    syncWithGitHubGist(true, 10000);
  });
  window.addEventListener('pageshow', () => {
    syncWithGitHubGist(true, 5000);
  });
  window.addEventListener('online', () => {
    updateCloudSyncPill();
    syncWithGitHubGist(true, 0);
  });
  window.addEventListener('offline', () => {
    updateCloudSyncPill();
  });

  // Initialize App (or Standalone Print Sheet if ?print=... is in URL)
  const urlParams = new URLSearchParams(window.location.search);
  const printParam = urlParams.get("print");
  initializeAppStorage()
    .then(() => {
      setupCrossTabSync();
      if (printParam) {
        enterStandalonePrintMode(
          printParam,
          parseInt(urlParams.get("y"), 10),
          parseInt(urlParams.get("m"), 10)
        );
      } else {
        if (window.matchMedia("(max-width: 640px)").matches) {
          document.getElementById("rosterListDetails").open = false;
          document.getElementById("homeActionsDetails").open = false;
        }
        renderUI();
        syncWithGitHubGist(true);
      }
    })
    .catch((error) => {
      console.error("Could not initialize app storage:", error);
      showStatus(`Could not load the saved schedule: ${error.message}`);
    });
