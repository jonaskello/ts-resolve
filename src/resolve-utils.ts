/* eslint-disable */
// @ts-nocheck
// Extracted from this file: https://github.com/nodejs/node/blob/master/lib/internal/modules/esm/resolve.js

// "use strict";
import debugCreator from "debug";
const debug = debugCreator("ts-resolve");

const { pathToFileURL, fileURLToPath } = require("url");

import { URL } from "url";
import { IsDirectory, ReadFile } from "./filesystem";

const primordials = {
  ArrayFrom: Array.from,
  ArrayIsArray: Array.isArray,
  // ArrayPrototypeJoin: (obj, separator) =>
  //   Array.prototype.join.call(obj, separator),
  ArrayPrototypeShift: (obj) => Array.prototype.shift.call(obj),
  ArrayPrototypeForEach: (arr, ...rest) => Array.prototype.forEach.apply(arr, rest),
  ArrayPrototypeIncludes: (arr, ...rest) => Array.prototype.includes.apply(arr, rest),
  ArrayPrototypeJoin: (arr, ...rest) => Array.prototype.join.apply(arr, rest),
  ArrayPrototypePop: (arr, ...rest) => Array.prototype.pop.apply(arr, rest),
  ArrayPrototypePush: (arr, ...rest) => Array.prototype.push.apply(arr, rest),
  FunctionPrototype: Function.prototype,
  JSONParse: JSON.parse,
  JSONStringify: JSON.stringify,
  ObjectFreeze: Object.freeze,
  ObjectKeys: Object.keys,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectDefineProperty: Object.defineProperty,
  ObjectPrototypeHasOwnProperty: (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop),
  RegExpPrototypeTest: (obj, string) => RegExp.prototype.test.call(obj, string),
  RegExpPrototypeSymbolReplace: (obj, ...rest) => RegExp.prototype[Symbol.replace].apply(obj, rest),
  SafeMap: Map,
  SafeSet: Set,
  StringPrototypeEndsWith: (str, ...rest) => String.prototype.endsWith.apply(str, rest),
  StringPrototypeIncludes: (str, ...rest) => String.prototype.includes.apply(str, rest),
  StringPrototypeLastIndexOf: (str, ...rest) => String.prototype.lastIndexOf.apply(str, rest),
  StringPrototypeIndexOf: (str, ...rest) => String.prototype.indexOf.apply(str, rest),
  StringPrototypeRepeat: (str, ...rest) => String.prototype.repeat.apply(str, rest),
  StringPrototypeReplace: (str, ...rest) => String.prototype.replace.apply(str, rest),
  StringPrototypeSlice: (str, ...rest) => String.prototype.slice.apply(str, rest),
  StringPrototypeSplit: (str, ...rest) => String.prototype.split.apply(str, rest),
  StringPrototypeStartsWith: (str, ...rest) => String.prototype.startsWith.apply(str, rest),
  StringPrototypeSubstr: (str, ...rest) => String.prototype.substr.apply(str, rest),
  SyntaxError: SyntaxError,
  ObjectCreate: Object.create,
  ObjectAssign: Object.assign,
};

const {
  ArrayIsArray,
  JSONParse,
  JSONStringify,
  ObjectFreeze,
  ObjectGetOwnPropertyNames,
  ObjectPrototypeHasOwnProperty,
  // RegExp,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeTest,
  SafeMap,
  SafeSet,
  // String,
  StringPrototypeEndsWith,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
} = primordials; //require("./resolve-utils-support/node-primordials");

// Do not eagerly grab .manifest, it may be in TDZ
// const pendingDeprecation = getOptionValue("--pending-deprecation");
const pendingDeprecation = "";
// const userConditions = getOptionValue("--conditions");
const userConditions = "";
// const noAddons = getOptionValue("--no-addons");
const noAddons = "";

const addonConditions = noAddons ? [] : ["node-addons"];

const DEFAULT_CONDITIONS = ObjectFreeze(["node", "import", ...addonConditions, ...userConditions]);

const DEFAULT_CONDITIONS_SET = new SafeSet(DEFAULT_CONDITIONS);

/**
 * @typedef {string | string[] | Record<string, unknown>} Exports
 * @typedef {'module' | 'commonjs'} PackageType
 * @typedef {{
 *   exports?: ExportConfig;
 *   name?: string;
 *   main?: string;
 *   type?: PackageType;
 * }} PackageConfig
 */

