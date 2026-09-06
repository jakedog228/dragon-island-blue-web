from dib_extract.atlas import atlas_to_pixi

def test_atlas_to_pixi_frame_geometry():
    src = {
        "metadata": {"format": 2, "textureFileName": "Adown-hd.png", "size": "{256,512}"},
        "frames": {"Adown1.png": {
            "frame": "{{127,119},{94,88}}", "offset": "{0,32}",
            "sourceColorRect": "{{73,44},{94,88}}", "sourceSize": "{240,240}", "rotated": False}},
    }
    out = atlas_to_pixi(src)
    assert out["meta"]["image"] == "Adown-hd.png"
    assert out["meta"]["size"] == {"w": 256, "h": 512}
    fr = out["frames"]["Adown1.png"]
    assert fr["frame"] == {"x": 127, "y": 119, "w": 94, "h": 88}
    assert fr["rotated"] is False
    assert fr["sourceSize"] == {"w": 240, "h": 240}
    assert fr["spriteSourceSize"] == {"x": 73, "y": 44, "w": 94, "h": 88}
    assert fr["trimmed"] is True


def test_atlas_to_pixi_rotated_frame():
    src = {
        "metadata": {"format": 2, "textureFileName": "Adown-hd.png", "size": "{256,512}"},
        "frames": {"Adown3.png": {
            "frame": "{{0,0},{94,144}}", "offset": "{0,4}",
            "sourceColorRect": "{{73,44},{94,144}}", "sourceSize": "{240,240}", "rotated": True}},
    }
    out = atlas_to_pixi(src)
    fr = out["frames"]["Adown3.png"]
    assert fr["rotated"] is True
    # frame w/h are the UNROTATED dims, passed straight through (PixiJS swaps internally)
    assert fr["frame"] == {"x": 0, "y": 0, "w": 94, "h": 144}
    assert fr["spriteSourceSize"] == {"x": 73, "y": 44, "w": 94, "h": 144}
    assert fr["sourceSize"] == {"w": 240, "h": 240}
