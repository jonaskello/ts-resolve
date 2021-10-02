import * as path from "path";
import * as fs from "fs";
// tslint:disable:no-require-imports
import JSON5 = require("json5");
import StripBom = require("strip-bom");
// tslint:enable:no-require-imports

/**
 * Typing for the parts of tsconfig that we care about
 */
export interface Tsconfig {
  extends?: string;
  references?: Array<{ path: string }>;
  include?: Array<string>;
  exclude?: Array<string>;
  files?: Array<string>;
  compilerOptions?: {
    rootDir?: string;
    outDir?: string;
    baseUrl?: string;
    paths?: { [key: string]: Array<string> };
    strict?: boolean;
  };
}

export function loadTsconfig(
  configFilePath: string,
  existsSync: (path: string) => boolean = fs.existsSync,
  readFileSync: (filename: string) => string = (filename: string) => fs.readFileSync(filename, "utf8")
): Tsconfig | undefined {
  if (!existsSync(configFilePath)) {
    return undefined;
  }

  const configString = readFileSync(configFilePath);
  const cleanedJson = StripBom(configString);
  const config: Tsconfig = JSON5.parse(cleanedJson);
  let extendedConfig = config.extends;

  if (extendedConfig) {
    if (typeof extendedConfig === "string" && extendedConfig.indexOf(".json") === -1) {
      extendedConfig += ".json";
    }
    const currentDir = path.dirname(configFilePath);
    let extendedConfigPath = path.join(currentDir, extendedConfig);
    if (extendedConfig.indexOf("/") !== -1 && extendedConfig.indexOf(".") !== -1 && !existsSync(extendedConfigPath)) {
      extendedConfigPath = path.join(currentDir, "node_modules", extendedConfig);
    }

    const base = loadTsconfig(extendedConfigPath, existsSync, readFileSync) || {};

    // baseUrl should be interpreted as relative to the base tsconfig,
    // but we need to update it so it is relative to the original tsconfig being loaded
    if (base.compilerOptions && base.compilerOptions.baseUrl) {
      const extendsDir = path.dirname(extendedConfig);
      base.compilerOptions.baseUrl = path.join(extendsDir, base.compilerOptions.baseUrl);
    }

    return {
      ...base,
      ...config,
      compilerOptions: {
        ...base.compilerOptions,
        ...config.compilerOptions,
      },
    };
  }
  return config;
}
