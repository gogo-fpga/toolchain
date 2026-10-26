# サードパーティーのライセンス

本リポジトリー自体は BSD-3-Clause です。以下に、配布物に含める第三者のライセンスを記録します。

以下の固定版を使用しています。コミットは `vendor/` の gitlink に記録した値です。

| 部品 | 固定版 / commit | ライセンス | WASM への静的リンク / 開発用 | web zip 内のライセンスファイル |
|---|---|---|---|---|
| openFPGALoader | v1.2.0 / `befbab4f646207dbaf1daf8b144dd980ad283dd5` | Apache-2.0 | WASM に静的リンク | `licenses/openFPGALoader-LICENSE` |
| libusb | v1.0.30 / `87a55632db62c9bdc58cd31d3ccfa673f1bb017f` | LGPL-2.1-or-later | WASM に静的リンク | `licenses/libusb-COPYING` |
| libftdi | 1.6rc1 / `92d657bcb543a9622947d984d4a8e725fb680e8c` | LGPL-2.1（ライブラリ部分） | WASM に静的リンク | `licenses/libftdi-COPYING.LIB` |
| zlib | v1.3.2 / `da607da739fa6047df13e66a2af6b8bec7c2a498` | zlib | WASM に静的リンク | `licenses/zlib-LICENSE` |
| Emscripten のランタイムと libc | 6.0.13 / `35659964bc2762fffec0d257997fb61475f765b7` | MIT、University of Illinois/NCSA、LLVM の Apache-2.0 with LLVM Exceptions | ランタイムと libc の一部を WASM / mjs に含む。emcc はビルド用 | `licenses/emscripten-LICENSE`、`licenses/emscripten-musl-COPYRIGHT`、`licenses/emscripten-libcxx-LICENSE.TXT`、`licenses/emscripten-libcxxabi-LICENSE.TXT`、`licenses/emscripten-llvm-libc-LICENSE.TXT`、`licenses/emscripten-compiler-rt-LICENSE.TXT`、`licenses/emscripten-libunwind-LICENSE.TXT` |

Emscripten SDK の `upstream/emscripten/LICENSE` は Emscripten の MIT と University of Illinois/NCSA のライセンス本文を含む文書です。また、Node.js の一部利用と musl の MIT ライセンスへの案内も記載されています。musl の本文は `system/lib/libc/musl/COPYRIGHT` です。libc++、libc++abi、llvm-libc、compiler-rt、libunwind は SDK 内に個別のライセンスファイルがあるため、上表のとおり別に同梱します。

## 配布物に含まないもの

- yomiyasu: 文書の推敲に使う開発用ツールです。
- Playwright: E2E テストに使う開発用ツールです。

## LGPL ライブラリの再リンク

ソース tarball には、使用した固定版の libusb と libftdi の完全なソースを含めます。改変した LGPL ライブラリを使う場合は、tarball 内の `vendor/libusb` または `vendor/libftdi` のソースを置き換え、`scripts/build-wasm.sh` と `scripts/build-web.sh` を実行して再ビルドしてください。生成した WASM を含むアプリを配布する際は、ライブラリの改変に応じて LGPL の条件を満たしてください。
