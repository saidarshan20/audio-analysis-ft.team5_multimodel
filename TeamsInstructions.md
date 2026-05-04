> **Tip:** For a better reading experience, open this file in VS Code and press `Ctrl + Shift + V` to preview it.

# Team Instructions

This document outlines the folder structure and boundaries for each team. Please make sure you are only working within your designated folders to avoid conflicts.

---

> **Important:** Always pull and refer to the **latest integrated code** as your base for any further changes. Do not use older files or folders from your side — they may be outdated and could overwrite things that are already integrated.

---

## Frontend

All frontend changes should be made **only within your respective folder** listed below.

| Team | Folder |
|------|--------|
| Team 1 — AutoML | `src\pages\model-exchange` |
| Team 2 — Feature Engineering | `src\pages\data-exchange\tools\feature-engineering` |
| Team 3 — OCR | `src\pages\data-exchange\tools\ocr` |
| Team 4 — Data Anonymization | `src\pages\data-exchange\tools\data-anonymization` |
| Team 5 — Data Visualisation | `src\pages\data-exchange\tools\data-viz` |

> Do not modify files outside your folder. If something needs to be changed at a shared/common level, discuss with the group first.

---

## Backend

The backend has a clean separation under the `modules` folder. Each team has their own module — stick to your own.

> Same rule applies — avoid touching other teams' modules unless there's a discussed and agreed reason to do so.

---

## Integration Guidelines

Since most things are now integrated, there may already be some code embedded within your files — for navigation, routing, Try Other Features, and so on. Please be aware of this before making changes.

When you go to the integration team with your updates, please mention:

- **Which file(s)** you made changes in
- **Which code block or section** was changed (function name, component name, line range, etc.)

This makes it much easier to integrate cleanly without anything breaking on either side.

---

## General Guidelines

- Always refer to the latest integrated codebase — not your older local copies.
- If you need something from another team's module or folder, reach out to them directly instead of editing it yourself.
