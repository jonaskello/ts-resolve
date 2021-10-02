import { tsResolve } from "../ts-resolve";
import { MockFilesystem, createFilesystem } from "./mock-filesystem";

const mfs: MockFilesystem = {
  // server
  "/root/packages/server/package.json": { type: "FileEntry", content: {} },
  "/root/packages/server/tsconfig.json": { type: "FileEntry", content: {} },
  "/root/packages/server/src/server.ts": { type: "FileEntry", content: "import { startServer } from './start-server'" },
  "/root/packages/server/src/start-server.ts": {
    type: "FileEntry",
    content: "import { appendMessage } from '@app/shared'",
  },
  // shared
  "/root/packages/shared/package.json": { type: "FileEntry", content: {} },
  "/root/packages/shared/tsconfig.json": { type: "FileEntry", content: {} },
  // node_modules
  "/root/node_modules/@app/server": { type: "LinkEntry", realPath: "packages/server" },
  "/root/node_modules/@app/shared": { type: "LinkEntry", realPath: "packages/server" },
};

const fileSystem = createFilesystem(mfs, "/root");

test("Resolve entry file", () => {
  // parentURL is undefined for the entry file
  const resolved = tsResolve("packages/server/src/server.ts", { conditions: [], parentURL: undefined }, "", fileSystem);
  expect(resolved.fileUrl).toBe("file:///abs/working/dir/packages/server/src/server.ts");
});

test.only("Relative resolve", () => {
  const resolved = tsResolve(
    "./start-server.ts",
    { conditions: [], parentURL: "/root/packages/server/src/server.ts" },
    "",
    fileSystem
  );
  expect(resolved.fileUrl).toBe("file:///abs/working/dir/hello.ts");
});
