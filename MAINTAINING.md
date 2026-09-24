# Sheets MCP

An MCP server that lets Claude (Claude Code or Claude Desktop) read, edit, format and chart Google Sheets, using your Claude subscription.

## 1. Google Cloud setup (one time)

The Cloud project can live in any Google Cloud account. The project only identifies the app. The account you sign in with in step 2 decides which sheets Claude can reach.

1. Go to https://console.cloud.google.com and create a project (for example "Sheets MCP").
2. **APIs & Services → Library**: enable the **Google Sheets API**.
3. **Google Auth Platform → Branding / Audience** (the OAuth consent screen):
   - **User type: Internal**, if the project is in the same Workspace org as the account you'll sign in with. No verification is needed and tokens don't expire.
   - **User type: External**, if the project is in a different org (this setup). Then under **Audience**, click **Publish app** to move it to **In production**. You don't need to submit for verification. At sign-in, click past the "Google hasn't verified this app" screen (**Advanced → Go to …**). Don't leave it in **Testing**: refresh tokens for Testing apps expire after 7 days.
4. **Data Access**: add the scopes `openid`, `.../auth/userinfo.email` and `.../auth/spreadsheets`.
5. **Clients → Create client → Application type: Desktop app**, then **Download JSON**.
6. Save the downloaded file as `~/.sheets-mcp/credentials.json`:
   ```bash
   mkdir -p ~/.sheets-mcp && mv ~/Downloads/client_secret_*.json ~/.sheets-mcp/credentials.json
   ```

If the Workspace admin restricts third-party apps, they may need to mark this OAuth client as **Trusted** under Admin console → Security → API controls → App access control.

## 2. Build and sign in

```bash
npm install
npm run build
npm run auth      # opens a browser for Google sign-in; run again to add more accounts
```

## Multiple Google accounts

Run `npm run auth` once per account. Then:

```bash
npm run accounts                                 # list accounts (* = default)
node dist/index.js accounts default acme.com     # change the default (email or unique part of one)
node dist/index.js accounts remove acme.com      # sign out an account and revoke its access
```

Every tool takes an optional `account` argument, so you can tell Claude "use my acme.com account". Without it:
- For an existing spreadsheet, the server tries the account that last opened it, then the default, then your other accounts, until one has access.
- `create_spreadsheet` uses the default account.

When more than one account is signed in, results start with `[account: …]` so it's clear which account was used.

## 3. Connect to Claude

**Claude Code** (already done on this machine):
```bash
claude mcp add --scope user google-sheets -- node /Users/bluesteel/Desktop/Projects/Sheets-MCP/dist/index.js
```

**Claude Desktop**: add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "node",
      "args": ["/Users/bluesteel/Desktop/Projects/Sheets-MCP/dist/index.js"]
    }
  }
}
```

## Tools

| Area | Tools |
|---|---|
| Accounts & discovery | `google_accounts`, `get_spreadsheet_info`, `create_spreadsheet` |
| Read/write | `read_range`, `write_range`, `append_rows`, `clear_range`, `find_replace`, `undo_last` |
| Structure | `manage_tab`, `insert_rows_or_columns`, `delete_rows_or_columns`, `freeze`, `resize_columns`, `merge_cells` |
| Formatting | `format_range`, `add_conditional_format` |
| Data | `sort_range`, `set_filter`, `set_data_validation`, `add_chart` |
| Escape hatch | `batch_update` (raw Sheets API requests) |

Safety features:
- `write_range` and `clear_range` support `dry_run`.
- Writes over 10,000 cells need `allow_large`.
- Writes are read back so formula errors (`#REF!`, `#N/A`, and so on) are reported immediately.
- `undo_last` restores values and formulas from `write_range`, `append_rows` and `clear_range`. The history is kept in memory for the session.

## Files

- `~/.sheets-mcp/credentials.json`: OAuth client (from Google Cloud)
- `~/.sheets-mcp/accounts/<email>.json`: one refresh token per signed-in account (mode 600)
- `~/.sheets-mcp/settings.json`: which account is the default
- Set `SHEETS_MCP_DIR` to use a different folder.

## Releasing

Users sign in through this project's Google OAuth client, which ships inside the npm package and the Claude Desktop extension as `oauth-client.json`. It's git-ignored and must never be committed. GitHub Actions gets it from the `OAUTH_CLIENT_JSON` repository secret.

npm publishing is automatic: pushing a `v*` tag runs `.github/workflows/publish.yml`, which publishes to npm through npm trusted publishing (no npm login or 2FA prompt).

1. Make sure `oauth-client.json` is in the project root (needed for the Desktop build):
   ```bash
   cp ~/.sheets-mcp/credentials.json oauth-client.json
   ```
2. Bump the version (this also creates the git tag):
   ```bash
   npm version patch        # or minor / major
   ```
3. Build the Claude Desktop extension and deploy the website with the new download:
   ```bash
   npm run pack:extension
   npm run deploy:site
   ```
4. Push. The tag triggers the npm publish:
   ```bash
   git push --follow-tags
   ```
   Watch it under the repo's **Actions** tab. To test the workflow without publishing, run it manually from Actions (the dry-run box is checked by default).
