import assert from "node:assert/strict";
import test from "node:test";
import { parseDeviceUtilization } from "./library-measurements.mjs";

const log = "Info: Device utilisation:\nInfo: LUT4: 217/ 1152 18%\nInfo: DFF: 81/ 864 9%\nInfo: BSRAM: 0/ 4 0%\nInfo:\n";

test("resource measurements retain exact used and available counts", () => {
  assert.deepEqual(parseDeviceUtilization(log), {
    LUT4: { used: 217, total: 1152 }, DFF: { used: 81, total: 864 }, BSRAM: { used: 0, total: 4 },
  });
});

test("unparseable, absent, repeated, exceeded, or optimized-away resources fail closed", () => {
  for (const broken of [
    "", log + log, log.replace("LUT4", "UNKNOWN"), log.replace("217/ 1152", "1153/ 1152"),
    log.replace("217/ 1152", "0/ 1152"), log.replace("81/ 864", "0/ 864"),
    log.replace("BSRAM: 0/ 4", "BSRAM: invalid"),
    log.replace("Info:\n", "Info: DSP: invalid\nInfo:\n"),
    log.replace("Info:\n", "Info: DSP: 0/ 0 0%\nInfo:\n"),
    log.replace("Info:\n", "Info: __proto__: 1/ 10 10%\nInfo:\n"),
    log.replace("18%", "19%"), log.replace("Info:\n", ""),
    log.replace("Info: DFF", "Info: LUT4: 1/ 10 10%\nInfo: DFF"),
  ]) assert.throws(() => parseDeviceUtilization(broken), assert.AssertionError);
});
