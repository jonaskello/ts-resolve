import { ResolveTest, runTest } from "./resolve-test";
import { testCase as case1 } from "./resolve-tests/case1";
import { testCase as case2 } from "./resolve-tests/case2";
import { onlySkip } from "./test-utils";

const tests: ReadonlyArray<ResolveTest> = [case1, case2];

describe("Resolve tests", () => {
  onlySkip(tests).forEach((item) => {
    test(item.testName, () => {
      runTest(item);
    });
  });
});
