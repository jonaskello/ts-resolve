import { ResolveTest } from "../resolve-test";
import { MockFilesystem } from "../mock-filesystem";

const mfs: MockFilesystem = {
  // server
  "/root/packages/server/package.json": {
    type: "JsonFile",
    json: { name: "@app/server", version: "1.0.0", main: "index.js", type: "module" },
  },
  "/root/packages/server/tsconfig.json": {
    type: "JsonFile",
    json: {
      compilerOptions: { outDir: "lib", rootDir: "src" },
      references: [{ path: "../shared" }],
    },
  },
  "/root/packages/server/src/server.ts": {
    type: "TsFile",
    imports: [{ unresolved: "./start-server", resolved: "/root/packages/server/src/start-server.ts" }],
  },
  "/root/packages/server/src/start-server.ts": {
    type: "TsFile",
    imports: [{ unresolved: "@app/shared", resolved: "/root/packages/shared/src/index.ts" }],
  },
  // shared
  "/root/packages/shared/package.json": {
    type: "JsonFile",
    json: { name: "@app/shared", version: "1.0.0", main: "lib/index.js", type: "module" },
  },
  "/root/packages/shared/tsconfig.json": {
    type: "JsonFile",
    json: { compilerOptions: { outDir: "lib", rootDir: "src" } },
  },
  "/root/packages/shared/src/index.ts": { type: "TsFile", imports: [] },
  // node_modules
  "/root/node_modules/@app/server": { type: "Symlink", realPath: "/root/packages/server" },
  "/root/node_modules/@app/shared": { type: "Symlink", realPath: "/root/packages/shared" },
};

export const testCase: ResolveTest = {
  entryTsConfig: "./packages/server/tsconfig.json",
  unsresolvedEntryTsFilePath: "./packages/server/src/server.ts",
  resolvedFileUrl: "file:///root/packages/server/src/server.ts",
  mfs,
  cwd: "/root",
};
