import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ICE_SERVERS, SIGNAL_URL } from "../webrtc/config.js";
import {
  applyHostClipboard,
  markHubClipboardSent,
  pushHubClipboardToHost,
  resetClipboardSyncState,
} from "../lib/clipboardSync.js";

function isHubLocalTarget(target) {
  if (!target?.closest) return false;
  if (target.closest(".viewer-stage")) return false;
  return Boolean(
    target.closest("input, textarea, select, button, a, [contenteditable='true']")
  );
}

export function useViewerSession(sessionCode) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [controlReady, setControlReady] = useState(false);
  const [remoteControl, setRemoteControl] = useState(false);
  const [clipboardSynced, setClipboardSynced] = useState(false);
  const videoRef = useRef(null);
  const surfaceRef = useRef(null);
  const pcRef = useRef(null);
  const controlRef = useRef(null);
  const socketRef = useRef(null);
  const remoteControlRef = useRef(false);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    remoteControlRef.current = remoteControl;
  }, [remoteControl]);

  const cleanup = useCallback(() => {
    pointerDownRef.current = false;
    controlRef.current?.close();
    controlRef.current = null;
    setControlReady(false);
    setRemoteControl(false);
    setClipboardSynced(false);
    resetClipboardSyncState();
    pcRef.current?.close();
    pcRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const sendControl = useCallback((payload) => {
    const ch = controlRef.current;
    if (ch?.readyState === "open") {
      ch.send(JSON.stringify(payload));
    }
  }, []);

  const sendRelease = useCallback(() => {
    sendControl({ type: "release" });
  }, [sendControl]);

  const enableRemoteControl = useCallback(() => {
    if (!controlRef.current || controlRef.current.readyState !== "open") return;
    setRemoteControl(true);
    requestAnimationFrame(() => surfaceRef.current?.focus({ preventScroll: true }));
  }, []);

  const pauseRemoteControl = useCallback(() => {
    setRemoteControl(false);
    pointerDownRef.current = false;
    sendRelease();
    if (document.pointerLockElement === surfaceRef.current) {
      document.exitPointerLock();
    }
  }, [sendRelease]);

  const handleChannelMessage = useCallback((ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "clipboard" && msg.from === "host" && msg.text) {
        applyHostClipboard(msg.text)
          .then(() => setClipboardSynced(true))
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, []);

  const syncHubClipboardToHost = useCallback(() => {
    return pushHubClipboardToHost(sendControl).then(() => setClipboardSynced(true));
  }, [sendControl]);

  const coordsFromEvent = useCallback((clientX, clientY) => {
    const video = videoRef.current;
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const sendMouseAt = useCallback(
    (clientX, clientY, extra = {}) => {
      const pos = coordsFromEvent(clientX, clientY);
      if (!pos) return;
      sendControl({ ...pos, ...extra });
    },
    [coordsFromEvent, sendControl]
  );

  useEffect(() => {
    if (!sessionCode) return undefined;

    const socket = io(SIGNAL_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;
    setStatus("connecting");
    setError(null);

    const setupPeer = async (offerSdp) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      };

      pc.ondatachannel = (ev) => {
        if (ev.channel.label !== "control") return;
        const ch = ev.channel;
        const bind = () => {
          controlRef.current = ch;
          ch.onmessage = handleChannelMessage;
          setControlReady(true);
        };
        if (ch.readyState === "open") bind();
        else ch.onopen = bind;
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("signal:ice", {
            candidate: {
              candidate: ev.candidate.candidate,
              sdpMid: ev.candidate.sdpMid,
              sdpMLineIndex: ev.candidate.sdpMLineIndex,
            },
          });
        }
      };

      await pc.setRemoteDescription(offerSdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const { type, sdp } = pc.localDescription;
      socket.emit("signal:answer", { sdp: { type, sdp } });
      setStatus("connected");
    };

    socket.on("connect", () => {
      socket.emit("session:join", { code: sessionCode, role: "viewer" }, (res) => {
        if (!res?.ok) {
          setError(res?.error || "Failed to join session");
          setStatus("error");
          return;
        }
        setStatus("waiting-for-host");
      });
    });

    socket.on("session:updated", (session) => {
      if (session?.hasHost && status === "waiting-for-host") {
        setStatus("waiting-for-stream");
      }
    });

    socket.on("signal:offer", async ({ sdp }) => {
      if (!sdp) return;
      try {
        await setupPeer(sdp);
      } catch (e) {
        setError(e.message);
        setStatus("error");
      }
    });

    socket.on("signal:ice", async ({ candidate }) => {
      if (candidate && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch {
          /* ignore */
        }
      }
    });

    return () => {
      cleanup();
      setStatus("idle");
    };
  }, [sessionCode, cleanup, handleChannelMessage]);

  useEffect(() => {
    if (status === "connected" && controlReady) {
      enableRemoteControl();
    }
  }, [status, controlReady, enableRemoteControl]);

  useEffect(() => {
    if (!remoteControl) return undefined;

    const channelOpen = () =>
      controlRef.current && controlRef.current.readyState === "open";

    const forwardKeyDown = (e) => {
      if (!channelOpen() || !remoteControlRef.current) return;
      if (isHubLocalTarget(e.target)) return;

      e.preventDefault();
      e.stopPropagation();

      const payload = {
        type: "keydown",
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        repeat: e.repeat,
      };

      if (e.ctrlKey && (e.key === "v" || e.key === "V")) {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              markHubClipboardSent(text);
              sendControl({ type: "clipboard", text, from: "hub" });
              sendControl({ type: "paste" });
            } else {
              sendControl(payload);
            }
          })
          .catch(() => sendControl(payload));
        return;
      }

      sendControl(payload);
    };

    const forwardKeyUp = (e) => {
      if (!channelOpen() || !remoteControlRef.current) return;
      if (isHubLocalTarget(e.target)) return;

      e.preventDefault();
      e.stopPropagation();
      sendControl({
        type: "keyup",
        key: e.key,
        code: e.code,
      });
    };

    window.addEventListener("keydown", forwardKeyDown, true);
    window.addEventListener("keyup", forwardKeyUp, true);
    return () => {
      window.removeEventListener("keydown", forwardKeyDown, true);
      window.removeEventListener("keyup", forwardKeyUp, true);
    };
  }, [remoteControl, sendControl]);

  useEffect(() => {
    if (!controlReady) return undefined;

    const onWindowMouseUp = (e) => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      sendMouseAt(e.clientX, e.clientY, { type: "mouseup", button: e.button });
    };

    const onWindowMouseMove = (e) => {
      if (!pointerDownRef.current) return;
      sendMouseAt(e.clientX, e.clientY, { type: "mousemove" });
    };

    window.addEventListener("mouseup", onWindowMouseUp, true);
    window.addEventListener("mousemove", onWindowMouseMove, true);
    return () => {
      window.removeEventListener("mouseup", onWindowMouseUp, true);
      window.removeEventListener("mousemove", onWindowMouseMove, true);
    };
  }, [controlReady, sendMouseAt]);

  const onSurfaceMouseEnter = useCallback(() => {
    if (remoteControlRef.current) {
      surfaceRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const onSurfaceMouseDown = useCallback(
    (e) => {
      if (e.button !== 0 || e.target.closest(".viewer-toolbar")) return;
      enableRemoteControl();
      surfaceRef.current?.focus({ preventScroll: true });
      try {
        surfaceRef.current?.requestPointerLock?.();
      } catch {
        /* optional */
      }
    },
    [enableRemoteControl]
  );

  const onVideoMouseMove = useCallback(
    (e) => {
      if (!controlReady) return;
      sendMouseAt(e.clientX, e.clientY, { type: "mousemove" });
    },
    [controlReady, sendMouseAt]
  );

  const onVideoMouseDown = useCallback(
    (e) => {
      if (!controlReady) return;
      e.preventDefault();
      pointerDownRef.current = true;
      sendMouseAt(e.clientX, e.clientY, { type: "mousedown", button: e.button });
    },
    [controlReady, sendMouseAt]
  );

  const onVideoMouseUp = useCallback(
    (e) => {
      if (!controlReady) return;
      pointerDownRef.current = false;
      sendMouseAt(e.clientX, e.clientY, { type: "mouseup", button: e.button });
    },
    [controlReady, sendMouseAt]
  );

  const onVideoWheel = useCallback(
    (e) => {
      if (!controlReady) return;
      e.preventDefault();
      sendControl({ type: "wheel", deltaY: e.deltaY });
    },
    [controlReady, sendControl]
  );

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
  }, []);

  return {
    status,
    error,
    controlReady,
    remoteControl,
    remoteKeyboard: remoteControl,
    clipboardSynced,
    syncHubClipboardToHost,
    videoRef,
    surfaceRef,
    enableRemoteControl,
    activateRemoteKeyboard: enableRemoteControl,
    pauseRemoteControl,
    deactivateRemoteKeyboard: pauseRemoteControl,
    onSurfaceMouseEnter,
    onSurfaceMouseDown,
    onVideoMouseMove,
    onVideoMouseDown,
    onVideoMouseUp,
    onVideoWheel,
    onContextMenu,
    disconnect: cleanup,
  };
}
