/* eslint-disable @typescript-eslint/no-unsafe-return */
import { URL } from "url";
import { IsDirectory, ReadFile } from "./filesystem";
import * as ru from "./resolve-utils";

/**
 * This needs to be implemented by the caller
 */
type PackageResolve = (
  specifier: string,
  base: string | URL | undefined,
  conditions: ReadonlySet<string>,
  isDirectory: IsDirectory,
  readFile: ReadFile
) => ReadonlyArray<URL>;

/**
 * Relevant parts of package.json
 */
type PackageConfig = {
  readonly pjsonPath: string;
  readonly exists: boolean;
  readonly main: string | undefined;
  readonly name: string | undefined;
  readonly type: string;
  readonly exports: unknown | undefined;
  readonly imports: unknown | undefined;
};

export function getPackageConfig(
  readFile: ReadFile,
  path: string,
  specifier: string,
  base: string | URL | undefined
): PackageConfig {
  return ru.getPackageConfig(readFile, path, specifier, base);
}

export function packageExportsResolve(
  packageResolve: PackageResolve,
  packageJSONUrl: URL,
  packageSubpath: string,
  packageConfig: PackageConfig,
  base: string | URL | undefined,
  conditions: ReadonlySet<string>
): { readonly resolved: URL; readonly exact: boolean } {
  return ru.packageExportsResolve(packageResolve, packageJSONUrl, packageSubpath, packageConfig, base, conditions);
}

export function packageImportsResolve(
  packageResolve: PackageResolve,
  name: string,
  base: string | undefined,
  conditions: ReadonlySet<string>,
  readFile: ReadFile
): { readonly resolved: URL; readonly exact: boolean } {
  return ru.packageImportsResolve(packageResolve, name, base, conditions, readFile);
}
