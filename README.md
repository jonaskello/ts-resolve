# ts-esm-resolve

Resolve typescript ES modules

## Overview

This package will resolve typescript ES modules. It includes support for the new `exports` and `imports` sections of `package.json`.

For relative and absolute paths it is easy to resolve typescript files, just change the file extension to `.ts` or `.tsx`. However for bare specifiers it is a bit more tricky. Most of the ime a bare specifier will resolve to a package installed into `node_modules` that is not part of your source code. But if you are using project references and yarn/npm workspaces then bare specifiers may point to a package that is part of your project.

The aim of this package is to resolve all cases including:

- Relative and absolute paths
- Bare specifiers for packages part of project references in a npm/yarn workspace
- Bare specifiers resolved by the `path` key in `tsconfig.json`.
