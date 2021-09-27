import { URL, pathToFileURL, fileURLToPath } from "url";
import fs from "fs";
import path from "path";
import { loadTsConfigAndResolveReferences, Tsconfig } from "./tsconfig-loader";
const { statSync, Stats } = require("fs");

const {
  getPackageConfig, // getPackageConfig does filesystem access
  getPackageScopeConfig, // getPackageScopeConfig calls getPackageConfig
  shouldBeTreatedAsRelativeOrAbsolutePath,
  parsePackageName,
  getConditionsSet,
  packageImportsResolve,
  packageExportsResolve,
} = require("./resolve_nofs");

// const { finalizeResolution } = require("./resolve_fs");

type TsConfigInfo = {
  tsconfigMap: Map<string, Tsconfig>;
  absOutDirToTsConfig: Map<string, string>;
};

const entryTsConfigInfoCache: Map<string, TsConfigInfo> = new Map();

type ResolveContext = {
  conditions: string[];
  parentURL: string | undefined;
};

type ResolveReturn = {
  format?: null | undefined | string;
  url: string;
};

/**
 * Resolves to a typescript file, or returns undefined if
 * no typescript file was available.
 */
export function tsResolve(
  specifier: string,
  context: ResolveContext
): ResolveReturn | undefined {
  console.log("RESOLVE: START");

  // parentURL is the URL returned by previous resolve, so it is not the specifier that did the import but the resolved specifier
  // If a ./foo.ts file was resolved for
  // import xxxx from "./foo.js"
  // Then ./foo.ts file will be the parentURL, not foo.js
  // This means abs/relative imports never need mapping of path from output to input
  let { parentURL, conditions } = context;
  console.log("RESOLVE: parentURL", parentURL);

  // Let node handle `data:` and `node:` prefix etc.
  const excludeRegex = /^\w+:/;
  if (excludeRegex.test(specifier)) {
    return undefined;
  }

  // Build tsconfig map if we don't have it
  const entryTsConfig = process.env["TS_NODE_PROJECT"];
  if (!entryTsConfig) {
    throw new Error("TS_NODE_PROJECT must be defined for now...");
  }
  let tsConfigInfo = entryTsConfigInfoCache.get(entryTsConfig);
  if (tsConfigInfo === undefined) {
    tsConfigInfo = buildTsConfigInfo(entryTsConfig);
    entryTsConfigInfoCache.set(entryTsConfig, tsConfigInfo);
  }

  // If file ends in .ts then just return it
  // This can only happen for the entry file as typescript does not allow
  // import of .ts files
  if (isTypescriptFile(specifier)) {
    const url = new URL(specifier, parentURL).href;
    return { url };
  }

  // Try to resolve to a typescript file
  const conditionsSet = getConditionsSet(conditions);
  const resolved = myModuleResolve(
    specifier,
    parentURL,
    conditionsSet,
    tsConfigInfo
  );
  if (resolved !== undefined) {
    const [url, format] = resolved;
    console.log("it was resolved", url.href, format);
    return { url: `${url}`, format };
  }

  // Not resolved as typescript, forward to default resolve
  return undefined;
}

/**
 * @param {string} specifier
 * @param {string | URL | undefined} base
 * @param {Set<string>} conditions
 * @returns {URL}
 */
