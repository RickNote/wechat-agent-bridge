import fs from "node:fs";
import path from "node:path";

export const ROOT_DIR = "/home/ubuntu/wechat-codex-bridge";
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const ACCOUNT_FILE = path.join(DATA_DIR, "account.json");
export const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
export const RUNTIME_DIR = path.join(ROOT_DIR, "runtime");
export const TRANSCRIPTS_DIR = path.join(DATA_DIR, "transcripts");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureStateDirs() {
  ensureDir(DATA_DIR);
  ensureDir(RUNTIME_DIR);
  ensureDir(TRANSCRIPTS_DIR);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureStateDirs();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function loadAccount() {
  return readJson(ACCOUNT_FILE, null);
}

export function saveAccount(account) {
  writeJson(ACCOUNT_FILE, account);
}

export function loadSessions() {
  return readJson(SESSIONS_FILE, {});
}

export function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function transcriptPath(userId) {
  const safeName = String(userId || "unknown").replace(/[^a-zA-Z0-9._@-]/g, "_");
  return path.join(TRANSCRIPTS_DIR, `${safeName}.jsonl`);
}

export function appendTranscriptEntry(userId, entry) {
  ensureStateDirs();
  const line = JSON.stringify(
    {
      ts: new Date().toISOString(),
      ...entry,
    },
    null,
    0,
  );
  fs.appendFileSync(transcriptPath(userId), `${line}\n`, "utf8");
}
