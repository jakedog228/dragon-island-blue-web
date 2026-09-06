from .cocos import parse_point, parse_rect, parse_bool

def _to_int(x):
    return int(x) if float(x).is_integer() else x

def atlas_to_pixi(plist_dict) -> dict:
    meta_in = plist_dict["metadata"]
    w, h = parse_point(meta_in["size"])
    image = meta_in.get("realTextureFileName") or meta_in["textureFileName"]
    frames = {}
    for name, fr in plist_dict["frames"].items():
        fx, fy, fw, fh = parse_rect(fr["frame"])
        sx, sy, _sw, _sh = parse_rect(fr["sourceColorRect"])
        sw, sh = parse_point(fr["sourceSize"])
        frames[name] = {
            "frame": {"x": _to_int(fx), "y": _to_int(fy), "w": _to_int(fw), "h": _to_int(fh)},
            "rotated": parse_bool(fr.get("rotated", False)),
            "trimmed": True,
            "spriteSourceSize": {"x": _to_int(sx), "y": _to_int(sy), "w": _to_int(fw), "h": _to_int(fh)},
            "sourceSize": {"w": _to_int(sw), "h": _to_int(sh)},
        }
    return {"frames": frames,
            "meta": {"image": image, "size": {"w": _to_int(w), "h": _to_int(h)}, "scale": "1"}}
