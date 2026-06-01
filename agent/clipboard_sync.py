"""Bidirectional clipboard sync between host OS and technician browser."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Callable, Optional

import pyperclip

logger = logging.getLogger(__name__)

_send_to_viewer: Optional[Callable[[str], None]] = None
_monitor_thread: Optional[threading.Thread] = None
_monitor_stop = threading.Event()

_last_host_text = ""
_last_sent_to_viewer = ""
_suppress_monitor = False


def set_send_callback(fn: Optional[Callable[[str], None]]) -> None:
    global _send_to_viewer
    _send_to_viewer = fn


def _emit_to_viewer(text: str) -> None:
    global _last_sent_to_viewer
    if not text or not _send_to_viewer:
        return
    if text == _last_sent_to_viewer:
        return
    _last_sent_to_viewer = text
    payload = json.dumps({"type": "clipboard", "text": text, "from": "host"})
    try:
        _send_to_viewer(payload)
    except Exception as exc:
        logger.debug("clipboard send failed: %s", exc)


def apply_hub_clipboard(text: str) -> None:
    """Set host OS clipboard from technician (hub)."""
    global _last_host_text, _suppress_monitor, _last_sent_to_viewer
    if not text:
        return
    _suppress_monitor = True
    try:
        pyperclip.copy(text)
        _last_host_text = text
        _last_sent_to_viewer = text
    except Exception as exc:
        logger.debug("clipboard copy to host failed: %s", exc)
    finally:
        _suppress_monitor = False


def push_host_clipboard_to_viewer() -> None:
    global _last_host_text
    if _suppress_monitor:
        return
    try:
        text = pyperclip.paste()
    except Exception as exc:
        logger.debug("clipboard read failed: %s", exc)
        return
    if not text or text == _last_host_text:
        return
    _last_host_text = text
    _emit_to_viewer(text)


def schedule_push_after_copy(delay: float = 0.2) -> None:
    threading.Timer(delay, push_host_clipboard_to_viewer).start()


def _monitor_loop() -> None:
    while not _monitor_stop.is_set():
        push_host_clipboard_to_viewer()
        _monitor_stop.wait(0.45)


def start_monitor() -> None:
    global _monitor_thread
    stop_monitor()
    _monitor_stop.clear()
    _monitor_thread = threading.Thread(target=_monitor_loop, daemon=True, name="clipboard-monitor")
    _monitor_thread.start()


def stop_monitor() -> None:
    _monitor_stop.set()
    if _monitor_thread and _monitor_thread.is_alive():
        _monitor_thread.join(timeout=1.0)
