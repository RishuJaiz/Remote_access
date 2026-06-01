import json
import logging

import pyautogui

logger = logging.getLogger(__name__)

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

_SIZE = pyautogui.size()

# Map browser KeyboardEvent.code to pyautogui key names where needed
_CODE_MAP = {
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "Enter": "enter",
    "Backspace": "backspace",
    "Tab": "tab",
    "Escape": "esc",
    "Delete": "delete",
    "Home": "home",
    "End": "end",
    "PageUp": "pageup",
    "PageDown": "pagedown",
    "Space": "space",
}


def _to_screen(x_norm: float, y_norm: float) -> tuple[int, int]:
    w, h = _SIZE.width, _SIZE.height
    return int(x_norm * w), int(y_norm * h)


def handle_control_message(raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return

    kind = msg.get("type")
    try:
        if kind == "mousemove":
            pyautogui.moveTo(*_to_screen(msg["x"], msg["y"]), _pause=False)
        elif kind == "mousedown":
            pyautogui.moveTo(*_to_screen(msg["x"], msg["y"]), _pause=False)
            pyautogui.mouseDown(button=_button(msg.get("button", 0)), _pause=False)
        elif kind == "mouseup":
            pyautogui.moveTo(*_to_screen(msg["x"], msg["y"]), _pause=False)
            pyautogui.mouseUp(button=_button(msg.get("button", 0)), _pause=False)
        elif kind == "wheel":
            clicks = int(-msg.get("deltaY", 0) / 100) or (-1 if msg.get("deltaY", 0) > 0 else 1)
            pyautogui.scroll(clicks, _pause=False)
        elif kind == "keydown":
            _keydown(msg)
    except Exception as exc:
        logger.debug("control action failed: %s", exc)


def _button(index: int) -> str:
    return ("left", "middle", "right")[index] if index in (0, 1, 2) else "left"


def _keydown(msg: dict) -> None:
    key = msg.get("key", "")
    code = msg.get("code", "")

    if len(key) == 1 and key.isprintable():
        pyautogui.press(key, _pause=False)
        return

    name = _CODE_MAP.get(code)
    if name:
        pyautogui.press(name, _pause=False)
