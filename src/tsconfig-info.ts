import path from "path";
import debugCreator from "debug";
import { loadTsconfig, Tsconfig } from "./tsconfig-loader";
import { IsFile, IsDirectory, ReadFile, FileSystem } from "./filesystem";

const debug = debugCreator("tsconfig-info");

export type TsConfigInfo = {
  tsconfigMap: Map<string, Tsconfig>;
  absOutDirToTsConfig: Map<string, string>;
};
let entryTsConfigInfoCache: Map<string, TsConfigInfo> = new Map();

export function clearCache(): void {
  entryTsConfigInfoCache = new Map();
}

export function getTsConfigInfo(fileystem: FileSystem, entryTsConfig: string): TsConfigInfo {
  let tsConfigInfo = entryTsConfigInfoCache.get(entryTsConfig);
  if (tsConfigInfo === undefined) {
    tsConfigInfo = buildTsConfigInfo(
      entryTsConfig,
      fileystem.cwd(),
      fileystem.isDirectory,
      fileystem.isFile,
      fileystem.readFile
    );
    entryTsConfigInfoCache.set(entryTsConfig, tsConfigInfo);
  }
  return tsConfigInfo;
}

export function buildTsConfigInfo(
  entryTsConfig: string,
  cwd: string,
  isDirectory: IsDirectory,
  isFile: IsFile,
  readFile: ReadFile
): TsConfigInfo {
  const tsconfigMap = loadTsConfigAndResolveReferences(entryTsConfig, cwd, isDirectory, isFile, readFile);
  const absOutDirToTsConfig = new Map();
  for (const [k, v] of tsconfigMap.entries()) {
    if (v.compilerOptions?.outDir === undefined) {
      throw new Error("Outdir must be defined for now...");
    }
    const absoluteOutDir = path.resolve(path.dirname(k), v.compilerOptions.outDir);
    absOutDirToTsConfig.set(absoluteOutDir, k);
  }
  return {
    tsconfigMap,
    absOutDirToTsConfig,
  };
}

export function loadTsConfigAndResolveReferences(
  entryTsConfig: string,
  cwd: string,
  isDirectory: IsDirectory,
  isFile: IsFile,
  readFile: ReadFile
): Map<string, Tsconfig> {
  const tsconfigMap = new Map();
  debug(`entryTsConfig = '${entryTsConfig}'`);
  loadTsConfigAndResolveReferencesRecursive(cwd, [{ path: entryTsConfig }], tsconfigMap, isDirectory, isFile, readFile);
  return tsconfigMap;
}

function loadTsConfigAndResolveReferencesRecursive(
  cwd: string,
  refs: Array<{ path: string }>,
  tsconfigMap: Map<string, Tsconfig>,
  isDirectory: IsDirectory,
  isFile: IsFile,
  readFile: ReadFile
): Map<string, Tsconfig> {
  for (const ref of refs) {
    debug("resolveConfigPath", cwd, ref.path);
    let fullPath = path.join(cwd, ref.path);
    if (isDirectory(fullPath)) {
      fullPath = path.join(fullPath, "tsconfig.json");
    }
    const tsconfig = loadTsconfig(fullPath, isFile, readFile);
    if (!tsconfig) {
      throw new Error(`Could not find tsconfig in path '${fullPath}'.`);
    }
    tsconfigMap.set(fullPath, tsconfig);
    loadTsConfigAndResolveReferencesRecursive(
      path.dirname(fullPath),
      tsconfig?.references ?? [],
      tsconfigMap,
      isDirectory,
      isFile,
      readFile
    );
  }
  return tsconfigMap;
}
