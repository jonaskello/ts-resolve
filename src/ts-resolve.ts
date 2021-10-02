import { URL, pathToFileURL, fileURLToPath } from "url";
import path from "path";
import { loadTsconfig, Tsconfig } from "./tsconfig-loader";

import {
  getPackageConfig, // getPackageConfig does filesystem access
  getPackageScopeConfig, // getPackageScopeConfig calls getPackageConfig
  shouldBeTreatedAsRelativeOrAbsolutePath,
  parsePackageName,
  getConditionsSet,
  packageImportsResolve,
  packageExportsResolve,
} from "./resolve_utils";
import { createDefaultFilesystem, FileExists, FileSystem, GetRealpath, IsDirectory, ReadFile } from "./filesystem";
import { readFileSync } from "fs";

type TsConfigInfo = {
  tsconfigMap: Map<string, Tsconfig>;
  absOutDirToTsConfig: Map<string, string>;
};

const entryTsConfigInfoCache: Map<string, TsConfigInfo> = new Map();

export type ResolveContext = {
  readonly conditions: ReadonlyArray<string>;
  readonly parentURL: string | undefined;
};

export type ResolveReturn = {
  readonly tsConfigUrl: string;
  readonly fileUrl: string;
};

/**
 * Resolves to a typescript file, or returns undefined if
 * no typescript file was available.
 */
export function tsResolve(
  specifier: string,
  context: ResolveContext,
  tsConfigPathIn?: string | undefined,
  fileSystemIn?: FileSystem | undefined
): ResolveReturn | undefined {
  // Let node handle `data:` and `node:` prefix etc.
  const excludeRegex = /^\w+:/;
  if (excludeRegex.test(specifier)) {
    return undefined;
  }

  // Fallback for entry tsconfig.json
  const entryTsConfig = tsConfigPathIn ?? process.env["TS_NODE_PROJECT"];

  // Fallback to default filesystem
  const fileystem = fileSystemIn ?? createDefaultFilesystem();

  console.log("RESOLVE: START");

  // parentURL is the URL returned by previous resolve, so it is not the specifier that did the import but the resolved specifier
  // If a ./foo.ts file was resolved for
  // import xxxx from "./foo.js"
  // Then ./foo.ts file will be the parentURL, not foo.js
  // This means abs/relative imports never need mapping of path from output to input
  let { parentURL: parentURLIn, conditions } = context;

  // If parentURL was not specified, then we use cwd
  const parentURL = parentURLIn ?? fileystem?.cwd() ?? process.cwd();
  console.log("RESOLVE: parentURL", parentURL);

  // Build tsconfig map if we don't have it
  if (entryTsConfig === undefined || entryTsConfig === null || entryTsConfig === "") {
    throw new Error("Entry tsconfig file must be passed or present in TS_NODE_PROJECT.");
  }
  let tsConfigInfo = entryTsConfigInfoCache.get(entryTsConfig);
  if (tsConfigInfo === undefined) {
    tsConfigInfo = buildTsConfigInfo(
      entryTsConfig,
      fileystem.cwd(),
      fileystem.isDirectory,
      fileystem.fileExists,
      fileystem.readFile
    );
    entryTsConfigInfoCache.set(entryTsConfig, tsConfigInfo);
  }

  // If file explicitly ends in .ts then just return it
  // This can only happen for the entry file as typescript does not allow
  // import of .ts files
  if (isTypescriptFile(specifier)) {
    // Assert this is the entry
    if (parentURLIn !== undefined) {
      throw new Error(
        "Typescript files (*.ts/tsx) can only used as entry file, not be imported (this should never happen)."
      );
    }
    console.log("specifier, parentURL", specifier, parentURL);
    const absFilePath = path.join(parentURL, specifier);
    const url = pathToFileURL(absFilePath);
    return { fileUrl: url.href, tsConfigUrl: "EntryPoint" };
  }

  // Try to resolve to a typescript file, returns undefined if it could not be resolved
  const conditionsSet = getConditionsSet(conditions);
  const resolved = tsModuleResolve(specifier, parentURL, conditionsSet, tsConfigInfo, fileystem);
  return resolved;
}

/**
 * @param {string} specifier
 * @param {string | URL | undefined} base
 * @param {Set<string>} conditions
 * @returns {URL}
 */
