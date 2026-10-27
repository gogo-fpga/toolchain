import { createOpfsStore } from "./lib/project-store.mjs";
import { validatePath } from "./lib/project.mjs";
import { createHdlEditor, languageForPath } from "./editor/editor.bundle.mjs";

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
  if (path.endsWith(".cst")) return "# ピン割り当ては未設定です。\n";
  return path.endsWith(".fs") ? new Uint8Array() : "";
}

function readUiState(name, project) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`${UI_STATE_PREFIX}${name}`) ?? "null",
    );
    const filePaths = new Set(project.files.map((file) => file.path));
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

export function initializeIde({ form, boardSelect, programLog, BOARDS }) {
  const store = createOpfsStore(navigator.storage);
  const projectName = document.querySelector("#project-name");
  const projectStatus = document.querySelector("#project-status");
  const boardFpga = document.querySelector("#board-fpga");
  const boardIdcode = document.querySelector("#board-idcode");
  const boardTarget = document.querySelector("#board-target");
  const fileList = document.querySelector("#file-list");
  const addFileButton = document.querySelector("#add-file-button");
  const renameFileButton = document.querySelector("#rename-file-button");
  const deleteFileButton = document.querySelector("#delete-file-button");
  const useBitstreamButton = document.querySelector("#use-bitstream-button");
  const fileTabs = document.querySelector("#editor-tabs");
  const editorMount = document.querySelector("#editor-mount");
  const problemList = document.querySelector("#problem-list");
  const problemEmpty = document.querySelector("#problem-empty");
  const fileDialog = document.querySelector("#file-dialog");
  const fileDialogHeading = document.querySelector("#file-dialog-heading");
  const filePathInput = document.querySelector("#file-path-input");
  const filePathError = document.querySelector("#file-path-error");
  const filePathSaveButton = document.querySelector("#file-path-save");
  const filePathCancelButton = document.querySelector("#file-path-cancel");
  const fileInput = document.querySelector("#bitstream-file");
  const tabButtons = [...document.querySelectorAll("[data-bottom-tab]")];
  const tabPanels = [...document.querySelectorAll("[data-bottom-panel]")];
  const toggleFilesButton = document.querySelector("#toggle-files-pane");
  const toggleBoardButton = document.querySelector("#toggle-board-pane");
  const filesPane = document.querySelector("#files-pane");
  const boardPane = document.querySelector("#board-pane");
  const closeFilesPaneButton = document.querySelector("#close-files-pane");
  const closeBoardPaneButton = document.querySelector("#close-board-pane");

  let project = null;
  let fileContents = new Map();
  let openTabs = [];
  let activeTab = null;
  let selectedPath = null;
  let editor = null;
  let saveTimer = null;
  let fileDialogMode = "add";

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
    boardIdcode.textContent = `0x${boardData.idcode
      .toString(16)
      .padStart(8, "0")}`;
    boardTarget.textContent =
      form.elements.target.value === "flash" ? "フラッシュ" : "SRAM";
  }

  function setProjectStatus(message) {
    projectStatus.textContent = message;
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
      item.textContent = `${severity}: ${diagnostic.message}`;
      problemList.append(item);
    }
  }

  function scheduleSave() {
    if (!project) return;
    clearTimeout(saveTimer);
    setProjectStatus("変更を保存しています。");
    saveTimer = setTimeout(() => {
      void saveProject();
    }, 500);
  }

  async function saveProject() {
    if (!project) return;
    clearTimeout(saveTimer);
    project.board = boardSelect.value;
    try {
      await store.save(project, fileContents);
      setProjectStatus("ローカルに保存しました。");
    } catch (error) {
      setProjectStatus("プロジェクトを保存できません。");
      appendProjectLog(`プロジェクト保存エラー: ${error.message}`);
    }
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
      button.addEventListener("click", () => openFile(path));
      item.append(button);
      fileList.append(item);
    }
    const hasSelection = Boolean(selectedPath);
    renameFileButton.disabled = !hasSelection;
    deleteFileButton.disabled = !hasSelection;
    useBitstreamButton.disabled = !selectedPath?.endsWith(".fs");
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
    button.setAttribute(
      "aria-label",
      open ? "ペインを閉じる" : `${pane === filesPane ? "ファイル" : "書き込み"}ペインを開く`,
    );
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
    filePathError.textContent = "";
    filePathSaveButton.textContent = renaming ? "名前を変更" : "追加する";
    fileDialog.showModal();
    filePathInput.focus();
  }

  function submitFileDialog() {
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
      project.files.push({ path });
      fileContents.set(path, templateForPath(path));
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
    scheduleSave();
  }

  function deleteSelectedFile() {
    if (!selectedPath) return;
    const path = selectedPath;
    if (!window.confirm(`「${path}」を削除しますか。`)) return;
    project.files = project.files.filter((file) => file.path !== path);
    fileContents.delete(path);
    openTabs = openTabs.filter((openPath) => openPath !== path);
    if (activeTab === path) activeTab = openTabs.at(-1) ?? null;
    selectedPath = null;
    renderFileList();
    renderFileTabs();
    updateEditor();
    scheduleSave();
  }

  function useSelectedBitstream() {
    if (!selectedPath?.endsWith(".fs")) return;
    const file = new File(
      [fileContents.get(selectedPath)],
      selectedPath.split("/").at(-1),
      { type: "text/plain" },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderBoardOptions() {
    for (const board of boardSelect.options) {
      const boardData = BOARDS.find(({ id }) => id === board.value);
      if (boardData) board.dataset.board = JSON.stringify(boardData);
    }
  }

  async function initializeProject() {
    try {
      const names = await store.listProjects();
      if (names.length > 0) {
        const loaded = await store.load(names[0]);
        project = loaded.project;
        fileContents = loaded.files;
      } else {
        project = {
          version: 1,
          name: "blink",
          board: boardSelect.value,
          top: "top",
          files: [{ path: "src/top.v" }, { path: "src/top.vhd" }],
        };
        fileContents = new Map([
          ["src/top.v", templateForPath("src/top.v")],
          ["src/top.vhd", templateForPath("src/top.vhd")],
        ]);
        await store.save(project, fileContents);
      }

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
      editor = createHdlEditor(editorMount, {
        doc: activeTab ? textForPath(activeTab) : "",
        language: activeTab ? languageForPath(activeTab) : "plain",
        onChange: persistEditorContent,
        onDiagnostics: renderProblems,
        getProjectTexts: projectTexts,
      });
      updateBoardInformation();
      boardSelect.dispatchEvent(new Event("change", { bubbles: true }));
      setProjectStatus("プロジェクトをローカルに保存しています。");
    } catch (error) {
      setProjectStatus("プロジェクトを読み込めません。");
      appendProjectLog(`プロジェクト読み込みエラー: ${error.message}`);
    }
  }

  renderBoardOptions();
  updateBoardInformation();
  updateTabs("log");
  renderProblems();
  addFileButton.addEventListener("click", () => showFileDialog("add"));
  renameFileButton.addEventListener("click", () => showFileDialog("rename"));
  deleteFileButton.addEventListener("click", deleteSelectedFile);
  useBitstreamButton.addEventListener("click", useSelectedBitstream);
  filePathSaveButton.addEventListener("click", submitFileDialog);
  filePathCancelButton.addEventListener("click", () => fileDialog.close());
  filePathInput.addEventListener("input", () => {
    filePathError.textContent = "";
    filePathInput.removeAttribute("aria-invalid");
  });
  filePathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitFileDialog();
    }
  });
  boardSelect.addEventListener("change", () => {
    updateBoardInformation();
    scheduleSave();
  });
  form.addEventListener("change", updateBoardInformation);
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => updateTabs(button.dataset.bottomTab));
    button.addEventListener("keydown", handleBottomTabKeydown);
  });
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

  void initializeProject();
}
