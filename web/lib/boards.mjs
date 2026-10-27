export const BOARDS = Object.freeze([
  Object.freeze({
    id: "tangnano1k",
    label: "Tang Nano 1K",
    part: "GW1NZ-1",
    idcode: 0x0100681b,
    flashBytes: null,
    writeTargets: ["SRAM", "内蔵フラッシュ"],
  }),
  Object.freeze({
    id: "tangnano4k",
    label: "Tang Nano 4K",
    part: "GW1NSR-4C",
    idcode: 0x0100981b,
    flashBytes: 4 * 1024 * 1024,
    writeTargets: ["SRAM", "内蔵フラッシュ"],
  }),
  Object.freeze({
    id: "tangnano9k",
    label: "Tang Nano 9K",
    part: "GW1N(R)-9C",
    idcode: 0x0100481b,
    flashBytes: 4 * 1024 * 1024,
    writeTargets: ["SRAM", "内蔵フラッシュ"],
  }),
  Object.freeze({
    id: "tangnano20k",
    label: "Tang Nano 20K",
    part: "GW2A(R)-18(C)",
    idcode: 0x0000081b,
    flashBytes: 8 * 1024 * 1024,
    writeTargets: ["SRAM", "外付け SPI フラッシュ"],
  }),
]);

export function getBoard(id) {
  return BOARDS.find((board) => board.id === id) ?? null;
}
