# RemoteDesk MVP (HelpWire-style, Phase 1)

Remote support application: screen sharing + remote mouse/keyboard over **WebRTC**, with **Socket.IO** signaling and a **Python** host agent.

## Architecture

```
Technician (React)  <--Socket.IO-->  Signaling Server (Node)
       |                                    |
       +------------ WebRTC P2P ------------+
       |         (screen + data channel)    |
       v                                    v
                              Host Agent (Python)
```

## Prerequisites

- Node.js 18+
- Python 3.10+
- npm

## Quick start

### 1. Signaling server

```bash
cd server
npm install
npm run dev
```

Runs on `http://localhost:3001`.

### 2. Web dashboard

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

### 3. Host agent (machine being controlled)

```bash
cd agent
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python main.py --session YOUR_SESSION_CODE
```

Get `YOUR_SESSION_CODE` from the dashboard when you click **Start support session**.

### 4. Connect as technician

1. Open the dashboard → **Join session** → enter the same code.
2. Wait for the host agent to connect (status: connected).
3. Click the video area to focus; move mouse, click, and type to control the remote machine.

## Project layout

```
├── server/          # Express + Socket.IO signaling
├── web/             # React (Vite) technician UI
├── agent/           # Python host: capture + pyautogui control
└── README.md
```

## Phase roadmap

| Phase | Features |
|-------|----------|
| **1 (this repo)** | Session codes, signaling, screen share, mouse/keyboard |
| **2** | User accounts (MongoDB), JWT, device registration, unattended agent |
| **3** | File transfer, chat, recording, multi-monitor |

## Security notes (MVP)

- Session codes are short-lived room IDs, not production auth.
- Use HTTPS + TURN servers before deploying beyond localhost.
- Only run the agent on machines you own or have permission to control.

## Troubleshooting

- **No video**: Ensure the agent is running with the correct session code and firewall allows UDP (WebRTC).
- **ICE failed on LAN**: STUN is configured; for strict NAT add a TURN server in `web/src/webrtc/config.ts` and the agent.
- **pyautogui fails on Linux**: Install `python3-xlib` / display server access.
