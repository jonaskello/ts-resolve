import { URL, pathToFileURL, fileURLToPath } from "url";
import path from "path";
import debugCreator from "debug";
// import * as ru from "./resolve-utils";
import * as rua from "./resolve-utils-api";
import { createDefaultFilesystem, IsFile, FileSystem, GetRealpath, IsDirectory, ReadFile } from "./filesystem";
import { getTsConfigInfo, TsConfigInfo } from "./tsconfig-info";

const debug = debugCreator("ts-resolve");

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
  entryTsConfig: string,
  fileSystemIn?: FileSystem | undefined
): ResolveReturn | undefined {
  // Let node handle `data:` and `node:` prefix etc.
  const excludeRegex = /^\w+:/;
  if (excludeRegex.test(specifier)) {
    return undefined;
  }

  // Fallback to default filesystem
  const filesystem = fileSystemIn ?? createDefaultFilesystem();

  debug("RESOLVE: START");

  const { parentURL: parentURLIn, conditions } = context;

  // If parentURL was not specified, then we use cwd
  const parentURL = parentURLIn ?? filesystem.cwd();
  debug("RESOLVE: parentURL", parentURL);

  const entryTsConfigUrl = pathToFileURL(path.join(filesystem.cwd(), entryTsConfig)).href;

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
    debug("specifier, parentURL", specifier, parentURL);
    const absFilePath = path.join(parentURL, specifier);
    const url = pathToFileURL(absFilePath);
    return { fileUrl: url.href, tsConfigUrl: entryTsConfigUrl };
  }

  // Get tsconfig info (it can be cached)
  const tsConfigInfo = getTsConfigInfo(filesystem, entryTsConfig);

  // Try to resolve to a typescript file, returns undefined if it could not be resolved
  const conditionsSet = rua.getConditionsSet(conditions);
  const resolved = tsModuleResolve(specifier, parentURL, conditionsSet, tsConfigInfo, filesystem);
  return resolved;
}

function tsModuleResolve(
  specifier: string,
  base: string | undefined,
  conditions: ReadonlySet<string>,
  tsConfigInfo: TsConfigInfo,
  filesystem: FileSystem
): ResolveReturn | undefined {
  debug("tsModuleResolve: START");

  // Resolve path specifiers
  if (rua.shouldBeTreatedAsRelativeOrAbsolutePath(specifier)) {
    debug("tsModuleResolve: resolveFilePath", specifier, base);
    // parentURL is the URL returned by previous resolve, so it is always a fully resolved specifier
    // If a ./foo.ts file was resolved for
    // import xxxx from "./foo.js"
    // Then ./foo.ts file will be the parentURL, not foo.js
    // This means abs/relative imports never need mapping of path from output to input
    const parentTsFile = new URL(specifier, base);

    debug("myModuleResolve: resolved", parentTsFile.href);

    const tsFileUrl = probeForTsFileInSamePathAsJsFile(parentTsFile, filesystem.isFile);
    if (tsFileUrl !== undefined) {
      const tsFilePath = fileURLToPath(tsFileUrl);
      const thePaths = Array.from(tsConfigInfo.absRootDirToTsConfig.entries()).find((e) => tsFilePath.startsWith(e[0]));
      debug("GOT relative with thePaths", thePaths);
      if (thePaths === undefined) {
        return undefined;
      }
      const [, tsConfigAbsPath] = thePaths;
      const tsConfigUrl = pathToFileURL(tsConfigAbsPath).href;
      return { fileUrl: tsFileUrl.href, tsConfigUrl };
    }
    return undefined;
  }

  // Resolve bare specifiers
  let possibleUrls: ReadonlyArray<URL> = [];
  if (specifier.startsWith("#")) {
    debug("myModuleResolve: packageImportsResolve");
    const { resolved } = rua.packageImportsResolve(packageResolve, specifier, base, conditions, filesystem.readFile)!;
    possibleUrls = [resolved];
  } else {
    debug("myModuleResolve: else");
    try {
      possibleUrls = [new URL(specifier)];
    } catch {
      debug("myModuleResolve: packageResolve");
      possibleUrls = packageResolve(specifier, base, conditions, filesystem.isDirectory, filesystem.readFile);
      debug("myModuleResolve: packageResolve RETURN", Array.isArray(possibleUrls));
    }
  }
  debug("myModuleResolve: END");

  // At this point the bare specifier is resolved to one or more possible JS files
  // Cannot be a .ts file since that case only exists for the entry file and is handled directly in resolve()
  debug("bare specifiier possibleUrls", possibleUrls.length);
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
        debug("---------> RESOLVED BARE SPECIFIER: ", tsFile.href);
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
): { readonly fileUrl: URL; readonly tsConfigAbsPath: string } | undefined {
  const outFilePath = fileURLToPath(outFileUrl);
  const thePaths = getAbsOutDirAndAbsTsconfigForOutFile(tsConfigInfo, outFilePath);
  if (thePaths === undefined) {
    return undefined;
  }
  const [absOutDir, tsConfigAbsPath] = thePaths;

  const tc = tsConfigInfo.tsconfigMap.get(tsConfigAbsPath);
  // let absRootDir: string | undefined = undefined;
  const absRootDir = path.join(path.dirname(tsConfigAbsPath), tc?.compilerOptions?.rootDir ?? "");
  debug("-----> checking for root dir", absRootDir);

  if (absOutDir) {
    // const outDir = tsConfigInfo.absOutDirToTsConfig[absOutDir];
    if (!outFilePath.startsWith(absOutDir)) {
      throw new Error("Mismatch in paths");
    }
    const remaining = outFilePath.substr(absOutDir.length);
    const convertedPath = path.join(absRootDir, remaining);
    debug("---->CONVERTED PATH", convertedPath);
    return { fileUrl: pathToFileURL(convertedPath), tsConfigAbsPath };
  }
  return undefined;
}

