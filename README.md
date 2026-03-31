# wechat-agent-bridge

WeChat bridge for local coding agents running on a server.

Current implementation includes:

- WeChat message ingress/egress using Tencent's official OpenClaw Weixin plugin code
- Local `codex` CLI as the active backend
- Per-WeChat-user Codex thread persistence
- Transcript logging to local JSONL files
- Local transcript viewer with optional Nginx reverse proxy

## Current layout

- `scripts/login.mjs`: WeChat QR login flow
- `scripts/run-bridge.mjs`: WeChat to Codex bridge worker
- `scripts/run-viewer.mjs`: transcript viewer HTTP server
- `lib/weixin.mjs`: WeChat API wrapper
- `lib/codex.mjs`: local Codex CLI wrapper
- `lib/state.mjs`: local state and transcript storage

## Runtime data

Runtime state is intentionally excluded from git:

- `data/account.json`
- `data/sessions.json`
- `data/transcripts/`
- `runtime/`

## Environment

At minimum:

```bash
YOUR_PROVIDER_KEY=
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for:

- first-time WeChat login
- systemd user services
- transcript viewer setup
- Nginx reverse proxy
- runtime data layout
- troubleshooting

## Notes

This repository is being generalized from an initial Codex-only bridge toward a multi-backend design.
Planned next step is adding another provider such as Claude Code behind the same WeChat channel.
