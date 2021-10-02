import { FileSystem } from "../filesystem";

export type MockFilesystem = {
  [path: string]: Entry;
};

export type Entry = FileEntry | DirEntry | LinkEntry;

export type FileEntry = { type: "FileEntry"; content: string };
export type DirEntry = { type: "DirEntry" };
export type LinkEntry = { type: "LinkEntry"; realPath: string };

export function createFilesystem(mfs: MockFilesystem, cwd: string): FileSystem {
  return {
    cwd: () => cwd,
    fileExists: (path: string) => {
      console.log("MOCK: fileExists", path);
      return false;
    },
    isDirectory: (path: string) => {
      const hit = mfs[path];
      const result = hit !== undefined && hit.type === "DirEntry";
      console.log("MOCK: isDirectory", result);
      return result;
    },
    getRealpath: (path: string) => {
      console.log("MOCK: getRealpath", path);
      return undefined;
    },
    readFile: (path: string) => {
      const entry = mfs[path];
      if (entry.type === "FileEntry") {
        return entry.content;
      }
      return undefined;
    },
  };
}
