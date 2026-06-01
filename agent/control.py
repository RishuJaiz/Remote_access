import json
import logging

import pyautogui

from clipboard_sync import apply_hub_clipboard, schedule_push_after_copy

logger = logging.getLogger(__name__)

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

_CODE_MAP = {
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "Enter": "enter",
    "NumpadEnter": "enter",
    "Backspace": "backspace",
    "Tab": "tab",
    "Escape": "esc",
    "Delete": "delete",
    "Home": "home",
    "End": "end",
    "PageUp": "pageup",
    "PageDown": "pagedown",
    "Space": "space",
    "Insert": "insert",
    "CapsLock": "capslock",
    "NumLock": "numlock",
    "ScrollLock": "scrolllock",
    "Pause": "pause",
    "PrintScreen": "printscreen",
}
for i in range(1, 13):
    _CODE_MAP[f"F{i}"] = f"f{i}"

_MODIFIER_KEYS = frozenset(
    {"Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "CapsLock", "NumLock"}
)

_HELD: set[str] = set()


def _to_screen(x_norm: float, y_norm: float) -> tuple[int, int]:
    w, h = pyautogui.size()
    return int(x_norm * w), int(y_norm * h)


def _modifier_name(key: str, code: str = "") -> str | None:
    if key in ("Control",) or code in ("ControlLeft", "ControlRight"):
        return "ctrl"
    if key in ("Shift",) or code in ("ShiftLeft", "ShiftRight"):
        return "shift"
    if key in ("Alt", "AltGraph") or code in ("AltLeft", "AltRight"):
        return "alt"
    if key in ("Meta", "OS") or code in ("MetaLeft", "MetaRight", "OSLeft", "OSRight"):
        return "win"
    return None


def _resolve_py_key(key: str, code: str) -> str | None:
    if code.startswith("Key") and len(code) == 4:
        return code[3].lower()
    if code.startswith("Digit") and len(code) == 6:
        return code[5]
    if len(key) == 1:
        return key
    if code in _CODE_MAP:
        return _CODE_MAP[code]
    if len(key) > 1 and key.lower() not in ("dead", "unidentified"):
        return key.lower()
    return None


def _release_all_modifiers() -> None:
    for mod in list(_HELD):
        try:
            pyautogui.keyUp(mod, _pause=False)
        except Exception:
            pass
    _HELD.clear()


def _tap_combo(mods: list[str], py_key: str) -> None:
    for mod in mods:
        pyautogui.keyDown(mod, _pause=False)
    if len(py_key) == 1:
        pyautogui.press(py_key, _pause=False)
    else:
        pyautogui.press(py_key, _pause=False)
    for mod in reversed(mods):
        pyautogui.keyUp(mod, _pause=False)


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
            delta = msg.get("deltaY", 0)
            clicks = int(-delta / 100) or (-1 if delta > 0 else 1)
            pyautogui.scroll(clicks, _pause=False)
        elif kind == "clipboard":
            apply_hub_clipboard(msg.get("text") or "")
        elif kind == "paste":
            text = msg.get("text") or ""
            if text:
                apply_hub_clipboard(text)
            pyautogui.hotkey("ctrl", "v", _pause=False)
        elif kind == "release":
            _release_all_modifiers()
        elif kind == "keydown":
            _keydown(msg)
        elif kind == "keyup":
            _keyup(msg)
    except Exception as exc:
        logger.debug("control action failed: %s", exc)


def _button(index: int) -> str:
    return ("left", "middle", "right")[index] if index in (0, 1, 2) else "left"


def _active_modifiers(msg: dict) -> list[str]:
    mods: list[str] = []
    if msg.get("ctrlKey"):
        mods.append("ctrl")
    if msg.get("altKey"):
        mods.append("alt")
    if msg.get("shiftKey"):
        mods.append("shift")
    if msg.get("metaKey"):
        mods.append("win")
    return mods


def _keydown(msg: dict) -> None:
    key = msg.get("key", "")
    code = msg.get("code", "")

    mod_only = _modifier_name(key, code)
    if key in _MODIFIER_KEYS or mod_only:
        if mod_only and mod_only not in _HELD:
            pyautogui.keyDown(mod_only, _pause=False)
            _HELD.add(mod_only)
        return

    py_key = _resolve_py_key(key, code)
    if not py_key:
        return

    mods = _active_modifiers(msg)
    if mods:
        _tap_combo(mods, py_key)
        if mods == ["ctrl"] and py_key in ("c", "x"):
            schedule_push_after_copy()
        return

    if len(py_key) == 1:
        pyautogui.write(py_key, interval=0)
    else:
        pyautogui.press(py_key, _pause=False)


def _keyup(msg: dict) -> None:
    key = msg.get("key", "")
    code = msg.get("code", "")
    mod = _modifier_name(key, code)
    if mod and mod in _HELD:
        pyautogui.keyUp(mod, _pause=False)
        _HELD.discard(mod)
