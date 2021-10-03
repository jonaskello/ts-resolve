import { fileURLToPath, pathToFileURL } from "url";
import { tsResolve } from "../ts-resolve";
import { MockFilesystem, createFilesystem } from "./mock-filesystem";

const mfs: MockFilesystem = {
  // server
  "/root/packages/server/package.json": {
    type: "JsonFile",
    json: {
      name: "@app/server",
      version: "1.0.0",
      main: "index.js",
      type: "module",
    },
  },
  "/root/packages/server/tsconfig.json": {
    type: "JsonFile",
    json: {
      compilerOptions: {
        outDir: "lib",
        rootDir: "src",
      },
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
    json: {
      name: "@app/shared",
      version: "1.0.0",
      main: "lib/index.js",
      type: "module",
    },
  },
  "/root/packages/shared/tsconfig.json": {
    type: "JsonFile",
    json: {
      compilerOptions: {
        outDir: "lib",
        rootDir: "src",
      },
    },
  },
  "/root/packages/shared/src/index.ts": { type: "TsFile", imports: [] },
  // node_modules
  "/root/node_modules/@app/server": { type: "Symlink", realPath: "/root/packages/server" },
  "/root/node_modules/@app/shared": { type: "Symlink", realPath: "/root/packages/shared" },
};

const fileSystem = createFilesystem(mfs, "/root");

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

test.only("Resolve all", () => {
  // parentURL is undefined for the entry file
  const importsStack: Array<readonly [parentURL: string, unresolved: string, resolved: string]> = [];
  importsStack.push([undefined, "./packages/server/src/server.ts", "file:///root/packages/server/src/server.ts"]);
  while (importsStack.length > 0) {
    const [parentURL, unresolvedUrl, expectedUrl] = importsStack.pop();
    const resolved = tsResolve(unresolvedUrl, { conditions: [], parentURL }, entryTsConfig, fileSystem);
    expect(resolved?.fileUrl).toBe(expectedUrl);
    // Get the mock file for the resolved file
    const mfsFile = mfs[fileURLToPath(resolved.fileUrl)];
    if (mfsFile.type !== "TsFile") {
      throw new Error("Resolved typescript file not found in mock file system.");
    }
    importsStack.push(
      ...mfsFile.imports.map((imp) => [resolved.fileUrl, imp.unresolved, pathToFileURL(imp.resolved).href] as const)
    );
  }
});
