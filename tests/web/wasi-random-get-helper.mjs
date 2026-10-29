import { webcrypto } from "node:crypto";

const randomSource = globalThis.crypto ?? webcrypto;

export function installWasiRandomGet(decoderBytes) {
  const decoderBytesWithWasiImports = new WeakSet(decoderBytes);
  const nativeInstantiate = WebAssembly.instantiate.bind(WebAssembly);

  WebAssembly.instantiate = async (source, imports) => {
    if (!decoderBytesWithWasiImports.has(source)) {
      return imports === undefined
        ? nativeInstantiate(source)
        : nativeInstantiate(source, imports);
    }

    let instance;
    const randomGet = (pointer, length) => {
      const memory = instance?.exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) return 21;
      let view;
      try {
        view = new Uint8Array(memory.buffer, pointer >>> 0, length >>> 0);
      } catch {
        return 21;
      }
      for (let offset = 0; offset < view.length; offset += 65_536) {
        randomSource.getRandomValues(view.subarray(offset, Math.min(offset + 65_536, view.length)));
      }
      return 0;
    };

    const result = await nativeInstantiate(source, {
      ...(imports ?? {}),
      wasi_snapshot_preview1: {
        ...(imports?.wasi_snapshot_preview1 ?? {}),
        random_get: randomGet,
      },
    });
    instance = result.instance;
    return result;
  };
}
