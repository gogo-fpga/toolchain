# S11 NVC の WASM 化の基準（試す前に固定）

- 決定日：2026-10-31
- 対象：NVC r1.23.1（`vendor/nvc`、shallow submodule）。LLVM は使わない（`--disable-llvm`）。
- 目的：NVC の解析・展開・シミュレーションを WASM にし、ブラウザーと Node で動かせるかを確かめる。

## 方式

1. WASI SDK 34（S10 と同じ。例外が要れば EH 版）で試す。dlopen・libffi の外部関数呼び出しは、使わない経路として patch（`patches/nvc/`）で塞ぐ。標準ライブラリー（std・ieee など）は、ネイティブの NVC で事前に作って資材にする。
2. コルーチン（ucontext）と pthread は、WASI で使えないことをログで示せた場合に限り、Emscripten（fiber、または Asyncify・JSPI）に切り替える。
3. 打ち切り：次のどれかに当たったら、それ以上は進めず、失敗として記録して終える（ユーザーの判断：Icarus と波形だけで T4 を終え、T5 に進む）。
   - コルーチンや JIT の置き換えが、NVC の本体の多数のファイルにわたる変更になる
   - 2 の Emscripten の方式でもリンクまたは実行ができない
   - 作業の合計が、1 セッションの目安（約 1 日）を超える見込みになる

## 合格の条件（すべて満たすこと）

1. ビルドが成功する。
2. ゼロからのビルドを 2 回行い、WASM がバイト単位で一致する。
3. 例すべてで、ネイティブ版（同じ commit、`--disable-llvm`）と、`report` の出力と波形（FST、または VCD）がバイト単位で一致する。
4. 負の対照：構文の誤り、未定義の entity、`assert ... severity failure` で、ネイティブ版と同じ失敗になる。WASM を 1 バイト壊すと失敗する。
5. テストを 5 回続けて通す。

## 例

- 4 ボードの VHDL テンプレートの counter の testbench（`wait for` で数周期）
- 組み合わせ回路、FSM、`numeric_std`、package、generic、`report` と `assert`

## 記録

- 成功しても失敗しても `docs/experiments/S11-nvc-wasm.md` に残す。失敗のときは、止まった場所、ログ、試した方式、打ち切りの理由を書き、RESEARCH.md にも要約を書く。
