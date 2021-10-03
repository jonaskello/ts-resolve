import { dirname, join } from "path";
import { FileSystem } from "../filesystem";

export type MockFilesystem = {
  readonly [path: string]: Entry;
};

export type Entry = JsonFileEntry | TsFileEntry | LinkEntry;

export type JsonFileEntry = { type: "JsonFileEntry"; json: object };
export type TsFileEntry = { type: "TsFileEntry"; imports: ReadonlyArray<string> };
export type LinkEntry = { type: "LinkEntry"; realPath: string };

export function createFilesystem(mfs: MockFilesystem, cwd: string): FileSystem {
  return {
    cwd: () => cwd,
    fileExists: (path: string) => {
      const result = isFileEntry(mfs[path]);
      // console.log("MOCK: fileExists", path, result);
      return result;
    },
    isDirectory: isDirectory(mfs),
    getRealpath: getRealPath(mfs),
    readFile: (path: string) => {
      const realPath = getRealPath(mfs)(path);
      let result: string = undefined;
      const entry = mfs[realPath];
      if (entry !== undefined && entry.type === "JsonFileEntry") {
        result = JSON.stringify(entry.json);
      }
      console.log("MOCK: readFile", path, result);
      return result;
    },
  };
}

const getRealPath =
  (mfs: MockFilesystem) =>
  (path: string): string | undefined => {
    // Check if the start of path matches a symlink path and if so resolve that part and try again
    for (const [k, v] of Object.entries(mfs)) {
      if (v.type === "LinkEntry") {
        const realPath = v.realPath;
        if (path.startsWith(k)) {
          // Replace the matching start of path with the realpath
          const remainingPath = path.substr(k.length);
          const resolvedPath = realPath + remainingPath;
          console.log("resolvedPath", resolvedPath);
          return getRealPath(mfs)(resolvedPath);
        }
      }
    }
    // The path does not start with a link, so it is a realpath, check if it exists
    const result = (pathExists(mfs, path) && path) || undefined;
    console.log("getRealPath", path, result);
    return result;
  };

function pathExists(mfs: MockFilesystem, path: string): boolean {
  for (const key of Object.keys(mfs)) {
    if (key.startsWith(path)) return true;
  }
  return false;
}

const isDirectory =
  (mfs: MockFilesystem) =>
  (path: string): boolean => {
    let result = false;
    for (let [entryPath, entry] of Object.entries(mfs)) {
      if (entry.type === "LinkEntry") {
        // In reality, not all links are dirs, but for our purpose they can always be
        if (entryPath.startsWith(path)) {
          result = true;
        }
        // result = isDirectory(mfs, cwd)(entry.realPath);
      }
      if (isFileEntry(entry)) {
        const dir = dirname(entryPath);
        if (dir.startsWith(path)) {
          result = true;
        }
      }
    }
    // console.log("MOCK: isDirectory", path, result);
    return result;
  };

function isFileEntry(entry: Entry | undefined): boolean {
  if (entry === undefined) return false;
  return entry.type === "JsonFileEntry" || entry.type === "TsFileEntry";
}