const emittedPackageWarnings = new SafeSet();

/**
 * @param {string} match
 * @param {URL} pjsonUrl
 * @param {boolean} isExports
 * @param {string | URL | undefined} base
 * @returns {void}
 */
function emitFolderMapDeprecation(match, pjsonUrl, isExports, base) {
  const pjsonPath = fileURLToPath(pjsonUrl);

  if (emittedPackageWarnings.has(pjsonPath + "|" + match)) return;
  emittedPackageWarnings.add(pjsonPath + "|" + match);
  process.emitWarning(
    `Use of deprecated folder mapping "${match}" in the ${
      isExports ? '"exports"' : '"imports"'
    } field module resolution of the package at ${pjsonPath}${base ? ` imported from ${fileURLToPath(base)}` : ""}.\n` +
      `Update this package.json to use a subpath pattern like "${match}*".`,
    "DeprecationWarning",
    "DEP0148"
  );
}

function emitTrailingSlashPatternDeprecation(match, pjsonUrl, isExports, base) {
  if (!pendingDeprecation) return;
  const pjsonPath = fileURLToPath(pjsonUrl);
  if (emittedPackageWarnings.has(pjsonPath + "|" + match)) return;
  emittedPackageWarnings.add(pjsonPath + "|" + match);
  process.emitWarning(
    `Use of deprecated trailing slash pattern mapping "${match}" in the ${
      isExports ? '"exports"' : '"imports"'
    } field module resolution of the ` +
      `package at ${pjsonPath}${
        base ? ` imported from ${fileURLToPath(base)}` : ""
      }. Mapping specifiers ending in "/" is no longer supported.`,
    "DeprecationWarning",
    "DEP0155"
  );
}

/**
 * @param {string[]} [conditions]
 * @returns {Set<string>}
 */
function getConditionsSet(conditions): Set<string> {
  if (conditions !== undefined && conditions !== DEFAULT_CONDITIONS) {
    if (!ArrayIsArray(conditions)) {
      throw new codes.ERR_INVALID_ARG_VALUE("conditions", conditions, "expected an array");
    }
    return new SafeSet(conditions);
  }
  return DEFAULT_CONDITIONS_SET;
}

const packageJSONCache = new SafeMap(); /* string -> PackageConfig */

/**
 * @param {string} path
 * @param {string} specifier
 * @param {string | URL | undefined} base
 * @returns {PackageConfig}
 */
function getPackageConfig(readFile, path, specifier, base?) {
  const existing = packageJSONCache.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const source = packageJsonReaderRead(path, readFile).string;
  if (source === undefined) {
    const packageConfig = {
      pjsonPath: path,
      exists: false,
      main: undefined,
      name: undefined,
      type: "none",
      exports: undefined,
      imports: undefined,
    };
    packageJSONCache.set(path, packageConfig);
    return packageConfig;
  }

  let packageJSON;
  try {
    packageJSON = JSONParse(source);
  } catch (error: any) {
    throw new codes.ERR_INVALID_PACKAGE_CONFIG(
      path,
      (base ? `"${specifier}" from ` : "") + fileURLToPath(base || specifier),
      error.message
    );
  }

  let { imports, main, name, type } = packageJSON;
  const { exports } = packageJSON;
  if (typeof imports !== "object" || imports === null) imports = undefined;
  if (typeof main !== "string") main = undefined;
  if (typeof name !== "string") name = undefined;
  // Ignore unknown types for forwards compatibility
  if (type !== "module" && type !== "commonjs") type = "none";

  const packageConfig = {
    pjsonPath: path,
    exists: true,
    main,
    name,
    type,
    exports,
    imports,
  };
  packageJSONCache.set(path, packageConfig);
  return packageConfig;
}

/**
 * @param {URL | string} resolved
 * @returns {PackageConfig}
 */
