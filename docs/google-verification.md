# Google OAuth verification: Sheets MCP

Project: `sheets-mcp-k8ajul` · Console: Google Auth Platform → **Verification Center**

## Before submitting

1. **Data Access** (Google Auth Platform → Data Access). The scopes listed must exactly match what the app requests:
   - Remove `.../auth/drive.metadata.readonly`
   - Keep `.../auth/spreadsheets` (sensitive)
   - Add `openid` and `.../auth/userinfo.email` (non-sensitive)
2. **Branding**: app name "Sheets MCP"; home page `https://sheetsmcp.io`; privacy policy `https://sheetsmcp.io/privacy`; authorized domain `sheetsmcp.io` (already verified in Search Console). Optional: upload `brand/logo-120.png` now, since you're verifying anyway.
3. Release 1.1.0 (no Drive scope) is live on sheetsmcp.io and npm, so the app Google tests matches this submission.

## Scope justification (paste into the form)

> **https://www.googleapis.com/auth/spreadsheets**
>
> Sheets MCP is a local add-on for the Claude AI assistant (Claude Desktop and Claude Code) that lets users edit their own Google Sheets by asking Claude in plain language, for example "add a Profit column with totals and format it as currency" or "chart revenue by month". To do this, the app must read cell values and formulas, write values and formulas, apply formatting (number formats, colors, borders, conditional formatting), change structure (add, rename, or delete tabs, rows, and columns), sort and filter ranges, add data validation, create charts, and create new spreadsheets when asked.
>
> Narrower scopes do not work for this use case:
> - `spreadsheets.readonly` cannot make any edits, which is the core purpose of the app.
> - `drive.file` only grants access to files the app created or that the user selects through a Google file picker. Sheets MCP runs inside Claude's chat, with no browser UI in which to show a picker. Users give Claude a link to an existing spreadsheet, often one they or colleagues created long before installing the app, so `drive.file` would not be able to open it.
>
> The app runs entirely on the user's own computer. OAuth tokens are stored only on that device, requests go directly from the device to the Google Sheets API, and the developer operates no server that receives user data. Data is used only to carry out the actions the user requests, in line with the Google API Services User Data Policy, including the Limited Use requirements.

> **openid, https://www.googleapis.com/auth/userinfo.email**
>
> Used only to identify which Google account the user signed in with, so users who connect more than one account (for example, personal and work) can choose between them. The email address is stored only on the user's device.

## Demo video (unlisted YouTube, about 2–3 minutes)

Record the screen at 1080p with no music; narration or on-screen captions are both fine. Google requires showing the **full consent screen** and **each scope being used**.

1. **Intro (10s).** Show `https://sheetsmcp.io`. Say: "Sheets MCP lets Claude edit Google Sheets. This demo shows the sign-in and how each permission is used."
2. **Install (20s).** Click **Download for Claude Desktop**, open the file, click **Install** in Claude Desktop. Show it listed under Settings → Extensions.
3. **Starting state (10s).** Open a Google Sheet in the browser with a few rows (Month / Revenue / Cost). Copy its link.
4. **Trigger sign-in (15s).** In Claude Desktop, paste the link and type: "Add a Profit column that subtracts Cost from Revenue, with a total row." The Google sign-in page opens.
5. **Consent screen (30s). Most important part.** Choose the account. Show the whole consent screen and scroll through it slowly, so the app name **Sheets MCP**, the **client ID** in the URL bar (`1075023269753-p28k35du2v3k2lmts060t2e3q0iocea0`), and each requested permission are readable. Click **Continue** / **Allow**. Show the "You're signed in" page.
6. **Spreadsheets scope: read and write (30s).** Back in Claude, say "done, try again". Show Claude reading the sheet and adding the Profit column and totals. Switch to the browser: the new column and formulas are in the sheet.
7. **Spreadsheets scope: formatting, charts, create (30s).** Ask: "Format the money columns as currency, bold the header, and chart revenue by month." Show the result in the sheet. Then ask: "Create a new spreadsheet called Demo Tracker." Show that it appears.
8. **Email scope (15s).** Ask Claude: "Which Google accounts are connected?" Show the reply listing the signed-in email. Say: "The email is only used to tell accounts apart, and it's stored on this computer."
9. **Revoking (10s).** Show myaccount.google.com/permissions with Sheets MCP listed, and mention it can be removed there.

## Submitting

Verification Center → **Prepare for verification** → confirm branding, paste the justifications above, add the YouTube link, and submit. Google reviews by email. Answer follow-up questions from the project contact address. Review time varies; plan for several weeks.

## After approval

- The "unverified app" warning disappears and the 100-user cap is lifted.
- Update the site: remove the "Google shows a warning" part of step 3 and the matching FAQ entry.
- Any future scope change requires a new verification.
