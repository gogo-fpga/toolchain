import { getBoard } from "./boards.mjs";

const PROJECT_KEYS = new Set(["version", "name", "board", "top", "files"]);
const FILE_KEYS = new Set(["path"]);
const ALLOWED_EXTENSIONS = new Set([
  ".v",
  ".vh",
  ".vhd",
  ".vhdl",
  ".fs",
  ".cst",
  ".md",
  ".txt",
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
    path.length > 128 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\u0000")
  ) {
    errors.push("ファイルのパスは 128 文字以内の相対パスにしてください。");
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
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    errors.push("対応していないファイルの拡張子です。");
  }

  return { ok: errors.length === 0, errors };
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

  if (project.version !== 1) {
    errors.push("プロジェクトの版は 1 にしてください。");
  }

  errors.push(...validateProjectName(project.name).errors);

  if (typeof project.board !== "string" || !getBoard(project.board)) {
    errors.push("対応していないボードです。");
  }

  if (typeof project.top !== "string" || project.top.trim().length === 0) {
    errors.push("トップモジュール名を指定してください。");
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
  }

  return { ok: errors.length === 0, errors };
}