function tsModuleResolve(
  specifier: string,
  base: string | undefined,
  conditions: Set<string>,
  tsConfigInfo: TsConfigInfo,
  filesystem: FileSystem
): ResolveReturn | undefined {
  console.log("tsModuleResolve: START");

  // Resolve path specifiers
  if (shouldBeTreatedAsRelativeOrAbsolutePath(specifier)) {
    console.log("tsModuleResolve: resolveFilePath", specifier, base);
    const resolved = new URL(specifier, base);
    // console.log("myModuleResolve: tsConfigInfo", tsConfigInfo);
    // const tsConfigAbsPath = getTsConfigAbsPathForOutFile(
    //   tsConfigInfo,
    //   resolved
    // );
    // console.log("myModuleResolve: tsConfigAbsPath", tsConfigAbsPath);
    // if (tsConfigAbsPath) {
    //   // If the file was in the output space of a tsconfig, then just
    //   // probe for file-ext as there can be no path-mapping for abs/rel paths
    //   const tsFile = probeForTsExtFile(resolved);
    //   console.log("myModuleResolve: tsFile", tsFile);
    //   if (tsFile !== undefined) {
    //     return [new URL(tsFile), tsConfigAbsPath];
    //   }
    // }
    console.log("myModuleResolve: resolved", resolved.href);

    const tsFileUrl = probeForTsFileInSamePathAsJsFile(resolved, filesystem.fileExists);
    if (tsFileUrl !== undefined) {
      // This file belongs to the same TsConfig as it's ParentUrl, but we don't know
      // which TsConfig the ParentUrl belongs to....
      // Or is it allowed in typescript composite project to make a relative import to a file in a different TsConfig?
      return { fileUrl: tsFileUrl.href, tsConfigUrl: "SameAsParent" };
    }
    return undefined;
  }

  // Resolve bare specifiers
  let possibleUrls: ReadonlyArray<URL>;
  if (specifier[0] === "#") {
    console.log("myModuleResolve: packageImportsResolve");
    const { resolved } = packageImportsResolve(packageResolve, specifier, base, conditions, filesystem.readFile)!;
    possibleUrls = [resolved];
  } else {
    console.log("myModuleResolve: else");
    try {
      possibleUrls = [new URL(specifier)];
    } catch {
      console.log("myModuleResolve: packageResolve");
      possibleUrls = packageResolve(specifier, base, conditions, filesystem.isDirectory, filesystem.readFile);
      console.log("myModuleResolve: packageResolve RETURN", Array.isArray(possibleUrls));
    }
  }
  console.log("myModuleResolve: END");

  // At this point the bare specifier is resolved to one or more possible JS files
  // Cannot be a .ts file since that case only exists for the entry file and is handled directly in resolve()
  console.log("bare specifiier possibleUrls", possibleUrls.length);
  for (const possibleUrl of possibleUrls) {
    // Convert path (useful if the specifier was a reference to a package which is in the same composite project)
    // If the resolution resulted in a symlink then use the real path instead
    const realPossibleUrl = realPathOfSymlinkedUrl(possibleUrl, filesystem.getRealpath);
    const possibleSourceLocation = convertTypescriptOutUrlToSourceLocation(tsConfigInfo, realPossibleUrl);
    if (possibleSourceLocation !== undefined) {
      const { fileUrl, tsConfigAbsPath } = possibleSourceLocation;
      //
      const tsFile = probeForTsFileInSamePathAsJsFile(fileUrl, filesystem.fileExists);
      if (tsFile !== undefined) {
        console.log("---------> RESOLVED BARE SPECIFIER: ", tsFile.href);
        // finalizeResolution checks for old file endings if getOptionValue("--experimental-specifier-resolution") === "node"
        // const finalizedUrl = finalizeResolution(tsFile, base);
        const finalizedUrl = tsFile;
        return {
          fileUrl: finalizedUrl.href,
          tsConfigUrl: pathToFileURL(tsConfigAbsPath).href,
        };
      }
    }
    // }
  }
  return undefined;
}

/**
 * Given an URL that a TS file will emit a JS file to when compiled, convert that back to the URL
 * for the source TS file.
 */
function convertTypescriptOutUrlToSourceLocation(
  tsConfigInfo: TsConfigInfo,
  outFileUrl: URL
): { fileUrl: URL; tsConfigAbsPath: string } | undefined {
  const outFilePath = fileURLToPath(outFileUrl);
  let absOutDir: string | undefined = undefined;
  let tsConfigAbsPath: string | undefined = undefined;
  let absRootDir: string | undefined = undefined;
  for (const [key, value] of tsConfigInfo.absOutDirToTsConfig.entries()) {
    if (outFilePath.startsWith(key)) {
      absOutDir = key;
      tsConfigAbsPath = value;
      const tc = tsConfigInfo.tsconfigMap.get(tsConfigAbsPath);
      absRootDir = path.join(path.dirname(tsConfigAbsPath), tc?.compilerOptions?.rootDir ?? "");
      console.log("-----> checking for root dir", absRootDir);
      break;
    }
  }
  if (absOutDir === undefined || tsConfigAbsPath === undefined || absRootDir === undefined) {
    return undefined;
  }

  if (absOutDir) {
    // const outDir = tsConfigInfo.absOutDirToTsConfig[absOutDir];
    if (!outFilePath.startsWith(absOutDir)) {
      throw new Error("Mismatch in paths");
    }
    const remaining = outFilePath.substr(absOutDir.length);
    const convertedPath = path.join(absRootDir, remaining);
    console.log("---->CONVERTED PATH", convertedPath);
    return { fileUrl: pathToFileURL(convertedPath), tsConfigAbsPath };
  }
  return undefined;
}

