import test from "node:test";
import assert from "node:assert/strict";
import { createStore, normalizeRecoveryPoints, normalizeSyncAuditEvents, RECOVERY_POINTS_STORAGE_KEY, RECOVERY_STORAGE_KEY, STORAGE_KEY, SYNC_AUDIT_STORAGE_KEY } from "../src/store.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    dump: () => Object.fromEntries(data),
  };
}

test("store persists bookmark CRUD", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const bookmark = store.addBookmark({ title: "真实收藏", tags: "测试" });
  assert.equal(store.getState().bookmarks[0].title, "真实收藏");
  store.updateBookmark(bookmark.id, { status: "to_read" });
  assert.equal(store.getState().bookmarks[0].status, "to_read");
  assert.ok(storage.dump()[STORAGE_KEY].includes("真实收藏"));
  store.deleteBookmark(bookmark.id);
  assert.equal(store.getState().bookmarks.some((item) => item.id === bookmark.id), false);
  assert.deepEqual(store.getState().syncTombstones.map((entry) => `${entry.entityType}:${entry.entityId}`), [`bookmark:${bookmark.id}`]);
});

test("deleting a project removes bookmark associations", () => {
  const store = createStore(memoryStorage());
  const project = store.addProject({ name: "测试项目" });
  const bookmark = store.addBookmark({ title: "项目收藏", projectIds: [project.id] });
  store.deleteProject(project.id);
  assert.deepEqual(store.getState().bookmarks.find((item) => item.id === bookmark.id).projectIds, []);
  assert.deepEqual(store.getState().syncTombstones.map((entry) => `${entry.entityType}:${entry.entityId}`), [`project:${project.id}`]);
});

test("review actions update behavior data and daily log", () => {
  const store = createStore(memoryStorage());
  const bookmark = store.getState().bookmarks[0];
  store.recordReview(bookmark.id, "view");
  const updated = store.getState().bookmarks.find((item) => item.id === bookmark.id);
  assert.equal(updated.recommendationCount, bookmark.recommendationCount + 1);
  assert.equal(updated.viewCount, bookmark.viewCount + 1);
  assert.ok(updated.lastViewedAt);
});

test("store detects duplicate canonical URLs", () => {
  const store = createStore(memoryStorage());
  store.addBookmark({ title: "原链接", url: "https://www.example.com/a?utm_source=x" });
  assert.throws(
    () => store.addBookmark({ title: "重复链接", url: "https://example.com/a" }),
    (error) => error.code === "DUPLICATE_URL",
  );
});

test("store allows an intentional duplicate copy", () => {
  const store = createStore(memoryStorage());
  store.addBookmark({ title: "原链接", url: "https://example.com/copy" });
  store.addBookmark({ title: "副本", url: "https://www.example.com/copy", allowDuplicate: true });
  assert.equal(store.getState().bookmarks.filter((item) => item.canonicalUrl === "https://example.com/copy").length, 2);
});

test("today review selection remains stable after bookmark state changes", () => {
  const store = createStore(memoryStorage());
  const first = store.getTodayReview(3).map(({ bookmark }) => bookmark.id);
  store.updateBookmark(first[0], { status: "used" });
  const second = store.getTodayReview(3).map(({ bookmark }) => bookmark.id);
  assert.deepEqual(second, first);
});

test("today review respects count changes without changing its ordering", () => {
  const store = createStore(memoryStorage());
  const five = store.getTodayReview(5).map(({ bookmark }) => bookmark.id);
  const one = store.getTodayReview(1).map(({ bookmark }) => bookmark.id);
  assert.deepEqual(one, five.slice(0, 1));
});

test("review events preserve multiple actions and reset consecutive skips", () => {
  const store = createStore(memoryStorage());
  const id = store.getState().bookmarks[0].id;
  store.recordReview(id, "skip");
  assert.equal(store.getState().bookmarks.find((item) => item.id === id).skipCount, 1);
  store.recordReview(id, "view");
  assert.equal(store.getState().bookmarks.find((item) => item.id === id).skipCount, 0);
  assert.deepEqual(store.getState().reviewEvents.slice(-2).map((event) => event.eventType), ["skip", "view"]);
});

