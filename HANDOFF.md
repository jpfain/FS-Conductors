# Handoff Note: FS-Conductors (v46)

* **App & Stack:** FS-Conductors PWA (`index.html`, `sw.js`, `manual.html`), managed via GitHub Desktop; tested across desktop Chrome, iPhone, and iPad.

* **Current Baseline (v46 — Reverted from v47):**

  * Stable pre-v47 baseline before the print/PDF multi-month layout, margin, column reorder, and assignment status sent-date changes were introduced.

  * Core PWA scheduling, service worker caching (`sw.js`), and user manual (`manual.html`) are intact at v46.

* **Key Constraints & Gotchas:**

  * Keep `sw.js` cache versioning aligned with `index.html` / `manual.html` updates so installed PWAs on iPhone, iPad, and desktop don't serve stale cached files.

  * Test any print/PDF or responsive layout changes against desktop Chrome as well as iOS/iPadOS Safari print/share behavior.

  * Keep edits surgical or scoped to specific sections/functions in `index.html` rather than full-file rewrites to prevent context bloat or truncation.

  * Never include secrets, tokens, or sensitive credentials in pasted code or commits.

* **What Changed / Lessons from v47 Rollback:**

  * \[Optional: Note briefly what broke or felt off in v47—e.g., print overflow, column widths, or status data binding—so we avoid repeating it\]

* **Goal for This Thread:**

  * \[State the exact feature, layout fix, or incremental step you want to build on top of v46\]

* **Relevant Code Attached/Pasted:**

  * \[Paste only the relevant section/function from `index.html`, `sw.js`, or `manual.html`\]