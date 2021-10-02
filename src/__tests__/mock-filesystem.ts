import { FileSystem } from "../filesystem";

export type MockFilesystem = {
  [path: string]: Entry;
};

export type Entry = FileEntry | DirEntry | LinkEntry;

export type FileEntry = { type: "FileEntry"; content: unknown };
export type DirEntry = { type: "DirEntry" };
export type LinkEntry = { type: "LinkEntry"; realPath: string };

export function createFilesystem(vfs: MockFilesystem, cwd: string): FileSystem {
  return {
    cwd: () => cwd,
    fileExists: (path: string) => {
      console.log("MOCK: fileExists", path);
      return false;
    },
    isDirectory: (path: string) => {
      console.log("MOCK: isDirectory", path);
      return false;
    },
    getRealpath: (path: string) => {
      console.log("MOCK: getRealpath", path);
      return undefined;
    },
  };
}
