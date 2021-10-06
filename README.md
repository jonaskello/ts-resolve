# ts-resolve

[![npm version](https://img.shields.io/npm/v/ts-resolve.svg?style=flat)](https://www.npmjs.com/package/ts-resolve)
[![CI](https://github.com/jonaskello/ts-resolve/actions/workflows/ci.yml/badge.svg)](https://github.com/jonaskello/ts-resolve/actions/workflows/ci.yml)
[![Coverage Status](https://codecov.io/gh/jonaskello/ts-resolve/branch/main/graph/badge.svg)](https://codecov.io/gh/jonaskello/ts-resolve)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat)](https://github.com/prettier/prettier)
[![types](https://img.shields.io/npm/types/scrub-js.svg)](https://www.typescriptlang.org/)
[![MIT license](https://img.shields.io/github/license/jonaskello/ts-resolve.svg?style=flat)](https://opensource.org/licenses/MIT)

Resolve typescript ES modules

## Overview

Given an import specifier for a javascript file, this package will resolve it back to the typescript file that would compile into that javascript file. The javascript file does not have to exist for the resolve to work so the project does not need to be in a compiled state. Currently this package will only resolve typescript ES modules. It is mainly built for usage in the resolve hook of a [node loader](https://nodejs.org/api/esm.html#esm_loaders) but the API should be generic enough to be useful in other scenarions.

For relative and absolute paths it is easy to resolve typescript files from their javascript counterpart, just change the file extension to `.ts` or `.tsx`. However for bare specifiers it is a bit more tricky. Most of the time a bare specifier will resolve to a package installed into `node_modules` that is not part of your source code. But if you are using [project references](https://www.typescriptlang.org/docs/handbook/project-references.html) and yarn/npm [workspaces](https://classic.yarnpkg.com/lang/en/docs/workspaces/) then bare specifiers may point to a package that is part of your project.

The aim of this package is to resolve all cases including:

- Relative and absolute paths
- Bare specifiers for packages specified as project references in a npm/yarn workspace
- Bare specifiers resolved by the `base` and `path` options in `tsconfig.json`.

## How to install

```
yarn add --dev ts-resolve
```

## API

### tsResolve

```ts
export function tsResolve(
  specifier: string,
  context: { parentURL: string | undefined; conditions: ReadonlyArray<string> },
  tsConfig: string,
  fileSystem?: FileSystem | undefined
): { fileUrl: string; tsConfigUrl: string } | undefined;
```

Resolves a specifier.

_Input_

- `specifier` - A specifier to resolve, eg. `./foo/bar.js` or `@myapp/package-a`.
- `context.parentURL` - The URL which is the parent of the resolve (normally the file that does the `import` of the `specifier`). Relative resolves will resolve relative to the parent URL path. Is `undefined` for the entry file since it has no parent.
- `context.conditions` - [Conditions](https://nodejs.org/api/packages.html#packages_conditional_exports) for resolve.
- `tsConfig` - A tsconfig.json file. In the case of [project references](https://www.typescriptlang.org/docs/handbook/project-references.html) it does not have to be the actual `tsconfig.json` that is associated with the resolved file, but it does have to have a reference to the `tsconfig.json` that is associated with the resolved file. So if you have a main `tsconfig.json` that references every other `tsconfig.json` in the workspace, you can use it for all calls.
- `fileSystem` - Optional. An object with filesystem methods. Could be used for testing or in scenarios where you don't want to make lookups in the normal filesystem. If it is not provided then a default implementation that reads the normal filesystem will be used.
  - `cwd: () => string`
  - `isFile: (path: string) => boolean`
  - `isDirectory: (path: string) => boolean`
  - `getRealpath: (path: string) => string | undefined;`
  - `readFile: (filename: string) => string | undefined`

_Returns_

An object with keys:

- `fileUrl` - URL to the resolved file. If the resolved specifier was found to be created from compiling a typescript file then this will be that typescript file.
- `tsConfigUrl` - URL for the `tsconfig.json` that is associated with the resolved file. Useful if you want to transpile the resolved file.

## How to use with a loader

You can use this package as a part of build a transpiling [node loader](https://nodejs.org/api/esm.html#esm_loaders) for typescript. Here is an example using esbuild for the transpile:

```js
// file loader.mjs
import { fileURLToPath } from "url";
import { transformSync } from "esbuild";
import { tsResolve } from "ts-resolve";

export function resolve(specifier, context, defaultResolve) {
  const entryTsConfig = process.env["TS_NODE_PROJECT"];
  if (entryTsConfig === undefined || entryTsConfig === null || entryTsConfig === "") {
    throw new Error("Entry tsconfig file must be present in TS_NODE_PROJECT.");
  }
  const resolved = tsResolve(specifier, context, entryTsConfig);
  if (resolved !== undefined) {
    const { fileUrl, tsConfigUrl } = resolved;
    return { url: fileUrl, format: tsConfigUrl };
  }
  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  // Return transpiled source if typescript file
  if (isTypescriptFile(url)) {
    // Call defaultLoad to get the source
    const format = "module";
    const { source: rawSource } = await defaultLoad(url, { format }, defaultLoad);
    const source = transpileTypescript(url, rawSource, "esm");
    return { format, source };
  }
  // Let Node.js load it
  return defaultLoad(url, context);
}

function isTypescriptFile(url) {
  const extensionsRegex = /\.ts$/;
  return extensionsRegex.test(url);
}

const isWindows = process.platform === "win32";

function transpileTypescript(url, source, outputFormat) {
  let filename = url;
  if (!isWindows) filename = fileURLToPath(url);

  const {
    code: js,
    warnings,
    map: jsSourceMap,
  } = transformSync(source.toString(), {
    sourcefile: filename,
    sourcemap: "both",
    loader: "ts",
    target: "esnext",
    // This sets the output format for the generated JavaScript files
    // format: format === "module" ? "esm" : "cjs",
    format: outputFormat,
  });

  if (warnings && warnings.length > 0) {
    for (const warning of warnings) {
      console.log(warning.location);
      console.log(warning.text);
    }
  }

  return js;
}
```

Then you can use it like this:

```bash
node --loader loader.mjs myfile.ts
```
