import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { randomBytes } from "crypto";

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

/** @type {Map<string, { host?: string, viewer?: string, createdAt: number }>} */
const sessions = new Map();

function generateSessionCode() {
  return randomBytes(3).toString("hex").toUpperCase();
}

function sessionPayload(code) {
  const s = sessions.get(code);
  if (!s) return null;
  return {
    code,
    hasHost: Boolean(s.host),
    hasViewer: Boolean(s.viewer),
    createdAt: s.createdAt,
  };
}

io.on("connection", (socket) => {
  socket.on("session:create", (cb) => {
    let code = generateSessionCode();
    while (sessions.has(code)) code = generateSessionCode();
    sessions.set(code, { createdAt: Date.now() });
    socket.join(code);
    cb?.({ ok: true, session: sessionPayload(code) });
  });

  socket.on("session:join", ({ code, role }, cb) => {
    const normalized = String(code || "")
      .trim()
      .toUpperCase();
    if (!normalized || !sessions.has(normalized)) {
      cb?.({ ok: false, error: "Session not found" });
      return;
    }
    const session = sessions.get(normalized);
    const slot = role === "host" ? "host" : "viewer";
    if (session[slot]) {
      cb?.({ ok: false, error: `${slot} already connected` });
      return;
    }
    session[slot] = socket.id;
    socket.join(normalized);
    socket.data.sessionCode = normalized;
    socket.data.role = slot;
    io.to(normalized).emit("session:updated", sessionPayload(normalized));
    cb?.({ ok: true, session: sessionPayload(normalized) });
  });

  const relay = (event) => {
    socket.on(event, (payload) => {
      const code = socket.data.sessionCode;
      if (!code) return;
      socket.to(code).emit(event, { ...payload, from: socket.data.role });
    });
  };

  relay("signal:offer");
  relay("signal:answer");
  relay("signal:ice");

  socket.on("disconnect", () => {
    const code = socket.data.sessionCode;
    if (!code || !sessions.has(code)) return;
    const session = sessions.get(code);
    if (session.host === socket.id) session.host = undefined;
    if (session.viewer === socket.id) session.viewer = undefined;
    io.to(code).emit("session:updated", sessionPayload(code));
    if (!session.host && !session.viewer) {
      sessions.delete(code);
    }
  });
});

const HOST = process.env.HOST || "0.0.0.0";

httpServer.listen(PORT, HOST, () => {
  console.log(`Signaling server listening on http://${HOST}:${PORT}`);
  console.log(`LAN clients: use your Wi-Fi IPv4, e.g. http://172.29.x.x:${PORT}`);
});
