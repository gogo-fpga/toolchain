function safePath(path) {
  return typeof path === "string" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every(
      (part) => part.length > 0 && part !== "." && part !== "..",
    );
}

export function verifyManifest(manifest) {
  if (
    manifest?.format_version !== 1 ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error("Synthesis asset manifest is invalid");
  }
  const assets = new Map();
  for (const asset of manifest.assets) {
    if (
      !safePath(asset?.path) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      (asset.encoding !== undefined && asset.encoding !== "zstd") ||
      (asset.encoding === "zstd" &&
        (!Number.isSafeInteger(asset.compressed_size) ||
          asset.compressed_size <= 0 ||
          !/^[0-9a-f]{64}$/.test(asset.compressed_sha256)))
    ) {
      throw new Error("Synthesis asset manifest contains an invalid entry");
    }
    if (assets.has(asset.path)) {
      throw new Error(`Synthesis asset manifest repeats ${asset.path}`);
    }
    assets.set(asset.path, asset);
  }
  return assets;
}

export { safePath };
