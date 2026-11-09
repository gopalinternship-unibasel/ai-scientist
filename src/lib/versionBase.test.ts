import { describe, it, expect } from "vitest";
import { refinementBase } from "./versionBase";

const v1 = { id: "a", version: 1, plan: { title: "v1" } };
const v2failed = { id: "b", version: 2, plan: null };
const v3 = { id: "c", version: 3, plan: null };

describe("refinementBase", () => {
  it("uses the parent run, not the next-lower version", () => {
    const base = refinementBase({ id: "c", version: 3, parent_run_id: "a" }, [v1, v2failed, v3]);
    expect(base?.id).toBe("a");
    expect(base?.version).toBe(1);
  });
  it("skips versions without a plan when the parent is not in the chain", () => {
    const base = refinementBase({ id: "c", version: 3, parent_run_id: "zz" }, [v1, v2failed, v3]);
    expect(base?.id).toBe("a");
  });
  it("returns null for an initial plan", () => {
    expect(refinementBase({ id: "a", version: 1, parent_run_id: null }, [v1])).toBeNull();
  });
});
