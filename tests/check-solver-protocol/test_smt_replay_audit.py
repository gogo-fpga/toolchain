import copy
import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("smt_replay_audit", Path(__file__).resolve().parents[2] / "scripts/audit-smt-replay.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class SmtReplayAuditTest(unittest.TestCase):
    def waveform(self):
        return b"""$timescale 1ps $end
$scope module __formal_replay $end
$scope module dut $end
$var wire 1 ! clk $end
$var reg 3 # q [2:0] $end
$upscope $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
0!
b0 #
$end
#2000
1!
b1 #
#3000
0!
#4000
"""

    def test_waveform_observations_expand_vectors_without_discarding_clock_timing(self):
        value, end, times, states, names = AUDIT.waveform(self.waveform())
        self.assertEqual(end, 4)
        self.assertEqual(times, [0, 2000, 3000, 4000])
        self.assertEqual(value(["__formal_replay", "dut", "q"], 1), "000")
        self.assertEqual(value(["__formal_replay", "dut", "q"], 4), "001")
        self.assertEqual(value(["__formal_replay", "dut", "clk"], 2), "1")
        self.assertEqual(value(["__formal_replay", "dut", "clk"], 3), "0")
        with self.assertRaises(ValueError):
            value(["__formal_replay", "dut", "missing"], 1)
        with self.assertRaises(ValueError):
            value(["__formal_replay", "dut", "q"], 5)

    def test_waveform_parser_fails_on_missing_unknown_duplicate_or_malformed_data(self):
        mutations = [
            lambda raw: raw.replace(b"$timescale 1ps $end", b""),
            lambda raw: raw.replace(b"#0", b"#1"),
            lambda raw: raw.replace(b"#3000", b"#2000"),
            lambda raw: raw.replace(b"b1 #", b"b1111 #"),
            lambda raw: raw.replace(b"b1 #", b"b? #"),
            lambda raw: raw.replace(b"b1 #", b"b1 missing"),
            lambda raw: raw.replace(b"$upscope $end", b"", 1),
            lambda raw: raw.replace(b"$var reg 3 # q [2:0] $end", b"$var reg 3 # q [2:0] $end\n$var reg 3 $ q [2:0] $end"),
        ]
        for modify in mutations:
            with self.subTest(modify=modify), self.assertRaises((ValueError, KeyError)):
                AUDIT.waveform(modify(self.waveform()))

    def test_only_PI_order_is_benign_in_the_independent_comparator(self):
        first = "  reg [0:0] PI_z;\n  reg [0:0] PI_a;\n  top UUT (\n    .z(PI_z),\n    .a(PI_a)\n  );\n"
        other = "  reg [0:0] PI_a;\n  reg [0:0] PI_z;\n  top UUT (\n    .a(PI_a),\n    .z(PI_z)\n  );\n"
        self.assertEqual(AUDIT.normalize_tb(first), AUDIT.normalize_tb(other))
        for changed in [other.replace(".a(PI_a)", ".a(PI_z)"), other.replace("[0:0]", "[1:0]", 1), other + "assign clock = 0;\n"]:
            self.assertNotEqual(AUDIT.normalize_tb(first), AUDIT.normalize_tb(changed))

    def test_unconstrained_unknown_and_unsupported_state_cannot_qualify(self):
        module = {"netnames": {"q": {"bits": [1], "attributes": {"init": "0"}}},
                  "cells": {"r": {"type": "$dff", "connections": {"Q": [1]}}}}
        self.assertEqual(AUDIT.initialized_state(module), {1: "0"})
        for value in ["x", "z", "00", None, True]:
            changed = copy.deepcopy(module)
            changed["netnames"]["q"]["attributes"]["init"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                AUDIT.initialized_state(changed)
        for cell_type in ["$mem_v2", "$memwr_v2", "$anyinit", "$dlatch"]:
            changed = copy.deepcopy(module)
            changed["cells"]["r"]["type"] = cell_type
            with self.subTest(cell_type=cell_type), self.assertRaises(ValueError):
                AUDIT.initialized_state(changed)
        changed = copy.deepcopy(module)
        del changed["netnames"]["q"]["attributes"]["init"]
        with self.assertRaises(ValueError):
            AUDIT.initialized_state(changed)


if __name__ == "__main__":
    unittest.main()
