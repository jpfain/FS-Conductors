# HANDOFF.md — FS-Conductors PWA (v48)

## Current Baseline & Stack
- **App:** Field Service Conductor Schedule PWA (`v48`)
- **Primary Files:** `index.html`, `sw.js`, `manual.html`, `manifest.json`, `icon-192.png`
- **Version Control:** Managed via GitHub Desktop (`index.html`, `sw.js`, `manual.html`, `HANDOFF.md`)
- **Target Environments:** Desktop Chrome on Mac; Home Screen PWA and Safari on iPhone 14 and iPad

## Key Capabilities in v48
- **Home Screen Hierarchy:** **Up Next** quick-action card positioned above the action toolbar, `Undo` placed on the right side near `Export .ics` and `Sync & Tools`, and streamlined 3-button conductor cards (`Share`, `.ics`, `Edit`) with `Earlier` / `Later` rotation reordering inside the Edit Conductor modal.
- **Conflict-Aware Reassignment & Trading:** Replacement selectors (**Quick Replace**, calendar dropdowns, and **Trade Dates**) surface conflict indicators when a candidate is marked unavailable on that date, assigned on an adjacent Saturday, or has a pending sub request.
- **Upcoming Follow-Up Queue:** **Up Next** includes a **Follow-Ups** count trigger that opens the individual text queue filtered to upcoming conductors who are not yet confirmed.
- **Sync, History Lock & Export:** Supports GitHub Gist sync with merge-before-push and offline queueing, past-date locking, per-date time/location overrides, `.ics` exports, and board-ready print/PDF output.

## Next Steps for Commit & Push
1. Open **GitHub Desktop** and review the modified `index.html` and `HANDOFF.md` files.
2. Enter a concise commit summary (e.g., `v48: refine home screen layout, conflict cues, and follow-up queue`) and commit to the working branch.
3. Push changes to the remote repository and verify the updated app loads cleanly in Chrome and on iOS/iPadOS.
