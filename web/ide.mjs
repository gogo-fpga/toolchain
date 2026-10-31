import { createOpfsStore } from "./lib/project-store.mjs";
import {
  findConstraintBoardMismatch,
  validatePath,
  validateProjectName,
} from "./lib/project.mjs";
import { createBlinkTemplate } from "./lib/templates.mjs";
import {
  exportProjectZip,
  importProjectZip,
} from "./lib/project-zip.bundle.mjs";
import { createHdlEditor, languageForPath } from "./editor/editor.bundle.mjs";
import { createBuildRunner } from "./lib/build-runner.mjs";
import { parseToolDiagnostics } from "./lib/tool-diagnostics.mjs";
import { createSimRunner } from "./lib/sim-runner.mjs";

const UI_STATE_PREFIX = "toolchain.ide.";

function decodeContent(content) {
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
}

function templateForPath(path) {
  if (path.endsWith(".v")) {
    return "// 最小の例です。ピン割り当ては含みません。\nmodule top;\nendmodule\n";
  }
  if (path.endsWith(".vhd") || path.endsWith(".vhdl")) {
    return [
      "-- 最小の例です。ピン割り当ては含みません。",
      "library ieee;",
      "use ieee.std_logic_1164.all;",
      "",
      "entity top is",
      "end entity;",
      "",
      "architecture rtl of top is",
      "begin",
      "end architecture;",
      "",
    ].join("\n");
  }
  if (path.endsWith(".cst")) return "// ピン割り当ては未設定です。\n";
  return path.endsWith(".fs") ? new Uint8Array() : "";
}

function readUiState(name, project) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`${UI_STATE_PREFIX}${name}`) ?? "null",
    );
    const filePaths = new Set(
      project.files.filter(({ path }) => !path.endsWith(".fs")).map(({ path }) => path),
    );
    const openTabs = Array.isArray(saved?.openTabs)
      ? [...new Set(saved.openTabs.filter((path) => filePaths.has(path)))]
      : [];
    const activeTab = filePaths.has(saved?.activeTab)
      ? saved.activeTab
      : openTabs[0] ?? null;
    return { openTabs, activeTab };
  } catch {
    return { openTabs: [], activeTab: null };
  }
}

