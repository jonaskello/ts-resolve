import { fileURLToPath, pathToFileURL } from "url";
import { tsResolve } from "../ts-resolve";
import { MockFilesystem, createFilesystem } from "./mock-filesystem";
import { runTest } from "./resolve-test";
import { testCase as case1 } from "./resolve-tests/case1";

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

const cwd = "/root";
const fileSystem = createFilesystem(mfs, cwd);

const entryTsConfig = "./packages/server/tsconfig.json";

test("Resolve entry file", () => {
  // parentURL is undefined for the entry file
  const resolved = tsResolve(
    "./packages/server/src/server.ts",
    { conditions: [], parentURL: undefined },
    entryTsConfig,
    fileSystem
  );
  expect(resolved?.fileUrl).toBe("file:///root/packages/server/src/server.ts");
});

test("Relative resolve", () => {
  const resolved = tsResolve(
    "./start-server.js",
    { conditions: [], parentURL: "file:///root/packages/server/src/server.ts" },
    entryTsConfig,
    fileSystem
  );
  expect(resolved?.fileUrl).toBe("file:///root/packages/server/src/start-server.ts");
});

test("Bare specifier, link to package referenced in tsconfig", () => {
  const resolved = tsResolve(
    "@app/shared",
    { conditions: [], parentURL: "file:///root/packages/server/src/start-server.ts" },
    entryTsConfig,
    fileSystem
  );
  expect(resolved?.fileUrl).toBe("file:///root/packages/shared/src/index.ts");
});

test("Resolve all", () => {
  // runTest({
  //   entryTsConfig,
  //   unsresolvedEntryTsFilePath: "./packages/server/src/server.ts",
  //   resolvedFileUrl: "file:///root/packages/server/src/server.ts",
  //   mfs,
  //   cwd,
  // });
  runTest(case1);
});
