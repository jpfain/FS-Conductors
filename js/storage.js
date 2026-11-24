(function (global) {
  const DATABASE_NAME = "fs-conductors";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "records";
  const LEGACY_STATE_KEY = "conductor_schedule_state";
  const RECOVERY_KEY = "conductor_schedule_recovery";
  let database = null;
  let fallbackReason = "";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another open app tab."));
    });
  }

  function readRecord(key) {
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
      request.onerror = () => reject(request.error || new Error(`Could not read ${key} from IndexedDB.`));
    });
  }

  function writeRecord(key, value) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error(`Could not save ${key} to IndexedDB.`));
      transaction.onabort = () => reject(transaction.error || new Error(`Saving ${key} to IndexedDB was aborted.`));
    });
  }

  async function persistSchedule(state) {
    if (database) {
      try {
        await writeRecord("schedule", state);
        return { fallback: false };
      } catch (error) {
        fallbackReason = error.message;
      }
    }

    try {
      localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(state));
      return { fallback: true, reason: fallbackReason || "IndexedDB is unavailable." };
    } catch (error) {
      throw new Error(`Schedule could not be saved to IndexedDB or local storage: ${error.message}`);
    }
  }

  async function open(options) {
    let storageError = "";
    let indexedDBOpenFailed = false;
    if ("indexedDB" in global) {
      try {
        database = await openDatabase();
      } catch (error) {
        storageError = error.message;
        fallbackReason = storageError;
        indexedDBOpenFailed = true;
      }
    } else {
      storageError = "This browser does not support IndexedDB.";
      fallbackReason = storageError;
    }

    let recoveredRaw = "";
    let state;
    let legacyStateRaw = "";

    try {
      if (database) state = await readRecord("schedule");
    } catch (error) {
      storageError = error.message;
    }

    if (state !== undefined && !options.validate(state)) {
      recoveredRaw = JSON.stringify(state, null, 2);
      state = undefined;
    }

    if (state === undefined) {
      try {
        legacyStateRaw = localStorage.getItem(LEGACY_STATE_KEY) || "";
      } catch (error) {
        storageError = `Could not read the previous browser schedule: ${error.message}`;
      }
      if (!database && indexedDBOpenFailed && !legacyStateRaw) {
        throw new Error(`${storageError} No local schedule backup is available; refusing to replace possibly inaccessible data with a blank schedule.`);
      }
      if (legacyStateRaw) {
        try {
          const legacyState = JSON.parse(legacyStateRaw);
          if (options.validate(legacyState)) {
            state = options.normalize(legacyState);
          } else {
            recoveredRaw = legacyStateRaw;
          }
        } catch {
          recoveredRaw = legacyStateRaw;
        }
      }
    } else {
      state = options.normalize(state);
    }

    if (recoveredRaw) {
      try {
        localStorage.setItem(RECOVERY_KEY, recoveredRaw);
      } catch {
        // The original localStorage record is retained when it was the source.
      }
    }

    if (state === undefined) state = options.createDefaultState();

    if (database) {
      try {
        await writeRecord("schedule", state);
        if (legacyStateRaw && !recoveredRaw) localStorage.removeItem(LEGACY_STATE_KEY);
      } catch (error) {
        storageError = error.message;
      }
    } else if (!legacyStateRaw) {
      localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(state));
    }

    let persistedRecoveryRaw = "";
    try {
      persistedRecoveryRaw = localStorage.getItem(RECOVERY_KEY) || "";
    } catch (error) {
      storageError = `Could not read the recovery copy: ${error.message}`;
    }

    return {
      state,
      recoveredRaw: recoveredRaw || persistedRecoveryRaw,
      storageError,
      usingIndexedDB: !!database
    };
  }

  async function clearLegacySyncSession() {
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete("sync-session");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear the previous cloud session."));
      transaction.onabort = () => reject(transaction.error || new Error("Clearing the previous cloud session was aborted."));
    });
  }

  global.ScheduleStorage = { open, persistSchedule, clearLegacySyncSession };
})(globalThis);
