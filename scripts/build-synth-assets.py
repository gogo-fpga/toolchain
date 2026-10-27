#!/usr/bin/env python3

import argparse
import hashlib
import io
import json
import shutil
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
YOSYS_SHARE = ROOT / "build/wasi/yosys/share"
CHIPDB_SOURCE = ROOT / "build/wasi/nextpnr/share/himbaechel/gowin"
CHIPDB_FAMILIES = ("GW1N-9C", "GW1NS-4", "GW1NZ-1", "GW2A-18C")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Required synthesis asset is missing or empty: {path}")


def create_share_tar(output):
    if YOSYS_SHARE.is_symlink() or not YOSYS_SHARE.is_dir():
        raise SystemExit(f"Yosys share directory is missing: {YOSYS_SHARE}")

    entries = sorted(
        YOSYS_SHARE.rglob("*"),
        key=lambda path: path.relative_to(YOSYS_SHARE).as_posix(),
    )
    if not entries:
        raise SystemExit(f"Yosys share directory is empty: {YOSYS_SHARE}")

    with tarfile.open(output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for path in entries:
            if path.is_symlink():
                raise SystemExit(f"Symbolic links are not supported in Yosys share data: {path}")
            if not path.is_dir() and not path.is_file():
                raise SystemExit(f"Unsupported Yosys share entry: {path}")
            name = path.relative_to(YOSYS_SHARE).as_posix()
            info = tarfile.TarInfo(name + ("/" if path.is_dir() else ""))
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            info.mode = 0o755 if path.is_dir() else 0o644
            if path.is_dir():
                info.type = tarfile.DIRTYPE
                info.size = 0
                archive.addfile(info)
            else:
                info.type = tarfile.REGTYPE
                info.size = path.stat().st_size
                with path.open("rb") as source:
                    archive.addfile(info, source)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    requested_output = args.output.absolute()
    if requested_output.is_symlink():
        raise SystemExit(f"Refusing symlink synthesis asset output path: {requested_output}")
    output = requested_output.resolve()
    if output == Path(output.anchor) or output == ROOT:
        raise SystemExit(f"Refusing unsafe synthesis asset output path: {output}")

    yosys = ROOT / "build/wasi/yosys/yosys.wasm"
    nextpnr = ROOT / "build/wasi/nextpnr/nextpnr-himbaechel-gowin.wasm"
    for path in (yosys, nextpnr):
        require_file(path)
    for family in CHIPDB_FAMILIES:
        require_file(CHIPDB_SOURCE / f"chipdb-{family}.bin")

    if output.exists():
        if output.is_dir():
            shutil.rmtree(output)
        else:
            output.unlink()
    (output / "chipdb").mkdir(parents=True)
    shutil.copyfile(yosys, output / "yosys.wasm")
    shutil.copyfile(nextpnr, output / "nextpnr-himbaechel-gowin.wasm")
    create_share_tar(output / "yosys-share.tar")
    for family in CHIPDB_FAMILIES:
        shutil.copyfile(
            CHIPDB_SOURCE / f"chipdb-{family}.bin",
            output / "chipdb" / f"chipdb-{family}.bin",
        )

    assets = []
    for path in sorted(
        output.rglob("*"),
        key=lambda entry: entry.relative_to(output).as_posix(),
    ):
        if path.is_file():
            assets.append(
                {
                    "path": path.relative_to(output).as_posix(),
                    "size": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    manifest = {"format_version": 1, "assets": assets}
    (output / "manifest.json").write_text(
        f"{json.dumps(manifest, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output), "assets": len(assets)}, sort_keys=True))


if __name__ == "__main__":
    main()
