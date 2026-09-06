import argparse, sys, pathlib
from .bundle import ensure_app, find_ipa, unpack_ipa
from .data_extract import run_data_extract
from .asset_extract import run_asset_extract

def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="dib_extract",
        description="Unpack the Dragon Island Blue IPA and extract its data/assets for the web port.",
    )
    ap.add_argument(
        "stage",
        choices=["unpack", "data", "assets", "all"],
        nargs="?",
        default="all",
        help="unpack: only unzip the IPA into Payload/. data/assets/all: extract (all also unpacks "
             "the IPA first if the bundle is missing). Default: all.",
    )
    ap.add_argument("--app", help="path to DragonIsland.app (default: <app-root>/Payload/DragonIsland.app)")
    ap.add_argument("--app-root", default="..", help="dir containing Payload/ and the source .ipa (default: .. — the repo root, since this is run from tools/)")
    ap.add_argument("--ipa", help="path to the source .ipa (default: DIB_IPA env, or the first *.ipa in --app-root)")
    ap.add_argument("--out", default="../extracted", help="output root")
    args = ap.parse_args(argv)

    if args.stage == "unpack":
        root = pathlib.Path(args.app_root or ".")
        ipa = find_ipa(root, args.ipa)
        if ipa is None:
            raise FileNotFoundError(
                f"No .ipa found in {root.resolve()} — put Dragon_Island_Blue_1.1.0.ipa there "
                "(it is copyrighted and not committed), or pass --ipa <path>."
            )
        unpack_ipa(ipa, root)
        return 0

    app = ensure_app(args.app, args.app_root, args.ipa)
    if args.stage in ("data", "all"):
        n = run_data_extract(app, f"{args.out}/data")
        print(f"data: {len(n)} files")
    if args.stage in ("assets", "all"):
        c = run_asset_extract(app, f"{args.out}/assets")
        print(f"assets: {c}")
    if args.stage == "all":
        print(f"done -- extracted bundle written to {pathlib.Path(args.out).resolve()}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (FileNotFoundError, ValueError) as e:
        # Setup/onboarding failures: print the actionable guidance without a Python traceback.
        print(f"\nerror: {e}\n", file=sys.stderr)
        sys.exit(1)
