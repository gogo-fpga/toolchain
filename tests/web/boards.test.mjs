import assert from "node:assert/strict";
import test from "node:test";

import { BOARDS, getBoard } from "../../web/lib/boards.mjs";

test("BOARDS contains the supported Tang Nano devices", () => {
  assert.deepEqual(BOARDS, [
    {
      id: "tangnano1k",
      label: "Tang Nano 1K",
      part: "GW1NZ-1",
      nextpnrDevice: "GW1NZ-LV1QN48C6/I5",
      packDevice: "GW1NZ-LV1QN48C6/I5",
      nextpnrFamily: "GW1NZ-1",
      idcode: 0x0100681b,
      flashBytes: null,
      writeTargets: ["SRAM", "内蔵フラッシュ"],
    },
    {
      id: "tangnano4k",
      label: "Tang Nano 4K",
      part: "GW1NSR-4C",
      nextpnrDevice: "GW1NSR-LV4CQN48PC7/I6",
      packDevice: "GW1NSR-LV4CQN48PC7/I6",
      nextpnrFamily: "GW1NS-4",
      idcode: 0x0100981b,
      flashBytes: 4 * 1024 * 1024,
      writeTargets: ["SRAM", "内蔵フラッシュ"],
    },
    {
      id: "tangnano9k",
      label: "Tang Nano 9K",
      part: "GW1N(R)-9C",
      nextpnrDevice: "GW1NR-LV9QN88PC6/I5",
      packDevice: "GW1N-9C",
      nextpnrFamily: "GW1N-9C",
      idcode: 0x0100481b,
      flashBytes: 4 * 1024 * 1024,
      writeTargets: ["SRAM", "内蔵フラッシュ"],
    },
    {
      id: "tangnano20k",
      label: "Tang Nano 20K",
      part: "GW2A(R)-18(C)",
      nextpnrDevice: "GW2AR-LV18QN88C8/I7",
      packDevice: "GW2A-18C",
      nextpnrFamily: "GW2A-18C",
      idcode: 0x0000081b,
      flashBytes: 8 * 1024 * 1024,
      writeTargets: ["SRAM", "外付け SPI フラッシュ"],
    },
  ]);
  assert.equal(Object.isFrozen(BOARDS), true);
  assert.equal(getBoard("tangnano9k").part, "GW1N(R)-9C");
  assert.equal(getBoard("missing"), null);
});
