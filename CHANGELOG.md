# Changelog

What changed in each release of Sheets MCP. The same notes are on [sheetsmcp.io/changelog](https://sheetsmcp.io/changelog) and on each [GitHub release](https://github.com/atc07/sheets-mcp/releases).

## 1.3.8 — October 9, 2026

- When previews of different spreadsheets are watched at the same time (several Claude Desktop sessions sharing one Sheets MCP process), no preview follows steps in other spreadsheets, and work in a spreadsheet without a preview is no longer taken as watched by another session's preview. Hosts send no session id with a tool call, so this is the guard for the case the 1.3.6 fix left open.

## 1.3.7 — October 9, 2026

- **Fixed:** in Safari, the Claude Desktop download was saved as `sheets-mcp.mcpb.html` and wouldn't open. The site now serves the file with its proper type, and the file name carries the version (`sheets-mcp-1.3.7.mcpb`).
- The site shows which version you're downloading, and this changelog.
- Same server as 1.3.6. If you installed 1.3.6 before October 9, update to get the preview fixes below: an earlier build shipped under that version number.

## 1.3.6 — October 8, 2026

- **Fixed:** the live preview could jump to a spreadsheet from another Claude session. In Claude Desktop one Sheets MCP process serves every open session, and a preview followed any session's reads. It now stays with its own task.
- The preview stays open through Claude's pauses between steps: it folds after a minute of quiet, not 12 seconds.
- A read of several ranges outlines the whole block while it runs.
- The preview tells Claude when it has scrolled out of your sight, so Claude opens a fresh one where you're looking. Long tabs load more rows as you scroll down.
- When your computer is idle (you're on your phone or claude.ai), Claude skips the live view and summarizes its work as text with a link to the sheet.
- Smaller preview results: each cell format is sent once instead of per cell.

## 1.3.5 — October 7, 2026

- **Recently worked on:** a searchable list of the sheets you've used with Sheets MCP, right in the chat. Search, pin, open a sheet in Google Sheets, or tick several and send them to Claude with a request.

## 1.3.4 — October 7, 2026

- Every tool has a readable title in Claude's tool list, and the server reports its real version.

## 1.3.3 — October 6, 2026

- The live preview follows Claude into other spreadsheets it reads for a task (the source of a copy, say).
- No outline snap-back between steps; a hidden outline appears in place.

## 1.3.2 — October 6, 2026

- Live preview polish: zoomed-out grid, Claude's tab marked, dropdowns, checkboxes, filters and error cells drawn as Sheets draws them, frozen panes, a tab strip, and the list of steps under the sheet.
- New charts scroll into view; fewer Sheets reads per refresh; writes past the view grow the grid.

## 1.3.0 — October 5, 2026

- **Live sheet preview in Claude:** watch each read and edit happen in the chat as Claude works.
- Chart tools (add, update, delete) and pivot tables.
- Find a spreadsheet by name, from the ones you've used before.
- `read_range` can return cell formatting ("formats" mode).

## 1.2.1 — September 24, 2026

- Sign-in pages: the Sheets MCP logo in the card, larger.

## 1.2.0 — September 24, 2026

- Get-started prompt and usage instructions for Claude.
- When several Google accounts are signed in, Claude asks which one to use instead of guessing.

## 1.1.x — September 24, 2026

- First public release: read, write and append cells; formulas, formatting, number formats, borders; sort, filter, dropdowns and checkboxes; merge, freeze, resize; find and replace; undo; several Google accounts.
