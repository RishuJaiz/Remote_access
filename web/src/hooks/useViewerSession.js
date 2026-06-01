import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ICE_SERVERS, SIGNAL_URL } from "../webrtc/config.js";

/** Ctrl+Alt+U — return keyboard to your PC (not sent to host). */
function isReleaseChord(e) {
  return e.ctrlKey && e.altKey && (e.key === "u" || e.key === "U");
}

export function useViewerSession(sessionCode) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [controlReady, setControlReady] = useState(false);
  const [remoteKeyboard, setRemoteKeyboard] = useState(false);
  const videoRef = useRef(null);
  const surfaceRef = useRef(null);
  const pcRef = useRef(null);
  const controlRef = useRef(null);
  const socketRef = useRef(null);
  const remoteKeyboardRef = useRef(false);

  useEffect(() => {
    remoteKeyboardRef.current = remoteKeyboard;
  }, [remoteKeyboard]);

  const cleanup = useCallback(() => {
    controlRef.current?.close();
    controlRef.current = null;
    setControlReady(false);
    setRemoteKeyboard(false);
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

  const deactivateRemoteKeyboard = useCallback(() => {
    setRemoteKeyboard(false);
    sendRelease();
  }, [sendRelease]);

  const activateRemoteKeyboard = useCallback(() => {
    if (!controlRef.current || controlRef.current.readyState !== "open") return;
    setRemoteKeyboard(true);
    surfaceRef.current?.focus();
  }, []);

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
          /* ignore late candidates */
        }
      }
    });

    return () => {
      cleanup();
      setStatus("idle");
    };
  }, [sessionCode, cleanup]);

  useEffect(() => {
    if (!remoteKeyboard) return undefined;

    const channelOpen = () =>
      controlRef.current && controlRef.current.readyState === "open";

    const forwardKeyDown = (e) => {
      if (!channelOpen()) return;
      if (isReleaseChord(e)) {
        e.preventDefault();
        e.stopPropagation();
        deactivateRemoteKeyboard();
        return;
      }

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
      };

      if (e.ctrlKey && (e.key === "v" || e.key === "V")) {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) sendControl({ type: "paste", text });
            else sendControl(payload);
          })
          .catch(() => sendControl(payload));
        return;
      }

      sendControl(payload);
    };

    const forwardKeyUp = (e) => {
      if (!channelOpen() || !remoteKeyboardRef.current) return;
      if (isReleaseChord(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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
  }, [remoteKeyboard, sendControl, deactivateRemoteKeyboard]);

  useEffect(() => {
    if (!remoteKeyboard) return undefined;

    const onPointerDown = (e) => {
      const stage = surfaceRef.current?.closest(".viewer-stage");
      if (stage && !stage.contains(e.target)) {
        deactivateRemoteKeyboard();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [remoteKeyboard, deactivateRemoteKeyboard]);

  const normalizedCoords = useCallback((el, clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }, []);

  const onSurfaceMouseDown = useCallback(
    (e) => {
      if (e.target.closest(".viewer-toolbar")) return;
      activateRemoteKeyboard();
    },
    [activateRemoteKeyboard]
  );

  const onVideoMouseMove = useCallback(
    (e) => {
      const { x, y } = normalizedCoords(e.currentTarget, e.clientX, e.clientY);
      sendControl({ type: "mousemove", x, y });
    },
    [normalizedCoords, sendControl]
  );

  const onVideoMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      const { x, y } = normalizedCoords(e.currentTarget, e.clientX, e.clientY);
      sendControl({ type: "mousedown", button: e.button, x, y });
    },
    [normalizedCoords, sendControl]
  );

  const onVideoMouseUp = useCallback(
    (e) => {
      const { x, y } = normalizedCoords(e.currentTarget, e.clientX, e.clientY);
      sendControl({ type: "mouseup", button: e.button, x, y });
    },
    [normalizedCoords, sendControl]
  );

  const onVideoWheel = useCallback(
    (e) => {
      if (!remoteKeyboardRef.current) return;
      e.preventDefault();
      sendControl({ type: "wheel", deltaY: e.deltaY });
    },
    [sendControl]
  );

  return {
    status,
    error,
    controlReady,
    remoteKeyboard,
    videoRef,
    surfaceRef,
    activateRemoteKeyboard,
    deactivateRemoteKeyboard,
    onSurfaceMouseDown,
    onVideoMouseMove,
    onVideoMouseDown,
    onVideoMouseUp,
    onVideoWheel,
    disconnect: cleanup,
  };
}
