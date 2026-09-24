# Sheets MCP

Let Claude read, edit, format and chart your Google Sheets. Ask for a new column, a cleaner layout or a chart, and Claude makes the change directly in your spreadsheet.

Website: https://sheetsmcp.io

## Install

### Claude Desktop (easiest, no setup)

1. Install [Claude Desktop](https://claude.ai/download) and sign in.
2. Download **[sheets-mcp.mcpb](https://sheetsmcp.io/downloads/sheets-mcp.mcpb)**.
3. Double-click the file, then click **Install** in Claude Desktop.

### Claude Code

Requires [Node.js](https://nodejs.org) 18 or newer. Run:

```bash
claude mcp add --scope user google-sheets -- npx -y @sheetsmcp/server
```

Then start a new Claude Code session.

## Sign in

The first time Claude uses Google Sheets, a Google sign-in page opens in your browser:

1. Choose your Google account.
2. Google shows **"Google hasn't verified this app"**. Click **Advanced**, then **Go to Sheets MCP**.
3. Click **Continue** to allow access to your spreadsheets.

To use more than one Google account, ask Claude to *"sign in to another Google account"*. When you paste a sheet link, Sheets MCP uses whichever of your accounts can open it.

If your company's Google Workspace blocks the sign-in, your Workspace admin can allow Sheets MCP under **Admin console → Security → API controls**.

## Try asking

- "Summarize this sheet: <link>"
- "Add a Profit column that subtracts Cost from Revenue, and format it as currency"
- "Chart spending by month in this sheet: <link>"
- "Freeze the header row, bold it, and auto-fit the column widths"
- "Create a new spreadsheet called Trip Planner"
- "Undo that"

## Privacy

Sheets MCP runs on your computer. Your Google sign-in is stored only on your computer (in `~/.sheets-mcp`), and requests go straight from your computer to Google. There is no Sheets MCP server in between. Spreadsheet data Claude reads becomes part of your Claude conversation. See the [privacy policy](https://sheetsmcp.io/privacy).

To disconnect, ask Claude to *"sign out of Google Sheets"*, or remove Sheets MCP at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Command line (optional)

```bash
npx @sheetsmcp/server auth                      # sign in to a Google account
npx @sheetsmcp/server accounts                  # list signed-in accounts
npx @sheetsmcp/server accounts default <email>  # choose the default account
npx @sheetsmcp/server accounts remove <email>   # sign out an account
```
