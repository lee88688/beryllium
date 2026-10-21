// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  PANEL_STATE_DEFAULT,
  PANEL_STATE_KEY,
  readPanelState,
  writePanelState,
} from "@/features/reader/panel-state";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readPanelState", () => {
  it("expands the TOC on the first visit", () => {
    expect(readPanelState()).toEqual(PANEL_STATE_DEFAULT);
    expect(PANEL_STATE_DEFAULT).toEqual({ open: true, tab: "toc" });
  });

  it("round-trips what writePanelState stored", () => {
    writePanelState({ open: false, tab: "type" });
    expect(readPanelState()).toEqual({ open: false, tab: "type" });
    expect(window.localStorage.getItem(PANEL_STATE_KEY)).toBe(
      '{"open":false,"tab":"type"}',
    );
  });

  it("falls back per field instead of throwing on a hand-edited payload", () => {
    // 坏 JSON：整份退回默认。
    window.localStorage.setItem(PANEL_STATE_KEY, "{oops");
    expect(readPanelState()).toEqual(PANEL_STATE_DEFAULT);

    // 缺字段 / 未知视图：逐字段退回（旧版本存过的视图名不该把侧栏弹开）。
    window.localStorage.setItem(PANEL_STATE_KEY, '{"open":false}');
    expect(readPanelState()).toEqual({ open: false, tab: "toc" });
    window.localStorage.setItem(
      PANEL_STATE_KEY,
      '{"open":false,"tab":"search"}',
    );
    expect(readPanelState()).toEqual({ open: false, tab: "toc" });
  });
});