test("combined review outcome updates bookmark and event in one write", () => {
  const storage = memoryStorage();
  let writes = 0;
  const originalSet = storage.setItem;
  storage.setItem = (...args) => { writes += 1; originalSet(...args); };
  const store = createStore(storage);
  const id = store.getState().bookmarks[0].id;
  store.handleReview(id, "use", { bookmarkChanges: { status: "used", useOutcome: "完成一次实践" }, outcomeNote: "完成一次实践" });
  const updated = store.getState().bookmarks.find((item) => item.id === id);
  assert.equal(writes, 1);
  assert.equal(updated.status, "used");
  assert.equal(store.getState().reviewEvents.at(-1).outcomeNote, "完成一次实践");
});

test("failed persistence does not leave a phantom bookmark in memory", () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("quota"); };
  const store = createStore(storage);
  const before = store.getState().bookmarks.length;
  assert.throws(() => store.addBookmark({ title: "无法保存" }), /本次修改没有保存/);
  assert.equal(store.getState().bookmarks.length, before);
});

test("corrupted local data is preserved before normal use continues", () => {
  const broken = '{"bookmarks":';
  const storage = memoryStorage({ [STORAGE_KEY]: broken });
  const store = createStore(storage);
  assert.equal(store.getStorageStatus().recoveryRaw, broken);
  assert.equal(storage.dump()[RECOVERY_STORAGE_KEY], broken);
  store.addBookmark({ title: "继续使用" });
  assert.equal(storage.dump()[RECOVERY_STORAGE_KEY], broken);
});

test("store falls back safely when browser storage cannot be read", () => {
  const storage = memoryStorage();
  storage.getItem = () => { throw new Error("SecurityError"); };
  assert.doesNotThrow(() => createStore(storage));
});

test("loaded preferences fall back from an invalid timezone", () => {
  const snapshot = createStore(memoryStorage()).getState();
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...snapshot, preferences: { ...snapshot.preferences, timeZone: "Mars/Olympus" } }) });
  const store = createStore(storage);
  assert.equal(store.getState().preferences.timeZone, "Asia/Shanghai");
  assert.doesNotThrow(() => store.getTodayReview(3));
});

test("batch import commits once and skips existing canonical URLs", () => {
  const storage = memoryStorage();
  let writes = 0;
  const originalSet = storage.setItem;
  storage.setItem = (...args) => { writes += 1; originalSet(...args); };
  const store = createStore(storage);
  const existing = store.getState().bookmarks[0].url;
  const result = store.addBookmarks([
    { title: "新链接", url: "https://example.net/new" },
    { title: "重复", url: existing },
    { title: "一段文字", rawText: "一段文字" },
  ]);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.equal(writes, 1);
});

test("backup restore rejects invalid data without replacing current state", () => {
  const store = createStore(memoryStorage());
  const before = store.getState();
  assert.throws(() => store.restoreBackup({ bookmarks: "bad", projects: [] }), /格式或关联关系不正确/);
  assert.equal(store.getState(), before);
});

test("backup restore rejects malformed records without replacing current state", () => {
  const store = createStore(memoryStorage());
  const before = store.getState();
  assert.throws(
    () => store.restoreBackup({ bookmarks: [{ id: "broken", title: "" }], projects: [] }),
    /格式或关联关系不正确/,
  );
  assert.equal(store.getState(), before);
});

test("backup restore rejects malformed nested bookmark fields", () => {
  const store = createStore(memoryStorage());
  const before = store.getState();
  const malformed = { ...before.bookmarks[0], tags: [{}] };
  assert.throws(
    () => store.restoreBackup({ ...before, bookmarks: [malformed, ...before.bookmarks.slice(1)] }),
    /格式或关联关系不正确/,
  );
  assert.equal(store.getState(), before);
});

test("backup restore rejects malformed preferences and selections", () => {
  const store = createStore(memoryStorage());
  const before = store.getState();
  assert.throws(
    () => store.restoreBackup({ ...before, preferences: { ...before.preferences, timeZone: "Mars/Olympus" } }),
    /格式或关联关系不正确/,
  );
  assert.throws(
    () => store.restoreBackup({ ...before, reviewSelections: "bad" }),
    /格式或关联关系不正确/,
  );
  assert.throws(
    () => store.restoreBackup({ ...before, reviewSelections: { "2026-08-07": [{ id: "missing", reason: "bad" }] } }),
    /格式或关联关系不正确/,
  );
  assert.throws(
    () => store.restoreBackup({ ...before, reviewEvents: [{ itemId: before.bookmarks[0].id, eventType: "bogus", occurredAt: "2026-08-07T00:00:00Z" }] }),
    /格式或关联关系不正确/,
  );
  assert.equal(store.getState(), before);
});

