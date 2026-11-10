// Display rules added for QA round 3 (10 Nov 2026): lesson match
// percentages, catalog-number status, the refinement chain as the run page
// loads it, and the older-pipeline marker.
import { describe, it, expect } from "vitest";
import { lessonMatchLabel, lessonMatchPercent } from "./lessons";
import { catalogDisplay } from "./catalogStatus";
import { loadChain, nextVersion } from "../../supabase/functions/_shared/versionChain";
import { madeByOlderPipeline, PIPELINE_VERSION } from "../../supabase/functions/_shared/pipelineVersion";

describe("lessonMatchPercent", () => {
  it("shows the cosine of new runs as a percentage", () => {
    expect(lessonMatchPercent({ similarity: 0.766, rating: 2, score: 1.224 })).toBe(77);
    expect(lessonMatchLabel({ similarity: 0.766, rating: 2, score: 1.224 })).toBe("77% match");
  });
  it("shows a lower bound for older runs' stored score (run 7a01520f: 1.633, shown as 163%)", () => {
    expect(lessonMatchLabel({ similarity: 1.633, rating: 2 })).toBe("at least 77% match");
    expect(lessonMatchPercent({ similarity: 1.485, rating: 5 })).toBe(69);
    expect(lessonMatchPercent({ similarity: 0.9, rating: null })).toBe(90);
  });
  it("never shows more than 100% or less than 0%", () => {
    for (const s of [0, 0.5, 0.99, 1, 1.5, 2.1, 3, -1]) {
      const p = lessonMatchPercent({ similarity: s, rating: 1 });
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});

describe("catalogDisplay", () => {
  it("shows only a confirmed number as verified", () => {
    expect(catalogDisplay({ catalog_number: "HTB-37", catalog_status: "verified", catalog_check: "ATCC's number for Caco-2" }))
      .toEqual({ number: "HTB-37", verified: true, note: "ATCC's number for Caco-2" });
    expect(catalogDisplay({ catalog_number: "B3157", catalog_status: "unverified", catalog_check: "not in Sigma-Aldrich's catalogue" })?.verified).toBe(false);
  });
  it("treats numbers of plans saved before the check as unverified", () => {
    const d = catalogDisplay({ catalog_number: "S1000" });
    expect(d?.verified).toBe(false);
    expect(d?.note).toMatch(/not confirmed/);
    expect(catalogDisplay({})).toBeNull();
  });
});

describe("the refinement chain on the run page", () => {
  // QA round 3: 7a01520f (v1) -> 40c0b182 (v2) -> 69a412a9 (v3).
  const rows = [
    { id: "7a01520f", parent_run_id: null, version: 1 },
    { id: "40c0b182", parent_run_id: "7a01520f", version: 2 },
    { id: "69a412a9", parent_run_id: "40c0b182", version: 3 },
  ];
  const one = async (id: string) => rows.find((r) => r.id === id) ?? null;
  const kids = async (ids: string[]) => rows.filter((r) => r.parent_run_id && ids.includes(r.parent_run_id));

  it("lists v1, v2 and v3 on every version's page", async () => {
    for (const r of rows) {
      const chain = await loadChain(r, one, kids);
      expect(chain.map((c) => `v${c.version}`)).toEqual(["v1", "v2", "v3"]);
    }
  });
  it("numbers a second refinement of v1 as v4", async () => {
    expect(nextVersion(await loadChain(rows[0], one, kids))).toBe(4);
  });
});

describe("older pipeline", () => {
  it("marks runs without the current pipeline version", () => {
    expect(madeByOlderPipeline(undefined)).toBe(true);
    expect(madeByOlderPipeline({ pipeline_version: PIPELINE_VERSION })).toBe(false);
  });
});

describe("display helpers with odd stored values", () => {
  it("lesson match: text, missing and broken numbers never leave 0-100", () => {
    const odd = [
      { similarity: "0.8" as unknown as number, rating: 3 },
      { similarity: null as unknown as number, rating: null },
      { similarity: Number.NaN, rating: 5 },
      { similarity: Infinity, rating: 5 },
      { similarity: 1.9, rating: 5, score: 1.9 },
      { similarity: 0.82, rating: 5, score: 1.74 },
    ];
    for (const e of odd) {
      const p = lessonMatchPercent(e);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    expect(lessonMatchLabel(odd[0])).toBe("80% match");
    expect(lessonMatchLabel(odd[5])).toBe("82% match");
    // A new run whose similarity is above 1 by mistake is capped, not called a lower bound.
    expect(lessonMatchLabel(odd[4])).toBe("100% match");
  });
  it("catalog number: a number stored as a number, blanks, and an unknown status", () => {
    expect(catalogDisplay({ catalog_number: 11965092 as unknown as string, catalog_status: "verified", catalog_check: "listed" })?.number).toBe("11965092");
    expect(catalogDisplay({ catalog_number: "   " })).toBeNull();
    const d = catalogDisplay({ catalog_number: "X1", catalog_status: "confirmed" as unknown as "verified" });
    expect(d?.verified).toBe(false);
  });
});
