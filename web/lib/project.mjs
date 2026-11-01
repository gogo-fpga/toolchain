import { getBoard } from "./boards.mjs";
import { inspectInstalledLibraries, isLibraryPath, validateLibrarySelections } from "./libraries.mjs";

const PROJECT_KEYS = new Set([
  "version",
  "name",
  "board",
  "top",
  "files",
  "vhdlStandard",
  "simulation",
  "libraries",
]);
const FILE_KEYS = new Set(["path"]);
const SIMULATION_KEYS = new Set(["top", "files", "timeLimitSeconds"]);
export const PROJECT_VERSION = 3;
export const DEFAULT_SIMULATION_SETTINGS = Object.freeze({
  top: "top_tb",
  files: null,
  timeLimitSeconds: 10,
});
const ALLOWED_EXTENSIONS = new Set([
  ".v",
  ".vh",
  ".vhd",
  ".vhdl",
  ".fs",
  ".json",
  ".cst",
  ".md",
  ".txt",
  ".hex",
  ".mem",
  ".bin",
  ".dat",
]);

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function validateProjectName(name) {
  const errors = [];
  if (typeof name !== "string" || name.trim().length === 0) {
    errors.push("プロジェクト名を指定してください。");
  } else if (
    name.length > 128 ||
    name === "." ||
    name === ".." ||
    /[/\\\u0000-\u001f\u007f]/.test(name)
  ) {
    errors.push("プロジェクト名に使えない文字が含まれています。");
  }
  return { ok: errors.length === 0, errors };
}

export function validatePath(path) {
  const errors = [];
  if (typeof path !== "string" || path.length === 0) {
    errors.push("ファイルの相対パスを指定してください。");
    return { ok: false, errors };
  }

  if (
    path.length > (isLibraryPath(path) ? 512 : 128) ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\u0000")
  ) {
    errors.push(`ファイルのパスは ${isLibraryPath(path) ? 512 : 128} 文字以内の相対パスにしてください。`);
  }

  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    errors.push("ファイルのパスに使えない区切りや文字が含まれています。");
  }

  const fileName = segments.at(-1) ?? "";
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex < 0 ? "" : fileName.slice(extensionIndex);
  if (isLibraryPath(path)) {
    if (!/^libraries\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:sources\/.+|snapshots\/[a-z0-9]+(?:-[a-z0-9]+)*\.json)$/.test(path)) {
      errors.push("ライブラリーの予約パスが不正です。");
    }
  } else if (!ALLOWED_EXTENSIONS.has(extension)) {
    errors.push("対応していないファイルの拡張子です。");
  }
  if (path === "project.json") errors.push("project.json は予約されたファイル名です。");

  return { ok: errors.length === 0, errors };
}

export function findConstraintBoardMismatch(project) {
  for (const file of project?.files ?? []) {
    const path = file?.path;
    const match = typeof path === "string"
      ? path.match(/^constraints\/([A-Za-z0-9_-]+)\.cst$/)
      : null;
    if (!match || match[1] === project.board) continue;
    return {
      path,
      boardId: match[1],
      boardName: getBoard(match[1])?.label ?? match[1],
    };
  }
  return null;
}

export function defaultSimulationSettings() {
  return {
    top: DEFAULT_SIMULATION_SETTINGS.top,
    files: DEFAULT_SIMULATION_SETTINGS.files,
    timeLimitSeconds: DEFAULT_SIMULATION_SETTINGS.timeLimitSeconds,
  };
}

export function migrateProject(project) {
  if (!isObject(project)) return project;
  const migrated = { ...project };
  if (!Object.hasOwn(migrated, "vhdlStandard")) {
    migrated.vhdlStandard = "2008";
  }
  if (migrated.version === 1) {
    migrated.version = 2;
    migrated.simulation ??= defaultSimulationSettings();
  }
  if (migrated.version === 2) {
    migrated.version = PROJECT_VERSION;
    if (!Object.hasOwn(migrated, "libraries")) migrated.libraries = [];
  }
  return migrated;
}

