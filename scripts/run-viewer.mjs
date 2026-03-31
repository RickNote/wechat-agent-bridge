import fs from "node:fs";
import path from "node:path";
import http from "node:http";

import { TRANSCRIPTS_DIR, ensureStateDirs } from "../lib/state.mjs";

const HOST = "127.0.0.1";
const PORT = 3181;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function listTranscriptFiles() {
  ensureStateDirs();
  return fs
    .readdirSync(TRANSCRIPTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => {
      const fullPath = path.join(TRANSCRIPTS_DIR, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        id: entry.name.replace(/\.jsonl$/, ""),
        file: entry.name,
        updatedAt: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readTranscript(id) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9._@-]/g, "_");
  const file = path.join(TRANSCRIPTS_DIR, `${safeId}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const entries = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { id: safeId, file: path.basename(file), entries };
}

function renderAppHtml() {
  const sessions = listTranscriptFiles();
  const initialSession = sessions[0] ? readTranscript(sessions[0].id) : null;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WeChat Codex Transcripts</title>
    <style>
      :root {
        --bg: #f3efe6;
        --panel: #fffaf0;
        --ink: #1f2933;
        --muted: #52606d;
        --line: #d9cbb3;
        --accent: #b44d1e;
        --in: #e7f7ee;
        --out: #fff0d9;
        --err: #fde8e8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Noto Serif SC", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(180,77,30,.16), transparent 28rem),
          linear-gradient(180deg, #f6f0e4, var(--bg));
      }
      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        min-height: 100vh;
      }
      aside {
        border-right: 1px solid var(--line);
        padding: 24px 18px;
        background: rgba(255,250,240,.86);
        backdrop-filter: blur(10px);
      }
      main {
        padding: 24px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      .sub {
        margin: 0 0 18px;
        color: var(--muted);
        font-size: 14px;
      }
      .list {
        display: grid;
        gap: 10px;
      }
      button.session {
        width: 100%;
        text-align: left;
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 14px;
        padding: 12px 14px;
        cursor: pointer;
      }
      button.session.active {
        border-color: var(--accent);
        box-shadow: 0 8px 24px rgba(180,77,30,.12);
      }
      .session-id {
        font-size: 13px;
        word-break: break-all;
      }
      .session-meta {
        color: var(--muted);
        font-size: 12px;
        margin-top: 6px;
      }
      .messages {
        display: grid;
        gap: 14px;
      }
      .msg {
        max-width: 860px;
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 14px 16px;
        background: var(--panel);
        box-shadow: 0 10px 30px rgba(31,41,51,.05);
      }
      .msg.in { background: var(--in); }
      .msg.out { background: var(--out); }
      .msg.error { background: var(--err); }
      .meta {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 13px;
      }
      .empty {
        color: var(--muted);
        border: 1px dashed var(--line);
        border-radius: 16px;
        padding: 24px;
        background: rgba(255,250,240,.6);
      }
      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
        aside { border-right: 0; border-bottom: 1px solid var(--line); }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <h1>会话记录</h1>
        <p class="sub">本地查看 transcripts，仅监听 127.0.0.1:${PORT}</p>
        <div id="session-list" class="list">${
          sessions.length
            ? sessions
                .map(
                  (session, index) => `
          <button class="session${index === 0 ? " active" : ""}" data-session-id="${session.id}">
            <div class="session-id">${session.id}</div>
            <div class="session-meta">更新时间 ${session.updatedAt} · ${session.size} bytes</div>
          </button>`,
                )
                .join("")
            : '<div class="empty">还没有落盘会话。</div>'
        }</div>
      </aside>
      <main>
        ${
          initialSession?.entries?.length
            ? `<div id="messages" class="messages">${initialSession.entries
                .map(
                  (entry) => `
          <section class="msg ${entry.direction || ""}">
            <div class="meta">${entry.direction || "unknown"} · ${entry.ts || ""}</div>
            <pre>${String(entry.text || "")
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")}</pre>
          </section>`,
                )
                .join("")}</div>`
            : '<div id="messages" class="empty">选择左侧会话后显示消息内容。</div>'
        }
      </main>
    </div>
    <script>
      const listEl = document.getElementById("session-list");
      const messagesEl = document.getElementById("messages");
      const apiBase = window.location.pathname.endsWith("/")
        ? window.location.pathname.slice(0, -1)
        : window.location.pathname;
      const POLL_MS = 3000;
      let selectedSessionId = document.querySelector("[data-session-id]")?.dataset.sessionId || null;
      let listSignature = "";
      let detailSignature = "";

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\\"/g, "&quot;");
      }

      function renderSessionList(sessions) {
        listEl.innerHTML = "";
        if (!sessions.length) {
          selectedSessionId = null;
          listEl.innerHTML = '<div class="empty">还没有落盘会话。</div>';
          return;
        }

        if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
          selectedSessionId = sessions[0].id;
        }

        sessions.forEach((session, index) => {
          const btn = document.createElement("button");
          btn.className = session.id === selectedSessionId ? "session active" : "session";
          btn.dataset.sessionId = session.id;
          btn.innerHTML = \`
            <div class="session-id">\${escapeHtml(session.id)}</div>
            <div class="session-meta">更新时间 \${escapeHtml(session.updatedAt)} · \${session.size} bytes</div>
          \`;
          btn.addEventListener("click", () => {
            selectedSessionId = session.id;
            detailSignature = "";
            selectSession(session.id, btn);
          });
          listEl.appendChild(btn);
        });
      }

      function renderMessages(data) {
        if (!data.entries.length) {
          messagesEl.className = "empty";
          messagesEl.textContent = "该会话暂无消息。";
          return;
        }
        messagesEl.className = "messages";
        messagesEl.innerHTML = data.entries.map((entry) => \`
          <section class="msg \${escapeHtml(entry.direction || "")}">
            <div class="meta">\${escapeHtml(entry.direction || "unknown")} · \${escapeHtml(entry.ts || "")}</div>
            <pre>\${escapeHtml(entry.text || "")}</pre>
          </section>
        \`).join("");
      }

      async function selectSession(id, btn) {
        document.querySelectorAll(".session").forEach((el) => el.classList.remove("active"));
        if (btn) btn.classList.add("active");
        const res = await fetch(apiBase + "/api/transcripts/" + encodeURIComponent(id));
        const data = await res.json();
        const nextDetailSignature = JSON.stringify(data.entries);
        if (nextDetailSignature !== detailSignature) {
          detailSignature = nextDetailSignature;
          renderMessages(data);
        }
      }

      async function refreshView() {
        const res = await fetch(apiBase + "/api/transcripts");
        const sessions = await res.json();
        const nextListSignature = JSON.stringify(sessions);
        if (nextListSignature !== listSignature) {
          listSignature = nextListSignature;
          renderSessionList(sessions);
        }

        if (selectedSessionId) {
          const activeBtn = document.querySelector('[data-session-id="' + CSS.escape(selectedSessionId) + '"]');
          await selectSession(selectedSessionId, activeBtn);
        }
      }

      refreshView().catch((err) => {
        messagesEl.className = "empty";
        messagesEl.textContent = "加载失败: " + err.message;
      });

      setInterval(() => {
        refreshView().catch((err) => {
          messagesEl.className = "empty";
          messagesEl.textContent = "加载失败: " + err.message;
        });
      }, POLL_MS);
    </script>
  </body>
</html>`;
}

ensureStateDirs();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/wechat-codex-viewer/")) {
    sendHtml(res, renderAppHtml());
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/api/transcripts" || url.pathname === "/wechat-codex-viewer/api/transcripts")
  ) {
    sendJson(res, 200, listTranscriptFiles());
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname.startsWith("/api/transcripts/") ||
      url.pathname.startsWith("/wechat-codex-viewer/api/transcripts/"))
  ) {
    const id = decodeURIComponent(
      url.pathname
        .replace("/wechat-codex-viewer/api/transcripts/", "")
        .replace("/api/transcripts/", ""),
    );
    const transcript = readTranscript(id);
    if (!transcript) {
      sendJson(res, 404, { error: "Transcript not found" });
      return;
    }
    sendJson(res, 200, transcript);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Transcript viewer listening on http://${HOST}:${PORT}`);
});
