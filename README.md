# ts-esm-resolve

[![npm version](https://img.shields.io/npm/v/ts-esm-resolve.svg?style=flat)](https://www.npmjs.com/package/ts-esm-resolve)
[![CI](https://github.com/jonaskello/ts-esm-resolve/actions/workflows/ci.yml/badge.svg)](https://github.com/jonaskello/ts-esm-resolve/actions/workflows/ci.yml)
[![Coverage Status](https://codecov.io/gh/jonaskello/ts-esm-resolve/branch/master/graph/badge.svg)](https://codecov.io/gh/jonaskello/ts-esm-resolve)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat)](https://github.com/prettier/prettier)
[![types](https://img.shields.io/npm/types/scrub-js.svg)](https://www.typescriptlang.org/)
[![MIT license](https://img.shields.io/github/license/jonaskello/ts-esm-resolve.svg?style=flat)](https://opensource.org/licenses/MIT)

Resolve typescript ES modules

## Overview

This package will resolve typescript ES modules. It includes support for the new `exports` and `imports` sections of `package.json`.

For relative and absolute paths it is easy to resolve typescript files, just change the file extension to `.ts` or `.tsx`. However for bare specifiers it is a bit more tricky. Most of the time a bare specifier will resolve to a package installed into `node_modules` that is not part of your source code. But if you are using project references and yarn/npm workspaces then bare specifiers may point to a package that is part of your project.

The aim of this package is to resolve all cases including:

- Relative and absolute paths
- Bare specifiers for packages specified as project references in a npm/yarn workspace
- Bare specifiers resolved by the `path` key in `tsconfig.json`.

## How to install

```
yarn add --dev ts-esm-resolve
```

## How to use

You can use this package as a part of build a transpiling [node loader]() for typescript. Here is an example using esbuild for the transpile:

```js
// file loader.mjs
import { fileURLToPath } from "url";
import { transformSync } from "esbuild";
import { tsResolve } from "../../lib/ts-resolve.js";

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