function getAbsOutDirAndAbsTsconfigForOutFile(
  tsConfigInfo: TsConfigInfo,
  outFilePath: string
): readonly [absOutDir: string, absTsconfig: string] | undefined {
  return Array.from(tsConfigInfo.absOutDirToTsConfig.entries()).find((e) => outFilePath.startsWith(e[0]));
  // for (const [key, value] of tsConfigInfo.absOutDirToTsConfig.entries()) {
  //   if (outFilePath.startsWith(key)) {
  //     return [key, value];
  //   }
  // }
  // return undefined;
}

/**
 * Convert a path that contains symlinks to a real path without requiring the full path to exist.
 * If a starting part of the path exists, it will be converted to a real path,
 * and then the rest of the path (the non-existing part) will be added to the end.
 */
function realPathOfSymlinkedUrl(inputUrl: URL, getRealPath: GetRealpath): URL {
  const pathString = fileURLToPath(inputUrl);
  debug("realPathOfSymlinkedUrl--START", pathString);
  const pathParts = pathString.substr(1).split(path.sep);
  let existingRealPath = "/";
  let i: number = 0;
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
  debug("realPathOfSymlinkedUrl--END", fullPath);
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
  return undefined;
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
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  conditions: ReadonlySet<string>,
  isDirectory: IsDirectory,
  readFile: ReadFile
): ReadonlyArray<URL> {
  // Parse the specifier as a package name (package or @org/package) and separate out the sub-path
  const { packageName, packageSubpath, isScoped } = rua.parsePackageName(specifier, base);

  // ResolveSelf
  // Check if the specifier resolves to the same package we are resolving from
  const selfResolved = rua.resolveSelf(packageResolve, base, packageName, packageSubpath, conditions, readFile);
  if (selfResolved) {
    return [selfResolved];
  }

  // Find package.json by ascending the file system
  const packageJsonMatch = rua.findPackageJson(packageName, base, isScoped, isDirectory);

  // If package.json was found, resolve from it's exports or main field
  if (packageJsonMatch) {
    const [packageJSONUrl, packageJSONPath] = packageJsonMatch;
    const packageConfig = rua.getPackageConfig(readFile, packageJSONPath, specifier, base);
    if (packageConfig.exports !== undefined && packageConfig.exports !== null) {
      const per = rua.packageExportsResolve(
        packageResolve,
        packageJSONUrl,
        packageSubpath,
        packageConfig,
        base,
        conditions
      ).resolved;
      return [per];
    }
    debug("packageSubpath", packageSubpath);
    if (packageSubpath === ".") {
      // return legacyMainResolve(packageJSONUrl, packageConfig, base);
      return rua.legacyMainResolve2(packageJSONUrl, packageConfig);
    }
    return [new URL(packageSubpath, packageJSONUrl)];
  }

  // eslint can't handle the above code.
  // eslint-disable-next-line no-unreachable
  //throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base ?? ""));
  return [];
}

function isTypescriptFile(url: string): boolean {
  return url.endsWith(".ts") || url.endsWith(".tsx");
}