export function validateProject(project) {
  const errors = [];
  if (!isObject(project)) {
    return { ok: false, errors: ["プロジェクトの形式が正しくありません。"] };
  }

  for (const key of Object.keys(project)) {
    if (!PROJECT_KEYS.has(key)) {
      errors.push(`プロジェクトに未対応の項目があります: ${key}`);
    }
  }

  if (project.version !== PROJECT_VERSION) {
    errors.push(`プロジェクトの版は ${PROJECT_VERSION} にしてください。`);
  }

  errors.push(...validateProjectName(project.name).errors);
  errors.push(...validateLibrarySelections(project.libraries));

  if (typeof project.board !== "string" || !getBoard(project.board)) {
    errors.push("対応していないボードです。");
  }

  if (typeof project.top !== "string" || project.top.trim().length === 0) {
    errors.push("トップモジュール名を指定してください。");
  }

  if (
    project.vhdlStandard !== undefined &&
    !["2008", "2019"].includes(project.vhdlStandard)
  ) {
    errors.push("VHDL 標準は 2008 または 2019 にしてください。");
  }

  if (!isObject(project.simulation)) {
    errors.push("シミュレーション設定の形式が正しくありません。");
  } else {
    for (const key of Object.keys(project.simulation)) {
      if (!SIMULATION_KEYS.has(key)) {
        errors.push(`シミュレーション設定に未対応の項目があります: ${key}`);
      }
    }
    if (
      typeof project.simulation.top !== "string" ||
      project.simulation.top.trim().length === 0
    ) {
      errors.push("シミュレーションのトップモジュール名を指定してください。");
    }
    if (
      project.simulation.files !== null &&
      !Array.isArray(project.simulation.files)
    ) {
      errors.push("シミュレーションのファイル一覧の形式が正しくありません。");
    }
    if (
      !Number.isInteger(project.simulation.timeLimitSeconds) ||
      project.simulation.timeLimitSeconds < 1 ||
      project.simulation.timeLimitSeconds > 120
    ) {
      errors.push("シミュレーションの時間上限は 1 から 120 秒にしてください。");
    }
  }

  if (!Array.isArray(project.files)) {
    errors.push("ファイル一覧の形式が正しくありません。");
  } else {
    const paths = new Set();
    project.files.forEach((file, index) => {
      if (!isObject(file)) {
        errors.push(`ファイル一覧の ${index + 1} 件目の形式が正しくありません。`);
        return;
      }
      for (const key of Object.keys(file)) {
        if (!FILE_KEYS.has(key)) {
          errors.push(`ファイル一覧に未対応の項目があります: ${key}`);
        }
      }
      const pathResult = validatePath(file.path);
      errors.push(
        ...pathResult.errors.map(
          (message) => `ファイル一覧の ${index + 1} 件目: ${message}`,
        ),
      );
      if (typeof file.path === "string") {
        if (paths.has(file.path)) {
          errors.push(`同じファイルが複数登録されています: ${file.path}`);
        }
        paths.add(file.path);
      }
    });
    for (const path of paths) {
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        if (paths.has(segments.slice(0, index).join("/"))) {
          errors.push(`ファイルとディレクトリーのパスが衝突しています: ${path}`);
        }
      }
    }
  }

  if (isObject(project.simulation) && Array.isArray(project.simulation.files)) {
    const projectPaths = new Set(
      Array.isArray(project.files)
        ? project.files
          .filter((file) => isObject(file))
          .map(({ path }) => path)
        : [],
    );
    const selectedPaths = new Set();
    for (const path of project.simulation.files) {
      if (typeof path !== "string") {
        errors.push("シミュレーションのファイルパスは文字列にしてください。");
        continue;
      }
      if (selectedPaths.has(path)) {
        errors.push(`シミュレーションのファイルが複数選択されています: ${path}`);
      }
      selectedPaths.add(path);
      if (!projectPaths.has(path)) {
        errors.push(`シミュレーションのファイルがプロジェクトにありません: ${path}`);
        continue;
      }
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      if (isLibraryPath(path) || ![".v", ".vh"].includes(extension)) {
        errors.push(`シミュレーションには Verilog ファイルを選んでください: ${path}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function createProjectSnapshot(project, files) {
  const validation = validateProject(project);
  if (!validation.ok) {
    throw new Error(`プロジェクトが不正です: ${validation.errors.join(" ")}`);
  }
  if (!(files instanceof Map)) throw new Error("プロジェクトのファイルは Map で指定してください。");
  if (project.files.length !== files.size || project.files.some(({ path }) => !files.has(path))) {
    throw new Error("プロジェクトの一覧とファイルの内容が一致しません。");
  }
  const projectJson = JSON.stringify(project);
  const savedProject = JSON.parse(projectJson);
  const savedFiles = new Map();
  const encoder = new TextEncoder();
  let size = encoder.encode(projectJson).byteLength;
  if (files.size + 1 > 256) throw new Error(`プロジェクトの項目数は 256 件以内にしてください（現在 ${files.size + 1} 件）。`);
  for (const [path, content] of files) {
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      throw new Error(`ファイルの内容を保存できません: ${path}`);
    }
    size += typeof content === "string" ? encoder.encode(content).byteLength : content.byteLength;
    savedFiles.set(path, typeof content === "string" ? content : new Uint8Array(content));
  }
  if (size > 16 * 1024 * 1024) throw new Error(`プロジェクトの展開後の合計サイズは 16 MiB 以内にしてください（現在 ${size} バイト）。`);
  const libraryState = await inspectInstalledLibraries(savedProject, savedFiles);
  return { project: savedProject, files: savedFiles, projectJson, libraryState };
}

export async function changeProjectLibraries(project, files, { add = null, remove = null } = {}) {
  const snapshot = await createProjectSnapshot(project, files);
  const next = snapshot.project;
  if (remove) next.libraries = next.libraries.filter(({ id, component }) => id !== remove.id || component !== remove.component);
  const retained = new Set(snapshot.libraryState.records.filter(({ id, component }) =>
    next.libraries.some((selection) => selection.id === id && selection.component === component),
  ).flatMap(({ paths }) => paths));
  const nextFiles = new Map([...snapshot.files].filter(([path]) =>
    !path.startsWith("build/") && (!isLibraryPath(path) || retained.has(path)),
  ));
  if (add) {
    next.libraries.push(add.selection);
    for (const [path, content] of add.files) {
      if (!isLibraryPath(path)) throw new Error(`依存はライブラリーの専用領域へ追加してください: ${path}`);
      nextFiles.set(path, content);
    }
  }
  next.files = [...nextFiles.keys()].map((path) => ({ path }));
  if (next.simulation.files !== null) next.simulation.files = next.simulation.files.filter((path) => nextFiles.has(path));
  return createProjectSnapshot(next, nextFiles);
}

export async function prepareProjectInputs(project, files, { simulation = false } = {}) {
  const snapshot = await createProjectSnapshot(project, files);
  const selected = snapshot.project.simulation.files;
  const userFiles = [...snapshot.files].filter(([path]) => {
    if (isLibraryPath(path) || path.startsWith("build/")) return false;
    if (/\.(?:hex|mem|bin|dat)$/.test(path)) return true;
    return simulation
      ? /\.(?:v|vh)$/.test(path) && (selected === null || selected.includes(path))
      : /\.(?:v|vh|vhd|vhdl|cst)$/.test(path) && !/(?:^|\/)top_tb\.v$/i.test(path);
  }).map(([path, content]) => ({ path, content }));
  const librarySources = snapshot.libraryState.sources.filter((source) => !simulation || source.language === "verilog");
  return {
    project: snapshot.project,
    files: [...librarySources, ...snapshot.libraryState.data, ...userFiles],
    includeDirectories: snapshot.libraryState.includeDirectories,
    defines: snapshot.libraryState.defines,
  };
}
