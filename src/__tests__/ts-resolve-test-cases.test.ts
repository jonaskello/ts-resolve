import { runTest } from "./resolve-test";
import { testCase as case1 } from "./resolve-tests/case1";
import { testCase as case2 } from "./resolve-tests/case2";

const allCases = [case1, case2];

test.only("Run all", () => {
  runTest(case1);
});
