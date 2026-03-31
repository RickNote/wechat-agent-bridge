import { randomUUID } from "node:crypto";

import {
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "/home/ubuntu/.openclaw/extensions/openclaw-weixin/src/auth/login-qr.js";
import { getUpdates, sendMessage } from "/home/ubuntu/.openclaw/extensions/openclaw-weixin/src/api/api.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

export async function beginLogin() {
  const sessionKey = `wechat-codex-${randomUUID()}`;
  const result = await startWeixinLoginWithQr({
    accountId: sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
  });
  return result;
}

export async function completeLogin(sessionKey) {
  return waitForWeixinLogin({
    sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
  });
}

export async function pollUpdates(account) {
  return getUpdates({
    baseUrl: account.baseUrl || DEFAULT_BASE_URL,
    token: account.botToken,
    get_updates_buf: account.getUpdatesBuf || "",
    timeoutMs: 35000,
  });
}

export async function sendTextMessage({ account, to, text, contextToken }) {
  const clientId = `wechat-codex-${Date.now()}`;
  await sendMessage({
    baseUrl: account.baseUrl || DEFAULT_BASE_URL,
    token: account.botToken,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [
          {
            type: 1,
            text_item: {
              text,
            },
          },
        ],
        context_token: contextToken || undefined,
      },
    },
  });
  return clientId;
}

export function extractInboundText(fullMessage) {
  const parts = [];
  for (const item of fullMessage?.item_list || []) {
    if (item?.type === 1 && item?.text_item?.text) {
      parts.push(item.text_item.text.trim());
    }
  }
  return parts.filter(Boolean).join("\n").trim();
}
