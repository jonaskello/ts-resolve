import fs from "fs";

export type FileSystem = {
  readonly cwd: () => string;
  readonly isFile: IsFile;
  readonly isDirectory: IsDirectory;
  readonly getRealpath: GetRealpath;
  readonly readFile: ReadFile;
};

export type IsFile = (path: string) => boolean;
export type IsDirectory = (path: string) => boolean;
export type GetRealpath = (path: string) => string | undefined;
export type ReadFile = (filename: string) => string | undefined;

export function createDefaultFilesystem(): FileSystem {
  return {
    cwd: process.cwd,
    isFile: (url: string) => fs.statSync(url, { throwIfNoEntry: false })?.isFile() ?? false,
    isDirectory: (path: string) => fs.statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false,
    getRealpath: (path: string) => {
      try {
        return fs.realpathSync(path);
      } catch (e: unknown) {
        return undefined;
      }
    },
    readFile: (path: string) => fs.readFileSync(path, "utf8"),
  };
}