function getPackageScopeConfig(resolved, readFile) {
  let packageJSONUrl = new URL("./package.json", resolved);
  while (true) {
    const packageJSONPath = packageJSONUrl.pathname;
    if (StringPrototypeEndsWith(packageJSONPath, "node_modules/package.json")) break;
    const packageConfig = getPackageConfig(readFile, fileURLToPath(packageJSONUrl), resolved);
    if (packageConfig.exists) return packageConfig;

    const lastPackageJSONUrl = packageJSONUrl;
    packageJSONUrl = new URL("../package.json", packageJSONUrl);

    // Terminates at root where ../package.json equals ../../package.json
    // (can't just check "/package.json" for Windows support).
    if (packageJSONUrl.pathname === lastPackageJSONUrl.pathname) break;
  }
  const packageJSONPath = fileURLToPath(packageJSONUrl);
  const packageConfig = {
    pjsonPath: packageJSONPath,
    exists: false,
    main: undefined,
    name: undefined,
    type: "none",
    exports: undefined,
    imports: undefined,
  };
  packageJSONCache.set(packageJSONPath, packageConfig);
  return packageConfig;
}

/**
 * @param {string} specifier
 * @param {URL} packageJSONUrl
 * @param {string | URL | undefined} base
 */
function throwImportNotDefined(specifier, packageJSONUrl, base) {
  throw new codes.ERR_PACKAGE_IMPORT_NOT_DEFINED(
    specifier,
    packageJSONUrl && fileURLToPath(new URL(".", packageJSONUrl)),
    fileURLToPath(base)
  );
}

/**
 * @param {string} specifier
 * @param {URL} packageJSONUrl
 * @param {string | URL | undefined} base
 */
function throwExportsNotFound(subpath, packageJSONUrl, base) {
  throw new codes.ERR_PACKAGE_PATH_NOT_EXPORTED(
    fileURLToPath(new URL(".", packageJSONUrl)),
    subpath,
    base && fileURLToPath(base)
  );
}

/**
 *
 * @param {string | URL} subpath
 * @param {URL} packageJSONUrl
 * @param {boolean} internal
 * @param {string | URL | undefined} base
 */
function throwInvalidSubpath(subpath, packageJSONUrl, internal, base) {
  const reason = `request is not a valid subpath for the "${
    internal ? "imports" : "exports"
  }" resolution of ${fileURLToPath(packageJSONUrl)}`;
  throw new codes.ERR_INVALID_MODULE_SPECIFIER(subpath, reason, base && fileURLToPath(base));
}

function throwInvalidPackageTarget(subpath, target, packageJSONUrl, internal, base) {
  if (typeof target === "object" && target !== null) {
    target = JSONStringify(target, null, "");
  } else {
    target = `${target}`;
  }
  throw new codes.ERR_INVALID_PACKAGE_TARGET(
    fileURLToPath(new URL(".", packageJSONUrl)),
    subpath,
    target,
    internal,
    base && fileURLToPath(base)
  );
}

const invalidSegmentRegEx = /(^|\\|\/)(\.\.?|node_modules)(\\|\/|$)/;
const patternRegEx = /\*/g;

