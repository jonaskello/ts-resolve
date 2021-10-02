import { tsResolve } from "../ts-resolve";

test("Simple resolve", () => {
  const resolved = tsResolve("hello", { conditions: [], parentURL: "" });
  expect(resolved.fileUrl).toBe("file://hello");
});