function myModuleResolve(
  specifier: string,
  base: string | undefined,
  conditions: Set<string>,
  tsConfigInfo: TsConfigInfo
): readonly [URL, string] | undefined {
  console.log("myModuleResolve: START");

  // Resolve path specifiers
  if (shouldBeTreatedAsRelativeOrAbsolutePath(specifier)) {
    console.log("myModuleResolve: resolveFilePath");
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

    const tsFileUrl = probeForTsFileInSamePathAsJsFile(resolved);
    if (tsFileUrl !== undefined) {
      // This file belongs to the same TsConfig as it's ParentUrl, but we don't know
      // which TsConfig the ParentUrl belongs to....
      // Or is it allowed in typescript composite project to make a relative import to a file in a different TsConfig?
      return [tsFileUrl, "SameAsParent"];
    }
    return undefined;
  }

  // Resolve bare specifiers
  let possibleUrls: ReadonlyArray<URL>;
  if (specifier[0] === "#") {
    console.log("myModuleResolve: packageImportsResolve");
    const { resolved } = packageImportsResolve(
      packageResolve,
      specifier,
      base,
      conditions
    )!;
    possibleUrls = [resolved];
  } else {
    console.log("myModuleResolve: else");
    try {
      possibleUrls = [new URL(specifier)];
    } catch {
      console.log("myModuleResolve: packageResolve");
      possibleUrls = packageResolve(specifier, base, conditions);
      console.log(
        "myModuleResolve: packageResolve RETURN",
        Array.isArray(possibleUrls)
      );
    }
  }
  console.log("myModuleResolve: END");

  // At this point the bare specifier is resolved to one or more possible JS files
  // Cannot be a .ts file since that case only exists for the entry file and is handled directly in resolve()
  console.log("bare specifiier possibleUrls", possibleUrls.length);
  for (const possibleUrl of possibleUrls) {
    // Convert path (useful if the specifier was a reference to a package which is in the same composite project)
    // If the resolution resulted in a symlink then use the real path instead
    const realPossibleUrl = realPathOfSymlinkedUrl(possibleUrl);
    const possibleSourceUrl = convertTypescriptOutUrlToSourceUrl(
      tsConfigInfo,
      realPossibleUrl
    );
    if (possibleSourceUrl !== undefined) {
      //
      const tsFile = probeForTsFileInSamePathAsJsFile(possibleSourceUrl);
      if (tsFile !== undefined) {
        console.log("---------> RESOLVED BARE SPECIFIER: ", tsFile.href);
        // finalizeResolution checks for old file endings if getOptionValue("--experimental-specifier-resolution") === "node"
        // const finalizedUrl = finalizeResolution(tsFile, base);
        const finalizedUrl = tsFile;
        return [finalizedUrl, "typescript"];
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
function convertTypescriptOutUrlToSourceUrl(
  tsConfigInfo: TsConfigInfo,
  outFileUrl: URL
): URL | undefined {
  const outFilePath = fileURLToPath(outFileUrl);
  let absOutDir: string | undefined = undefined;
  let tsConfigAbsPath: string | undefined = undefined;
  let absRootDir: string | undefined = undefined;
  for (const [key, value] of tsConfigInfo.absOutDirToTsConfig.entries()) {
    if (outFilePath.startsWith(key)) {
      absOutDir = key;
      tsConfigAbsPath = value;
      const tc = tsConfigInfo.tsconfigMap.get(tsConfigAbsPath);
      absRootDir = path.join(
        path.dirname(tsConfigAbsPath),
        tc?.compilerOptions?.rootDir ?? ""
      );
      console.log("-----> checking for root dir", absRootDir);
      break;
    }
  }
  if (
    absOutDir === undefined ||
    tsConfigAbsPath === undefined ||
    absRootDir === undefined
  ) {
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
    return pathToFileURL(convertedPath);
  }
  return undefined;
}

/**
 * Convert a path that contains symlinks to a real path without requiring the full path to exist.
 * If a starting part of the path exists, it will be converted to a real path,
 * and then the rest of the path (the non-existing part) will be added to the end.
 */
function realPathOfSymlinkedUrl(inputUrl: URL): URL {
  const pathString = fileURLToPath(inputUrl);
  // console.log("realPathOfSymlinkedUrl--START", pathString);
  const pathParts = pathString.substr(1).split(path.sep);
  let existingRealPath = "/";
  let i: number;
  for (i = 0; i < pathParts.length; i++) {
    const pp = pathParts[i];
    try {
      const checkPath = path.join(existingRealPath, pp);
      existingRealPath = fs.realpathSync(checkPath);
    } catch (e) {
      break;
    }
  }
  const fullPath = path.join(existingRealPath, ...pathParts.slice(i));
  // console.log("realPathOfSymlinkedUrl--END", fullPath);
  return pathToFileURL(fullPath);
}

/**
 * Given a file with a javascript extension, probe for a file with
 * typescript extension in the exact same path.
 */
function probeForTsFileInSamePathAsJsFile(jsFileUrl: URL): URL | undefined {
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
  conditions: Set<string>
): ReadonlyArray<URL> {
  // Parse the specifier as a package name (package or @org/package) and separate out the sub-path
  const { packageName, packageSubpath, isScoped } = parsePackageName(
    specifier,
    base
  );

  // ResolveSelf
  // Check if the specifier resolves to the same package we are resolving from
  const selfResolved = resolveSelf(
    base,
    packageName,
    packageSubpath,
    conditions
  );
  if (selfResolved) return [selfResolved];

  // Find package.json by ascending the file system
  const packageJsonMatch = findPackageJson(packageName, base, isScoped);

  // If package.json was found, resolve from it's exports or main field
  if (packageJsonMatch) {
    const [packageJSONUrl, packageJSONPath] = packageJsonMatch;
    const packageConfig = getPackageConfig(packageJSONPath, specifier, base);
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
function findPackageJson(
  packageName: string,
  base: string | URL,
  isScoped: boolean
) {
  let packageJSONUrl = new URL(
    "./node_modules/" + packageName + "/package.json",
    base
  );
  let packageJSONPath = fileURLToPath(packageJSONUrl);
  let lastPath;
  do {
    const stat = tryStatSync(
      // StringPrototypeSlice(packageJSONPath, 0, packageJSONPath.length - 13)
      packageJSONPath.slice(0, packageJSONPath.length - 13)
    );
    if (!stat.isDirectory()) {
      lastPath = packageJSONPath;
      packageJSONUrl = new URL(
        (isScoped ? "../../../../node_modules/" : "../../../node_modules/") +
          packageName +
          "/package.json",
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
function resolveSelf(base, packageName, packageSubpath, conditions) {
  const packageConfig = getPackageScopeConfig(base);
  if (packageConfig.exists) {
    const packageJSONUrl = pathToFileURL(packageConfig.pjsonPath);
    if (
      packageConfig.name === packageName &&
      packageConfig.exports !== undefined &&
      packageConfig.exports !== null
    ) {
      return packageExportsResolve(
        packageResolve,
        packageJSONUrl,
        packageSubpath,
        packageConfig,
        base,
        conditions
      ).resolved;
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

/**
 * @param {string | URL} path
 * @returns {import('fs').Stats}
 */
const tryStatSync = (path) =>
  statSync(path, { throwIfNoEntry: false }) ?? new Stats();

/**
 * @param {string | URL} url
 * @returns {boolean}
 */
function fileExists(url) {
  try {
    return statSync(url, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch (e) {
    return false;
  }
}

function isTypescriptFile(url) {
  const extensionsRegex = /\.ts$/;
  return extensionsRegex.test(url);
}

function buildTsConfigInfo(entryTsConfig: string): TsConfigInfo {
  const tsconfigMap = loadTsConfigAndResolveReferences(entryTsConfig);
  const absOutDirToTsConfig = new Map();
  for (const [k, v] of tsconfigMap.entries()) {
    if (v.compilerOptions?.outDir === undefined) {
      throw new Error("Outdir must be defined for now...");
    }
    const absoluteOutDir = path.resolve(
      path.dirname(k),
      v.compilerOptions.outDir
    );
    absOutDirToTsConfig.set(absoluteOutDir, k);
  }
  return {
    tsconfigMap,
    absOutDirToTsConfig,
  };
}

// const encodedSepRegEx = /%2F|%2C/i;
// function assertValidModuleSpecifier(resolved) {
//   if (encodedSepRegEx.test(resolved.pathname))
//     throw new ERR_INVALID_MODULE_SPECIFIER(
//       resolved.pathname,
//       'must not include encoded "/" or "\\" characters',
//       fileURLToPath(base)
//     );
// }

// /**
//  * @param {URL} resolved
//  * @param {string | URL | undefined} base
//  * @returns {URL | undefined}
//  */
// function finalizeResolution(
//   resolved,
//   base: string | URL | undefined,
//   asNodeSpecifier: boolean
// ): URL | undefined {
//   console.log(
//     "finalizeResolutionfinalizeResolutionfinalizeResolution-->",
//     typeof resolved
//   );
//   assertValidModuleSpecifier(resolved);

//   const thePath = fileURLToPath(resolved);
//   if (asNodeSpecifier) {
//     return finalizeResolutionAsNodeSpecifier(resolved, base, thePath);
//   }
//   return finalizeResolutionAsEsmSpecifier(resolved, thePath, base);
// }

// function finalizeResolutionAsNodeSpecifier(resolved, base, thePath) {
//   let file = resolveExtensionsWithTryExactName(resolved);
//   if (file !== undefined) return file;
//   if (!thePath.endsWith("/")) {
//     file = resolveDirectoryEntry(new URL(`${resolved}/`));
//     if (file !== undefined) return file;
//   } else {
//     return resolveDirectoryEntry(resolved) || resolved;
//   }
//   throw new ERR_MODULE_NOT_FOUND(
//     resolved.pathname,
//     fileURLToPath(base),
//     "module"
//   );
// }

// function finalizeResolutionAsEsmSpecifier(resolved, thePath, base) {
//   const stats = tryStatSync(thePath.endWith("/") ? thePath.slice(-1) : thePath);
//   if (stats.isDirectory()) {
//     const err = new ERR_UNSUPPORTED_DIR_IMPORT(thePath, fileURLToPath(base));
//     err.url = String(resolved);
//     throw err;
//   } else if (!stats.isFile()) {
//     throw new ERR_MODULE_NOT_FOUND(
//       thePath || resolved.pathname,
//       base && fileURLToPath(base),
//       "module"
//     );
//   }

//   return resolved;
// }

// /**
//  * @param {URL} search
//  * @returns {URL | undefined}
//  */
// function resolveDirectoryEntry(search) {
//   const dirPath = fileURLToPath(search);
//   const pkgJsonPath = path.resolve(dirPath, "package.json");
//   if (fileExists(pkgJsonPath)) {
//     const pkgJson = packageJsonReader.read(pkgJsonPath);
//     if (pkgJson.containsKeys) {
//       const { main } = JSON.parse(pkgJson.string);
//       if (main != null) {
//         const mainUrl = pathToFileURL(path.resolve(dirPath, main));
//         return resolveExtensionsWithTryExactName(mainUrl);
//       }
//     }
//   }
//   return resolveExtensions(new URL("index", search));
// }

// /**
//  * @param {URL} search
//  * @returns {URL | undefined}
//  */
// function resolveExtensionsWithTryExactName(search) {
//   if (fileExists(search)) return search;
//   return resolveExtensions(search);
// }

// const extensions = [".js", ".json", ".node", ".mjs"];

// /**
//  * @param {URL} search
//  * @returns {URL | undefined}
//  */
// function resolveExtensions(search) {
//   for (let i = 0; i < extensions.length; i++) {
//     const extension = extensions[i];
//     const guess = new URL(`${search.pathname}${extension}`, search);
//     if (fileExists(guess)) return guess;
//   }
//   return undefined;
// }
