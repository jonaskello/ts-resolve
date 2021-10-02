import { tsResolve } from "../ts-resolve";
import { MockFilesystem, createFilesystem } from "./mock-filesystem";

const mfs: MockFilesystem = {
  // server
  "/root/packages/server/package.json": {
    type: "JsonFileEntry",
    json: {
      name: "@app/server",
      version: "1.0.0",
      main: "index.js",
      type: "module",
    },
  },
  "/root/packages/server/tsconfig.json": {
    type: "JsonFileEntry",
    json: {
      compilerOptions: {
        outDir: "lib",
        rootDir: "src",
      },
      references: [{ path: "../shared" }],
    },
  },
  "/root/packages/server/src/server.ts": { type: "TsFileEntry", imports: ["./start-server"] },
  "/root/packages/server/src/start-server.ts": { type: "TsFileEntry", imports: ["@app/shared"] },
  // shared
  "/root/packages/shared/package.json": {
    type: "JsonFileEntry",
    json: {
      name: "@app/shared",
      version: "1.0.0",
      main: "lib/index.js",
      type: "module",
    },
  },
  "/root/packages/shared/tsconfig.json": {
    type: "JsonFileEntry",
    json: {
      compilerOptions: {
        outDir: "lib",
        rootDir: "src",
      },
    },
  },
  // node_modules
  "/root/node_modules/@app/server": { type: "LinkEntry", realPath: "/root/packages/server" },
  "/root/node_modules/@app/shared": { type: "LinkEntry", realPath: "/root/packages/shared" },
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

test.only("Bare specifier, link to package referenced in tsconfig", () => {
  const resolved = tsResolve(
    "@app/shared",
    { conditions: [], parentURL: "file:///root/packages/server/src/start-server.ts" },
    entryTsConfig,
    fileSystem
  );
  expect(resolved?.fileUrl).toBe("file:///root/packages/server/src/start-server.ts");
});