test("backup restore replaces state only after validation", () => {
  const store = createStore(memoryStorage());
  const original = store.getState().bookmarks[0];
  const backup = {
    ...store.getState(),
    bookmarks: [{ ...original, id: "restored", title: "恢复后的收藏", projectIds: [] }],
    projects: [],
  };
  store.restoreBackup(backup);
  assert.deepEqual(store.getState().bookmarks.map((item) => item.title), ["恢复后的收藏"]);
});

test("backup restore preserves coherent history for a deleted bookmark", () => {
  const source = createStore(memoryStorage());
  const id = source.getState().bookmarks[0].id;
  source.handleReview(id, "view");
  source.handleReview(id, "deleted", { deleteAfter: true });
  const target = createStore(memoryStorage());
  assert.doesNotThrow(() => target.restoreBackup(source.getState()));
  assert.equal(target.getState().reviewEvents.filter((event) => event.itemId === id).length, 2);
});

test("ordinary permanent deletion keeps the exported state restorable", () => {
  const source = createStore(memoryStorage());
  const id = source.getState().bookmarks[0].id;
  source.recordReview(id, "view");
  source.getTodayReview(5);
  source.deleteBookmark(id);
  const target = createStore(memoryStorage());
  assert.doesNotThrow(() => target.restoreBackup(source.getState()));
  assert.equal(target.getState().reviewEvents.some((event) => event.itemId === id), false);
});

test("backup restore migrates an older export with missing review fields", () => {
  const source = createStore(memoryStorage()).getState();
  const { reviewEvents: _events, reviewLog: _log, reviewSelections: _selections, ...older } = source;
  const { timeZone: _timeZone, ...olderPreferences } = older.preferences;
  const target = createStore(memoryStorage());
  assert.doesNotThrow(() => target.restoreBackup({ ...older, preferences: olderPreferences }));
  assert.equal(target.getState().preferences.timeZone, "Asia/Shanghai");
});

test("sync audit events are normalized, persisted and clearable", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.addSyncAuditEvent({ type: "object_merge", status: "warning", title: "对象合并", detail: "本机保留 1 个对象", at: "2026-08-07T08:00:00.000Z", metrics: { conflicts: 1, nested: {} } });
  store.addSyncAuditEvent({ type: "bad", status: "bad", title: "  兜底事件  ", at: "2026-08-08T08:00:00.000Z" });
  assert.equal(store.getSyncAuditSummary().total, 2);
  assert.equal(store.getSyncAuditSummary().warnings, 1);
  assert.equal(store.getSyncAudit()[0].type, "network");
  assert.deepEqual(store.getSyncAudit()[1].metrics, { conflicts: 1 });
  assert.ok(storage.dump()[SYNC_AUDIT_STORAGE_KEY].includes("对象合并"));
  const next = createStore(storage);
  assert.equal(next.getSyncAudit().length, 2);
  assert.equal(next.clearSyncAudit(), 2);
  assert.equal(next.getSyncAuditSummary().total, 0);
});

test("sync audit normalizer limits and sorts records", () => {
  const events = normalizeSyncAuditEvents([
    { type: "object_push", status: "success", title: "较旧", at: "2026-08-06T00:00:00.000Z" },
    { type: "cloud_pull", status: "success", title: "较新", at: "2026-08-08T00:00:00.000Z" },
    { type: "object_pull", status: "error", title: "无效时间", at: "bad" },
  ], 1);
  assert.deepEqual(events.map((event) => event.title), ["较新"]);
});

test("recovery points are verified, persisted and limited", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const point = store.createRecoveryPoint({ label: "手动保护", reason: "manual", createdAt: "2026-08-07T00:00:00.000Z" });
  assert.equal(store.verifyRecoveryPoint(point.id).ok, true);
  assert.equal(store.getRecoveryPointSummary().total, 1);
  assert.ok(storage.dump()[RECOVERY_POINTS_STORAGE_KEY].includes("手动保护"));
  const next = createStore(storage);
  assert.equal(next.getRecoveryPoints().length, 1);
  assert.equal(next.getRecoveryPointSummary().verified, 1);

  for (let index = 0; index < 6; index += 1) next.createRecoveryPoint({ label: `保护 ${index}`, reason: "manual", createdAt: `2026-08-0${index + 1}T00:00:00.000Z` });
  assert.equal(next.getRecoveryPoints().length, 5);
});

