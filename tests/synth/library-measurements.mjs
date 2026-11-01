import assert from "node:assert/strict";

export function parseDeviceUtilization(log) {
  const sections = log.split("Info: Device utilisation:");
  assert.equal(sections.length, 2, "Expected one nextpnr device utilization table");
  const resources = {};
  let terminated = false;
  for (const line of sections[1].replace(/\n$/, "").split("\n")) {
    if (/^(?:Info:)?\s*$/.test(line)) {
      if (Object.keys(resources).length > 0) {
        terminated = true;
        break;
      }
      continue;
    }
    const match = /^Info:\s+(\w+):\s+(\d+)\/\s*(\d+)\s+(\d+)%\s*$/.exec(line);
    assert.ok(match, `Malformed device utilization row: ${line}`);
    const [, name, usedText, totalText, percentText] = match;
    assert.ok(!["__proto__", "constructor", "prototype"].includes(name), "Unsafe resource name");
    assert.ok(!Object.hasOwn(resources, name), `Duplicate resource ${name}`);
    const used = Number(usedText);
    const total = Number(totalText);
    assert.ok(Number.isSafeInteger(used) && Number.isSafeInteger(total) && total > 0 && total >= used, `Invalid capacity for ${name}`);
    assert.equal(Number(percentText), Math.floor(100 * used / total), `Invalid percentage for ${name}`);
    resources[name] = { used, total };
  }
  assert.ok(terminated, "Unterminated device utilization table");
  for (const name of ["LUT4", "DFF", "BSRAM"]) {
    assert.ok(Object.hasOwn(resources, name) && resources[name].total > 0, `Missing device capacity for ${name}`);
  }
  assert.ok(resources.LUT4.used > 0 && resources.DFF.used > 0, "The representative has no retained logic or state");
  return resources;
}
