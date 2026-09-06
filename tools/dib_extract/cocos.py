"""Parsers for Cocos2d/TexturePacker geometry strings."""
import re

_NUM = r"-?\d+(?:\.\d+)?"
_POINT_RE = re.compile(r"^\s*\{\s*(" + _NUM + r")\s*,\s*(" + _NUM + r")\s*\}\s*$")
_RECT_RE = re.compile(
    r"^\s*\{\s*\{\s*(" + _NUM + r")\s*,\s*(" + _NUM + r")\s*\}\s*,"
    r"\s*\{\s*(" + _NUM + r")\s*,\s*(" + _NUM + r")\s*\}\s*\}\s*$"
)

def parse_point(s: str) -> tuple[float, float]:
    m = _POINT_RE.match(s)
    if not m:
        raise ValueError(f"not a point string: {s!r}")
    return (float(m.group(1)), float(m.group(2)))

def parse_rect(s: str) -> tuple[float, float, float, float]:
    m = _RECT_RE.match(s)
    if not m:
        raise ValueError(f"not a rect string: {s!r}")
    return (float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)))

def parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if v in ("true", "1", 1):
        return True
    if v in ("false", "0", 0):
        return False
    raise ValueError(f"not a bool: {v!r}")