test("recovery point normalizer rejects tampered snapshots", () => {
  const store = createStore(memoryStorage());
  const point = store.createRecoveryPoint({ label: "安全快照", createdAt: "2026-08-07T00:00:00.000Z" });
  const tampered = { ...point, snapshot: { ...point.snapshot, bookmarks: [] } };
  assert.deepEqual(normalizeRecoveryPoints([tampered]), []);
});

test("restore and reset create protective recovery points", () => {
  const store = createStore(memoryStorage());
  const before = store.createRecoveryPoint({ label: "原始", createdAt: "2026-08-07T00:00:00.000Z" });
  store.addBookmark({ title: "临时收藏" });
  const result = store.restoreRecoveryPoint(before.id);
  assert.equal(result.bookmarks, before.bookmarkCount);
  assert.ok(store.getRecoveryPoints().some((point) => point.reason === "before_recovery_point_restore"));
  store.reset();
  assert.ok(store.getRecoveryPoints().some((point) => point.reason === "before_reset"));
});

test("restoreBackup automatically protects current state", () => {
  const source = createStore(memoryStorage());
  const backup = source.getState();
  const target = createStore(memoryStorage());
  target.addBookmark({ title: "会被恢复替换" });
  target.restoreBackup(backup);
  assert.ok(target.getRecoveryPoints().some((point) => point.reason === "before_restore"));
});

test("review deletion keeps a bookmark tombstone for object sync", () => {
  const store = createStore(memoryStorage());
  const id = store.getState().bookmarks[0].id;
  store.handleReview(id, "deleted", { deleteAfter: true });
  assert.equal(store.getState().bookmarks.some((bookmark) => bookmark.id === id), false);
  assert.ok(store.getState().reviewEvents.some((event) => event.itemId === id && event.eventType === "deleted"));
  assert.deepEqual(store.getState().syncTombstones.map((entry) => `${entry.entityType}:${entry.entityId}`), [`bookmark:${id}`]);
});

test("clearing sync tombstones removes only acknowledged deletions", () => {
  const store = createStore(memoryStorage());
  const bookmark = store.addBookmark({ title: "待删除" });
  const project = store.addProject({ name: "待删项目" });
  store.deleteBookmark(bookmark.id);
  store.deleteProject(project.id);
  const removed = store.clearSyncTombstones([`bookmark:${bookmark.id}`]);
  assert.equal(removed, 1);
  assert.deepEqual(store.getState().syncTombstones.map((entry) => `${entry.entityType}:${entry.entityId}`), [`project:${project.id}`]);
});

test("starting validation stores a new experiment boundary", () => {
  const store = createStore(memoryStorage());
  store.startValidation("2026-08-07T00:00:00.000Z");
  assert.equal(store.getState().preferences.validationStartedAt, "2026-08-07T00:00:00.000Z");
});