function resolvePackageTargetString(
  packageResolve,
  target,
  subpath,
  match,
  packageJSONUrl,
  base,
  pattern,
  internal,
  conditions
) {
  if (subpath !== "" && !pattern && target[target.length - 1] !== "/")
    throwInvalidPackageTarget(match, target, packageJSONUrl, internal, base);

  if (!StringPrototypeStartsWith(target, "./")) {
    if (internal && !StringPrototypeStartsWith(target, "../") && !StringPrototypeStartsWith(target, "/")) {
      let isURL = false;
      try {
        new URL(target);
        isURL = true;
      } catch {}
      if (!isURL) {
        const exportTarget = pattern
          ? RegExpPrototypeSymbolReplace(patternRegEx, target, () => subpath)
          : target + subpath;
        return packageResolve(exportTarget, packageJSONUrl, conditions);
      }
    }
    throwInvalidPackageTarget(match, target, packageJSONUrl, internal, base);
  }

  if (RegExpPrototypeTest(invalidSegmentRegEx, StringPrototypeSlice(target, 2)))
    throwInvalidPackageTarget(match, target, packageJSONUrl, internal, base);

  const resolved = new URL(target, packageJSONUrl);
  const resolvedPath = resolved.pathname;
  const packagePath = new URL(".", packageJSONUrl).pathname;

  if (!StringPrototypeStartsWith(resolvedPath, packagePath))
    throwInvalidPackageTarget(match, target, packageJSONUrl, internal, base);

  if (subpath === "") return resolved;

  if (RegExpPrototypeTest(invalidSegmentRegEx, subpath))
    throwInvalidSubpath(match + subpath, packageJSONUrl, internal, base);

  if (pattern) return new URL(RegExpPrototypeSymbolReplace(patternRegEx, resolved.href, () => subpath));
  return new URL(subpath, resolved);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isArrayIndex(key) {
  const keyNum = +key;
  if (`${keyNum}` !== key) return false;
  return keyNum >= 0 && keyNum < 0xffff_ffff;
}

function resolvePackageTarget(
  packageResolve,
  packageJSONUrl,
  target,
  subpath,
  packageSubpath,
  base,
  pattern,
  internal,
  conditions
): URL {
  if (typeof target === "string") {
    return resolvePackageTargetString(
      packageResolve,
      target,
      subpath,
      packageSubpath,
      packageJSONUrl,
      base,
      pattern,
      internal,
      conditions
    );
  } else if (ArrayIsArray(target)) {
    if (target.length === 0) return null;

    let lastException;
    for (let i = 0; i < target.length; i++) {
      const targetItem = target[i];
      let resolved;
      try {
        resolved = resolvePackageTarget(
          packageResolve,
          packageJSONUrl,
          targetItem,
          subpath,
          packageSubpath,
          base,
          pattern,
          internal,
          conditions
        );
      } catch (e: any) {
        lastException = e;
        if (e.code === "ERR_INVALID_PACKAGE_TARGET") continue;
        throw e;
      }
      if (resolved === undefined) continue;
      if (resolved === null) {
        lastException = null;
        continue;
      }
      return resolved;
    }
    if (lastException === undefined || lastException === null) return lastException;
    throw lastException;
  } else if (typeof target === "object" && target !== null) {
    const keys = ObjectGetOwnPropertyNames(target);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (isArrayIndex(key)) {
        throw new codes.ERR_INVALID_PACKAGE_CONFIG(
          fileURLToPath(packageJSONUrl),
          base,
          '"exports" cannot contain numeric property keys.'
        );
      }
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "default" || conditions.has(key)) {
        const conditionalTarget = target[key];
        const resolved = resolvePackageTarget(
          packageResolve,
          packageJSONUrl,
          conditionalTarget,
          subpath,
          packageSubpath,
          base,
          pattern,
          internal,
          conditions
        );
        if (resolved === undefined) continue;
        return resolved;
      }
    }
    return undefined;
  } else if (target === null) {
    return null;
  }
  throwInvalidPackageTarget(packageSubpath, target, packageJSONUrl, internal, base);
}

/**
 *
 * @param {Exports} exports
 * @param {URL} packageJSONUrl
 * @param {string | URL | undefined} base
 * @returns
 */
function isConditionalExportsMainSugar(exports, packageJSONUrl, base) {
  if (typeof exports === "string" || ArrayIsArray(exports)) return true;
  if (typeof exports !== "object" || exports === null) return false;

  const keys = ObjectGetOwnPropertyNames(exports);
  let isConditionalSugar = false;
  let i = 0;
  for (let j = 0; j < keys.length; j++) {
    const key = keys[j];
    const curIsConditionalSugar = key === "" || key[0] !== ".";
    if (i++ === 0) {
      isConditionalSugar = curIsConditionalSugar;
    } else if (isConditionalSugar !== curIsConditionalSugar) {
      throw new codes.ERR_INVALID_PACKAGE_CONFIG(
        fileURLToPath(packageJSONUrl),
        base,
        "\"exports\" cannot contain some keys starting with '.' and some not." +
          " The exports object must either be an object of package subpath keys" +
          " or an object of main entry condition name keys only."
      );
    }
  }
  return isConditionalSugar;
}

/**
 * @param {URL} packageJSONUrl
 * @param {string} packageSubpath
 * @param {PackageConfig} packageConfig
 * @param {string | URL | undefined} base
 * @param {Set<string>} conditions
 * @returns {URL}
 */
