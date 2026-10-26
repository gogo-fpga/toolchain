#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_dir="$root/tests/fixtures"
build_dir="$root/build/fixtures"
venv="$build_dir/venv"

mkdir -p "$build_dir"
python3 -m venv "$venv"
python="$venv/bin/python"

"$python" -m pip install -r "$fixture_dir/requirements.txt"
"$python" -m pip check

yosys="$venv/bin/yowasp-yosys"
gowin_pack="$venv/bin/gowin_pack"
nextpnr="$venv/bin/yowasp-nextpnr-himbaechel"
if [[ ! -x "$nextpnr" ]]; then
  nextpnr="$venv/bin/yowasp-nextpnr-himbaechel-gowin"
fi
for tool in "$yosys" "$nextpnr" "$gowin_pack"; do
  if [[ ! -x "$tool" ]]; then
    printf 'Required fixture tool is missing: %s\n' "$tool" >&2
    exit 1
  fi
done

build_board() {
  local board="$1"
  local idcode="$2"
  local family="$3"
  local device="$4"
  local family_option="${5:-}"
  local pack_device="${6:-$device}"
  local json="$build_dir/$board.json"
  local routed="$build_dir/$board-routed.json"
  local bitstream="$build_dir/$board.fs"
  local -a nextpnr_args=(
    --json "$json"
    --write "$routed"
    --device "$device"
    --freq 27
    --vopt "cst=$fixture_dir/$board.cst"
  )

  "$yosys" -p "read_verilog $fixture_dir/blinky.v; synth_gowin -family $family -json $json"
  if [[ -n "$family_option" ]]; then
    nextpnr_args+=(--vopt "$family_option")
  fi
  "$nextpnr" "${nextpnr_args[@]}"
  "$gowin_pack" -d "$pack_device" -o "$bitstream" "$routed"
  "$python" - "$bitstream" "$idcode" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
expected = int(sys.argv[2], 16)
header = []
for line in path.read_text().splitlines():
    if line.startswith("/"):
        continue
    if len(line) >= 8 and (int(line[:8], 2) & 0x7f) == 0x06:
        header.append(int(line, 2) & 0xffffffff)
if len(header) != 1:
    raise SystemExit(f"{path}: expected one header IDCODE, found {header!r}")
if header[0] != expected:
    raise SystemExit(
        f"{path}: header IDCODE 0x{header[0]:08x} does not match "
        f"expected 0x{expected:08x}"
    )
print(f"{path}: header IDCODE 0x{header[0]:08x} verified")
PY
}

build_board tangnano1k 0100681b gw1n GW1NZ-LV1QN48C6/I5
build_board tangnano4k 0100981b gw1n GW1NSR-LV4CQN48PC7/I6
build_board tangnano9k 1100481b gw1n GW1NR-LV9QN88PC6/I5 family=GW1N-9C GW1N-9C
build_board tangnano20k 0000081b gw2a GW2AR-LV18QN88C8/I7 family=GW2A-18C GW2A-18C
