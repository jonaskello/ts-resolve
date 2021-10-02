import { tsResolve } from "../ts-resolve";
import { VirtualFilesystem, createFilesystem } from "./virtual-filesystem";

const vfs: VirtualFilesystem = {
  // server
  "packages/server/package.json": { type: "FileEntry", content: {} },
  "packages/server/tsconfig.json": { type: "FileEntry", content: {} },
  "packages/server/src/server.ts": { type: "FileEntry", content: "import { startServer } from './start-server'" },
  "packages/server/src/start-server.ts": { type: "FileEntry", content: "import { appendMessage } from '@app/shared'" },
  // shared
  "packages/shared/package.json": { type: "FileEntry", content: {} },
  "packages/shared/tsconfig.json": { type: "FileEntry", content: {} },
  // node_modules
  "node_modules/@app/server": { type: "LinkEntry", realPath: "packages/server" },
  "node_modules/@app/shared": { type: "LinkEntry", realPath: "packages/server" },
};

const fileSystem = createFilesystem(vfs);

test("Resolve entry file", () => {
  // parentURL is undefined for the entry file
  const resolved = tsResolve("packages/server/src/server.ts", { conditions: [], parentURL: undefined }, "", fileSystem);
  expect(resolved.fileUrl).toBe("file:///abs/working/dir/packages/server/src/server.ts");
});

test("Relative resolve", () => {
  const resolved = tsResolve(
    "packages/server/src/start-server.ts",
    { conditions: [], parentURL: "packages/server/src/server.ts" },
    "",
    fileSystem
  );
  expect(resolved.fileUrl).toBe("file:///abs/working/dir/hello.ts");
});
