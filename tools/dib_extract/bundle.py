import os, plistlib, pathlib, zipfile

def load_plist(path):
    with open(path, "rb") as f:
        return plistlib.load(f)

def classify_plist(path) -> str:
    d = load_plist(path)
    if isinstance(d, dict) and "frames" in d and "metadata" in d:
        return "atlas"
    if isinstance(d, dict) and ("chars" in d or "kernings" in d):
        return "font"
    return "data"

def _missing_app_message(app_path, explicit: bool, ipa_hint) -> str:
    lines = [
        f"Dragon Island Blue app bundle not found at {app_path}",
        "  (the extractor needs the game's shipped plists, textures, audio, and fonts,",
        "   which live inside Payload/DragonIsland.app/ once the IPA is unpacked).",
        "",
    ]
    if explicit:
        lines += [
            "You passed --app / DIB_APP explicitly, so no IPA was unpacked automatically.",
            "Point it at a real DragonIsland.app directory, or drop the flag and let the",
            "extractor unpack an IPA for you.",
        ]
    else:
        lines += [
            "To set this up from a fresh clone:",
            "  1. Put Dragon_Island_Blue_1.1.0.ipa in the repository root.",
            "  2. Run the extractor again from tools/ -- it unpacks the IPA for you:",
            "       python -m dib_extract all",
            "     (or unpack only:  python -m dib_extract unpack)",
        ]
        if ipa_hint is None:
            lines += [
                "",
                "No .ipa was found next to the expected bundle. The IPA is a copyrighted",
                "input and is intentionally NOT committed; you must supply your own copy.",
            ]
    return "\n".join(lines)

def find_ipa(root, explicit=None) -> pathlib.Path | None:
    """Locate the source IPA. Priority: explicit path/--ipa, DIB_IPA env, then the first
    *.ipa sitting in `root`. Returns None when nothing is found (callers decide if that is
    fatal); raises only when an explicitly-named path does not exist."""
    candidate = explicit or os.environ.get("DIB_IPA")
    if candidate:
        p = pathlib.Path(candidate)
        if not p.exists():
            raise FileNotFoundError(f"IPA not found at {p}")
        return p
    ipas = sorted(pathlib.Path(root).glob("*.ipa"))
    return ipas[0] if ipas else None

def unpack_ipa(ipa_path, dest_root, log=print) -> pathlib.Path:
    """Unzip the `Payload/` tree from an IPA into `dest_root`, yielding
    `dest_root/Payload/DragonIsland.app`. An IPA is an ordinary zip; only the Mach-O
    executable inside is FairPlay-encrypted, and the extractor never reads it, so a plain
    unzip is enough to run the demo (RE work needs the separately-decrypted binary)."""
    ipa_path, dest_root = pathlib.Path(ipa_path), pathlib.Path(dest_root)
    with zipfile.ZipFile(ipa_path) as zf:
        members = [n for n in zf.namelist() if n.startswith("Payload/")]
        if not members:
            raise ValueError(
                f"{ipa_path} has no Payload/ entries — is this really a Dragon Island Blue IPA?"
            )
        zf.extractall(dest_root, members)
    app = dest_root / "Payload" / "DragonIsland.app"
    if not (app / "DragonIsland").exists():
        raise FileNotFoundError(
            f"unpacked {ipa_path.name} but {app / 'DragonIsland'} is missing; "
            "the archive does not look like the expected app bundle"
        )
    log(f"[dib_extract] unpacked {ipa_path.name} -> {app}")
    return app

def find_app(app: str | None, app_root: str | None) -> pathlib.Path:
    candidate = app or os.environ.get("DIB_APP")
    if candidate:
        p = pathlib.Path(candidate)
    else:
        root = pathlib.Path(app_root or ".")
        p = root / "Payload" / "DragonIsland.app"
    if not (p / "DragonIsland").exists():
        raise FileNotFoundError(
            _missing_app_message(p, explicit=bool(candidate), ipa_hint=None)
        )
    return p

def ensure_app(app: str | None, app_root: str | None, ipa: str | None = None,
               auto_unpack: bool = True, log=print) -> pathlib.Path:
    """Resolve the app bundle, unpacking an available IPA on the fly when the bundle is
    absent and no explicit --app was given. This is what the CLI uses so a fresh clone can
    go from `*.ipa` to extracted assets in a single command."""
    explicit = app or os.environ.get("DIB_APP")
    if explicit:
        app_path = pathlib.Path(explicit)
        if (app_path / "DragonIsland").exists():
            return app_path
        raise FileNotFoundError(_missing_app_message(app_path, explicit=True, ipa_hint=None))

    root = pathlib.Path(app_root or ".")
    app_path = root / "Payload" / "DragonIsland.app"
    if (app_path / "DragonIsland").exists():
        return app_path

    if auto_unpack:
        found = find_ipa(root, ipa)
        if found is not None:
            log(f"[dib_extract] {app_path} not found -- unpacking {found.name} first...")
            unpack_ipa(found, root, log=log)
            if (app_path / "DragonIsland").exists():
                return app_path

    raise FileNotFoundError(
        _missing_app_message(app_path, explicit=False, ipa_hint=find_ipa(root, ipa))
    )
