# サードパーティーのライセンス

本リポジトリー自体は BSD-3-Clause です。以下に、配布物に含める第三者のライセンスを記録します。

以下の固定版を使用しています。コミットは `vendor/` の gitlink に記録した値です。

| 部品 | 固定版 / commit | ライセンス | WASM への静的リンク / 開発用 | web zip 内のライセンスファイル |
|---|---|---|---|---|
| openFPGALoader | v1.2.0 / `befbab4f646207dbaf1daf8b144dd980ad283dd5` | Apache-2.0 | WASM に静的リンク | `licenses/openFPGALoader-LICENSE` |
| libusb | v1.0.30 / `87a55632db62c9bdc58cd31d3ccfa673f1bb017f` | LGPL-2.1-or-later | WASM に静的リンク | `licenses/libusb-COPYING` |
| libftdi | 1.6rc1 / `92d657bcb543a9622947d984d4a8e725fb680e8c` | LGPL-2.1（ライブラリ部分） | WASM に静的リンク | `licenses/libftdi-COPYING.LIB` |
| zlib | v1.3.2 / `da607da739fa6047df13e66a2af6b8bec7c2a498` | zlib | WASM に静的リンク | `licenses/zlib-LICENSE` |
| Yosys | v0.70 / `28ba3cb926fe376fa05ebfc1b921747d011d4557` | ISC | WASI WASM に静的リンク | `licenses/yosys-COPYING` |
| ABC | `6c5104934c90eb3cdef9ea063318f7588908a185` | Regents of the University of California の許諾条件 | Yosys WASM に静的リンク | `licenses/abc-copyright.txt` |
| cxxopts | `4bf61f08697b110d9e3991864650a405b3dd515d` | MIT | Yosys WASM に静的リンク | `licenses/cxxopts-LICENSE` |
| fmt | `a00f82c6b66dcae15503ba19c1598b2733057dea` | MIT | Yosys WASM に静的リンク | `licenses/fmt-LICENSE` |
| wasi-sdk | 34.0 / `b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4`。ライセンス原文の source commit: `5a0bf653a1a06e1c18867567c5937006d3394a69` | Apache-2.0 | ビルド用 SDK | `licenses/wasi-sdk-LICENSE` |
| LLVM runtime | `895aa2c896ada719451be2e3673c83da8ddf1141` | Apache-2.0 with LLVM Exceptions | libc++、libc++abi、libunwind などを Yosys WASM に静的リンク | `licenses/wasi-sdk-llvm-LICENSE.TXT` |
| wasi-libc | `2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13` | Apache-2.0 with LLVM Exceptions、Apache-2.0、MIT と同梱部品のライセンス | libc を Yosys WASM に静的リンク | `licenses/wasi-libc-LICENSE*` |
| Emscripten のランタイムと libc | 6.0.13 / `35659964bc2762fffec0d257997fb61475f765b7` | MIT、University of Illinois/NCSA、LLVM の Apache-2.0 with LLVM Exceptions | ランタイムと libc の一部を WASM / mjs に含む。emcc はビルド用 | `licenses/emscripten-LICENSE`、`licenses/emscripten-musl-COPYRIGHT`、`licenses/emscripten-libcxx-LICENSE.TXT`、`licenses/emscripten-libcxxabi-LICENSE.TXT`、`licenses/emscripten-llvm-libc-LICENSE.TXT`、`licenses/emscripten-compiler-rt-LICENSE.TXT`、`licenses/emscripten-libunwind-LICENSE.TXT` |
| CodeMirror 6（`codemirror` 6.0.2、`@codemirror/state` 6.7.6、`@codemirror/view` 6.43.15、`@codemirror/language` 6.13.1、`@codemirror/legacy-modes` 6.5.5、`@codemirror/lint` 6.9.7、`@codemirror/autocomplete` 6.20.4、`@codemirror/commands` 6.11.1） | npm 固定版 | MIT | `editor.bundle.mjs` に含む | npm パッケージに同梱 |
| fflate | 0.8.3 | MIT | `project-zip.bundle.mjs` に含む | `licenses/fflate-LICENSE` |

Emscripten SDK の `upstream/emscripten/LICENSE` は Emscripten の MIT と University of Illinois/NCSA のライセンス本文を含む文書です。また、Node.js の一部利用と musl の MIT ライセンスへの案内も記載されています。musl の本文は `system/lib/libc/musl/COPYRIGHT` です。libc++、libc++abi、llvm-libc、compiler-rt、libunwind は SDK 内に個別のライセンスファイルがあるため、上表のとおり別に同梱します。

Yosys の `COPYING` は ISC License の本文です。ABC の `copyright.txt` は University of California, Berkeley の許諾条件を記載したファイルです。WASI SDK のアーカイブにはライセンス本文が含まれないため、wasi-sdk 34 の source commit と、その commit が参照する LLVM、wasi-libc の各 commit からライセンス文書を取得し、リポジトリーと配布 zip に収録する方針です。wasi-libc の原文には主要ライセンスだけでなく、musl、cloudlibc、musl-fts、wasi-headers の許諾文書も含まれています。

## 配布物に含まないもの

- yomiyasu: 文書の推敲に使う開発用ツールです。
- Playwright: E2E テストに使う開発用ツールです。
- esbuild: CodeMirror のバンドルに使うビルド用ツールです。配布物には含めません。

## LGPL ライブラリの再リンク

ソース tarball には、使用した固定版の libusb と libftdi の完全なソースを含めます。改変した LGPL ライブラリを使う場合は、tarball 内の `vendor/libusb` または `vendor/libftdi` のソースを置き換え、`scripts/build-wasm.sh` と `scripts/build-web.sh` を実行して再ビルドしてください。生成した WASM を含むアプリを配布する際は、ライブラリの改変に応じて LGPL の条件を満たしてください。
