import {
  migrateProject,
  validatePath,
  validateProject,
  validateProjectName,
} from "./project.mjs";

function cloneContent(content) {
  return typeof content === "string" ? content : new Uint8Array(content);
}

function cloneFiles(files) {
  return new Map(
    [...files.entries()].map(([path, content]) => [path, cloneContent(content)]),
  );
}

function validateStoreInput(project, files) {
  const validation = validateProject(project);
  if (!validation.ok) {
    throw new Error(`プロジェクトが不正です: ${validation.errors.join(" ")}`);
  }
  if (!(files instanceof Map)) {
    throw new Error("プロジェクトのファイルは Map で指定してください。");
  }

  const declaredPaths = new Set(project.files.map((file) => file.path));
  if (
    declaredPaths.size !== files.size ||
    [...files.keys()].some((path) => !declaredPaths.has(path))
  ) {
    throw new Error("プロジェクトの一覧とファイルの内容が一致しません。");
  }

  for (const [path, content] of files) {
    if (!validatePath(path).ok) {
      throw new Error(`ファイルのパスが不正です: ${path}`);
    }
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      throw new Error(`ファイルの内容を保存できません: ${path}`);
    }
  }

  return {
    projectJson: JSON.stringify(project),
    files: cloneFiles(files),
  };
}

function parseProjectJson(projectJson, name) {
  let project;
  try {
    project = JSON.parse(projectJson);
  } catch (error) {
    throw new Error(`project.json を解析できません: ${name}`, { cause: error });
  }
  project = migrateProject(project);
  const validation = validateProject(project);
  if (!validation.ok) {
    throw new Error(`project.json の内容が不正です: ${validation.errors.join(" ")}`);
  }
  if (project.name !== name) {
    throw new Error(`project.json のプロジェクト名が一致しません: ${name}`);
  }
  return project;
}

function assertProjectName(name) {
  const validation = validateProjectName(name);
  if (!validation.ok) {
    throw new Error(validation.errors.join(" "));
  }
}

export function createMemoryStore({ records = new Map() } = {}) {
  if (!(records instanceof Map)) {
    throw new TypeError("records must be a Map");
  }

  return {
    async listProjects() {
      return [...records.keys()].sort();
    },

    async load(name) {
      assertProjectName(name);
      const record = records.get(name);
      if (!record) {
        throw new Error(`プロジェクトが見つかりません: ${name}`);
      }
      const project = parseProjectJson(record.projectJson, name);
      const files = new Map();
      for (const { path } of project.files) {
        if (!(record.files instanceof Map) || !record.files.has(path)) {
          throw new Error(`プロジェクトのファイルが見つかりません: ${path}`);
        }
        files.set(path, cloneContent(record.files.get(path)));
      }
      return { project, files };
    },

    async save(project, files) {
      const record = validateStoreInput(project, files);
      records.set(project.name, record);
    },

    async remove(name) {
      assertProjectName(name);
      return records.delete(name);
    },
  };
}

async function getProjectsDirectory(storage, create) {
  if (typeof storage?.getDirectory !== "function") {
    throw new Error("このブラウザーでは OPFS を利用できません。");
  }
  const root = await storage.getDirectory();
  return root.getDirectoryHandle("projects", { create });
}

async function getFileDirectory(projectDirectory, path, create) {
  const segments = path.split("/");
  let directory = projectDirectory;
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return { directory, fileName: segments.at(-1) };
}

async function writeOpfsFile(projectDirectory, path, content) {
  const { directory, fileName } = await getFileDirectory(
    projectDirectory,
    path,
    true,
  );
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readOpfsFile(projectDirectory, path) {
  const { directory, fileName } = await getFileDirectory(
    projectDirectory,
    path,
    false,
  );
  const handle = await directory.getFileHandle(fileName);
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

async function removeUnusedEntries(directory, prefix, keptPaths) {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      const hasKeptFile = [...keptPaths].some((kept) =>
        kept.startsWith(`${path}/`),
      );
      if (hasKeptFile) {
        await removeUnusedEntries(handle, path, keptPaths);
      } else {
        await directory.removeEntry(name, { recursive: true });
      }
    } else if (!keptPaths.has(path)) {
      await directory.removeEntry(name);
    }
  }
}

export function createOpfsStore(storage) {
  return {
    async listProjects() {
      let projects;
      try {
        projects = await getProjectsDirectory(storage, false);
      } catch (error) {
        if (error?.name === "NotFoundError") return [];
        throw new Error("プロジェクト一覧を読み込めません。", { cause: error });
      }

      const names = [];
      for await (const [name, handle] of projects.entries()) {
        if (handle.kind === "directory" && validateProjectName(name).ok) {
          names.push(name);
        }
      }
      return names.sort();
    },

    async load(name) {
      assertProjectName(name);
      try {
        const projects = await getProjectsDirectory(storage, false);
        const projectDirectory = await projects.getDirectoryHandle(name);
        const manifest = await projectDirectory.getFileHandle("project.json");
        const project = parseProjectJson(
          await (await manifest.getFile()).text(),
          name,
        );
        const files = new Map();
        for (const { path } of project.files) {
          files.set(path, await readOpfsFile(projectDirectory, path));
        }
        return { project, files };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("project.json")) {
          throw error;
        }
        throw new Error(`プロジェクトを読み込めません: ${name}`, { cause: error });
      }
    },

    async save(project, files) {
      const record = validateStoreInput(project, files);
      try {
        const projects = await getProjectsDirectory(storage, true);
        const projectDirectory = await projects.getDirectoryHandle(project.name, {
          create: true,
        });
        for (const [path, content] of record.files) {
          await writeOpfsFile(projectDirectory, path, content);
        }
        const keptPaths = new Set([
          "project.json",
          ...project.files.map((file) => file.path),
        ]);
        await removeUnusedEntries(projectDirectory, "", keptPaths);
        const manifest = await projectDirectory.getFileHandle("project.json", {
          create: true,
        });
        const writable = await manifest.createWritable();
        await writable.write(record.projectJson);
        await writable.close();
      } catch (error) {
        throw new Error(`プロジェクトを保存できません: ${project.name}`, {
          cause: error,
        });
      }
    },

    async remove(name) {
      assertProjectName(name);
      try {
        const projects = await getProjectsDirectory(storage, false);
        await projects.removeEntry(name, { recursive: true });
        return true;
      } catch (error) {
        if (error?.name === "NotFoundError") return false;
        throw new Error(`プロジェクトを削除できません: ${name}`, {
          cause: error,
        });
      }
    },
  };
}
