import { FileSystem } from "../filesystem";

export type VirtualFilesystem = {
  [path: string]: Entry;
};

export type Entry = FileEntry | DirEntry | LinkEntry;

export type FileEntry = { type: "FileEntry"; content: unknown };
export type DirEntry = { type: "DirEntry" };
export type LinkEntry = { type: "LinkEntry"; realPath: string };

export function createFilesystem(vfs: VirtualFilesystem): FileSystem {
  return {
    cwd: () => "/abs/working/dir",
    fileExists: () => false,
    isDirectory: () => false,
    getRealpath: () => undefined,
  };
}
