### Handoff Note: FS-Conductors (v47)

- **App & Stack:** FS-Conductors PWA (`index.html`, `sw.js`, `manual.html`), managed via GitHub Desktop; tested across desktop Chrome, iPhone, and iPad.
- **Current Baseline (v47):** Print/Save PDF schedule layout supports 1, 3, 6, and 12-month views, tuned side margins, merged Date + 2nd Saturday in column 1, reordered schedule columns, and displays Assignment Status with sent dates pulled from saved records.
- **Key Constraints & Gotchas:**
  - Keep `sw.js` cache versioning aligned with `index.html` / `manual.html` updates so PWA installs don't serve stale assets.
  - Preserve mobile print/PDF layout behavior on iPhone and iPad.
  - Avoid embedding large Base64 blobs inline when not needed; keep edits surgical or scoped to specific sections/functions rather than blind full-file rewrites.
  - Never include secrets, tokens, or sensitive credentials in pasted code or commits.
- **Goal for This Thread:** [State the exact feature, bug fix, or layout tweak you want to build next]
- **Relevant Code Attached/Pasted:** [Paste only the relevant section/function from `index.html`, `sw.js`, or `manual.html`]