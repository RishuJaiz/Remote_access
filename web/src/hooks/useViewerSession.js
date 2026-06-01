import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ICE_SERVERS, SIGNAL_URL } from "../webrtc/config.js";

export function useViewerSession(sessionCode) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const controlRef = useRef(null);
  const socketRef = useRef(null);

  const cleanup = useCallback(() => {
    controlRef.current?.close();
    controlRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
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
        if (ev.channel.label === "control") {
          controlRef.current = ev.channel;
        }
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

  const sendControl = useCallback((payload) => {
    const ch = controlRef.current;
    if (ch?.readyState === "open") {
      ch.send(JSON.stringify(payload));
    }
  }, []);

  const normalizedCoords = useCallback((el, clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }, []);

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
      e.preventDefault();
      sendControl({ type: "wheel", deltaY: e.deltaY });
    },
    [sendControl]
  );

  const onVideoKeyDown = useCallback(
    (e) => {
      e.preventDefault();
      sendControl({
        type: "keydown",
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
    },
    [sendControl]
  );

  return {
    status,
    error,
    videoRef,
    onVideoMouseMove,
    onVideoMouseDown,
    onVideoMouseUp,
    onVideoWheel,
    onVideoKeyDown,
    disconnect: cleanup,
  };
}
