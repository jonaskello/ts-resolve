import { ResolveTest } from "../resolve-test";
import { MockFilesystem } from "../mock-filesystem";

// Simple case with only an entry file

const mfs: MockFilesystem = {
  "/root/packages/server/tsconfig.json": {
    type: "JsonFile",
    json: {
      compilerOptions: { outDir: "lib", rootDir: "src" },
    },
  },
  "/root/packages/server/src/server.ts": {
    type: "TsFile",
    imports: [],
    tsconfig: "/root/packages/server/tsconfig.json",
  },
};

export const testCase: ResolveTest = {
  testName: "Entryfile only",
  entryTsConfig: "./packages/server/tsconfig.json",
  unsresolvedEntryTsFilePath: "./packages/server/src/server.ts",
  resolvedFileUrl: "file:///root/packages/server/src/server.ts",
  mfs,
  cwd: "/root",
};