function packageExportsResolve(
  packageResolve,
  packageJSONUrl,
  packageSubpath,
  packageConfig,
  base,
  conditions
): { resolved: URL; exact: boolean } {
  let exports = packageConfig.exports;
  if (isConditionalExportsMainSugar(exports, packageJSONUrl, base)) exports = { ".": exports };

  if (
    ObjectPrototypeHasOwnProperty(exports, packageSubpath) &&
    !StringPrototypeIncludes(packageSubpath, "*") &&
    !StringPrototypeEndsWith(packageSubpath, "/")
  ) {
    const target = exports[packageSubpath];
    const resolved = resolvePackageTarget(
      packageResolve,
      packageJSONUrl,
      target,
      "",
      packageSubpath,
      base,
      false,
      false,
      conditions
    );
    if (resolved === null || resolved === undefined) throwExportsNotFound(packageSubpath, packageJSONUrl, base);
    return { resolved, exact: true };
  }

  let bestMatch = "";
  let bestMatchSubpath;
  const keys = ObjectGetOwnPropertyNames(exports);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const patternIndex = StringPrototypeIndexOf(key, "*");
    if (patternIndex !== -1 && StringPrototypeStartsWith(packageSubpath, StringPrototypeSlice(key, 0, patternIndex))) {
      if (StringPrototypeEndsWith(packageSubpath, "/"))
        emitTrailingSlashPatternDeprecation(packageSubpath, packageJSONUrl, true, base);
      const patternTrailer = StringPrototypeSlice(key, patternIndex + 1);
      if (
        packageSubpath.length >= key.length &&
        StringPrototypeEndsWith(packageSubpath, patternTrailer) &&
        patternKeyCompare(bestMatch, key) === 1 &&
        StringPrototypeLastIndexOf(key, "*") === patternIndex
      ) {
        bestMatch = key;
        bestMatchSubpath = StringPrototypeSlice(
          packageSubpath,
          patternIndex,
          packageSubpath.length - patternTrailer.length
        );
      }
    } else if (
      key[key.length - 1] === "/" &&
      StringPrototypeStartsWith(packageSubpath, key) &&
      patternKeyCompare(bestMatch, key) === 1
    ) {
      bestMatch = key;
      bestMatchSubpath = StringPrototypeSlice(packageSubpath, key.length);
    }
  }

  if (bestMatch) {
    const target = exports[bestMatch];
    const pattern = StringPrototypeIncludes(bestMatch, "*");
    const resolved = resolvePackageTarget(
      packageResolve,
      packageJSONUrl,
      target,
      bestMatchSubpath,
      bestMatch,
      base,
      pattern,
      false,
      conditions
    );
    if (resolved === null || resolved === undefined) throwExportsNotFound(packageSubpath, packageJSONUrl, base);
    if (!pattern) emitFolderMapDeprecation(bestMatch, packageJSONUrl, true, base);
    return { resolved, exact: pattern };
  }

  throwExportsNotFound(packageSubpath, packageJSONUrl, base);
}

function patternKeyCompare(a, b) {
  const aPatternIndex = StringPrototypeIndexOf(a, "*");
  const bPatternIndex = StringPrototypeIndexOf(b, "*");
  const baseLenA = aPatternIndex === -1 ? a.length : aPatternIndex + 1;
  const baseLenB = bPatternIndex === -1 ? b.length : bPatternIndex + 1;
  if (baseLenA > baseLenB) return -1;
  if (baseLenB > baseLenA) return 1;
  if (aPatternIndex === -1) return 1;
  if (bPatternIndex === -1) return -1;
  if (a.length > b.length) return -1;
  if (b.length > a.length) return 1;
  return 0;
}

/**
 * @param {string} name
 * @param {string | URL | undefined} base
 * @param {Set<string>} conditions
 * @returns
 */
