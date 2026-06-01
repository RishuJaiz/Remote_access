"""
RemoteDesk host agent — run on the machine being controlled.

Usage:
  python main.py --session AB12CD
  python main.py --session AB12CD --signal http://localhost:3001
"""

from __future__ import annotations

import argparse
import asyncio
import logging

import socketio
from aiortc import (
    RTCIceCandidate,
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.sdp import candidate_from_sdp

from clipboard_sync import set_send_callback, start_monitor, stop_monitor
from control import handle_control_message
from screen_track import ScreenCaptureTrack

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("agent")

RTC_CONFIG = RTCConfiguration(
    iceServers=[
        RTCIceServer(urls="stun:stun.l.google.com:19302"),
        RTCIceServer(urls="stun:stun1.l.google.com:19302"),
    ]
)


def sdp_payload(desc: RTCSessionDescription) -> dict[str, str]:
    return {"type": desc.type, "sdp": desc.sdp}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="RemoteDesk host agent")
    p.add_argument("--session", required=True, help="Session code from dashboard")
    p.add_argument("--signal", default="http://localhost:3001", help="Signaling server URL")
    return p.parse_args()


async def run_agent(session_code: str, signal_url: str) -> None:
    sio = socketio.AsyncClient()
    pc: RTCPeerConnection | None = None
    negotiating = asyncio.Lock()
    code = session_code.strip().upper()

    control_channel = None

    async def close_pc() -> None:
        nonlocal pc, control_channel
        stop_monitor()
        set_send_callback(None)
        control_channel = None
        if pc:
            await pc.close()
            pc = None

    async def start_offer() -> None:
        nonlocal pc, control_channel
        async with negotiating:
            if pc is not None:
                return
            logger.info("Viewer detected — starting WebRTC offer")
            pc = RTCPeerConnection(configuration=RTC_CONFIG)
            pc.addTrack(ScreenCaptureTrack())

            control = pc.createDataChannel("control")
            control_channel = control

            def send_on_channel(payload: str) -> None:
                if control.readyState == "open":
                    control.send(payload)

            set_send_callback(send_on_channel)

            @control.on("open")
            def on_control_open() -> None:
                logger.info("Control channel open — clipboard sync active")
                start_monitor()

            @control.on("message")
            def on_control(message: str | bytes) -> None:
                if isinstance(message, bytes):
                    message = message.decode("utf-8", errors="ignore")
                handle_control_message(message)

            @pc.on("icecandidate")
            async def on_ice(candidate) -> None:
                if candidate:
                    await sio.emit(
                        "signal:ice",
                        {
                            "candidate": {
                                "candidate": candidate.candidate,
                                "sdpMid": candidate.sdpMid,
                                "sdpMLineIndex": candidate.sdpMLineIndex,
                            }
                        },
                    )

            offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            await sio.emit("signal:offer", {"sdp": sdp_payload(pc.localDescription)})
            logger.info("WebRTC offer sent to technician")

    @sio.event
    async def connect() -> None:
        logger.info("Connected to signaling server")
        res = await sio.call("session:join", {"code": code, "role": "host"})
        if not res or not res.get("ok"):
            err = (res or {}).get("error", "join failed")
            raise RuntimeError(f"Could not join session: {err}")
        logger.info("Joined session %s as host", code)
        session = res.get("session") or {}
        if session.get("hasViewer"):
            await start_offer()

    @sio.on("session:updated")
    async def on_session_updated(session: dict) -> None:
        if session.get("code") == code and session.get("hasViewer"):
            await start_offer()

    @sio.on("signal:answer")
    async def on_answer(data: dict) -> None:
        if not pc or not data.get("sdp"):
            return
        await pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"]["sdp"], type=data["sdp"]["type"]))

    @sio.on("signal:ice")
    async def on_ice(data: dict) -> None:
        if not pc:
            return
        cand = data.get("candidate")
        if not cand:
            return
        if isinstance(cand, dict):
            ice = RTCIceCandidate(
                sdpMid=cand.get("sdpMid"),
                sdpMLineIndex=cand.get("sdpMLineIndex"),
                candidate=cand.get("candidate"),
            )
        else:
            ice = candidate_from_sdp(cand)
            ice.sdpMLineIndex = data.get("sdpMLineIndex", ice.sdpMLineIndex)
        try:
            await pc.addIceCandidate(ice)
        except Exception as exc:
            logger.debug("ICE add skipped: %s", exc)

    await sio.connect(signal_url, transports=["websocket", "polling"])
    logger.info("Agent running for session %s — waiting for technician", code)
    try:
        await sio.wait()
    finally:
        await close_pc()
        await sio.disconnect()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(run_agent(args.session, args.signal))
    except KeyboardInterrupt:
        logger.info("Stopped")


if __name__ == "__main__":
    main()
