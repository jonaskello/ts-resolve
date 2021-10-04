import * as path from "path";
import JSON5 from "json5";
import StripBom from "strip-bom";

/**
 * Typing for the parts of tsconfig that we care about
 */
export interface Tsconfig {
  readonly extends?: string;
  readonly references?: ReadonlyArray<{ readonly path: string }>;
  readonly include?: ReadonlyArray<string>;
  readonly exclude?: ReadonlyArray<string>;
  readonly files?: ReadonlyArray<string>;
  readonly compilerOptions?: {
    readonly rootDir?: string;
    readonly outDir?: string;
    // eslint-disable-next-line functional/prefer-readonly-type
    baseUrl?: string;
    readonly paths?: { readonly [key: string]: ReadonlyArray<string> };
    readonly strict?: boolean;
  };
}

export function loadTsconfig(
  configFilePath: string,
  existsSync: (path: string) => boolean,
  readFileSync: (filename: string) => string | undefined
): Tsconfig | undefined {
  try {
    if (!existsSync(configFilePath)) {
      return undefined;
    }
    const configString = readFileSync(configFilePath);
    if (configString === undefined) {
      return undefined;
    }
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
      if (base.compilerOptions?.baseUrl) {
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
  } catch (e: unknown) {
    console.error(`Error while trying to load tsconfig file ${configFilePath}.`);
    throw e;
  }
}
