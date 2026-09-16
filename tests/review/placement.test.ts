import { describe, expect, it, vi } from "vitest";
import { resolveSide, spaceAround } from "@/components/ui/placement";

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe("dropdown placement", () => {
  vi.stubGlobal("window", { innerHeight: 800 });
  it("keeps the preferred side when the panel fits", () => {
    expect(resolveSide(rect(100, 132), 200, "bottom")).toEqual({ side: "bottom", maxHeight: 652 });
    expect(resolveSide(rect(700, 732), 200, "top")).toEqual({ side: "top", maxHeight: 684 });
  });
  it("flips to the roomier side when the viewport would clip the panel", () => {
    expect(resolveSide(rect(700, 732), 300, "bottom")).toEqual({ side: "top", maxHeight: 684 });
    expect(resolveSide(rect(40, 72), 300, "top")).toEqual({ side: "bottom", maxHeight: 712 });
  });
  it("caps the height on the chosen side so the panel scrolls instead of clipping", () => {
    expect(resolveSide(rect(380, 412), 900, "bottom")).toEqual({ side: "bottom", maxHeight: 372 });
    expect(spaceAround(rect(0, 800))).toEqual({ above: 48, below: 48 });
  });
});
