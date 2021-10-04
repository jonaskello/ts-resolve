import { MockFilesystem } from "./mock-filesystem";
import { UtilsTest } from "./test-utils";

export type ResolveTest = {
  readonly testName: string;
  readonly entryTsConfig: string;
  readonly unsresolvedEntryTsFilePath: string;
  readonly resolvedFileUrl: string;
  readonly mfs: MockFilesystem;
  readonly cwd: string;
} & UtilsTest;
