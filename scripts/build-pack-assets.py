#!/usr/bin/env python3
"""Create the local, hash-checked Pyodide gowin_pack asset bundle."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(sys.argv[1]).resolve()
PACKAGE_ROOT = ROOT / "node_modules/pyodide"
PACK_DIR = Path(os.environ.get("PACK_ASSET_DIR", ROOT / "build/pack")).resolve()
CACHE_DIR = Path(os.environ.get("PACK_ASSET_CACHE_DIR", ROOT / "build/cache/pack")).resolve()
CHECK_PINS = ROOT / ".github/scripts/check-pins.py"
PYODIDE_CORE_FILES = (
    "pyodide.mjs",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
)
PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide"


def ensure_build_path(path: Path, label: str) -> None:
    build_root = (ROOT / "build").resolve()
    if path == build_root or not path.is_relative_to(build_root):
        raise RuntimeError(f"{label} must be inside {build_root}: {path}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_pin_command(name: str) -> list[str]:
    result = subprocess.run(
        [sys.executable, str(CHECK_PINS), name],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.rstrip("\n").split("\t")


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "toolchain-pack-assets/1"})
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".download")
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def verified_download(url: str, destination: Path, expected_sha256: str) -> None:
    if not destination.is_file():
        download(url, destination)
    actual = sha256(destination)
    if actual != expected_sha256:
        raise RuntimeError(
            f"SHA-256 mismatch for {destination.name}: expected {expected_sha256}, got {actual}"
        )


def copy_verified(source: Path, destination: Path, expected_sha256: str | None = None) -> None:
    if not source.is_file():
        raise RuntimeError(f"Required asset is missing: {source}")
    source_hash = sha256(source)
    if expected_sha256 is not None and source_hash != expected_sha256:
        raise RuntimeError(
            f"SHA-256 mismatch for {source.name}: expected {expected_sha256}, got {source_hash}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    if sha256(destination) != source_hash:
        raise RuntimeError(f"Copied asset failed SHA-256 verification: {destination}")


def pyodide_version() -> str:
    root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    package_lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    installed_package = json.loads((PACKAGE_ROOT / "package.json").read_text(encoding="utf-8"))
    declared = root_package.get("devDependencies", {}).get("pyodide")
    locked = package_lock.get("packages", {}).get("node_modules/pyodide", {}).get("version")
    installed = installed_package.get("version")
    if not declared or declared != locked or locked != installed:
        raise RuntimeError(
            f"Pyodide npm pin mismatch: package.json={declared}, "
            f"package-lock.json={locked}, node_modules={installed}"
        )
    return installed


def prepare_apycula() -> Path:
    pin = run_pin_command("apycula-wheel-pins")
    if len(pin) < 2:
        raise RuntimeError("Could not read the pinned Apycula wheel hashes")
    version, *allowed_hashes = pin
    filename = f"apycula-{version}-py3-none-any.whl"
    cached = CACHE_DIR / filename
    if cached.is_file():
        actual = sha256(cached)
        if actual not in allowed_hashes or not zipfile.is_zipfile(cached):
            raise RuntimeError(
                f"Apycula wheel cache failed hash verification: {filename} ({actual})"
            )
    else:
        info = run_pin_command("apycula-wheel-info")
        if len(info) != 3 or info[0] != filename:
            raise RuntimeError("Apycula wheel metadata does not match requirements-nextpnr.txt")
        _, expected_hash, url = info
        if expected_hash not in allowed_hashes:
            raise RuntimeError("Apycula wheel hash is not in requirements-nextpnr.txt")
        verified_download(url, cached, expected_hash)
        if not zipfile.is_zipfile(cached):
            raise RuntimeError("Downloaded Apycula wheel is not a ZIP archive")
    return cached


def main() -> None:
    ensure_build_path(PACK_DIR, "PACK_ASSET_DIR")
    ensure_build_path(CACHE_DIR, "PACK_ASSET_CACHE_DIR")
    if (
        PACK_DIR == CACHE_DIR
        or PACK_DIR in CACHE_DIR.parents
        or CACHE_DIR in PACK_DIR.parents
    ):
        raise RuntimeError("PACK_ASSET_DIR and PACK_ASSET_CACHE_DIR must not overlap")
    version = pyodide_version()
    lock_source = PACKAGE_ROOT / "pyodide-lock.json"
    if not lock_source.is_file():
        raise RuntimeError(f"Pyodide lock file is missing: {lock_source}")
    lock = json.loads(lock_source.read_text(encoding="utf-8"))
    packages = lock.get("packages", {})
    if not isinstance(packages, dict):
        raise RuntimeError("Pyodide lock file has no package table")

    shutil.rmtree(PACK_DIR, ignore_errors=True)
    pyodide_dir = PACK_DIR / "pyodide"
    wheel_dir = PACK_DIR / "wheels"
    pyodide_dir.mkdir(parents=True)
    wheel_dir.mkdir(parents=True)

    for filename in PYODIDE_CORE_FILES:
        copy_verified(PACKAGE_ROOT / filename, pyodide_dir / filename)

    for name in ("micropip", "numpy", "msgspec"):
        package = packages.get(name)
        if not isinstance(package, dict):
            raise RuntimeError(f"{name} is missing from the pinned Pyodide lock file")
        filename = package.get("file_name")
        expected_hash = package.get("sha256")
        if (
            not isinstance(filename, str)
            or not filename.endswith(".whl")
            or not isinstance(expected_hash, str)
            or len(expected_hash) != 64
        ):
            raise RuntimeError(f"Invalid {name} wheel metadata in the Pyodide lock file")
        cache_path = CACHE_DIR / filename
        url = f"{PYODIDE_CDN}/v{version}/full/{filename}"
        verified_download(url, cache_path, expected_hash)
        copy_verified(cache_path, wheel_dir / filename, expected_hash)

    apycula_wheel = prepare_apycula()
    copy_verified(apycula_wheel, wheel_dir / apycula_wheel.name)
    total = sum(path.stat().st_size for path in PACK_DIR.rglob("*") if path.is_file())
    print(f"Pyodide: {version}; Python: {lock.get('info', {}).get('python', 'unknown')}")
    print(f"Assets: {PACK_DIR} ({total} bytes)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"build-pack-assets: {error}", file=sys.stderr)
        raise SystemExit(1) from error
