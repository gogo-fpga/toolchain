#!/usr/bin/env python3

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

from zstd_cli import require_pinned_zstd_version


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


def compress_file(source, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as compressed:
        result = subprocess.run(
            ["zstd", "-19", "-q", "--no-progress", "-c", str(source)],
            check=False,
            stdout=compressed,
            stderr=subprocess.PIPE,
            text=True,
        )
    if result.returncode != 0:
        output.unlink(missing_ok=True)
        detail = result.stderr.strip()
        raise SystemExit(f"Could not compress synthesis asset {source}: {detail}")


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
    parser.add_argument("--dist-output", type=Path)
    args = parser.parse_args()
    try:
        require_pinned_zstd_version(ROOT)
    except RuntimeError as error:
        raise SystemExit(str(error)) from error

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

    asset_paths = sorted(
        (path for path in output.rglob("*") if path.is_file()),
        key=lambda entry: entry.relative_to(output).as_posix(),
    )
    assets = []
    for path in asset_paths:
        relative_path = path.relative_to(output).as_posix()
        compressed_path = output / f"{relative_path}.zst"
        compress_file(path, compressed_path)
        assets.append(
            {
                "path": relative_path,
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
                "encoding": "zstd",
                "compressed_size": compressed_path.stat().st_size,
                "compressed_sha256": sha256_file(compressed_path),
            }
        )
    manifest = {"format_version": 1, "assets": assets}
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        f"{json.dumps(manifest, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )

    if args.dist_output:
        requested_dist_output = args.dist_output.absolute()
        if requested_dist_output.is_symlink():
            raise SystemExit(
                f"Refusing symlink synthesis distribution output path: {requested_dist_output}"
            )
        dist_output = requested_dist_output.resolve()
        if (
            dist_output in (Path(dist_output.anchor), ROOT, output)
            or dist_output in output.parents
            or output in dist_output.parents
        ):
            raise SystemExit(
                f"Refusing unsafe synthesis distribution output path: {dist_output}"
            )
        if dist_output.exists():
            if dist_output.is_dir():
                shutil.rmtree(dist_output)
            else:
                dist_output.unlink()
        dist_output.mkdir(parents=True)
        shutil.copyfile(manifest_path, dist_output / "manifest.json")
        for asset in assets:
            relative_path = Path(f"{asset['path']}.zst")
            source = output / relative_path
            destination = dist_output / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)

    print(json.dumps({"output": str(output), "assets": len(assets)}, sort_keys=True))


if __name__ == "__main__":
    main()
