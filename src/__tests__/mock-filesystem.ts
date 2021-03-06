import { FileSystem } from "../filesystem";

export type MockFilesystem = {
  readonly [path: string]: Entry;
};

export type Entry = JsonFile | TsFile | Symlink;

// eslint-disable-next-line @typescript-eslint/ban-types
export type JsonFile = { readonly type: "JsonFile"; readonly json: object };
export type TsFile = {
  readonly type: "TsFile";
  readonly imports: ReadonlyArray<{ readonly unresolved: string; readonly resolved: string }>;
  readonly tsconfig: string;
};
export type Symlink = { readonly type: "Symlink"; readonly realPath: string };

export function createFilesystem(mfs: MockFilesystem, cwd: string): FileSystem {
  return {
    cwd: () => cwd,
    isFile: (path: string) => isFileEntry(mfs[path]),
    isDirectory: isDirectory(mfs),
    getRealpath: getRealPath(mfs),
    readFile: readFile(mfs),
  };
}

const isDirectory =
  (mfs: MockFilesystem) =>
  (path: string): boolean => {
    const realPath = getRealPath(mfs)(path);
    // Check if it is a file
    if (realPath !== undefined) {
      const exactMatch = mfs[realPath];
      if (exactMatch !== undefined && isFileEntry(exactMatch)) {
        return false;
      }
    }
    // If the realpath exists but is not a file, then it is a dir
    return pathExists(mfs, path);
  };

const getRealPath =
  (mfs: MockFilesystem) =>
  (path: string): string | undefined => {
    // Check if the start of path matches a symlink path and if so resolve that part and try again
    for (const [k, v] of Object.entries(mfs)) {
      if (v.type === "Symlink") {
        const realPath = v.realPath;
        if (path.startsWith(k)) {
          // Replace the matching start of path with the realpath
          const remainingPath = path.substr(k.length);
          const resolvedPath = realPath + remainingPath;
          return getRealPath(mfs)(resolvedPath);
        }
      }
    }
    // The path does not start with a link, so it is a realpath, check if it exists
    const result = (pathExists(mfs, path) && path) || undefined;
    return result;
  };

const readFile = (mfs: MockFilesystem) => (path: string) => {
  const realPath = getRealPath(mfs)(path);
  let result: string | undefined = undefined;
  if (realPath !== undefined) {
    const entry = mfs[realPath];
    if (entry !== undefined && entry.type === "JsonFile") {
      result = JSON.stringify(entry.json);
    }
  }
  return result;
};

function pathExists(mfs: MockFilesystem, path: string): boolean {
  for (const key of Object.keys(mfs)) {
    if (key.startsWith(path)) {
      return true;
    }
  }
  return false;
}

function isFileEntry(entry: Entry | undefined): boolean {
  if (entry === undefined) {
    return false;
  }
  return entry.type === "JsonFile" || entry.type === "TsFile";
}
