import { OAuth2Client, type Credentials } from "google-auth-library";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { signedInPage, signInFailedPage } from "./pages.js";

export const CONFIG_DIR = process.env.SHEETS_MCP_DIR ?? join(homedir(), ".sheets-mcp");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
const ACCOUNTS_DIR = join(CONFIG_DIR, "accounts");
const SETTINGS_PATH = join(CONFIG_DIR, "settings.json");

// openid + email identify which Google account signed in (non-sensitive); spreadsheets is the only data scope.
const SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/spreadsheets"];

interface ClientSecrets {
  client_id: string;
  client_secret: string;
}

/**
 * OAuth client shipped inside the npm package / Desktop extension (added at pack time, never
 * committed). A credentials.json in the config folder takes precedence, for self-hosted clients.
 */
const BUNDLED_CLIENT_PATH = fileURLToPath(new URL("../oauth-client.json", import.meta.url));

function loadClientSecrets(): ClientSecrets {
  const path = [CREDENTIALS_PATH, BUNDLED_CLIENT_PATH].find((p) => existsSync(p));
  if (!path) {
    throw new Error(
      `Missing Google OAuth client. Download the "Desktop app" OAuth client JSON from Google Cloud Console and save it as ${CREDENTIALS_PATH}.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const secrets = raw.installed ?? raw.web;
  if (!secrets?.client_id || !secrets?.client_secret) {
    throw new Error(`${path} does not look like a Google OAuth client file.`);
  }
  return secrets;
}

// ---------- account storage ----------

const tokenPath = (email: string) => join(ACCOUNTS_DIR, `${email.replace(/[\/\\]/g, "_")}.json`);

function writePrivate(path: string, data: unknown) {
  mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function readSettings(): { defaultAccount?: string } {
  return existsSync(SETTINGS_PATH) ? JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) : {};
}

export function listAccounts(): string[] {
  if (!existsSync(ACCOUNTS_DIR)) return [];
  return readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function getDefaultAccount(): string | undefined {
  const accounts = listAccounts();
  const saved = readSettings().defaultAccount;
  return saved && accounts.includes(saved) ? saved : accounts[0];
}

export function setDefaultAccount(email: string) {
  writePrivate(SETTINGS_PATH, { ...readSettings(), defaultAccount: resolveAccount(email) });
}

/** Match an exact email or a unique fragment of one (e.g. "otherorg" or "@otherorg.com"). */
export function resolveAccount(input: string): string {
  const accounts = listAccounts();
  if (accounts.includes(input)) return input;
  const matches = accounts.filter((a) => a.toLowerCase().includes(input.toLowerCase()));
  if (matches.length === 1) return matches[0];
  if (!accounts.length) throw new Error("No Google accounts are signed in yet.");
  throw new Error(
    matches.length ? `"${input}" matches several accounts: ${matches.join(", ")}` : `No signed-in account matches "${input}". Accounts: ${accounts.join(", ")}`,
  );
}

export async function removeAccount(input: string) {
  const email = resolveAccount(input);
  const stored: Credentials = JSON.parse(readFileSync(tokenPath(email), "utf8"));
  if (stored.refresh_token) {
    const { client_id, client_secret } = loadClientSecrets();
    await new OAuth2Client({ clientId: client_id, clientSecret: client_secret }).revokeToken(stored.refresh_token).catch(() => {});
  }
  rmSync(tokenPath(email));
  if (readSettings().defaultAccount === email) writePrivate(SETTINGS_PATH, { ...readSettings(), defaultAccount: undefined });
  return email;
}

/** The signed-in account's email, from the verified ID token returned with the sign-in. */
async function emailFromIdToken(client: OAuth2Client, idToken: string | null | undefined): Promise<string> {
  if (!idToken) throw new Error("Google did not return an ID token.");
  const ticket = await client.verifyIdToken({ idToken, audience: client._clientId });
  const email = ticket.getPayload()?.email;
  if (!email) throw new Error("Google did not return the account's email address.");
  return email;
}

function newClient(redirectUri?: string) {
  const { client_id, client_secret } = loadClientSecrets();
  return new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
}

/** Authorized client for one account. Refreshed tokens are persisted automatically. */
export function getAuthClient(email: string): OAuth2Client {
  const path = tokenPath(email);
  if (!existsSync(path)) throw new Error(`Account ${email} is not signed in.`);
  const client = newClient();
  const stored: Credentials = JSON.parse(readFileSync(path, "utf8"));
  client.setCredentials(stored);
  client.on("tokens", (fresh) => writePrivate(path, { ...stored, ...fresh }));
  return client;
}

function openBrowser(url: string) {
  if (process.env.SHEETS_MCP_NO_BROWSER) return; // tests
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {});
}

export interface SignIn {
  /** Google sign-in URL (also opened in the default browser). */
  url: string;
  /** Resolves with the signed-in email once the user finishes in the browser. */
  done: Promise<string>;
}

/**
 * Start a browser sign-in (loopback redirect + PKCE) that adds or refreshes one account.
 * Gives up after `timeoutMs` if the user never finishes.
 */
export async function startSignIn({ timeoutMs = 10 * 60_000 } = {}): Promise<SignIn> {
  const state = randomBytes(16).toString("hex");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const client = newClient(redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as never,
  });

  const done = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Google sign-in timed out."));
    }, timeoutMs);
    server.on("request", async (req, res) => {
      const params = new URL(req.url ?? "/", redirectUri).searchParams;
      const error = params.get("error");
      const code = params.get("code");
      if (!error && !code) return void res.writeHead(404).end();
      clearTimeout(timer);
      try {
        if (error || params.get("state") !== state) throw new Error(error === "access_denied" ? "Sign-in was cancelled." : (error ?? "OAuth state mismatch"));
        const { tokens } = await client.getToken({ code: code!, codeVerifier });
        if (!tokens.refresh_token) {
          throw new Error("Google did not return a refresh token. Remove Sheets MCP at myaccount.google.com/permissions and try again.");
        }
        const email = await emailFromIdToken(client, tokens.id_token);
        writePrivate(tokenPath(email), tokens);
        if (!readSettings().defaultAccount) setDefaultAccount(email);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(signedInPage(email));
        resolve(email);
      } catch (e: any) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(signInFailedPage(String(e?.message ?? e)));
        reject(e);
      } finally {
        server.close();
      }
    });
  });

  done.catch(() => {}); // callers observe it; avoid unhandled rejection if they stop waiting
  openBrowser(url);
  return { url, done };
}

/** CLI: `sheetsmcp auth`. */
export async function runAuthFlow(): Promise<void> {
  const { url, done } = await startSignIn();
  console.log(`Opening your browser to sign in with Google...\nIf it doesn't open, visit:\n\n${url}\n`);
  const email = await done;
  const isDefault = getDefaultAccount() === email;
  console.log(`Signed in as ${email}${isDefault ? " (default account)" : ""}.`);
  console.log(`Accounts: ${listAccounts().join(", ")}`);
}