/**
 * Convert a path that contains symlinks to a real path without requiring the full path to exist.
 * If a starting part of the path exists, it will be converted to a real path,
 * and then the rest of the path (the non-existing part) will be added to the end.
 */
function realPathOfSymlinkedUrl(inputUrl: URL, getRealPath: GetRealpath): URL {
  const pathString = fileURLToPath(inputUrl);
  console.log("realPathOfSymlinkedUrl--START", pathString);
  const pathParts = pathString.substr(1).split(path.sep);
  let existingRealPath = "/";
  let i: number;
  for (i = 0; i < pathParts.length; i++) {
    const pp = pathParts[i];
    const checkPath = path.join(existingRealPath, pp);
    const newRealpath = getRealPath(checkPath);
    if (newRealpath === undefined) {
      break;
    }
    existingRealPath = newRealpath;
  }
  const fullPath = path.join(existingRealPath, ...pathParts.slice(i));
  console.log("realPathOfSymlinkedUrl--END", fullPath);
  return pathToFileURL(fullPath);
}

/**
 * Given a file with a javascript extension, probe for a file with
 * typescript extension in the exact same path.
 */
function probeForTsFileInSamePathAsJsFile(jsFileUrl: URL, fileExists: FileExists): URL | undefined {
  // The jsFile can be extensionless or have another extension
  // so we remove any extension and try with .ts and .tsx
  const jsFilePath = fileURLToPath(jsFileUrl);
  const parsedPath = path.parse(jsFilePath);
  const extensionless = path.join(parsedPath.dir, parsedPath.name);
  if (fileExists(extensionless + ".ts")) {
    return pathToFileURL(extensionless + ".ts");
  }
  if (fileExists(extensionless + ".tsx")) {
    return pathToFileURL(extensionless + ".tsx");
  }
}

/**
 * This function resolves bare specifiers that refers to packages (not node:, data: bare specifiers)
 * @param {string} specifier
 * @param {string | URL | undefined} base
 * @param {Set<string>} conditions
 * @returns {URL}
 */
function packageResolve(
  specifier: string,
  base: string | URL | undefined,
  conditions: Set<string>,
  isDirectory: IsDirectory,
  readFile: ReadFile
): ReadonlyArray<URL> {
  // Parse the specifier as a package name (package or @org/package) and separate out the sub-path
  const { packageName, packageSubpath, isScoped } = parsePackageName(specifier, base);

  // ResolveSelf
  // Check if the specifier resolves to the same package we are resolving from
  const selfResolved = resolveSelf(base, packageName, packageSubpath, conditions, readFile);
  if (selfResolved) return [selfResolved];

  // Find package.json by ascending the file system
  const packageJsonMatch = findPackageJson(packageName, base, isScoped, isDirectory);

  // If package.json was found, resolve from it's exports or main field
  if (packageJsonMatch) {
    const [packageJSONUrl, packageJSONPath] = packageJsonMatch;
    const packageConfig = getPackageConfig(readFile, packageJSONPath, specifier, base);
    if (packageConfig.exports !== undefined && packageConfig.exports !== null) {
      const per = packageExportsResolve(
        packageResolve,
        packageJSONUrl,
        packageSubpath,
        packageConfig,
        base,
        conditions
      ).resolved;
      return per ? [per] : [];
    }
    if (packageSubpath === ".")
      // return legacyMainResolve(packageJSONUrl, packageConfig, base);
      return legacyMainResolve2(packageJSONUrl, packageConfig);
    return [new URL(packageSubpath, packageJSONUrl)];
  }

  // eslint can't handle the above code.
  // eslint-disable-next-line no-unreachable
  //throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base ?? ""));
  return [];
}

// This could probably be moved to a built-in API
function findPackageJson(packageName: string, base: string | URL, isScoped: boolean, isDirectory: IsDirectory) {
  let packageJSONUrl = new URL("./node_modules/" + packageName + "/package.json", base);
  let packageJSONPath = fileURLToPath(packageJSONUrl);
  let lastPath;
  do {
    // const stat = tryStatSync(
    //   // StringPrototypeSlice(packageJSONPath, 0, packageJSONPath.length - 13)
    //   packageJSONPath.slice(0, packageJSONPath.length - 13)
    // );
    const isDir = isDirectory(packageJSONPath.slice(0, packageJSONPath.length - 13));
    // if (!stat.isDirectory()) {
    if (!isDir) {
      lastPath = packageJSONPath;
      packageJSONUrl = new URL(
        (isScoped ? "../../../../node_modules/" : "../../../node_modules/") + packageName + "/package.json",
        packageJSONUrl
      );
      packageJSONPath = fileURLToPath(packageJSONUrl);
      continue;
    }

    // Package match.
    return [packageJSONUrl, packageJSONPath];
    // Cross-platform root check.
  } while (packageJSONPath.length !== lastPath.length);
  return undefined;
}

