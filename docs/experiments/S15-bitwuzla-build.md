# S15 P4 BitwuzlaのMeson診断ビルド

- 状態: WASIの予備ビルドで本体を生成。固定依存だけを使うnative/WASIの清浄ビルドと応答比較は未完了
- 事前基準: [S15共通基準](S15-formal-verification.md)、[追加ソルバーの基準](S15-extra-solver-builds.md)
- 戻り先: [実験索引](README.md)、[形式検証の候補](../research/formal-capabilities.md)

## 目的と範囲

固定Bitwuzla 0.9.1の上流Meson buildを再利用し、native参照版とWASI診断版を作ります。SAT・SMTの判定、浮動小数点の意味、応答の解析を別言語へ移植しません。native版は比較専用で、製品として配布しません。

この記録はビルド経路の診断です。正式5回・A/A 2回、独立監査、SMTBMC/SBY接続、取消・外部期限、製品の配布条件を通過したという意味ではありません。BitwuzlaとBoolectorは製品で無効のままです。

## 固定依存とビルド経路

依存の取得元・固定値は [形式ソースの記録](../research/formal-sources.md#ビルドprofileと無効な依存)と [MPFRの原記録](S15-extra-solver-builds.md)を正とします。driverはBitwuzlaの `cadical.wrap` と `symfpu.wrap` を読み、値を手で複製しません。

- GMP 6.3.0とMPFR 4.2.2の原archiveをSHA-256と照合し、別のprefixへ静的ビルドします。GMPは `--disable-assembly --enable-cxx`、WASIのMPFRは `--disable-thread-safe` を指定します。原license、生成したheader、static libraryのhashをmetadataへ保存します。
- CaDiCaL 2.1.2はwrapのarchive hash、SymFPUはwrapのcommitと照合します。上流のMeson package overlayもhashを記録して適用します。CaDiCaLはMIT、SymFPUは原本のBSD licenseを保持します。
- Mesonの自動取得を `--wrap-mode=nodownload` で禁止します。native/cross machine fileを生成し、GMP/MPFRの実際のinclude・link引数と版がstaging先に一致しなければ停止します。想定外の外部依存やsystem CaDiCaLも拒否します。
- `default_library=static`、`testing=disabled`、`unit_testing=disabled`、`optimization=2`、`strip=false` を固定します。期待する本体は `objects/src/main/bitwuzla` です。生成した全static libraryと本体のサイズ・hashを記録します。

Ubuntu 22.04.5、x86_64、2 CPU、Python 3.12.13、Node v24.21.0、GCC/G++ 11.4.0、WASI SDK 34.0（Clang 23.1.0）、Ninja 1.10.1、pkg-config 0.29.2で診断しました。Mesonは初回の1.9.2から既存lockの1.12.1へ訂正しました。旧版の結果を固定版での検証とは扱いません。

## WASI境界とpatchの理由

vendorを直接編集せず、staging先へ `patch --batch --fuzz=0 -p1` で適用します。全patchの原文snapshotとhashをbuild metadataに残します。

| patch / adapter | 変更する境界 | 成功したふりで代替しない内容 |
|---|---|---|
| `cadical-wasi-process-boundary.patch` | `sys/wait.h`、外部pipe・child process・OS alarm、resource統計 | processとalarmは明示診断後にabort。RSSは利用不可のsentinelとmetadataで区別 |
| `cadical-wasi-random-seed.patch` | host・network・process・時刻に依存する既定乱数seed | WASIで既定constructorを呼べば診断後にabort。明示seedのSAT実装は変更しない |
| `bitwuzla-wasi-time-limit.patch` | CLIのthreadとpthread依存 | 非ゼロの内部time limitは診断後にabort。外部workerの期限とは別機能 |
| `bitwuzla-wasi-rss.patch` | nativeのRSS、`ru_maxrss`、`/proc` | WASIでは原APIの利用不可値0を返す。metadataの `bitwuzla_native_rss_available=false` と合わせ、測定値0とは扱わない |
| `scripts/wasi-meson-compiler.py` | MesonがELF linkerとして生成するarchive grouping引数 | wasm-ldが拒否する完全一致の `-Wl,--start-group` と `-Wl,--end-group` だけを外す。他の引数とエラーはそのままcompilerへ渡す |

Meson 1.12.1はWASI SDKのClangを `ld.lld` と判定しました。WASIをEmscriptenやLinuxと偽らず `system='wasi'` のまま扱い、adapterをmachine fileに記録します。[LLVMのWASM linker文書](https://lld.llvm.org/WebAssembly.html)にある既定の未解決symbol拒否も緩めません。C++のlinkにはcompile時と同じ `-fwasm-exceptions` を渡し、SDKの対応する例外libraryを選びます。

CaDiCaLのCPU時刻はSDKのwall-clock emulationであり、nativeのCPU時間と同一とは扱いません。RSSのsentinelもWASM linear memoryの使用量とは別です。

## 予備試行と失敗の保存

基準commitは `bf2320af846c448d5c72a74483fa8ca0f6954705`、作業中の変更を含む予備試行です。[生CSV](S15-bitwuzla-build-preliminary.csv)に各status、metadata・driver・本体のhash、Meson版、経過秒を原記録から転記しています。正式な同一commitの結果ではありません。

| 試行 | 結果と解釈 |
|---|---|
| native preliminary-01 | 本体は生成したが、stagingに `gmpxx.h` がなくhost headerを使い得た。Mesonも旧版のため認定に使わない |
| WASI preliminary-01 | CaDiCaLの `sys/wait.h` 不在で停止 |
| WASI preliminary-02 | CaDiCaLの既定乱数seedが使う `netdb.h` 不在で停止 |
| WASI preliminary-03 | stagingの `gmpxx.h` 不在で停止。native初回も清浄な依存結果から除外 |
| WASI preliminary-04 | Mesonを1.12.1へ訂正。最終linkでELF group引数と例外libraryの選択が失敗 |
| WASI preliminary-05 | link probeの修正で `getrusage` が検出され、未提供の `ru_maxrss` fieldで停止 |
| WASI preliminary-06 | 本体8,357,412 bytesを生成。SHA-256 `c427675dd43312da81b595efdf2bcfe2cce4ac631de17b249f7bb91a77da9eed`。まだ作業中の版であり認定外 |

原log・metadata・依存・patch snapshotは各 `build/S15/bitwuzla-*-preliminary-*` に保存しています。temporary directoryへ置き換えたり、失敗を成功行へ書き換えたりしません。

## 残る警告と次の採否条件

WASIの `src/util/gmp_utils.cpp:123` と `src/solver/fp/floating_point.cpp:450` に、32 bit limbを32 bit shiftする警告が残ります。どちらも `mp_bits_per_limb == 64` のbranch内であり、今回の32 bit GMPでそのbranchを実行した結果ではありません。警告だけから実行時の誤判定を断定せず、型幅の追加検証を残します。

GMP C++ literalの空白に関する非推奨警告と、CaDiCaLの非trivial型に対する `memset` 警告も保持します。ビルド成功を、警告なし・意味論の認定済みとは扱いません。

まず清浄な同一commitでnative/WASIを生成し、版・help・sat/unsat・値取得・push/pop・EOF・構文エラーとFPの5丸めmode・NaN・array-storeを比較します。現段階の性能値や起動時間を改善の根拠にせず、正式5回・A/A 2回と全列の独立監査は後続の検証とします。

```sh
python3 scripts/build-solver-probe.py --solver bitwuzla --runtime native \
  --meson "$MESON_BIN" --jobs 2 --out build/S15/bitwuzla-native-clean-01
python3 scripts/build-solver-probe.py --solver bitwuzla --runtime wasi \
  --meson "$MESON_BIN" --jobs 2 --out build/S15/bitwuzla-wasi-clean-01
node scripts/probe-extra-solver-cli.mjs --solver bitwuzla \
  --native build/S15/bitwuzla-native-clean-01 --wasi build/S15/bitwuzla-wasi-clean-01 \
  --out build/S15/bitwuzla-cli-clean-01
```

`MESON_BIN` は既存 `requirements-formal-build.txt` のhash lockで導入した実行ファイルです。出力先が存在すればdriverと計測器は上書きせず停止します。予期しない終了やunsupportedな境界は通常のsat/unsatとは別に検査します。Tang Nano実機は本リポジトリでは試していません。
