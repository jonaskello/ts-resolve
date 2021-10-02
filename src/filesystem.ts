import fs from "fs";

export type FileSystem = {
  readonly cwd: () => string;
  readonly fileExists: FileExists;
  readonly isDirectory: (path) => boolean;
};

export type FileExists = (path: string) => boolean;
export type IsDirectory = (path: string) => boolean;

export function createDefaultFilesystem(): FileSystem {
  return {
    cwd: process.cwd,
    fileExists: (url: string) => {
      try {
        return fs.statSync(url, { throwIfNoEntry: false })?.isFile() ?? false;
      } catch (e) {
        return false;
      }
    },
    isDirectory: (path: string) =>
      fs.statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false,
  };
}
