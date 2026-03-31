# Deployment Guide

## Overview

`wechat-agent-bridge` is a WeChat channel bridge that currently connects:

- inbound / outbound WeChat messaging
- local `codex` CLI execution
- per-user session persistence
- transcript logging
- optional transcript viewer behind Nginx

The current implementation is Linux-first and has been verified on Ubuntu.

## Current architecture

```text
WeChat
  -> Tencent Weixin bot transport
  -> wechat-agent-bridge
  -> local codex CLI
  -> transcript storage
  -> optional viewer + Nginx
```

## Prerequisites

- Ubuntu server
- Node.js 22+
- `openclaw` already installed locally
- local `codex` CLI available in `PATH`
- a working provider key for the local Codex CLI flow
- WeChat account able to scan the Tencent QR login

## Project paths

- project root: `/home/ubuntu/wechat-agent-bridge`
- bridge service: `/home/ubuntu/.config/systemd/user/wechat-codex-bridge.service`
- viewer service: `/home/ubuntu/.config/systemd/user/wechat-codex-viewer.service`
- runtime state: `/home/ubuntu/wechat-agent-bridge/data`
- transcripts: `/home/ubuntu/wechat-agent-bridge/data/transcripts`

## Environment

Create a local environment file for the bridge service:

```bash
cat > /home/ubuntu/.config/wechat-codex-bridge.env <<'EOF'
YOUR_PROVIDER_KEY=your_key_here
EOF
chmod 600 /home/ubuntu/.config/wechat-codex-bridge.env
```

Notes:

- this file is loaded by the user systemd bridge service
- do not commit it
- map this placeholder key name to whatever your active backend actually requires
- if your local Codex configuration changes provider requirements later, update this file

## Install dependencies

This project currently has no npm package dependencies of its own beyond Node runtime.

The WeChat transport code is reused from the Tencent OpenClaw Weixin plugin already installed on the machine.

## First-time WeChat login

Run:

```bash
cd /home/ubuntu/wechat-agent-bridge
node ./scripts/login.mjs
```

This performs QR-code login and writes:

- `data/account.json`

Do not commit that file.

## Run manually

Bridge worker:

```bash
cd /home/ubuntu/wechat-agent-bridge
node ./scripts/run-bridge.mjs
```

Viewer:

```bash
cd /home/ubuntu/wechat-agent-bridge
node ./scripts/run-viewer.mjs
```

## Systemd user services

Reload user systemd:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
systemctl --user daemon-reload
```

Start bridge:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
systemctl --user enable --now wechat-codex-bridge.service
```

Start viewer:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
systemctl --user enable --now wechat-codex-viewer.service
```

Check status:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
systemctl --user status wechat-codex-bridge.service --no-pager -l

env XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
systemctl --user status wechat-codex-viewer.service --no-pager -l
```

Logs:

```bash
journalctl --user -u wechat-codex-bridge.service -n 100 --no-pager
journalctl --user -u wechat-codex-viewer.service -n 100 --no-pager
```

## Viewer access

Local-only viewer:

- `http://127.0.0.1:3181`

Current deployment also supports Nginx reverse proxy:

- `https://ubuntu.ricknote.net/wechat-codex-viewer/`

The current viewer behavior:

- renders latest transcript on first page load
- polls every 3 seconds for updates
- keeps current session selected when new data arrives

## Nginx reverse proxy

Current deployment pattern:

- path-based proxy under `/wechat-codex-viewer/`
- upstream viewer on `127.0.0.1:3181`
- HTTP Basic Auth enabled
- self-signed certificate currently in use

Important:

- transcripts contain sensitive chat content
- do not expose this endpoint publicly without access control

## Runtime data excluded from Git

These paths are intentionally untracked:

- `data/account.json`
- `data/sessions.json`
- `data/transcripts/`
- `runtime/`
- `node_modules/`

## GitHub push from server

Recommended pattern:

- create a dedicated SSH deploy key or account key on the server
- add the public key to GitHub
- push with explicit `GIT_SSH_COMMAND` if needed

Example:

```bash
GIT_SSH_COMMAND='ssh -i /home/ubuntu/.ssh/id_ed25519_github_wechat_agent_bridge -o IdentitiesOnly=yes' \
git -C /home/ubuntu/wechat-agent-bridge push -u origin main
```

## Troubleshooting

### WeChat replies twice

Cause:

- more than one bridge worker is running at the same time

Check:

```bash
ps -ef | rg 'run-bridge.mjs|npm run bridge'
```

Keep only the systemd-managed process.

### Viewer is blank

Check:

- transcript files exist in `data/transcripts/`
- viewer service is running
- browser cache is not serving stale HTML

### Bridge receives messages but returns errors

Check bridge logs:

```bash
journalctl --user -u wechat-codex-bridge.service -n 100 --no-pager
```

One known failure mode:

- missing required provider key in the systemd environment

### QR login works but no replies

Check:

- bridge service is running
- `data/account.json` exists
- local `codex` CLI works in the same environment

## Security notes

- this bridge can expose local agent capabilities through WeChat
- transcripts are sensitive and should be access-controlled
- do not grant the bridge broader host permissions than necessary
- if later adding approval flows over WeChat, prefer narrow allow rules over global bypasses
