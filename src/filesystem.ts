import fs from "fs";

export type FileSystem = {
  readonly cwd: () => string;
  readonly fileExists: FileExists;
  readonly isDirectory: IsDirectory;
  readonly getRealpath: GetRealpath;
  readonly readFile: ReadFile;
};

export type FileExists = (path: string) => boolean;
export type IsDirectory = (path: string) => boolean;
export type GetRealpath = (path: string) => string | undefined;
export type ReadFile = (filename: string) => string | undefined;

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
    isDirectory: (path: string) => fs.statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false,
    getRealpath: (path: string) => {
      try {
        return fs.realpathSync(path);
      } catch (e) {
        return undefined;
      }
    },
    readFile: (path: string) => fs.readFileSync(path, "utf8"),
  };
}