// This could probably be moved to a built-in API
// However it needs packageResolve since it calls into packageExportsResolve()
function resolveSelf(base, packageName, packageSubpath, conditions, readFile: ReadFile) {
  const packageConfig = getPackageScopeConfig(base, readFile);
  if (packageConfig.exists) {
    const packageJSONUrl = pathToFileURL(packageConfig.pjsonPath);
    if (packageConfig.name === packageName && packageConfig.exports !== undefined && packageConfig.exports !== null) {
      return packageExportsResolve(packageResolve, packageJSONUrl, packageSubpath, packageConfig, base, conditions)
        .resolved;
    }
  }
  return undefined;
}

/**
 * Legacy CommonJS main resolution:
 * 1. let M = pkg_url + (json main field)
 * 2. TRY(M, M.js, M.json, M.node)
 * 3. TRY(M/index.js, M/index.json, M/index.node)
 * 4. TRY(pkg_url/index.js, pkg_url/index.json, pkg_url/index.node)
 * 5. NOT_FOUND
 * @param {PackageConfig} packageConfig
 * @param {string | URL | undefined} base
 * @returns {URL}
 */
function legacyMainResolve2(packageJSONUrl, packageConfig): ReadonlyArray<URL> {
  const guess: Array<URL> = [];
  if (packageConfig.main !== undefined) {
    guess.push(
      ...[
        new URL(`./${packageConfig.main}.node`, packageJSONUrl),
        new URL(`./${packageConfig.main}`, packageJSONUrl),
        new URL(`./${packageConfig.main}.js`, packageJSONUrl),
        new URL(`./${packageConfig.main}.json`, packageJSONUrl),
        new URL(`./${packageConfig.main}.node`, packageJSONUrl),
        new URL(`./${packageConfig.main}/index.js`, packageJSONUrl),
        new URL(`./${packageConfig.main}/index.json`, packageJSONUrl),
        new URL(`./${packageConfig.main}/index.node`, packageJSONUrl),
      ]
    );
  }
  guess.push(
    ...[
      new URL("./index.js", packageJSONUrl),
      new URL("./index.json", packageJSONUrl),
      new URL("./index.node", packageJSONUrl),
    ]
  );
  return guess;
}

function isTypescriptFile(url) {
  const extensionsRegex = /\.ts$/;
  return extensionsRegex.test(url);
}

function buildTsConfigInfo(
  entryTsConfig: string,
  cwd: string,
  isDirectory: IsDirectory,
  fileExists: FileExists,
  readFile: ReadFile
): TsConfigInfo {
  const tsconfigMap = loadTsConfigAndResolveReferences(entryTsConfig, cwd, isDirectory, fileExists, readFile);
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
  fileExists: FileExists,
  readFile: ReadFile
): Map<string, Tsconfig> {
  const tsconfigMap = new Map();
  console.log(`entryTsConfig = '${entryTsConfig}'`);
  loadTsConfigAndResolveReferencesRecursive(
    cwd,
    [{ path: entryTsConfig }],
    tsconfigMap,
    isDirectory,
    fileExists,
    readFile
  );
  return tsconfigMap;
}

function loadTsConfigAndResolveReferencesRecursive(
  cwd: string,
  refs: Array<{ path: string }>,
  tsconfigMap: Map<string, Tsconfig>,
  isDirectory: IsDirectory,
  fileExists: FileExists,
  readFile: ReadFile
): Map<string, Tsconfig> {
  for (const ref of refs) {
    console.log("resolveConfigPath", cwd, ref.path);
    let fullPath = path.join(cwd, ref.path);
    if (isDirectory(fullPath)) {
      fullPath = path.join(fullPath, "tsconfig.json");
    }
    const tsconfig = loadTsconfig(fullPath, fileExists, readFile);
    if (!tsconfig) {
      throw new Error(`Could not find tsconfig in path '${fullPath}'.`);
    }
    tsconfigMap.set(fullPath, tsconfig);
    loadTsConfigAndResolveReferencesRecursive(
      path.dirname(fullPath),
      tsconfig?.references ?? [],
      tsconfigMap,
      isDirectory,
      fileExists,
      readFile
    );
  }
  return tsconfigMap;
}
