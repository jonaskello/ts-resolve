import { pathToFileURL, fileURLToPath } from "url";
import { clearCache, tsResolve } from "../ts-resolve";
import { createFilesystem, MockFilesystem } from "./mock-filesystem";
import { UtilsTest } from "./test-utils";

export type ResolveTest = {
  testName: string;
  entryTsConfig: string;
  unsresolvedEntryTsFilePath: string;
  resolvedFileUrl: string;
  mfs: MockFilesystem;
  cwd: string;
} & UtilsTest;

export function runTest(resolveTest: ResolveTest) {
  clearCache();
  const { entryTsConfig, unsresolvedEntryTsFilePath, resolvedFileUrl, cwd, mfs } = resolveTest;
  const fileSystem = createFilesystem(mfs, cwd);
  // parentURL is undefined for the entry file
  const importsStack: Array<readonly [parentURL: string | undefined, unresolved: string, resolved: string]> = [];
  importsStack.push([undefined, unsresolvedEntryTsFilePath, resolvedFileUrl]);
  while (importsStack.length > 0) {
    const [parentURL, unresolvedUrl, expectedUrl] = importsStack.pop()!;
    const resolved = tsResolve(unresolvedUrl, { conditions: [], parentURL }, entryTsConfig, fileSystem);
    // Assert resolved url
    expect(resolved?.fileUrl).toBe(expectedUrl);
    if (resolved === undefined) {
      throw new Error("Resolve failed");
    }
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