export function initializeIde({
  form,
  boardSelect,
  programLog,
  BOARDS,
  onFsSourceChange = () => {},
  onBuildStateChange = () => {},
  onSimulationStateChange = () => {},
  canStartSimulation = () => true,
}) {
  const store = createOpfsStore(navigator.storage);
  const projectName = document.querySelector("#project-name");
  const projectSelect = document.querySelector("#project-select");
  const projectActionStatus = document.querySelector("#project-action-status");
  const newProjectButton = document.querySelector("#new-project-button");
  const exportProjectButton = document.querySelector("#export-project-button");
  const importProjectButton = document.querySelector("#import-project-button");
  const projectZipInput = document.querySelector("#project-zip-input");
  const projectStatus = document.querySelector("#project-status");
  const boardFpga = document.querySelector("#board-fpga");
  const boardIdcode = document.querySelector("#board-idcode");
  const boardTarget = document.querySelector("#board-target");
  const boardConstraintWarning = document.querySelector("#board-constraint-warning");
  const fileList = document.querySelector("#file-list");
  const addFileButton = document.querySelector("#add-file-button");
  const renameFileButton = document.querySelector("#rename-file-button");
  const deleteFileButton = document.querySelector("#delete-file-button");
  const fileTabs = document.querySelector("#editor-tabs");
  const editorMount = document.querySelector("#editor-mount");
  const problemList = document.querySelector("#problem-list");
  const problemEmpty = document.querySelector("#problem-empty");
  const fileDialog = document.querySelector("#file-dialog");
  const fileDialogHeading = document.querySelector("#file-dialog-heading");
  const filePathInput = document.querySelector("#file-path-input");
  const fileUploadField = document.querySelector("#file-upload-field");
  const fileContentInput = document.querySelector("#file-content-input");
  const filePathError = document.querySelector("#file-path-error");
  const filePathSaveButton = document.querySelector("#file-path-save");
  const filePathCancelButton = document.querySelector("#file-path-cancel");
  const fileInput = document.querySelector("#bitstream-file");
  const fsSource = document.querySelector("#fs-source");
  const fsFileInfo = document.querySelector("#fs-file-info");
  const localFsField = document.querySelector("#local-fs-field");
  const newProjectDialog = document.querySelector("#new-project-dialog");
  const newProjectNameInput = document.querySelector("#new-project-name");
  const newProjectBoardSelect = document.querySelector("#new-project-board");
  const newProjectLanguageSelect = document.querySelector("#new-project-language");
  const newProjectStandardField = document.querySelector("#new-project-standard-field");
  const newProjectStandardSelect = document.querySelector("#new-project-standard");
  const newProjectError = document.querySelector("#new-project-error");
  const newProjectCreateButton = document.querySelector("#new-project-create");
  const newProjectCancelButton = document.querySelector("#new-project-cancel");
  const tabButtons = [...document.querySelectorAll("[data-bottom-tab]")];
  const tabPanels = [...document.querySelectorAll("[data-bottom-panel]")];
  const toggleFilesButton = document.querySelector("#toggle-files-pane");
  const toggleBoardButton = document.querySelector("#toggle-board-pane");
  const filesPane = document.querySelector("#files-pane");
  const boardPane = document.querySelector("#board-pane");
  const closeFilesPaneButton = document.querySelector("#close-files-pane");
  const closeBoardPaneButton = document.querySelector("#close-board-pane");
  const synthesisButton = document.querySelector("#synthesis-button");
  const synthesisStage = document.querySelector("#synthesis-stage");
  const synthesisReason = document.querySelector("#synthesis-reason");
  const simulationButton = document.querySelector("#simulation-button");
  const simulationStatus = document.querySelector("#simulation-status");
  const simulationReason = document.querySelector("#simulation-reason");
  const simulationTop = document.querySelector("#simulation-top");
  const simulationFiles = document.querySelector("#simulation-files");
  const simulationTimeLimit = document.querySelector("#simulation-time-limit");
  const waveformStatus = document.querySelector("#waveform-status");
  const surferMount = document.querySelector("#surfer-mount");
  const waveDownload = document.querySelector("#wave-download");
  const waveDownloadLink = document.querySelector("#wave-download-link");
  const synthesisAssetSize = document.querySelector("#synthesis-asset-size");
  const vhdlStandardControl = document.querySelector("#vhdl-standard-control");
  const vhdlStandardSelect = document.querySelector("#vhdl-standard");
  const programButton = document.querySelector("#program-button");

  let project = null;
  let fileContents = new Map();
  let openTabs = [];
  let activeTab = null;
  let selectedPath = null;
  let editor = null;
  let saveTimer = null;
  let pendingSave = Promise.resolve();
  let fileDialogMode = "add";
  let projectSwitchVersion = 0;
  const buildRunner = createBuildRunner();
  const simRunner = createSimRunner();
  let buildRunning = false;
  let simulationRunning = false;
  let surferFrame = null;
  let surferBridgePromise = null;
  let resolveSurferBridge = null;
  let vcdObjectUrl = null;
  let currentVcd = null;

  function appendProjectLog(message) {
    const prior = programLog.textContent.trim();
    programLog.textContent = prior ? `${prior}\n${message}` : message;
  }

  function updateBoardInformation() {
    const board = boardSelect.options[boardSelect.selectedIndex];
    const boardData = board?.value
      ? JSON.parse(board.dataset.board ?? "null")
      : null;
    if (!boardData) return;
    boardFpga.textContent = boardData.part;
    const idcodes = Array.isArray(boardData.idcodes)
      ? boardData.idcodes
      : [boardData.idcode];
    boardIdcode.textContent = idcodes
      .map((idcode) => `0x${idcode.toString(16).toUpperCase().padStart(8, "0")}`)
      .join("、");
    boardTarget.textContent = boardData.writeTargets.join("、");
    const mismatch = findConstraintBoardMismatch(project);
    boardConstraintWarning.hidden = !mismatch;
    boardConstraintWarning.textContent = mismatch
      ? `この制約ファイル（${mismatch.path}）は ${mismatch.boardName} 用です。ピン割り当ては T2 で編集できるようになります。`
      : "";
  }

  function setProjectStatus(message) {
    projectStatus.textContent = message;
  }

  function setProjectActionStatus(message) {
    projectActionStatus.textContent = message;
  }

  function renderFsSource(useDefault = false, preferredPath = null) {
    const paths = (project?.files ?? [])
      .map(({ path }) => path)
      .filter((path) => path.endsWith(".fs"));
    const previous = fsSource.value;
    fsSource.replaceChildren();
    for (const path of paths) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path;
      fsSource.append(option);
    }
    const localOption = document.createElement("option");
    localOption.value = "local";
    localOption.textContent = "パソコンのファイルから選ぶ";
    fsSource.append(localOption);
    const selected = preferredPath && paths.includes(preferredPath)
      ? preferredPath
      : !useDefault &&
      (previous === "local" || paths.includes(previous))
      ? previous
      : paths.length === 1
        ? paths[0]
        : "local";
    fsSource.value = selected;
    localFsField.hidden = selected !== "local";
    if (selected === "local") {
      onFsSourceChange(null);
    } else {
      const content = fileContents.get(selected);
      const bytes = content instanceof Uint8Array
        ? new Uint8Array(content)
        : new TextEncoder().encode(content ?? "");
      onFsSourceChange({
        name: selected.split("/").at(-1),
        bytes,
      });
    }
  }

  function updateSynthesisControls() {
    const hasVerilog = (project?.files ?? []).some(({ path }) =>
      /\.(?:v|sv)$/i.test(path)
    );
    const hasVhdl = (project?.files ?? []).some(({ path }) => /\.(?:vhd|vhdl)$/i.test(path));
    const board = BOARDS.find(({ id }) => id === boardSelect.value);
    const supported = (hasVerilog || hasVhdl) && Boolean(board);
    synthesisButton.disabled = (!supported && !buildRunning) || simulationRunning;
    synthesisReason.textContent = supported ? "" : "HDL プロジェクトを開いてください。";
    vhdlStandardControl.hidden = !hasVhdl;
    if (project) {
      project.vhdlStandard ??= "2008";
      vhdlStandardSelect.value = project.vhdlStandard;
    }
    if (board) {
      void fetch(new URL("./synth/manifest.json", import.meta.url))
        .then((response) => response.json())
        .then((manifest) => {
          const paths = new Set([
            "yosys.wasm",
            "nextpnr-himbaechel-gowin.wasm",
            "yosys-share.tar",
            `chipdb/chipdb-${board.nextpnrFamily}.bin`,
          ]);
          if (hasVhdl) {
            paths.add("ghdl-synth.wasm");
            paths.add("libraries.tar");
          }
          const size = manifest.assets
            .filter(({ path }) => paths.has(path))
            .reduce((total, asset) => total + asset.size, 0);
          synthesisAssetSize.textContent =
            `初回は約 ${(size / 1_000_000).toFixed(1)} MB を読み込みます`;
        })
        .catch(() => {
          synthesisAssetSize.textContent = "合成資材の情報を読み込めません。";
        });
    }
    updateSimulationControls();
  }

  function renderSimulationSettings() {
    if (!project) return;
    project.simulation ??= {
      top: "top_tb",
      files: null,
      timeLimitSeconds: 10,
    };
    simulationTop.value = project.simulation.top;
    simulationTimeLimit.value = String(project.simulation.timeLimitSeconds);
    simulationFiles.replaceChildren();
    const candidates = project.files.filter(({ path }) => /\.(?:v|vh)$/i.test(path));
    for (const { path } of candidates) {
      const label = document.createElement("label");
      label.className = "simulation-file";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = path;
      input.checked =
        project.simulation.files === null || project.simulation.files.includes(path);
      input.disabled = simulationRunning || buildRunning;
      input.addEventListener("change", () => {
        project.simulation.files = [
          ...simulationFiles.querySelectorAll("input:checked"),
        ].map((element) => element.value);
        scheduleSave();
      });
      label.append(input, document.createTextNode(path));
      simulationFiles.append(label);
    }
    if (candidates.length === 0) {
      const message = document.createElement("p");
      message.textContent = "Verilog ファイルがありません。";
      simulationFiles.append(message);
    }
  }

  function updateSimulationControls() {
    const paths = (project?.files ?? []).map(({ path }) => path);
    const hasVerilog = paths.some((path) => /\.(?:v|vh)$/i.test(path));
    const hasVhdl = paths.some((path) => /\.(?:vhd|vhdl)$/i.test(path));
    const board = BOARDS.find(({ id }) => id === boardSelect.value);
    simulationButton.textContent = simulationRunning ? "停止" : "シミュレーション";
    simulationReason.textContent = !hasVerilog && hasVhdl
      ? "VHDL のシミュレーションはできません（Verilog の testbench を使ってください）"
      : !hasVerilog
        ? "Verilog ファイルを含むプロジェクトを開いてください。"
        : "";
    simulationButton.disabled = simulationRunning
      ? false
      : !hasVerilog || !board || buildRunning || !canStartSimulation() ||
        !simulationTop.value.trim() ||
        !Number.isInteger(Number(simulationTimeLimit.value)) ||
        Number(simulationTimeLimit.value) < 1 ||
        Number(simulationTimeLimit.value) > 120;
    simulationTop.disabled = simulationRunning || buildRunning;
    simulationTimeLimit.disabled = simulationRunning || buildRunning;
    renderSimulationSettings();
  }

  function ensureSurferFrame() {
    if (surferFrame) return true;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    if (!context) {
      waveformStatus.textContent =
        "この環境では WebGL が使えないため、波形を表示できません。wave.vcd はダウンロードできます。";
      return false;
    }
    const frame = document.createElement("iframe");
    surferFrame = frame;
    frame.id = "surfer-frame";
    frame.title = "Surfer 波形ビューアー";
    frame.src = new URL("./surfer/index.html", import.meta.url).href;
    frame.addEventListener("load", () => {
      void (async () => {
        for (let attempt = 0; attempt < 150; attempt += 1) {
          if (surferFrame !== frame) return;
          if (
            typeof frame.contentWindow.register_message_listener === "function" &&
            typeof frame.contentWindow.inject_message === "function"
          ) {
            const script = frame.contentDocument.createElement("script");
            script.type = "module";
            script.src = new URL("./surfer-bridge.js", import.meta.url).href;
            frame.contentDocument.body.append(script);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (surferFrame === frame) resolveSurferBridge?.(false);
      })();
    }, { once: true });
    surferBridgePromise = new Promise((resolve) => {
      resolveSurferBridge = resolve;
    });
    surferMount.replaceChildren(frame);
    waveformStatus.textContent = currentVcd
      ? "波形を読み込んでいます。"
      : "シミュレーションを実行すると波形を表示します。";
    return true;
  }

  async function loadVcd(vcd) {
    if (currentVcd && surferFrame) {
      surferFrame.remove();
      surferFrame = null;
      surferBridgePromise = null;
      resolveSurferBridge = null;
    }
    currentVcd = vcd;
    waveDownload.hidden = false;
    if (vcdObjectUrl) URL.revokeObjectURL(vcdObjectUrl);
    vcdObjectUrl = URL.createObjectURL(
      new Blob([vcd.bytes], { type: "text/plain" }),
    );
    waveDownloadLink.href = vcdObjectUrl;
    if (!ensureSurferFrame()) return;
    waveformStatus.textContent = "Surfer で波形を読み込んでいます。";
    if (!(await surferBridgePromise)) {
      waveformStatus.textContent = "Surfer を読み込めません。";
      return;
    }
    surferFrame.contentWindow.postMessage(
      { command: "LoadUrl", url: vcdObjectUrl },
      location.origin,
    );
  }

  async function runProjectSimulation() {
    if (simulationRunning) {
      simRunner.stop();
      return;
    }
    if (!project || buildRunning || !canStartSimulation()) {
      simulationStatus.textContent = "ほかの処理が終わってから実行してください。";
      return;
    }
    await flushPendingSave();
    const settings = project.simulation;
    const selected = settings.files === null
      ? project.files.map(({ path }) => path)
      : settings.files;
    const files = project.files
      .filter(({ path }) => selected.includes(path) && /\.(?:v|vh)$/i.test(path))
      .map(({ path }) => ({ path, content: fileContents.get(path) }));
    if (files.length === 0) {
      simulationStatus.textContent = "シミュレーション対象の Verilog ファイルがありません。";
      return;
    }
    simulationRunning = true;
    onSimulationStateChange(true);
    updateSynthesisControls();
    simulationStatus.dataset.outcome = "running";
    simulationStatus.textContent = "シミュレーションを実行しています。";
    programLog.textContent = "";
    const hasVhdl = project.files.some(({ path }) => /\.(?:vhd|vhdl)$/i.test(path));
    if (hasVhdl) appendProjectLog("VHDL ファイルはシミュレーションから除外しました。");
    renderProblems();
    try {
      const result = await simRunner.run({
        files,
        top: settings.top,
        timeLimitMs: settings.timeLimitSeconds * 1000,
      });
      if (result.stdout) appendProjectLog(result.stdout.trimEnd());
      if (result.stderr) appendProjectLog(result.stderr.trimEnd());
      const editorResults = editorDiagnostics(result.diagnostics);
      renderProblems(editorResults);
      window.dispatchEvent(
        new CustomEvent("toolchain:diagnostics", { detail: editorResults }),
      );
      simulationStatus.dataset.outcome = result.outcome;
      simulationStatus.textContent = {
        ok: "シミュレーションが完了しました。",
        failed: "シミュレーションに失敗しました。",
        timeout: "時間上限に達しました。",
        stopped: "シミュレーションを停止しました。",
      }[result.outcome];
      if (result.vcd) await loadVcd(result.vcd);
    } catch (error) {
      simulationStatus.dataset.outcome = "failed";
      simulationStatus.textContent = "シミュレーションに失敗しました。";
      appendProjectLog(`シミュレーションエラー: ${error.message}`);
    } finally {
      simulationRunning = false;
      onSimulationStateChange(false);
      updateSynthesisControls();
    }
  }

  async function runProjectBuild() {
    if (buildRunning) {
      buildRunner.cancel();
      return;
    }
    if (!project) return;
    await flushPendingSave();
    buildRunning = true;
    onBuildStateChange(true);
    synthesisButton.textContent = "中止";
    synthesisStage.textContent = "合成";
    programButton.disabled = true;
    programLog.textContent = "";
    const diagnostics = [];
    const toolText = new Map();
    try {
      const files = project.files
        .filter(({ path }) =>
          !path.startsWith("build/") && !/(?:^|\/)top_tb\.v$/i.test(path)
        )
        .map(({ path }) => ({ path, content: fileContents.get(path) }));
      const result = await buildRunner.build(
        {
          board: boardSelect.value,
          top: project.top,
          vhdlStandard: project.vhdlStandard ?? "2008",
          files,
        },
        {
          onStage: (stage) => {
            const hasVhdl = files.some(({ path }) => /\.(?:vhd|vhdl)$/i.test(path));
            const labels = [
              ...(hasVhdl ? ["VHDL"] : []),
              "合成",
              "配置配線",
              "ビットストリーム",
            ];
            const indexes = hasVhdl
              ? { vhdl: 0, synth: 1, pnr: 2, pack: 3 }
              : { synth: 0, pnr: 1, pack: 2 };
            const activeIndex = indexes[stage];
            synthesisStage.textContent = labels
              .map((label, index) => index <= activeIndex ? label : "")
              .filter(Boolean)
              .join(" → ");
          },
          onLog: ({ tool, stream, text }) => {
            appendProjectLog(`[${tool} ${stream}] ${text}`);
            const prior = toolText.get(tool) ?? "";
            toolText.set(tool, prior + text);
          },
        },
      );
      for (const [tool, text] of toolText) {
        diagnostics.push(...parseToolDiagnostics(tool, text));
      }
      const editorResults = editorDiagnostics(diagnostics);
      for (const file of result.files) {
        if (!project.files.some(({ path }) => path === file.path)) {
          project.files.push({ path: file.path });
        }
        fileContents.set(file.path, file.bytes);
      }
      await saveProject();
      renderFileList();
      renderFsSource(true, "build/top.fs");
      renderProblems(editorResults);
      window.dispatchEvent(
        new CustomEvent("toolchain:diagnostics", { detail: editorResults }),
      );
      window.dispatchEvent(
        new CustomEvent("toolchain:build-complete", {
          detail: {
            timings: result.timings,
            memoryBytes: result.memoryBytes,
          },
        }),
      );
      synthesisStage.textContent = "ビルド完了";
      appendProjectLog(
        `${result.timings.vhdl === undefined ? "" : `VHDL ${result.timings.vhdl.toFixed(0)} ms、`}` +
        `合成 ${result.timings.synth.toFixed(0)} ms、配置配線 ${result.timings.pnr.toFixed(0)} ms、ビットストリーム ${result.timings.pack.toFixed(0)} ms`,
      );
    } catch (error) {
      if (error.name !== "AbortError") {
        for (const [tool, text] of toolText) {
          diagnostics.push(...parseToolDiagnostics(tool, text));
        }
        const failedTool = {
          vhdl: "ghdl",
          synth: "yosys",
          pnr: "nextpnr",
          pack: "gowin_pack",
        }[error.stage] ??
          (/^Yosys\b/i.test(error.message)
            ? "yosys"
            : /^nextpnr\b/i.test(error.message)
              ? "nextpnr"
              : null);
        if (failedTool) {
          const reported = parseToolDiagnostics(
            failedTool,
            `${[...toolText.values()].join("\n")}\n${error.message}`,
          );
          for (const diagnostic of reported) {
            if (
              !diagnostics.some(({ file, line, message }) =>
                file === diagnostic.file &&
                line === diagnostic.line &&
                message === diagnostic.message
              )
            ) {
              diagnostics.push(diagnostic);
            }
          }
        }
        const editorResults = editorDiagnostics(diagnostics);
        renderProblems(editorResults);
        window.dispatchEvent(
          new CustomEvent("toolchain:diagnostics", { detail: editorResults }),
        );
        appendProjectLog(`ビルドエラー: ${error.message}`);
        synthesisStage.textContent = "ビルド失敗";
      } else {
        synthesisStage.textContent = "中止しました";
      }
    } finally {
      buildRunning = false;
      synthesisButton.textContent = "合成・配置配線";
      onBuildStateChange(false);
      updateSynthesisControls();
    }
  }

  async function refreshProjectSwitcher() {
    const names = await store.listProjects();
    projectSelect.replaceChildren();
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      projectSelect.append(option);
    }
    if (project) projectSelect.value = project.name;
  }

  function renderFsFileInfo() {
    if (!selectedPath?.endsWith(".fs")) {
      fsFileInfo.hidden = true;
      fsFileInfo.textContent = "";
      return;
    }
    const content = fileContents.get(selectedPath);
    const byteLength = typeof content === "string"
      ? new TextEncoder().encode(content).length
      : content?.byteLength ?? 0;
    fsFileInfo.hidden = false;
    fsFileInfo.textContent =
      `${selectedPath} は読み取り専用です。サイズ: ${byteLength} バイト。エディターでは開きません。`;
  }

  function saveUiState() {
    if (!project) return;
    try {
      localStorage.setItem(
        `${UI_STATE_PREFIX}${project.name}`,
        JSON.stringify({ openTabs, activeTab }),
      );
    } catch {
      setProjectStatus("タブの状態を保存できません。");
    }
  }

  function renderProblems(diagnostics = []) {
    problemList.replaceChildren();
    problemEmpty.hidden = diagnostics.length > 0;
    for (const diagnostic of diagnostics) {
      const item = document.createElement("li");
      const severity = {
        error: "エラー",
        warning: "警告",
        info: "情報",
        hint: "ヒント",
      }[diagnostic.severity] ?? "エラー";
      const location = diagnostic.file
        ? `${diagnostic.file}:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}: `
        : "";
      item.textContent = `${severity}: ${location}${diagnostic.message}`;
      problemList.append(item);
    }
  }

  function editorDiagnostics(diagnostics) {
    return diagnostics.map((diagnostic) => {
      const path = diagnostic.file ?? activeTab;
      const lines = textForPath(path).split(/\r?\n/);
      const lineIndex = Number.isInteger(diagnostic.line)
        ? Math.min(Math.max(diagnostic.line - 1, 0), lines.length - 1)
        : 0;
      const lineStart = lines
        .slice(0, lineIndex)
        .reduce((length, line) => length + line.length + 1, 0);
      const columnOffset = Number.isInteger(diagnostic.column)
        ? Math.max(diagnostic.column - 1, 0)
        : 0;
      const from = path === activeTab
        ? lineStart + Math.min(columnOffset, lines[lineIndex].length)
        : 0;
      const to = path === activeTab ? lineStart + lines[lineIndex].length : from;
      return { ...diagnostic, from, to };
    });
  }

  function scheduleSave() {
    if (!project) return;
    clearTimeout(saveTimer);
    setProjectStatus("変更を保存しています。");
    saveTimer = setTimeout(() => {
      saveTimer = null;
      pendingSave = saveProject();
    }, 500);
  }

  async function saveProject() {
    if (!project) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    project.board = boardSelect.value;
    try {
      await store.save(project, fileContents);
      setProjectStatus("保存しました。");
    } catch (error) {
      setProjectStatus("プロジェクトを保存できません。");
      appendProjectLog(`プロジェクト保存エラー: ${error.message}`);
    }
  }

  async function flushPendingSave() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      pendingSave = saveProject();
    }
    await pendingSave;
  }

  function textForPath(path) {
    return decodeContent(fileContents.get(path) ?? "");
  }

  function projectTexts() {
    return project.files
      .filter(({ path }) => !path.endsWith(".fs"))
      .map(({ path }) => textForPath(path));
  }

  function persistEditorContent(text) {
    if (!activeTab || !fileContents.has(activeTab)) return;
    fileContents.set(activeTab, text);
    scheduleSave();
  }

  function updateEditor() {
    if (!editor) return;
    editor.setLanguage(activeTab ? languageForPath(activeTab) : "plain");
    editor.setText(activeTab ? textForPath(activeTab) : "");
    saveUiState();
  }

  function renderFileTabs() {
    fileTabs.replaceChildren();
    for (const path of openTabs) {
      const wrapper = document.createElement("div");
      wrapper.className = "editor-tab";
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = `editor-tab-${openTabs.indexOf(path)}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(path === activeTab));
      tab.setAttribute("aria-controls", "editor-mount");
      tab.setAttribute("aria-label", `${path} を編集`);
      tab.title = path;
      tab.textContent = path.split("/").at(-1);
      tab.addEventListener("click", () => {
        activeTab = path;
        selectedPath = path;
        renderFileList();
        renderFileTabs();
        updateEditor();
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = openTabs.indexOf(path);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextPath = openTabs[(index + direction + openTabs.length) % openTabs.length];
        activeTab = nextPath;
        selectedPath = nextPath;
        renderFileList();
        renderFileTabs();
        updateEditor();
        [...fileTabs.querySelectorAll('[role="tab"]')]
          .find((candidate) => candidate.getAttribute("aria-label") === `${nextPath} を編集`)
          ?.focus();
      });
      const close = document.createElement("button");
      close.type = "button";
      close.className = "editor-tab-close";
      close.setAttribute("aria-label", `${path} のタブを閉じる`);
      close.textContent = "×";
      close.addEventListener("click", () => {
        const closedIndex = openTabs.indexOf(path);
        openTabs = openTabs.filter((openPath) => openPath !== path);
        if (activeTab === path) {
          activeTab = openTabs[Math.min(closedIndex, openTabs.length - 1)] ?? null;
        }
        renderFileTabs();
        updateEditor();
      });
      wrapper.append(tab, close);
      fileTabs.append(wrapper);
    }
  }

  function renderFileList() {
    fileList.replaceChildren();
    for (const { path } of project?.files ?? []) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-list-item";
      button.textContent = path;
      button.setAttribute("aria-label", `${path} を開く`);
      button.setAttribute("aria-pressed", String(path === selectedPath));
      button.addEventListener("click", () => {
        if (path.endsWith(".fs")) {
          selectedPath = path;
          renderFileList();
          return;
        }
        openFile(path);
      });
      item.append(button);
      fileList.append(item);
    }
    const hasSelection = Boolean(selectedPath);
    renameFileButton.disabled = !hasSelection;
    deleteFileButton.disabled = !hasSelection;
    renderFsFileInfo();
  }

  function openFile(path) {
    selectedPath = path;
    if (!openTabs.includes(path)) openTabs = [...openTabs, path];
    activeTab = path;
    renderFileList();
    renderFileTabs();
    updateEditor();
  }

  function setPaneOpen(pane, button, open) {
    pane.dataset.open = String(open);
    button.setAttribute("aria-expanded", String(open));
    const paneName = pane === filesPane ? "ファイル一覧" : "ボードと書き込み";
    button.setAttribute("aria-label", `${paneName}を${open ? "閉じる" : "開く"}`);
  }

  function updateTabs(selectedTab) {
    for (const button of tabButtons) {
      const selected = button.dataset.bottomTab === selectedTab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of tabPanels) {
      panel.hidden = panel.dataset.bottomPanel !== selectedTab;
    }
    if (selectedTab === "waveform") ensureSurferFrame();
  }

  function handleBottomTabKeydown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const selectedIndex = tabButtons.findIndex(
      (button) => button.dataset.bottomTab === event.currentTarget.dataset.bottomTab,
    );
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabButtons[
      (selectedIndex + direction + tabButtons.length) % tabButtons.length
    ];
    updateTabs(next.dataset.bottomTab);
    next.focus();
  }

  function showFileDialog(mode) {
    fileDialogMode = mode;
    const renaming = mode === "rename";
    fileDialogHeading.textContent = renaming ? "ファイル名を変更" : "ファイルを追加";
    filePathInput.value = renaming ? selectedPath ?? "" : "";
    fileContentInput.value = "";
    fileUploadField.hidden = mode !== "add";
    filePathError.textContent = "";
    filePathSaveButton.textContent = renaming ? "名前を変更" : "追加する";
    fileDialog.showModal();
    filePathInput.focus();
  }

  async function submitFileDialog() {
    const path = filePathInput.value.trim();
    const validation = validatePath(path);
    if (!validation.ok) {
      filePathError.textContent = validation.errors[0];
      filePathInput.setAttribute("aria-invalid", "true");
      return;
    }
    filePathInput.removeAttribute("aria-invalid");

    if (fileDialogMode === "add") {
      if (project.files.some((file) => file.path === path)) {
        filePathError.textContent = "同じパスのファイルがすでにあります。";
        return;
      }
      const upload = fileContentInput.files[0];
      let content = templateForPath(path);
      if (path.endsWith(".fs")) {
        if (!upload || !upload.name.toLowerCase().endsWith(".fs")) {
          filePathError.textContent = ".fs ファイルを選んでください。";
          return;
        }
        content = new Uint8Array(await upload.arrayBuffer());
      } else if (upload) {
        filePathError.textContent = "アップロードできるのは .fs ファイルだけです。";
        return;
      }
      project.files.push({ path });
      fileContents.set(path, content);
      selectedPath = path;
      if (!path.endsWith(".fs")) {
        openTabs = [...openTabs, path];
        activeTab = path;
      }
    } else {
      const oldPath = selectedPath;
      if (!oldPath || oldPath === path) {
        fileDialog.close();
        return;
      }
      if (project.files.some((file) => file.path === path)) {
        filePathError.textContent = "同じパスのファイルがすでにあります。";
        return;
      }
      project.files = project.files.map((file) =>
        file.path === oldPath ? { path } : file,
      );
      if (Array.isArray(project.simulation?.files)) {
        project.simulation.files = project.simulation.files.map((selected) =>
          selected === oldPath ? path : selected,
        );
      }
      fileContents.set(path, fileContents.get(oldPath));
      fileContents.delete(oldPath);
      openTabs = openTabs.map((openPath) => (openPath === oldPath ? path : openPath));
      if (activeTab === oldPath) activeTab = path;
      selectedPath = path;
    }

    fileDialog.close();
    renderFileList();
    renderFileTabs();
    updateEditor();
    updateSynthesisControls();
    renderFsSource(true);
    await refreshProjectSwitcher();
    scheduleSave();
  }

  function deleteSelectedFile() {
    if (!selectedPath) return;
    const path = selectedPath;
    if (!window.confirm(`「${path}」を削除しますか。`)) return;
    project.files = project.files.filter((file) => file.path !== path);
    if (Array.isArray(project.simulation?.files)) {
      project.simulation.files = project.simulation.files.filter(
        (selected) => selected !== path,
      );
    }
    fileContents.delete(path);
    openTabs = openTabs.filter((openPath) => openPath !== path);
    if (activeTab === path) activeTab = openTabs.at(-1) ?? null;
    selectedPath = null;
    renderFileList();
    renderFileTabs();
    updateEditor();
    updateSynthesisControls();
    renderFsSource(true);
    void refreshProjectSwitcher();
    scheduleSave();
  }

  function renderBoardOptions() {
    for (const board of boardSelect.options) {
      const boardData = BOARDS.find(({ id }) => id === board.value);
      if (boardData) board.dataset.board = JSON.stringify(boardData);
    }
    for (const board of BOARDS) {
      const option = document.createElement("option");
      option.value = board.id;
      option.textContent = board.label;
      newProjectBoardSelect.append(option);
    }
  }

  function activateProject(loaded) {
    project = loaded.project;
    project.vhdlStandard ??= "2008";
    fileContents = loaded.files;
    projectName.textContent = project.name;
    boardSelect.value = project.board;
    const savedState = readUiState(project.name, project);
    openTabs = savedState.openTabs;
    activeTab = savedState.activeTab;
    if (!activeTab) {
      const firstTextFile = project.files.find(({ path }) => !path.endsWith(".fs"));
      if (firstTextFile) {
        openTabs = [firstTextFile.path];
        activeTab = firstTextFile.path;
      }
    }
    selectedPath = activeTab ?? project.files[0]?.path ?? null;
    renderFileList();
    renderFileTabs();
    if (!editor) {
      editor = createHdlEditor(editorMount, {
        doc: activeTab ? textForPath(activeTab) : "",
        language: activeTab ? languageForPath(activeTab) : "plain",
        onChange: persistEditorContent,
        onDiagnostics: renderProblems,
        getProjectTexts: projectTexts,
      });
    } else {
      updateEditor();
    }
    updateBoardInformation();
    updateSynthesisControls();
    renderFsSource(true);
    void refreshProjectSwitcher();
    boardSelect.dispatchEvent(new Event("change", { bubbles: true }));
    setProjectStatus("保存しました。");
  }

  async function openProject(name) {
    saveUiState();
    await flushPendingSave();
    activateProject(await store.load(name));
  }

  async function initializeProject() {
    try {
      const names = await store.listProjects();
      if (names.length > 0) {
        activateProject(await store.load(names[0]));
      } else {
        const initial = createBlinkTemplate(boardSelect.value, "verilog");
        await store.save(initial.project, initial.files);
        activateProject(initial);
      }
    } catch (error) {
      setProjectStatus("プロジェクトを読み込めません。");
      appendProjectLog(`プロジェクト読み込みエラー: ${error.message}`);
    }
  }

  async function createProject() {
    const name = newProjectNameInput.value;
    const validation = validateProjectName(name);
    if (!validation.ok) {
      newProjectError.textContent = validation.errors[0];
      return;
    }
    try {
      const names = await store.listProjects();
      if (names.includes(name)) {
        newProjectError.textContent = "同じ名前のプロジェクトがすでにあります。";
        return;
      }
      await flushPendingSave();
      const created = createBlinkTemplate(
        newProjectBoardSelect.value,
        newProjectLanguageSelect.value,
      );
      created.project.name = name;
      created.project.vhdlStandard =
        newProjectLanguageSelect.value === "vhdl"
          ? newProjectStandardSelect.value
          : "2008";
      await store.save(created.project, created.files);
      newProjectDialog.close();
      newProjectNameInput.value = "";
      newProjectError.textContent = "";
      setProjectActionStatus("");
      activateProject(created);
    } catch (error) {
      newProjectError.textContent = error.message;
    }
  }

  function exportCurrentProject() {
    if (!project) return;
    try {
      const bytes = exportProjectZip(project, fileContents);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProjectActionStatus("ZIP ファイルを書き出しました。");
    } catch (error) {
      setProjectActionStatus(error.message);
    }
  }

  async function importProjectFile() {
    const file = projectZipInput.files[0];
    if (!file) return;
    try {
      const imported = importProjectZip(
        new Uint8Array(await file.arrayBuffer()),
      );
      const names = await store.listProjects();
      if (names.includes(imported.project.name)) {
        setProjectActionStatus("同じ名前のプロジェクトがすでにあります。");
        return;
      }
      await flushPendingSave();
      await store.save(imported.project, imported.files);
      projectZipInput.value = "";
      activateProject(imported);
      setProjectActionStatus("ZIP ファイルを読み込みました。");
    } catch (error) {
      setProjectActionStatus(error.message);
    }
  }

  renderBoardOptions();
  updateBoardInformation();
  updateTabs("log");
  renderProblems();
  addFileButton.addEventListener("click", () => showFileDialog("add"));
  renameFileButton.addEventListener("click", () => showFileDialog("rename"));
  deleteFileButton.addEventListener("click", deleteSelectedFile);
  filePathSaveButton.addEventListener("click", () => {
    void submitFileDialog();
  });
  filePathCancelButton.addEventListener("click", () => fileDialog.close());
  fileContentInput.addEventListener("change", () => {
    const upload = fileContentInput.files[0];
    if (upload && filePathInput.value.trim() === "") {
      filePathInput.value = upload.name;
    }
  });
  filePathInput.addEventListener("input", () => {
    filePathError.textContent = "";
    filePathInput.removeAttribute("aria-invalid");
  });
  filePathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitFileDialog();
    }
  });
  projectSelect.addEventListener("change", () => {
    if (!project || projectSelect.value === project.name) return;
    void openProject(projectSelect.value).catch((error) => {
      setProjectActionStatus(`プロジェクトを切り替えられません: ${error.message}`);
      void refreshProjectSwitcher();
    });
  });
  newProjectButton.addEventListener("click", () => {
    newProjectError.textContent = "";
    newProjectBoardSelect.value = boardSelect.value;
    newProjectStandardField.hidden = newProjectLanguageSelect.value !== "vhdl";
    newProjectDialog.showModal();
    newProjectNameInput.focus();
  });
  newProjectLanguageSelect.addEventListener("change", () => {
    newProjectStandardField.hidden = newProjectLanguageSelect.value !== "vhdl";
  });
  vhdlStandardSelect.addEventListener("change", () => {
    if (!project) return;
    project.vhdlStandard = vhdlStandardSelect.value;
    scheduleSave();
  });
  newProjectCreateButton.addEventListener("click", () => {
    void createProject();
  });
  newProjectCancelButton.addEventListener("click", () => newProjectDialog.close());
  exportProjectButton.addEventListener("click", exportCurrentProject);
  importProjectButton.addEventListener("click", () => projectZipInput.click());
  projectZipInput.addEventListener("change", () => {
    void importProjectFile();
  });
  fsSource.addEventListener("change", () => {
    const selected = fsSource.value;
    localFsField.hidden = selected !== "local";
    if (selected === "local") {
      onFsSourceChange(null);
    } else {
      const content = fileContents.get(selected);
      const bytes = content instanceof Uint8Array
        ? new Uint8Array(content)
        : new TextEncoder().encode(content ?? "");
      onFsSourceChange({
        name: selected.split("/").at(-1),
        bytes,
      });
    }
  });
  boardSelect.addEventListener("change", () => {
    if (project) project.board = boardSelect.value;
    updateBoardInformation();
    scheduleSave();
  });
  form.addEventListener("change", updateBoardInformation);
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => updateTabs(button.dataset.bottomTab));
    button.addEventListener("keydown", handleBottomTabKeydown);
  });
  window.addEventListener("message", (event) => {
    if (
      !surferFrame ||
      event.origin !== location.origin ||
      event.source !== surferFrame.contentWindow
    ) return;
    if (event.data?.type === "toolchain:surfer-bridge-ready") {
      resolveSurferBridge?.(true);
    } else if (event.data?.type === "toolchain:surfer-waveform-loaded") {
      const inject = surferFrame.contentWindow.inject_message;
      if (typeof inject === "function") {
        inject(JSON.stringify({
          AddScope: [{ strs: [project?.simulation?.top ?? "top_tb"], id: "None" }, false],
        }));
        waveformStatus.textContent = "波形を表示しています。";
      }
    } else if (event.data?.type === "toolchain:surfer-waveform-timeout") {
      waveformStatus.textContent = "波形の読み込みがタイムアウトしました。";
    }
  });
  simulationButton.addEventListener("click", () => void runProjectSimulation());
  simulationTop.addEventListener("input", () => {
    if (!project) return;
    project.simulation.top = simulationTop.value;
    scheduleSave();
    updateSimulationControls();
  });
  simulationTimeLimit.addEventListener("change", () => {
    if (!project) return;
    const value = Number(simulationTimeLimit.value);
    if (Number.isInteger(value) && value >= 1 && value <= 120) {
      project.simulation.timeLimitSeconds = value;
      scheduleSave();
    }
    updateSimulationControls();
  });
  window.addEventListener("pagehide", () => {
    simRunner.dispose();
    if (vcdObjectUrl) URL.revokeObjectURL(vcdObjectUrl);
  }, { once: true });
  toggleFilesButton.addEventListener("click", () => {
    const open = filesPane.dataset.open !== "true";
    setPaneOpen(filesPane, toggleFilesButton, open);
    if (open) setPaneOpen(boardPane, toggleBoardButton, false);
  });
  toggleBoardButton.addEventListener("click", () => {
    const open = boardPane.dataset.open !== "true";
    setPaneOpen(boardPane, toggleBoardButton, open);
    if (open) setPaneOpen(filesPane, toggleFilesButton, false);
  });
  closeFilesPaneButton.addEventListener("click", () =>
    setPaneOpen(filesPane, toggleFilesButton, false),
  );
  closeBoardPaneButton.addEventListener("click", () =>
    setPaneOpen(boardPane, toggleBoardButton, false),
  );
  window.addEventListener("toolchain:diagnostics", (event) => {
    editor?.setDiagnostics(event.detail);
  });
  document.addEventListener("toolchain:artifacts-ready", () => {
    updateTabs("artifacts");
  });
  document.addEventListener("keydown", (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void saveProject();
    }
  });

  renderFsSource(true);
  synthesisButton.addEventListener("click", () => void runProjectBuild());
  boardSelect.addEventListener("change", updateSynthesisControls);
  void initializeProject();
}
