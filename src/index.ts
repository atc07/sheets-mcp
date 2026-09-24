#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDefaultAccount, listAccounts, removeAccount, runAuthFlow, setDefaultAccount } from "./auth.js";
import { createServer } from "./server.js";

async function accountsCommand([action, who]: string[]) {
  if (action === "default" && who) setDefaultAccount(who);
  else if (action === "remove" && who) console.log(`Removed ${await removeAccount(who)}.`);
  else if (action) throw new Error("Usage: accounts [default <email> | remove <email>]");
  const all = listAccounts();
  if (!all.length) return console.log("No accounts signed in. Run `npx @sheetsmcp/server auth` to sign in.");
  const def = getDefaultAccount();
  for (const a of all) console.log(`${a === def ? "*" : " "} ${a}`);
  console.log("\n* = default. Add another account with `npx @sheetsmcp/server auth`.");
}

const [command, ...rest] = process.argv.slice(2);
if (command === "auth" || command === "accounts") {
  (command === "auth" ? runAuthFlow() : accountsCommand(rest)).then(
    () => process.exit(0),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
} else {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("Google Sheets MCP server running on stdio");
}
