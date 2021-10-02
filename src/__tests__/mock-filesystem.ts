import { dirname } from "path";
import { FileSystem } from "../filesystem";

export type MockFilesystem = {
  [path: string]: Entry;
};

export type Entry = FileEntry | LinkEntry; //| DirEntry;

export type FileEntry = { type: "FileEntry"; content: string };
// export type DirEntry = { type: "DirEntry" };
export type LinkEntry = { type: "LinkEntry"; realPath: string };

export function createFilesystem(mfs: MockFilesystem, cwd: string): FileSystem {
  return {
    cwd: () => cwd,
    fileExists: (path: string) => {
      const result = mfs[path]?.type === "FileEntry";
      console.log("MOCK: fileExists", path, result);
      return result;
    },
    isDirectory: (path: string) => {
      let result = false;
      for (let [entryPath, entry] of Object.entries(mfs)) {
        if (entry.type === "FileEntry") {
          const dir = dirname(entryPath);
          if (dir.startsWith(path)) {
            result = true;
          }
        }
      }
      console.log("MOCK: isDirectory", path, result);
      return result;
    },
    getRealpath: (path: string) => {
      console.log("MOCK: getRealpath", path);
      return undefined;
    },
    readFile: (path: string) => {
      let result: string = undefined;
      const entry = mfs[path];
      if (entry !== undefined && entry.type === "FileEntry") {
        result = entry.content;
      }
      console.log("MOCK: readFile", path, result);
      return result;
    },
  };
}