import { useCallback, useState } from "react";
import { io } from "socket.io-client";
import { SIGNAL_URL } from "./webrtc/config.js";
import { useViewerSession } from "./hooks/useViewerSession.js";

export default function App() {
  const [createdCode, setCreatedCode] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [activeViewCode, setActiveViewCode] = useState(null);
  const [createError, setCreateError] = useState(null);

  const viewer = useViewerSession(activeViewCode);

  const createSession = useCallback(() => {
    setCreateError(null);
    const socket = io(SIGNAL_URL);
    socket.emit("session:create", (res) => {
      socket.disconnect();
      if (res?.ok) {
        setCreatedCode(res.session.code);
      } else {
        setCreateError("Could not create session");
      }
    });
  }, []);

  const startViewing = (e) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    setActiveViewCode(code);
  };

  const statusLabel = {
    idle: "Not connected",
    connecting: "Connecting…",
    "waiting-for-host": "Waiting for host agent…",
    "waiting-for-stream": "Host online — starting stream…",
    connected: "Connected",
    error: "Error",
  };

  return (
    <div className="app">
      <h1>RemoteDesk</h1>
      <p className="subtitle">Phase 1 MVP — screen share and remote control</p>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Host (remote machine)</h2>
        <p className="status">
          Create a session, then run the Python agent with the code below.
        </p>
        <div className="row">
          <button type="button" onClick={createSession}>
            Start support session
          </button>
        </div>
        {createError && <p className="status err">{createError}</p>}
        {createdCode && (
          <>
            <p className="status ok" style={{ marginTop: "1rem" }}>
              Session code
            </p>
            <p className="session-code">{createdCode}</p>
            <p className="hint">
              <code>
                python main.py --session {createdCode}
              </code>{" "}
              from the <code>agent/</code> folder
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Technician (this browser)</h2>
        <form className="row" onSubmit={startViewing}>
          <input
            placeholder="Session code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            maxLength={8}
          />
          <button type="submit">Join session</button>
          {activeViewCode && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                viewer.disconnect();
                setActiveViewCode(null);
              }}
            >
              Disconnect
            </button>
          )}
        </form>

        {activeViewCode && (
          <div className="viewer-wrap">
            <p
              className={`status ${
                viewer.status === "connected" ? "ok" : viewer.error ? "err" : ""
              }`}
            >
              {viewer.error || statusLabel[viewer.status] || viewer.status}
              {activeViewCode && ` · ${activeViewCode}`}
            </p>
            <video
              ref={viewer.videoRef}
              className="remote-video"
              tabIndex={0}
              autoPlay
              playsInline
              muted
              onMouseMove={viewer.onVideoMouseMove}
              onMouseDown={viewer.onVideoMouseDown}
              onMouseUp={viewer.onVideoMouseUp}
              onWheel={viewer.onVideoWheel}
              onKeyDown={viewer.onVideoKeyDown}
            />
            <p className="hint">
              Click the video to focus, then move, click, scroll, and type to control
              the remote desktop.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
