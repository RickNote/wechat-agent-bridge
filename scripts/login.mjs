import process from "node:process";

import { beginLogin, completeLogin } from "../lib/weixin.mjs";
import { ensureStateDirs, saveAccount } from "../lib/state.mjs";

async function main() {
  ensureStateDirs();
  const started = await beginLogin();
  if (!started.qrcodeUrl) {
    throw new Error(started.message || "Failed to start WeChat login");
  }

  console.log("微信 Codex bridge 登录二维码链接：");
  console.log(started.qrcodeUrl);
  console.log("");
  console.log("请用新的微信号扫码，不要用当前 OpenClaw 正在占用的那个号。");
  console.log("正在等待确认...");

  const result = await completeLogin(started.sessionKey);
  if (!result.connected || !result.botToken || !result.accountId) {
    throw new Error(result.message || "WeChat login failed");
  }

  saveAccount({
    accountId: result.accountId,
    botToken: result.botToken,
    baseUrl: result.baseUrl || "https://ilinkai.weixin.qq.com",
    botUserId: result.userId || "",
    getUpdatesBuf: "",
    loggedInAt: new Date().toISOString(),
  });

  console.log("登录成功。账号已保存到 /home/ubuntu/wechat-codex-bridge/data/account.json");
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
