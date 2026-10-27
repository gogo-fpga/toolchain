import assert from "node:assert/strict";
import test from "node:test";
import { readUstar } from "../../web/lib/ustar.mjs";

const BLOCK_SIZE = 512;
const encoder = new TextEncoder();

function writeText(bytes, start, length, text) {
  bytes.set(encoder.encode(text), start);
  assert.ok(encoder.encode(text).length <= length);
}

function writeOctal(bytes, start, length, value) {
  writeText(bytes, start, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function createUstar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = new Uint8Array(BLOCK_SIZE);
    writeText(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    const contents = entry.contents ?? new Uint8Array();
    writeOctal(header, 124, 12, contents.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = entry.type ?? 48;
    writeText(header, 257, 6, "ustar\0");
    writeText(header, 263, 2, "00");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header);
    if (contents.length > 0) {
      const padded = new Uint8Array(
        Math.ceil(contents.length / BLOCK_SIZE) * BLOCK_SIZE,
      );
      padded.set(contents);
      blocks.push(padded);
    }
  }
  blocks.push(new Uint8Array(BLOCK_SIZE * 2));
  const length = blocks.reduce((total, block) => total + block.length, 0);
  const archive = new Uint8Array(length);
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
}

test("ustar reader extracts regular files and directories", () => {
  const data = Uint8Array.of(1, 2, 3, 4);
  const archive = createUstar([
    { name: "share/", type: 53 },
    { name: "share/gowin/", type: 53 },
    { name: "share/gowin/cells.v", contents: data },
  ]);

  assert.deepEqual(readUstar(archive), {
    share: { gowin: { "cells.v": data } },
  });
});

test("ustar reader rejects a corrupt header", () => {
  const archive = createUstar([{ name: "cells.v", contents: Uint8Array.of(1) }]);
  archive[0] ^= 1;

  assert.throws(() => readUstar(archive), /checksum/);
});

test("ustar reader rejects entry types other than files and directories", () => {
  const archive = createUstar([{ name: "link", type: 50 }]);

  assert.throws(() => readUstar(archive), /entry type/);
});
