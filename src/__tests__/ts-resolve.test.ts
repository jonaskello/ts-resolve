import { tsResolve } from "../ts-resolve";

test("Simple resolve", () => {
  const resolved = tsResolve(
    "./hello.ts",
    { conditions: [], parentURL: undefined },
    "",
    { cwd: () => "/abs/working/dir", fileExists: () => false }
  );
  expect(resolved.fileUrl).toBe("file:///abs/working/dir/hello.ts");
});
