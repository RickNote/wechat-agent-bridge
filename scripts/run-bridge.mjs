import process from "node:process";

import { sendPrompt } from "../lib/codex.mjs";
import {
  appendTranscriptEntry,
  ensureStateDirs,
  getSessionRecord,
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
    "When an action would normally require human approval, do not perform it yet.",
    "Instead, emit a single-line approval request in exactly this format:",
    'WECHAT_APPROVAL_REQUEST: {"title":"...","summary":"...","command":"...","ruleKey":"...","risk":"..."}',
    "Only use that format when approval is actually required.",
    "If the user already approved a specific action for this turn, you may proceed with exactly that action.",
    "If the user denied an action, respect the denial and choose another approach.",
    "",
    userText,
  ].join("\n");
}

function buildApprovalMessage(request) {
  return [
    "这个操作需要你在微信里审批：",
    `标题：${request.title || "需要审批"}`,
    request.summary ? `说明：${request.summary}` : null,
    request.command ? `命令：${request.command}` : null,
    request.risk ? `风险：${request.risk}` : null,
    "",
    "回复以下任一格式：",
    "1",
    "2",
    "3 你的补充说明",
    "",
    "含义：",
    "1 = 仅本次同意",
    "2 = 同意并记住这条规则，后续同类动作不再询问",
    "3 = 不同意，并把你的补充说明发回去让它换方案",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseApprovalReply(text) {
  const normalized = String(text || "").trim();
  if (normalized === "1") return { type: "approve_once", note: "" };
  if (normalized === "2") return { type: "approve_always", note: "" };
  if (normalized === "3") return { type: "deny", note: "" };
  if (normalized.startsWith("3 ")) return { type: "deny", note: normalized.slice(2).trim() };
  return null;
}

function findApprovedRule(session, userText) {
  return session.approvedRules.find((rule) => String(userText).includes(rule.ruleKey || "__no_match__")) || null;
}

async function sendBridgeText(account, to, text, contextToken) {
  await sendTextMessage({
    account,
    to,
    text: text.slice(0, 3500),
    contextToken,
  });
}

async function handleMessage({ account, sessions, fullMessage }) {
  const fromUserId = fullMessage?.from_user_id || "";
  const text = extractInboundText(fullMessage);
  if (!fromUserId || !text) return;

  await enqueue(fromUserId, async () => {
    const session = getSessionRecord(sessions, fromUserId);
    appendTranscriptEntry(fromUserId, {
      direction: "in",
      userId: fromUserId,
      text,
      contextToken: fullMessage?.context_token || null,
    });

    const approvalReply = session.pendingApproval ? parseApprovalReply(text) : null;

    let effectivePrompt = buildPrompt(text);

    if (session.pendingApproval && approvalReply) {
      const pending = session.pendingApproval;
      session.pendingApproval = null;

      if (approvalReply.type === "approve_always" && pending.ruleKey) {
        if (!session.approvedRules.some((rule) => rule.ruleKey === pending.ruleKey)) {
          session.approvedRules.push({
            ruleKey: pending.ruleKey,
            command: pending.command || "",
            title: pending.title || "",
            approvedAt: new Date().toISOString(),
          });
        }
      }

      if (approvalReply.type === "deny") {
        effectivePrompt = buildPrompt(
          [
            `The user denied the pending action: ${pending.title || pending.command || "approval request"}.`,
            pending.command ? `Denied command: ${pending.command}` : "",
            approvalReply.note ? `User note: ${approvalReply.note}` : "No additional note was provided.",
            "Do not perform the denied action. Choose another approach and reply to the user normally.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } else {
        effectivePrompt = buildPrompt(
          [
            `The user approved this action${approvalReply.type === "approve_always" ? " and asked to remember it" : ""}.`,
            pending.command ? `Approved command: ${pending.command}` : "",
            pending.ruleKey ? `Approved rule key: ${pending.ruleKey}` : "",
            "You may proceed with exactly this approved action and continue the task.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    } else if (session.pendingApproval) {
      const reminder = [
        "你当前有一条待审批操作，请直接回复：",
        "1",
        "2",
        "3 你的补充说明",
      ].join("\n");
      appendTranscriptEntry(fromUserId, {
        direction: "system",
        userId: fromUserId,
        text: reminder,
      });
      await sendBridgeText(account, fromUserId, reminder, fullMessage?.context_token);
      return;
    } else {
      const approvedRule = findApprovedRule(session, text);
      if (approvedRule) {
        effectivePrompt = buildPrompt(
          [
            text,
            "",
            `The user has a remembered approval rule for this class of action.`,
            `Approved rule key: ${approvedRule.ruleKey}`,
            approvedRule.command ? `Previously approved command: ${approvedRule.command}` : "",
            "You may proceed without asking again if the action matches this approval.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }

    const result = await sendPrompt({
      threadId: session.threadId,
      prompt: effectivePrompt,
    });

    session.threadId = result.threadId;
    session.lastMessageAt = new Date().toISOString();
    sessions[fromUserId] = session;
    saveSessions(sessions);

    if (result.approvalRequest) {
      session.pendingApproval = result.approvalRequest;
      saveSessions(sessions);
      const approvalText = buildApprovalMessage(result.approvalRequest);
      appendTranscriptEntry(fromUserId, {
        direction: "approval",
        userId: fromUserId,
        text: approvalText,
        threadId: result.threadId,
      });
      await sendBridgeText(account, fromUserId, approvalText, fullMessage?.context_token);
      return;
    }

    const replyText = result.text.slice(0, 3500);
    appendTranscriptEntry(fromUserId, {
      direction: "out",
      userId: fromUserId,
      text: replyText,
      threadId: result.threadId,
    });
    await sendBridgeText(account, fromUserId, replyText, fullMessage?.context_token);
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
