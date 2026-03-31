import process from "node:process";

import { sendPrompt } from "../lib/codex.mjs";
import {
  appendTranscriptEntry,
  ensureStateDirs,
  loadAccount,
  loadSessions,
  saveAccount,
  saveSessions,
} from "../lib/state.mjs";
import { extractInboundText, pollUpdates, sendTextMessage } from "../lib/weixin.mjs";

const queues = new Map();

function enqueue(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    key,
    next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    }),
  );
  return next;
}

function buildPrompt(userText) {
  return [
    "You are replying to a user in WeChat via a server-side Codex bridge.",
    "Be concise, natural, and useful.",
    "Do not mention internal bridge implementation unless the user asks.",
    "",
    userText,
  ].join("\n");
}

async function handleMessage({ account, sessions, fullMessage }) {
  const fromUserId = fullMessage?.from_user_id || "";
  const text = extractInboundText(fullMessage);
  if (!fromUserId || !text) return;

  await enqueue(fromUserId, async () => {
    const session = sessions[fromUserId] || { threadId: null };
    appendTranscriptEntry(fromUserId, {
      direction: "in",
      userId: fromUserId,
      text,
      contextToken: fullMessage?.context_token || null,
    });

    const result = await sendPrompt({
      threadId: session.threadId,
      prompt: buildPrompt(text),
    });

    sessions[fromUserId] = {
      threadId: result.threadId,
      lastMessageAt: new Date().toISOString(),
    };
    saveSessions(sessions);

    const replyText = result.text.slice(0, 3500);
    appendTranscriptEntry(fromUserId, {
      direction: "out",
      userId: fromUserId,
      text: replyText,
      threadId: result.threadId,
    });
    await sendTextMessage({
      account,
      to: fromUserId,
      text: replyText,
      contextToken: fullMessage?.context_token,
    });
  });
}

async function main() {
  ensureStateDirs();
  const account = loadAccount();
  if (!account?.botToken) {
    throw new Error("No account configured. Run: npm run login");
  }

  const sessions = loadSessions();
  console.log(`WeChat-Codex bridge started for account ${account.accountId}`);

  while (true) {
    const resp = await pollUpdates(account);
    if (resp?.get_updates_buf) {
      account.getUpdatesBuf = resp.get_updates_buf;
      saveAccount(account);
    }

    for (const fullMessage of resp?.msgs || []) {
      try {
        await handleMessage({ account, sessions, fullMessage });
      } catch (err) {
        const to = fullMessage?.from_user_id;
        const message = `Bridge error: ${String(err).slice(0, 1000)}`;
        console.error(err);
        if (to) {
          appendTranscriptEntry(to, {
            direction: "error",
            userId: to,
            text: message,
          });
        }
        if (to) {
          try {
            await sendTextMessage({
              account,
              to,
              text: message,
              contextToken: fullMessage?.context_token,
            });
          } catch {}
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
