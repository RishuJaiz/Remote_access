import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SIGNAL_URL } from "./webrtc/config.js";
import { useViewerSession } from "./hooks/useViewerSession.js";

export default function App() {
  const [createdCode, setCreatedCode] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [activeViewCode, setActiveViewCode] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const viewerStageRef = useRef(null);

  const viewer = useViewerSession(activeViewCode);

  useEffect(() => {
    if (!isMaximized) return undefined;
    const onFsChange = () => {
      if (!document.fullscreenElement) setIsMaximized(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [isMaximized]);

  const toggleMaximize = useCallback(async () => {
    const el = viewerStageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen?.();
      setIsMaximized(true);
    } else {
      await document.exitFullscreen?.();
      setIsMaximized(false);
    }
  }, []);

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
          <div
            ref={viewerStageRef}
            className={`viewer-stage${isMaximized ? " viewer-stage--maximized" : ""}`}
          >
            <div className="viewer-toolbar">
              <p
                className={`status viewer-status ${
                  viewer.status === "connected" ? "ok" : viewer.error ? "err" : ""
                }`}
              >
                {viewer.error || statusLabel[viewer.status] || viewer.status}
                {activeViewCode && ` · ${activeViewCode}`}
                {viewer.controlReady && viewer.status === "connected" && (
                  <span className="control-badge"> · control ready</span>
                )}
              </p>
              {viewer.status === "connected" && (
                <div className="viewer-actions">
                  {viewer.remoteKeyboard ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={viewer.deactivateRemoteKeyboard}
                    >
                      Use my keyboard (local)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={viewer.activateRemoteKeyboard}
                      disabled={!viewer.controlReady}
                    >
                      Control host keyboard
                    </button>
                  )}
                  <button type="button" onClick={toggleMaximize}>
                    {isMaximized ? "Exit full screen" : "Maximize screen"}
                  </button>
                </div>
              )}
            </div>
            {viewer.remoteKeyboard && (
              <p className="remote-keyboard-banner">
                Keys and shortcuts go to the <strong>host</strong> — Ctrl+Alt+U or{" "}
                <strong>Use my keyboard</strong> for your PC. Win+* may not work in the
                browser; use full screen and try, or type on the host.
              </p>
            )}
            <div
              ref={viewer.surfaceRef}
              className={`viewer-surface${
                viewer.remoteKeyboard ? " viewer-surface--remote-keys" : ""
              }`}
              tabIndex={0}
              role="application"
              aria-label="Remote desktop control"
              onMouseDown={viewer.onSurfaceMouseDown}
            >
              <video
                ref={viewer.videoRef}
                className="remote-video"
                autoPlay
                playsInline
                muted
                onMouseMove={viewer.onVideoMouseMove}
                onMouseDown={viewer.onVideoMouseDown}
                onMouseUp={viewer.onVideoMouseUp}
                onWheel={viewer.onVideoWheel}
              />
            </div>
            <p className="hint">
              Click the remote screen or <strong>Control host keyboard</strong> so Ctrl+C/V
              and other shortcuts affect the host. Click outside or{" "}
              <strong>Use my keyboard (local)</strong> for your laptop. Ctrl+Alt+U also
              returns the keyboard to you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
