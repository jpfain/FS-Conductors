const SCHEDULE_STATE_STORAGE_KEY = "conductor_schedule_state";
const SCHEDULE_STATE_REVISION_KEY = "conductor_schedule_revision";
const APP_DATABASE_NAME = "fs-conductors";
const APP_DATABASE_VERSION = 1;
const APP_DATA_STORE = "appData";
const APP_SETTINGS_CACHE = new Map();

let appDatabasePromise = null;
let appStorageMode = "localStorage";
let appStorageInitialized = false;
let cachedScheduleState = null;

function reportStorageError(message, error) {
  console.error(message, error);
  if (typeof showStatus === "function") {
    showStatus(`${message} ${error && error.message ? error.message : ""}`.trim());
  }
}

function getLocalStorageValue(key) {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) APP_SETTINGS_CACHE.set(key, value);
    return value;
  } catch (error) {
    reportStorageError("Could not read saved browser settings.", error);
    return APP_SETTINGS_CACHE.get(key) || null;
  }
}

function setLocalStorageValue(key, value) {
  try {
    localStorage.setItem(key, value);
    APP_SETTINGS_CACHE.set(key, value);
    return true;
  } catch (error) {
    APP_SETTINGS_CACHE.set(key, value);
    reportStorageError("Could not persist browser settings; they will last only for this page session.", error);
    return false;
  }
}

function removeLocalStorageValue(key) {
  try {
    localStorage.removeItem(key);
    APP_SETTINGS_CACHE.delete(key);
    return true;
  } catch (error) {
    reportStorageError("Could not remove a migrated browser setting.", error);
    return false;
  }
}

function cloneScheduleState(state) {
  return state ? JSON.parse(JSON.stringify(state)) : null;
}

function cacheScheduleState(state) {
  cachedScheduleState = cloneScheduleState(state);
}

function scheduleTimestamp(state) {
  const timestamp = Date.parse(state && state.lastModified ? state.lastModified : "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function preserveInvalidLegacySchedule(raw, error) {
  const recoveryKey = `conductor_schedule_state_recovery_${Date.now()}`;
  if (!setLocalStorageValue(recoveryKey, raw)) {
    throw new Error("Invalid legacy schedule data could not be preserved.");
  }
  console.error("Invalid legacy schedule data was preserved before migration.", error);
  alert(`Older saved schedule data was invalid. A recovery copy is preserved in this browser as "${recoveryKey}".`);
}

function openAppDatabase() {
  if (appDatabasePromise) return appDatabasePromise;
  if (!("indexedDB" in window)) {
    appDatabasePromise = Promise.reject(new Error("IndexedDB is unavailable."));
    return appDatabasePromise;
  }

  appDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(APP_DATABASE_NAME, APP_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(APP_DATA_STORE)) {
        database.createObjectStore(APP_DATA_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the app database."));
    request.onblocked = () => reject(new Error("Close other app tabs to finish the storage upgrade."));
  });
  return appDatabasePromise;
}

async function readIndexedScheduleState() {
  const database = await openAppDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(APP_DATA_STORE, "readonly")
      .objectStore(APP_DATA_STORE)
      .get("schedule");
    request.onsuccess = () => resolve(request.result ? request.result.value : null);
    request.onerror = () => reject(request.error || new Error("Could not read the schedule from IndexedDB."));
  });
}

async function writeIndexedScheduleState(state) {
  const database = await openAppDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(APP_DATA_STORE, "readwrite");
    transaction.objectStore(APP_DATA_STORE).put({ id: "schedule", value: cloneScheduleState(state) });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not write the schedule to IndexedDB."));
    transaction.onabort = () => reject(transaction.error || new Error("The IndexedDB schedule write was aborted."));
  });
}

function signalScheduleStorageChange() {
  setLocalStorageValue(SCHEDULE_STATE_REVISION_KEY, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function persistScheduleState(state) {
  cacheScheduleState(state);

  if (appStorageMode === "indexedDB") {
    return writeIndexedScheduleState(state).then(() => {
      removeLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY);
      signalScheduleStorageChange();
    }).catch((error) => {
      reportStorageError("IndexedDB failed; trying browser storage fallback.", error);
      appStorageMode = "localStorage";
      const saved = setLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY, JSON.stringify(state));
      if (!saved) throw new Error("Schedule changes could not be saved to IndexedDB or browser storage.");
      signalScheduleStorageChange();
    });
  }

  const saved = setLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY, JSON.stringify(state));
  if (!saved) return Promise.reject(new Error("Schedule changes could not be saved to this browser."));
  signalScheduleStorageChange();
  return Promise.resolve();
}

async function readSharedScheduleState() {
  if (appStorageMode === "indexedDB") return readIndexedScheduleState();
  const saved = getLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY);
  return saved ? JSON.parse(saved) : null;
}

async function initializeAppStorage() {
  let indexedState = null;
  try {
    appStorageMode = "indexedDB";
    indexedState = await readIndexedScheduleState();
    cacheScheduleState(indexedState);
  } catch (error) {
    appStorageMode = "localStorage";
    reportStorageError("Using browser storage fallback.", error);
  }

  const legacyRaw = getLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY);
  if (appStorageMode === "indexedDB" && indexedState && legacyRaw) {
    try {
      const legacyState = JSON.parse(legacyRaw);
      if (!legacyState || !Array.isArray(legacyState.roster)) {
        throw new Error("Invalid legacy schedule format.");
      }
      if (scheduleTimestamp(legacyState) > scheduleTimestamp(indexedState)) {
        cacheScheduleState(legacyState);
      }
    } catch (error) {
      preserveInvalidLegacySchedule(legacyRaw, error);
    }
  }

  const state = loadAppState();
  if (appStorageMode === "indexedDB") {
    try {
      await writeIndexedScheduleState(state);
      removeLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY);
    } catch (error) {
      reportStorageError("IndexedDB could not save the schedule; using browser storage fallback.", error);
      appStorageMode = "localStorage";
      if (!setLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY, JSON.stringify(state))) {
        throw new Error("The schedule could not be saved to IndexedDB or browser storage.");
      }
    }
  } else {
    const saved = setLocalStorageValue(SCHEDULE_STATE_STORAGE_KEY, JSON.stringify(state));
    if (!saved) throw new Error("The schedule could not be saved to browser storage.");
  }
  appStorageInitialized = true;
  return cloneScheduleState(state);
}
