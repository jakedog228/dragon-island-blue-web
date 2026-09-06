"""Minimal reader for Apple's compiled `NIBArchive` container.

The Tournament prize list is the one shipped screen whose layout lives in a nib rather than in
`-[... init]`, so its row geometry cannot be recovered from the binary alone. Only the pieces the
port needs are decoded: object -> class name, and each object's key/value pairs.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field


def _varint(buf: bytes, pos: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte & 0x80:
            return value, pos
        shift += 7


@dataclass
class NibObject:
    class_name: str
    values: dict[str, object] = field(default_factory=dict)


def parse(path: str) -> list[NibObject]:
    buf = open(path, "rb").read()
    if buf[:10] != b"NIBArchive":
        raise ValueError(f"{path} is not a NIBArchive")
    (
        object_count, object_offset,
        key_count, key_offset,
        value_count, value_offset,
        class_count, class_offset,
    ) = struct.unpack("<8I", buf[18:50])

    keys: list[str] = []
    pos = key_offset
    for _ in range(key_count):
        length, pos = _varint(buf, pos)
        keys.append(buf[pos:pos + length].decode("utf-8", "replace"))
        pos += length

    classes: list[str] = []
    pos = class_offset
    for _ in range(class_count):
        length, pos = _varint(buf, pos)
        extras, pos = _varint(buf, pos)
        pos += extras * 4
        classes.append(buf[pos:pos + length].rstrip(b"\0").decode("utf-8", "replace"))
        pos += length

    values: list[tuple[int, object]] = []
    pos = value_offset
    for _ in range(value_count):
        key_index, pos = _varint(buf, pos)
        kind = buf[pos]
        pos += 1
        if kind == 0:
            value = struct.unpack("<b", buf[pos:pos + 1])[0]; pos += 1
        elif kind == 1:
            value = struct.unpack("<h", buf[pos:pos + 2])[0]; pos += 2
        elif kind == 2:
            value = struct.unpack("<i", buf[pos:pos + 4])[0]; pos += 4
        elif kind == 3:
            value = struct.unpack("<q", buf[pos:pos + 8])[0]; pos += 8
        elif kind == 4:
            value = True
        elif kind == 5:
            value = False
        elif kind == 6:
            value = struct.unpack("<f", buf[pos:pos + 4])[0]; pos += 4
        elif kind == 7:
            value = struct.unpack("<d", buf[pos:pos + 8])[0]; pos += 8
        elif kind == 8:
            length, pos = _varint(buf, pos)
            raw = buf[pos:pos + length]; pos += length
            try:
                text = raw.decode("utf-8")
                value = text if text.isprintable() else raw
            except UnicodeDecodeError:
                value = raw
        elif kind == 9:
            value = None
        elif kind == 10:
            value = ("object", struct.unpack("<I", buf[pos:pos + 4])[0]); pos += 4
        else:
            raise ValueError(f"unknown NIBArchive value type {kind}")
        values.append((key_index, value))

    objects: list[NibObject] = []
    pos = object_offset
    for _ in range(object_count):
        class_index, pos = _varint(buf, pos)
        first, pos = _varint(buf, pos)
        count, pos = _varint(buf, pos)
        obj = NibObject(classes[class_index])
        for key_index, value in values[first:first + count]:
            obj.values[keys[key_index]] = value
        objects.append(obj)
    return objects
