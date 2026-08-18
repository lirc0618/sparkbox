import test from "node:test";
import assert from "node:assert/strict";
import { applySyncItemsToState, createBookmark } from "../src/domain.js";

const base = "2026-08-07T08:00:00.000Z";

function stateOf(overrides = {}) {
  return {
    version: 1,
    bookmarks: [],
    projects: [{ id: "p1", name: "项目一", description: "", color: "#6c5ce7", status: "active", createdAt: base, updatedAt: base }],
    preferences: { reviewSize: 5, snoozeDays: 3, language: "zh-CN", timeZone: "Asia/Shanghai", theme: "light", validationStartedAt: null },
    reviewLog: {},
    reviewSelections: {},
    reviewEvents: [],
    ...overrides,
  };
}

test("object sync creates new remote bookmarks without replacing the whole state", () => {
  const local = createBookmark({ id: "local", title: "本机收藏", projectIds: ["p1"] }, base);
  const remotePayload = createBookmark({ id: "remote", title: "远端收藏", projectIds: ["p1"], tags: ["同步"] }, "2026-08-08T08:00:00.000Z");
  const result = applySyncItemsToState(stateOf({ bookmarks: [local] }), [
    { entityType: "bookmark", entityId: "remote", payload: remotePayload, versionHash: "r1", clientUpdatedAt: remotePayload.updatedAt },
  ]);

  assert.deepEqual(result.state.bookmarks.map((bookmark) => bookmark.id).sort(), ["local", "remote"]);
  assert.equal(result.stats.created, 1);
  assert.equal(result.stats.updated, 0);
});

test("object sync applies newer remote updates and reports remote conflict wins", () => {
  const local = createBookmark({ id: "same", title: "本机标题" }, "2026-08-08T08:00:00.000Z");
  const remotePayload = createBookmark({ id: "same", title: "远端标题" }, "2026-08-09T08:00:00.000Z");
  const result = applySyncItemsToState(stateOf({ bookmarks: [local] }), [
    { entityType: "bookmark", entityId: "same", payload: remotePayload, versionHash: "r2", clientUpdatedAt: remotePayload.updatedAt },
  ], { lastMergedAt: "2026-08-07T00:00:00.000Z" });

  assert.equal(result.state.bookmarks.find((bookmark) => bookmark.id === "same").title, "远端标题");
  assert.equal(result.stats.updated, 1);
  assert.equal(result.stats.remoteWins, 1);
});

test("object sync preserves newer local edits and reports a local conflict", () => {
  const local = createBookmark({ id: "same", title: "本机较新" }, "2026-08-10T08:00:00.000Z");
  const remotePayload = createBookmark({ id: "same", title: "远端较旧" }, "2026-08-09T08:00:00.000Z");
  const result = applySyncItemsToState(stateOf({ bookmarks: [local] }), [
    { entityType: "bookmark", entityId: "same", payload: remotePayload, versionHash: "r3", clientUpdatedAt: remotePayload.updatedAt },
  ], { lastMergedAt: "2026-08-07T00:00:00.000Z" });

  assert.equal(result.state.bookmarks.find((bookmark) => bookmark.id === "same").title, "本机较新");
  assert.equal(result.stats.conflicts, 1);
  assert.equal(result.stats.localWins, 1);
});

test("object sync deletes stale remote removals and prunes invalid references", () => {
  const local = createBookmark({ id: "gone", title: "待删除", projectIds: ["p1"] }, "2026-08-08T08:00:00.000Z");
  const result = applySyncItemsToState(stateOf({
    bookmarks: [local],
    reviewLog: { "2026-08-08": { gone: "view" } },
    reviewSelections: { "2026-08-08": [{ id: "gone", reason: "测试" }] },
    reviewEvents: [{ id: "e1", itemId: "gone", eventType: "view", occurredAt: "2026-08-08T09:00:00.000Z" }],
  }), [
    { entityType: "bookmark", entityId: "gone", deleted: true, versionHash: "d1", clientUpdatedAt: "2026-08-11T08:00:00.000Z" },
  ]);

  assert.equal(result.state.bookmarks.length, 0);
  assert.deepEqual(result.state.reviewEvents, []);
  assert.deepEqual(result.state.reviewLog, { "2026-08-08": {} });
  assert.deepEqual(result.state.reviewSelections, { "2026-08-08": [] });
  assert.equal(result.stats.deleted, 1);
});
