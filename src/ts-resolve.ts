import { URL, pathToFileURL, fileURLToPath } from "url";
import path from "path";
import { loadTsconfig, Tsconfig } from "./tsconfig-loader";

import {
  getPackageConfig, // getPackageConfig does filesystem access
  shouldBeTreatedAsRelativeOrAbsolutePath,
  parsePackageName,
  getConditionsSet,
  packageImportsResolve,
  packageExportsResolve,
  resolveSelf,
  findPackageJson,
  legacyMainResolve2,
} from "./resolve-utils";
import { createDefaultFilesystem, IsFile, FileSystem, GetRealpath, IsDirectory, ReadFile } from "./filesystem";
import { buildTsConfigInfo, getTsConfigInfo, TsConfigInfo } from "./tsconfig-info";

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
  if (entryTsConfig === undefined || entryTsConfig === null || entryTsConfig === "") {
    throw new Error("Entry tsconfig file must be passed or present in TS_NODE_PROJECT.");
  }

  // Fallback to default filesystem
  const filesystem = fileSystemIn ?? createDefaultFilesystem();

  console.log("RESOLVE: START");

  // parentURL is the URL returned by previous resolve, so it is not the specifier that did the import but the resolved specifier
  // If a ./foo.ts file was resolved for
  // import xxxx from "./foo.js"
  // Then ./foo.ts file will be the parentURL, not foo.js
  // This means abs/relative imports never need mapping of path from output to input
  let { parentURL: parentURLIn, conditions } = context;

  // If parentURL was not specified, then we use cwd
  const parentURL = parentURLIn ?? filesystem?.cwd() ?? process.cwd();
  console.log("RESOLVE: parentURL", parentURL);

  // Get tsconfig info (it can be cached)
  const tsConfigInfo = getTsConfigInfo(filesystem, entryTsConfig);

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
  const resolved = tsModuleResolve(specifier, parentURL, conditionsSet, tsConfigInfo, filesystem);
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

    const tsFileUrl = probeForTsFileInSamePathAsJsFile(resolved, filesystem.isFile);
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
      const tsFile = probeForTsFileInSamePathAsJsFile(fileUrl, filesystem.isFile);
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
function probeForTsFileInSamePathAsJsFile(jsFileUrl: URL, isFile: IsFile): URL | undefined {
  // The jsFile can be extensionless or have another extension
  // so we remove any extension and try with .ts and .tsx
  const jsFilePath = fileURLToPath(jsFileUrl);
  const parsedPath = path.parse(jsFilePath);
  const extensionless = path.join(parsedPath.dir, parsedPath.name);
  if (isFile(extensionless + ".ts")) {
    return pathToFileURL(extensionless + ".ts");
  }
  if (isFile(extensionless + ".tsx")) {
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
  const selfResolved = resolveSelf(packageResolve, base, packageName, packageSubpath, conditions, readFile);
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
    console.log("packageSubpath", packageSubpath);
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

function isTypescriptFile(url: string) {
  const extensionsRegex = /\.ts$/;
  return extensionsRegex.test(url);
}
