#!/usr/bin/env python3

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIN_SCRIPT = ROOT / ".github/scripts/check-pins.py"
BUILD_SCRIPT = ROOT / "scripts/build-pnr-wasm.sh"


def load_pin_checker():
    spec = importlib.util.spec_from_file_location("check_pins", PIN_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load pin checker")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("wasi", "native"), required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--build-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    binary = args.binary.resolve()
    build_dir = args.build_dir.resolve()
    if not binary.is_file():
        raise SystemExit(f"Build artifact is missing: {binary}")

    pins = load_pin_checker()
    research = (ROOT / "RESEARCH.md").read_text(encoding="utf-8")
    nextpnr_pin = pins.parse_research_dependency(research, "nextpnr")
    archive_pins = {
        name: pins.parse_archive_pin(research, name)
        for name in ("boost", "eigen")
    }
    apycula_version, apycula_hashes = pins.parse_apycula_requirements(
        (ROOT / pins.APYCULA_REQUIREMENTS).read_text(encoding="utf-8")
    )
    chipdb = [
        {
            "path": str(path.relative_to(build_dir)),
            "size": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in (build_dir / "share/himbaechel/gowin").glob("chipdb-*.bin")
    ]
    chipdb.sort(key=lambda item: item["path"])
    if not chipdb:
        raise SystemExit("No generated Gowin chipdb files were found")
    metadata = {
        "format_version": 1,
        "mode": args.mode,
        "source": nextpnr_pin,
        "dependencies": {
            **{
                name: {"version": pin["version"], "sha256": pin["sha256"]}
                for name, pin in archive_pins.items()
            },
            "apycula": {"version": apycula_version, "hashes": apycula_hashes},
        },
        "build_script_sha256": sha256_file(BUILD_SCRIPT),
        "artifact": {
            "path": binary.name,
            "sha256": sha256_file(binary),
            "size": binary.stat().st_size,
        },
        "chipdb": chipdb,
    }
    if args.mode == "wasi":
        metadata["wasi_sdk"] = pins.parse_wasi_sdk_pin(research)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        f"{json.dumps(metadata, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, sort_keys=True))


if __name__ == "__main__":
    main()
