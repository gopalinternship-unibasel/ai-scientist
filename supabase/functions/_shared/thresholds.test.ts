import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fractionSetting } from "./thresholds.ts";
import {
  DEFAULT_LIT_EMBED_MARGIN, DEFAULT_LIT_EMBED_MIN_SIMILARITY, litEmbedMargin, litEmbedMinSimilarity,
} from "./embeddingRelevance.ts";
import { EXACT_EMBED_MIN, exactEmbedMin } from "./noveltyVerdict.ts";

Deno.test("a threshold setting is used only when it is a number between 0 and 1", () => {
  assertEquals(fractionSetting(undefined, 0.78), 0.78);
  assertEquals(fractionSetting("", 0.78), 0.78);
  assertEquals(fractionSetting(" 0.5 ", 0.78), 0.5);
  for (const bad of ["0", "1", "1.5", "-0.2", "abc"]) assertEquals(fractionSetting(bad, 0.78), 0.78);
});

Deno.test("today's defaults hold when no setting is present", () => {
  assertEquals(DEFAULT_LIT_EMBED_MIN_SIMILARITY, 0.66);
  assertEquals(DEFAULT_LIT_EMBED_MARGIN, 0.15);
  assertEquals(EXACT_EMBED_MIN, 0.78);
  assertEquals(litEmbedMinSimilarity(), 0.66);
  assertEquals(litEmbedMargin(), 0.15);
  assertEquals(exactEmbedMin(), 0.78);
});

Deno.test("settings override the thresholds", () => {
  Deno.env.set("EXACT_EMBED_MIN", "0.6");
  Deno.env.set("LIT_EMBED_MIN_SIMILARITY", "0.5");
  try {
    assertEquals(exactEmbedMin(), 0.6);
    assertEquals(litEmbedMinSimilarity(), 0.5);
  } finally {
    Deno.env.delete("EXACT_EMBED_MIN");
    Deno.env.delete("LIT_EMBED_MIN_SIMILARITY");
  }
});