function packageImportsResolve(packageResolve, name, base, conditions, readFile): { resolved: URL; exact: boolean } {
  if (name === "#" || StringPrototypeStartsWith(name, "#/")) {
    const reason = "is not a valid internal imports specifier name";
    throw new codes.ERR_INVALID_MODULE_SPECIFIER(name, reason, fileURLToPath(base));
  }
  let packageJSONUrl;
  const packageConfig = getPackageScopeConfig(base, readFile);
  if (packageConfig.exists) {
    packageJSONUrl = pathToFileURL(packageConfig.pjsonPath);
    const imports = packageConfig.imports;
    if (imports) {
      if (
        ObjectPrototypeHasOwnProperty(imports, name) &&
        !StringPrototypeIncludes(name, "*") &&
        !StringPrototypeEndsWith(name, "/")
      ) {
        const resolved = resolvePackageTarget(
          packageResolve,
          packageJSONUrl,
          imports[name],
          "",
          name,
          base,
          false,
          true,
          conditions
        );
        if (resolved !== null) return { resolved, exact: true };
      } else {
        let bestMatch = "";
        let bestMatchSubpath;
        const keys = ObjectGetOwnPropertyNames(imports);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const patternIndex = StringPrototypeIndexOf(key, "*");
          if (patternIndex !== -1 && StringPrototypeStartsWith(name, StringPrototypeSlice(key, 0, patternIndex))) {
            const patternTrailer = StringPrototypeSlice(key, patternIndex + 1);
            if (
              name.length >= key.length &&
              StringPrototypeEndsWith(name, patternTrailer) &&
              patternKeyCompare(bestMatch, key) === 1 &&
              StringPrototypeLastIndexOf(key, "*") === patternIndex
            ) {
              bestMatch = key;
              bestMatchSubpath = StringPrototypeSlice(name, patternIndex, name.length - patternTrailer.length);
            }
          } else if (
            key[key.length - 1] === "/" &&
            StringPrototypeStartsWith(name, key) &&
            patternKeyCompare(bestMatch, key) === 1
          ) {
            bestMatch = key;
            bestMatchSubpath = StringPrototypeSlice(name, key.length);
          }
        }

        if (bestMatch) {
          const target = imports[bestMatch];
          const pattern = StringPrototypeIncludes(bestMatch, "*");
          const resolved = resolvePackageTarget(
            packageResolve,
            packageJSONUrl,
            target,
            bestMatchSubpath,
            bestMatch,
            base,
            pattern,
            true,
            conditions
          );
          if (resolved !== null) {
            if (!pattern) emitFolderMapDeprecation(bestMatch, packageJSONUrl, false, base);
            return { resolved, exact: pattern };
          }
        }
      }
    }
  }
  throwImportNotDefined(name, packageJSONUrl, base);
}

// /**
//  * @param {URL} url
//  * @returns {PackageType}
//  */
// function getPackageType(url) {
//   const packageConfig = getPackageScopeConfig(url, readFile);
//   return packageConfig.type;
// }

/**
 * @param {string} specifier
 * @param {string | URL | undefined} base
 * @returns {{ packageName: string, packageSubpath: string, isScoped: boolean }}
 */
function parsePackageName(specifier, base) {
  let separatorIndex = StringPrototypeIndexOf(specifier, "/");
  let validPackageName = true;
  let isScoped = false;
  if (specifier[0] === "@") {
    isScoped = true;
    if (separatorIndex === -1 || specifier.length === 0) {
      validPackageName = false;
    } else {
      separatorIndex = StringPrototypeIndexOf(specifier, "/", separatorIndex + 1);
    }
  }

  const packageName = separatorIndex === -1 ? specifier : StringPrototypeSlice(specifier, 0, separatorIndex);

  // Package name cannot have leading . and cannot have percent-encoding or
  // separators.
  for (let i = 0; i < packageName.length; i++) {
    if (packageName[i] === "%" || packageName[i] === "\\") {
      validPackageName = false;
      break;
    }
  }

  if (!validPackageName) {
    throw new codes.ERR_INVALID_MODULE_SPECIFIER(specifier, "is not a valid package name", fileURLToPath(base));
  }

  const packageSubpath = "." + (separatorIndex === -1 ? "" : StringPrototypeSlice(specifier, separatorIndex));

  return { packageName, packageSubpath, isScoped };
}

function isRelativeSpecifier(specifier) {
  if (specifier[0] === ".") {
    if (specifier.length === 1 || specifier[1] === "/") return true;
    if (specifier[1] === ".") {
      if (specifier.length === 2 || specifier[2] === "/") return true;
    }
  }
  return false;
}

function shouldBeTreatedAsRelativeOrAbsolutePath(specifier) {
  if (specifier === "") return false;
  if (specifier[0] === "/") return true;
  return isRelativeSpecifier(specifier);
}

// FROM OTHER FILE node-package-json-reader.js

// copied from https://github.com/nodejs/node/blob/v15.3.0/lib/internal/modules/package_json_reader.js
("use strict");

const { toNamespacedPath } = require("path");

const cache = new SafeMap();

let manifest;

/**
 * @param {string} jsonPath
 * @return {[string, boolean]}
 */