test("data cleaning actions create a recovery point and only apply safe fixes", () => {
  const importedState = {
    version: 1,
    projects: [{ id: "p1", name: "项目", description: "", color: "#6c5ce7", status: "active", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }],
    preferences: { reviewSize: 5, snoozeDays: 3, language: "zh-CN", timeZone: "Asia/Shanghai", theme: "light", validationStartedAt: null },
    reviewLog: {},
    reviewSelections: {},
    reviewEvents: [],
    syncTombstones: [],
    bookmarks: [
      { id: "keep", title: "完整链接", url: "https://example.com/a", canonicalUrl: "https://example.com/a", inputType: "url", contentType: "article", rawText: "", summary: "这是一段足够长的摘要内容", notes: "", source: "example.com", whySaved: "", whyValuable: "", nextAction: "", importance: "medium", processingStatus: "ready", processingError: "", tags: [], status: "inbox", projectIds: ["p1"], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", lastViewedAt: null, viewCount: 4, lastRecommendedAt: null, recommendationCount: 0, skipCount: 0, usedAt: null, nextReviewAt: null, useOutcome: "", archivedAt: null },
      { id: "dup", title: "example.com", url: "https://example.com/a", canonicalUrl: "https://example.com/a", inputType: "url", contentType: "article", rawText: "", summary: "", notes: "", source: "example.com", whySaved: "", whyValuable: "", nextAction: "", importance: "medium", processingStatus: "ready", processingError: "", tags: [], status: "inbox", projectIds: [], createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z", lastViewedAt: null, viewCount: 0, lastRecommendedAt: null, recommendationCount: 0, skipCount: 0, usedAt: null, nextReviewAt: null, useOutcome: "", archivedAt: null },
      { id: "orphan", title: "孤立", url: "", canonicalUrl: "", inputType: "text", contentType: "note", rawText: "", summary: "", notes: "", source: "手动收藏", whySaved: "", whyValuable: "", nextAction: "", importance: "medium", processingStatus: "ready", processingError: "", tags: [], status: "inbox", projectIds: ["missing"], createdAt: "2026-07-03T00:00:00.000Z", updatedAt: "2026-07-03T00:00:00.000Z", lastViewedAt: null, viewCount: 0, lastRecommendedAt: null, recommendationCount: 0, skipCount: 0, usedAt: null, nextReviewAt: null, useOutcome: "", archivedAt: null },
      { id: "xhs", title: "小红书", url: "https://xhslink.com/a", canonicalUrl: "https://xhslink.com/a", inputType: "url", contentType: "social", rawText: "", summary: "", notes: "", source: "小红书", whySaved: "", whyValuable: "", nextAction: "", importance: "medium", processingStatus: "ready", processingError: "", tags: [], status: "inbox", projectIds: [], createdAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z", lastViewedAt: null, viewCount: 0, lastRecommendedAt: null, recommendationCount: 0, skipCount: 0, usedAt: null, nextReviewAt: null, useOutcome: "", archivedAt: null },
    ],
  };
  const store = createStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(importedState) }));
  assert.equal(store.getDataCleaningReport().metrics.safeActionCount >= 3, true);
  const result = store.applyDataCleaningActions();
  const state = store.getState();
  assert.equal(result.applied >= 3, true);
  assert.equal(state.bookmarks.find((item) => item.id === "dup").status, "archived");
  assert.deepEqual(state.bookmarks.find((item) => item.id === "orphan").projectIds, []);
  assert.equal(state.bookmarks.find((item) => item.id === "xhs").tags.includes("需补充"), true);
  assert.ok(store.getRecoveryPoints().some((point) => point.reason === "before_cleaning"));
});

test("priority queue promotion creates a recovery point and pins today review", () => {
  const importedState = {
    version: 1,
    projects: [{ id: "p1", name: "项目", description: "", color: "#6c5ce7", status: "active", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }],
    preferences: { reviewSize: 5, snoozeDays: 3, language: "zh-CN", timeZone: "Asia/Shanghai", theme: "light", validationStartedAt: null },
    reviewLog: {},
    reviewSelections: {},
    reviewEvents: [],
    syncTombstones: [],
    bookmarks: [
      { id: "action", title: "立刻推进", url: "", canonicalUrl: "", inputType: "text", contentType: "note", rawText: "", summary: "这是一段足够长的摘要内容", notes: "", source: "手动收藏", whySaved: "", whyValuable: "", nextAction: "写进本周方案", importance: "high", processingStatus: "ready", processingError: "", tags: [], status: "inbox", projectIds: ["p1"], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", lastViewedAt: null, viewCount: 0, lastRecommendedAt: null, recommendationCount: 0, skipCount: 0, usedAt: null, nextReviewAt: null, useOutcome: "", archivedAt: null },
      { id: "plain", title: "普通", url: "", canonicalUrl: "", inputType: "text", contentType: "note", rawText: "", summary: "", notes: "", source: "手动收藏", whySaved: "", whyValuable: "", nextAction: "", importance: "medium", processingStatus: "ready", processingError: "", tags: [], status: "inbox", projectIds: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", lastViewedAt: null, viewCount: 0, lastRecommendedAt: null, recommendationCount: 0, skipCount: 0, usedAt: null, nextReviewAt: null, useOutcome: "", archivedAt: null },
    ],
  };
  const store = createStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(importedState) }));
  const result = store.promotePriorityQueue(["action"]);
  const today = Object.keys(store.getState().reviewSelections)[0];
  assert.equal(result.promoted, 1);
  assert.equal(store.getState().reviewSelections[today][0].id, "action");
  assert.equal(store.getState().bookmarks.find((item) => item.id === "action").status, "to_action");
  assert.ok(store.getRecoveryPoints().some((point) => point.reason === "before_priority_push"));
});
