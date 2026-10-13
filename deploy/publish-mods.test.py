"""Linux operational tests: real files/tar/flock, fake Docker; never touches live services."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

DRIVER = Path(__file__).with_name("publish-mods.sh")
MOCK = '''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['MOCK_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[0] == 'inspect' or args[:2] == ['image', 'inspect']:
    print('sha256:test-image')
elif args[0] == 'compose':
    if 'ps' in args: print('test-game')
    if 'run' in args and os.environ['MOCK_FAILURE'] == 'preflight': sys.exit(17)
elif args[0] == 'exec' and os.environ['MOCK_FAILURE'] == 'verify':
    sys.exit(18)
'''


@unittest.skipUnless(os.name == "posix", "requires Linux deployment tools")
class PublisherTests(unittest.TestCase):
    def exercise(self, failure, previous):
        with tempfile.TemporaryDirectory(prefix="dib-publish-test-", dir="/tmp") as temp:
            root = Path(temp)
            live = root / "releases/app/deploy"
            live.mkdir(parents=True)
            (live / ".env").write_text("DIB_GAME_PUBLIC_ORIGIN=https://example.com\n")
            (live / "compose.yaml").write_text("name: dib\nservices: {}\n")
            (root / "current").symlink_to("releases/app")
            override = root / "official-mods/compose.yaml"
            if previous:
                override.parent.mkdir()
                override.write_text("previous catalog configuration\n")
            import uuid
            stage = Path("/tmp") / ("dib-mods-" + uuid.uuid4().hex)
            stage.mkdir()
            try:
                files = {"test.dibmod": b"mock archive", "publish-manifest.json": b"[]"}
                files["SHA256SUMS"] = "".join(
                    f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in files.items()
                ).encode()
                archive = stage / "catalog.tar.gz"
                with tarfile.open(archive, "w:gz") as tar:
                    for name, data in files.items():
                        entry = tarfile.TarInfo(name)
                        entry.size = len(data)
                        tar.addfile(entry, io.BytesIO(data))
                (stage / "verify-mods.mjs").write_text("// consumed by fake docker\n")
                mock_bin = root / "bin"
                mock_bin.mkdir()
                docker = mock_bin / "docker"
                docker.write_text(MOCK)
                docker.chmod(0o755)
                log = root / "docker.log"
                result = subprocess.run(
                    ["bash", str(DRIVER), str(root), str(stage), hashlib.sha256(archive.read_bytes()).hexdigest()],
                    env={**os.environ, "PATH": str(mock_bin) + ":" + os.environ["PATH"],
                         "MOCK_LOG": str(log), "MOCK_FAILURE": failure},
                    capture_output=True, text=True, timeout=30,
                )
                import json
                calls = [json.loads(line) for line in log.read_text().splitlines()]
                activations = [call for call in calls if call[0] == "compose" and "up" in call]
                if failure:
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(override.exists(), previous)
                    if previous:
                        self.assertEqual(override.read_text(), "previous catalog configuration\n")
                    self.assertEqual(len(activations), 2 if failure == "verify" else 0)
                    if failure == "verify":
                        self.assertEqual(any(arg.endswith("previous.yaml") for arg in activations[-1]), previous)
                else:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("read_only: true", override.read_text())
                    self.assertEqual(len(activations), 1)
                self.assertFalse(stage.exists(), "remote staging should be cleaned")
            finally:
                import shutil
                if stage.exists():
                    shutil.rmtree(stage)

    def test_first_publication_rolls_back_on_verification_failure(self):
        self.exercise("verify", False)

    def test_republication_restores_previous_catalog(self):
        self.exercise("verify", True)

    def test_preflight_failure_never_activates(self):
        self.exercise("preflight", True)

    def test_success_retains_catalog(self):
        self.exercise("", False)


if __name__ == "__main__":
    unittest.main()
