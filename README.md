# Hermes Mission Control

A self-hosted, browser-based **3D "war-room" dashboard** for monitoring a multi-machine
AI homelab — LLM inference servers, worker nodes, and a ComfyUI image/video generator.
Built as a [Hermes Agent](https://github.com/) Workspace companion.

> **Visual theme:** the UI ships with a **Māori Pā** (fortified-village) 3D aesthetic.
> It is a design asset, freely reskinnable — replace the static assets to re-theme.

## Features
- Live machine metrics (primary node via `/proc`; LAN nodes via SSH/direct probe)
- Live **Ollama daemon + model tags** per machine
- **ComfyUI GEN panel**: text-to-image (SDXL) and text-to-video (Wan 2.2) workflows
- **Preview gallery** (images + video), Web, and Device tabs
- Worker terminal, profile modal, layout/reset controls
- Systemd `--user` supervised service (or `./start-mc.sh`)

## Install
```bash
python3 -m pip install -r requirements.txt
cp .env.example .env        # set COMFYUI_BASE_URL + any LAN hosts
# edit comfy_env.json / server.py MACHINES to point at YOUR hosts
./start-mc.sh              # or: systemctl --user start mission-control
# open http://localhost:8777
```

## Configuration
The shipped code contains **placeholders** — set them to your own LAN:
- `<host-m1>` / `<host-m2>` / `<host-m3>` — your machine IPs (see `server.py` MACHINES)
- `<ssh-user>` — SSH user for LAN metric probes (`server.py` SSH_HOSTS)
- `<project-dir>` — resolved at runtime; no action needed
- `COMFYUI_BASE_URL` — your ComfyUI instance (default port 8188)

ComfyUI workflows live in `comfy_workflows/` (manifest-driven). Drop exported
API-format workflows there and they appear in the GEN panel.

## Project layout
```
server.py            # dashboard HTTP + websocket server
comfy_wrapper.py     # ComfyUI client (submit / poll / gallery)
comfy_env.json       # ComfyUI base URL
comfy_workflows/     # manifest.json + workflow JSONs
static/              # frontend (index.html, js/, css/, model/)
start-mc.sh          # launcher
```

## Rights
MIT License — Copyright (c) **isoloman275-wq**.
All rights reserved to the author; free to use, modify, and redistribute under the MIT license.

*Note: internal planning docs, screenshots, and the author's personal gallery renders
were intentionally excluded from this public release.*
