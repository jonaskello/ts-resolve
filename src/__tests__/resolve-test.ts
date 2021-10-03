import { pathToFileURL, fileURLToPath } from "url";
import { FileSystem } from "../filesystem";
import { tsResolve } from "../ts-resolve";
import { createFilesystem, MockFilesystem } from "./mock-filesystem";

export type ResolveTest = {
  entryTsConfig: string;
  unsresolvedEntryTsFilePath: string;
  resolvedFileUrl: string;
  mfs: MockFilesystem;
  cwd: string;
};

export function runTest(resolveTest: ResolveTest) {
  const { entryTsConfig, unsresolvedEntryTsFilePath, resolvedFileUrl, cwd, mfs } = resolveTest;
  const fileSystem = createFilesystem(mfs, cwd);
  // parentURL is undefined for the entry file
  const importsStack: Array<readonly [parentURL: string, unresolved: string, resolved: string]> = [];
  importsStack.push([undefined, unsresolvedEntryTsFilePath, resolvedFileUrl]);
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
}