function packageJsonReaderRead(jsonPath, readFile) {
  if (cache.has(jsonPath)) {
    return cache.get(jsonPath);
  }

  const [string, containsKeys] = internalModuleReadJSON(toNamespacedPath(jsonPath), readFile);
  const result = { string, containsKeys };
  if (string !== undefined) {
    if (manifest === undefined) {
      // manifest = getOptionValue('--experimental-policy') ?
      //   require('internal/process/policy').manifest :
      //   null;
      // disabled for now.  I am not sure if/how we should support this
      manifest = null;
    }
    if (manifest !== null) {
      const jsonURL = pathToFileURL(jsonPath);
      manifest.assertIntegrity(jsonURL, string);
    }
  }
  cache.set(jsonPath, result);
  return result;
}

// FROM OTHER FILE node-internal-fs.js

// In node's core, this is implemented in C
// https://github.com/nodejs/node/blob/v15.3.0/src/node_file.cc#L891-L985
function internalModuleReadJSON(path, readFile) {
  let string;
  try {
    // string = fs.readFileSync(path, "utf8");
    string = readFile(path);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  // Node's implementation checks for the presence of relevant keys: main, name, type, exports, imports
  // Node does this for performance to skip unnecessary parsing.
  // This would slow us down and, based on our usage, we can skip it.
  const containsKeys = true;
  return [string, containsKeys];
}

// FROM OTHER FILE node-errors.js

const codes = {
  ERR_INPUT_TYPE_NOT_ALLOWED: createErrorCtor(joinArgs("ERR_INPUT_TYPE_NOT_ALLOWED")),
  ERR_INVALID_ARG_VALUE: createErrorCtor(joinArgs("ERR_INVALID_ARG_VALUE")),
  ERR_INVALID_MODULE_SPECIFIER: createErrorCtor(joinArgs("ERR_INVALID_MODULE_SPECIFIER")),
  ERR_INVALID_PACKAGE_CONFIG: createErrorCtor(joinArgs("ERR_INVALID_PACKAGE_CONFIG")),
  ERR_INVALID_PACKAGE_TARGET: createErrorCtor(joinArgs("ERR_INVALID_PACKAGE_TARGET")),
  ERR_MANIFEST_DEPENDENCY_MISSING: createErrorCtor(joinArgs("ERR_MANIFEST_DEPENDENCY_MISSING")),
  ERR_MODULE_NOT_FOUND: createErrorCtor((path, base, type = "package") => {
    return `Cannot find ${type} '${path}' imported from ${base}`;
  }),
  ERR_PACKAGE_IMPORT_NOT_DEFINED: createErrorCtor(joinArgs("ERR_PACKAGE_IMPORT_NOT_DEFINED")),
  ERR_PACKAGE_PATH_NOT_EXPORTED: createErrorCtor(joinArgs("ERR_PACKAGE_PATH_NOT_EXPORTED")),
  ERR_UNSUPPORTED_DIR_IMPORT: createErrorCtor(joinArgs("ERR_UNSUPPORTED_DIR_IMPORT")),
  ERR_UNSUPPORTED_ESM_URL_SCHEME: createErrorCtor(joinArgs("ERR_UNSUPPORTED_ESM_URL_SCHEME")),
};

function joinArgs(name) {
  return (...args) => {
    return [name, ...args].join(" ");
  };
}

function createErrorCtor(errorMessageCreator) {
  return class CustomError extends Error {
    constructor(...args) {
      super(errorMessageCreator(...args));
    }
  };
}

// Extra functions added that are not part of the original file

// This could probably be moved to a built-in API
function findPackageJson(
  packageName: string,
  base: string | URL | undefined,
  isScoped: boolean,
  isDirectory: IsDirectory
) {
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
    return [packageJSONUrl, packageJSONPath] as const;
    // Cross-platform root check.
  } while (packageJSONPath.length !== lastPath.length);
  return undefined;
}

// This could probably be moved to a built-in API
// However it needs packageResolve since it calls into packageExportsResolve()
function resolveSelf(packageResolve, base, packageName, packageSubpath, conditions, readFile: ReadFile): URL {
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
function legacyMainResolve2(packageJSONUrl: string | URL, packageConfig): ReadonlyArray<URL> {
  debug("legacyMainResolve2", packageJSONUrl, packageConfig);
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

// EXPORTS

export {
  getPackageConfig,
  // getPackageScopeConfig,
  getConditionsSet,
  shouldBeTreatedAsRelativeOrAbsolutePath,
  packageImportsResolve,
  packageExportsResolve,
  parsePackageName,
  legacyMainResolve2,
  resolveSelf,
  findPackageJson,
};
