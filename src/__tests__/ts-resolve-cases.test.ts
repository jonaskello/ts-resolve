import { fileURLToPath, pathToFileURL } from "url";
import { tsResolve } from "../ts-resolve";
import { clearCache } from "../tsconfig-info";
import { createFilesystem } from "./mock-filesystem";
import { ResolveTest } from "./resolve-test";
import { testCase as case1 } from "./resolve-tests/case1";
import { testCase as case2 } from "./resolve-tests/case2";
import { onlySkip } from "./test-utils";

const tests: ReadonlyArray<ResolveTest> = [case1, case2];

onlySkip(tests).forEach((item) => {
  describe(`${item.testName} `, () => {
    clearCache();
    const { entryTsConfig, unsresolvedEntryTsFilePath, resolvedFileUrl, cwd, mfs } = item;
    const fileSystem = createFilesystem(mfs, cwd);
    // parentURL is undefined for the entry file
    type StackItem = { parentURL: string | undefined; unresolved: string; expectedUrl: string };
    const importsStack: Array<StackItem> = [];
    importsStack.push({ parentURL: undefined, unresolved: unsresolvedEntryTsFilePath, expectedUrl: resolvedFileUrl });

    while (importsStack.length > 0) {
      const { parentURL, unresolved, expectedUrl } = importsStack.pop()!;
      const resolved = tsResolve(unresolved, { conditions: [], parentURL }, entryTsConfig, fileSystem);
      // eslint-disable-next-line @typescript-eslint/no-loop-func
      test(`Resolve ${unresolved} (${(parentURL && fileURLToPath(parentURL)) ?? "undefined"})`, () => {
        // Assert resolved url
        expect(resolved?.fileUrl).toBe(expectedUrl);
      });
      if (resolved === undefined) {
        throw new Error("Resolve failed");
      }
      // Get the mock file for the resolved file
      const mfsFile = mfs[fileURLToPath(resolved.fileUrl)];
      if (mfsFile.type !== "TsFile") {
        throw new Error("Resolved typescript file not found in mock file system.");
      }
      importsStack.push(
        ...mfsFile.imports.map((imp) => ({
          parentURL: resolved.fileUrl,
          unresolved: imp.unresolved,
          expectedUrl: pathToFileURL(imp.resolved).href,
        }))
      );
    }
  });
});
