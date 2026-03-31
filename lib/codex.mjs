import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { RUNTIME_DIR } from "./state.mjs";

const CODEX_WORKDIR = "/home/ubuntu";

function runCodex(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: CODEX_WORKDIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractThreadId(events) {
  const started = events.find((item) => item.type === "thread.started");
  return started?.thread_id || null;
}

function extractAgentText(events, fallbackText) {
  const texts = [];
  for (const event of events) {
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item?.text) {
      texts.push(event.item.text);
    }
  }
  if (texts.length) return texts.join("\n").trim();
  return fallbackText?.trim() || "";
}

function extractApprovalRequest(text) {
  const prefix = "WECHAT_APPROVAL_REQUEST:";
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  if (!line) return null;

  try {
    const parsed = JSON.parse(line.slice(prefix.length).trim());
    if (!parsed || typeof parsed !== "object") return null;
    return {
      title: String(parsed.title || "Action requires approval"),
      summary: String(parsed.summary || ""),
      command: String(parsed.command || ""),
      ruleKey: String(parsed.ruleKey || ""),
      risk: String(parsed.risk || ""),
    };
  } catch {
    return null;
  }
}

export async function sendPrompt({ threadId, prompt }) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const outputFile = path.join(RUNTIME_DIR, `last-message-${Date.now()}.txt`);
  const args = threadId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "--output-last-message",
        outputFile,
        threadId,
        prompt,
      ]
    : [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--output-last-message",
        outputFile,
        prompt,
      ];

  const { stdout } = await runCodex(args);
  const events = parseJsonl(stdout);
  const nextThreadId = threadId || extractThreadId(events);
  const fallbackText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
  const text = extractAgentText(events, fallbackText);
  try {
    fs.unlinkSync(outputFile);
  } catch {}

  if (!nextThreadId) {
    throw new Error("No Codex thread id returned");
  }

  return {
    threadId: nextThreadId,
    text: text || "(empty reply)",
    approvalRequest: extractApprovalRequest(text),
  };
}
