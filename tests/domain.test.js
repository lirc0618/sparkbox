import test from "node:test";
import assert from "node:assert/strict";
import {
  createBookmark,
  canonicalizeUrl,
  filterBookmarks,
  getDailyReview,
  getDashboardStats,
  getCollectionInsights,
  getDataCleaningReport,
  getActionPriorityReport,
  getDateKey,
  getReviewCompletionState,
  getValidationMetrics,
  getWeeklyActivationMetrics,
  applySyncItemsToState,
  getSyncHealthReport,
  parseBatchInput,
  parseCaptureInput,
  matchesSearch,
  updateBookmark,
} from "../src/domain.js";

const now = "2026-08-07T08:00:00.000Z";

test("createBookmark normalizes tags and initializes behavior fields", () => {
  const bookmark = createBookmark({ title: "  一条收藏  ", tags: "AI, 产品，AI", projectIds: ["p1", "p1"] }, now);
  assert.equal(bookmark.title, "一条收藏");
  assert.deepEqual(bookmark.tags, ["AI", "产品"]);
  assert.deepEqual(bookmark.projectIds, ["p1"]);
  assert.equal(bookmark.viewCount, 0);
  assert.equal(bookmark.status, "inbox");
});

test("activation rate only counts used bookmarks that were actually reviewed", () => {
  const bookmarks = [
    createBookmark({ id: "used-directly", title: "直接使用", status: "used" }, now),
    createBookmark({ id: "reviewed", title: "已回顾", recommendationCount: 1 }, now),
  ];
  assert.equal(getDashboardStats(bookmarks).activated, 0);
});

test("date keys follow the configured calendar timezone", () => {
  const instant = new Date("2026-08-06T17:30:00.000Z");
  assert.equal(getDateKey(instant, "Asia/Shanghai"), "2026-08-07");
  assert.equal(getDateKey(instant, "UTC"), "2026-08-06");
});

test("batch input converts links and text into importable bookmarks", () => {
  const items = parseBatchInput("https://example.com/a\n一个产品想法\nhttps://example.com/a\n\n");
  assert.equal(items.length, 2);
  assert.equal(items[0].url, "https://example.com/a");
  assert.equal(items[0].source, "example.com");
  assert.equal(items[1].rawText, "一个产品想法");
  assert.equal(items[1].contentType, "note");
});

test("batch input keeps inline context for restricted platform links", () => {
  const [item] = parseBatchInput("小红书选题案例 https://xhslink.com/abc 这段讲了开头钩子");
  assert.equal(item.url, "https://xhslink.com/abc");
  assert.equal(item.title, "小红书选题案例 这段讲了开头钩子");
  assert.equal(item.rawText, "小红书选题案例 这段讲了开头钩子");
  assert.equal(item.processingError, "");
  assert.deepEqual(item.tags, ["小红书", "需补充"]);
});

test("quick capture parses mixed mobile text with a link", () => {
  const item = parseCaptureInput("微信文章标题 https://mp.weixin.qq.com/s/abc 这里是能看到的一段摘录");
  assert.equal(item.url, "https://mp.weixin.qq.com/s/abc");
  assert.equal(item.source, "微信/公众号");
  assert.equal(item.title, "微信文章标题 这里是能看到的一段摘录");
  assert.equal(item.rawText, "微信文章标题 这里是能看到的一段摘录");
  assert.equal(item.processingError, "");
});

test("weekly activation metrics summarize real review outcomes", () => {
  const current = "2026-08-07T08:00:00.000Z";
  const bookmarks = [
    createBookmark({ id: "old", title: "旧收藏", createdAt: "2026-07-20T00:00:00Z" }, now),
    createBookmark({ id: "new", title: "新收藏", createdAt: "2026-08-06T00:00:00Z" }, now),
    createBookmark({ id: "demo", title: "示例", isDemo: true, createdAt: "2026-08-06T00:00:00Z" }, now),
  ];
  const metrics = getWeeklyActivationMetrics({
    bookmarks,
    reviewEvents: [
      { itemId: "old", eventType: "view", occurredAt: "2026-08-05T01:00:00Z", outcomeNote: "" },
      { itemId: "old", eventType: "use", occurredAt: "2026-08-06T01:00:00Z", outcomeNote: "用于本周项目" },
      { itemId: "demo", eventType: "use", occurredAt: "2026-08-06T01:00:00Z", outcomeNote: "示例不计入" },
    ],
    now: current,
    timeZone: "Asia/Shanghai",
  });
  assert.equal(metrics.savedCount, 1);
  assert.equal(metrics.handledCount, 1);
  assert.equal(metrics.activatedCount, 1);
  assert.equal(metrics.oldActivatedCount, 1);
  assert.equal(metrics.outcomeCount, 1);
  assert.equal(metrics.recentOutcomes[0].note, "用于本周项目");
  assert.deepEqual(metrics.revivedTitles, ["旧收藏"]);
});

test("review completion state guides the next action", () => {
  const active = getReviewCompletionState({ done: 1, total: 3 });
  assert.equal(active.complete, false);
  assert.equal(active.title, "还剩 2 张卡片");
  const done = getReviewCompletionState({ done: 3, total: 3, activatedCount: 1, outcomeCount: 1 });
  assert.equal(done.complete, true);
  assert.equal(done.tone, "activated");
  assert.match(done.suggestion, /本周反馈/);
});

test("collection insights expose source, context and dormancy signals", () => {
  const bookmarks = [
    createBookmark({ id: "xhs", title: "小红书案例", url: "https://xhslink.com/a", source: "小红书", createdAt: "2026-07-01T00:00:00Z" }, now),
    createBookmark({ id: "project", title: "项目文章", source: "博客", projectIds: ["p1"], createdAt: "2026-08-01T00:00:00Z" }, now),
    createBookmark({ id: "demo", title: "示例", source: "示例", isDemo: true, createdAt: "2026-08-01T00:00:00Z" }, now),
  ];
  const insights = getCollectionInsights({
    bookmarks,
    reviewEvents: [{ itemId: "project", eventType: "view", occurredAt: "2026-08-06T01:00:00Z" }],
    now,
    timeZone: "Asia/Shanghai",
  });
  assert.equal(insights.restrictedNeedContextCount, 1);
  assert.equal(insights.projectCoverage, 33);
  assert.equal(insights.dormantCount, 1);
  assert.deepEqual(insights.sourceBreakdown.map((item) => item.source), ["小红书", "博客"]);
});

test("validation metrics count real saves, active days and activated old items", () => {
  const bookmarks = [
    createBookmark({ id: "demo", title: "示例", isDemo: true, createdAt: "2026-08-01T00:00:00Z" }, now),
    createBookmark({ id: "real", title: "真实", createdAt: "2026-07-20T00:00:00Z", status: "used", usedAt: "2026-08-05T00:00:00Z" }, now),
    createBookmark({ id: "new", title: "新收藏", createdAt: "2026-08-03T00:00:00Z" }, now),
  ];
  const reviewEvents = [
    { itemId: "real", eventType: "view", occurredAt: "2026-08-03T01:00:00Z" },
    { itemId: "real", eventType: "use", occurredAt: "2026-08-05T01:00:00Z" },
    { itemId: "demo", eventType: "view", occurredAt: "2026-08-04T01:00:00Z" },
  ];
  const metrics = getValidationMetrics({ bookmarks, reviewEvents, startedAt: "2026-08-01T00:00:00Z", now, timeZone: "Asia/Shanghai" });
  assert.equal(metrics.day, 7);
  assert.equal(metrics.savedCount, 2);
  assert.equal(metrics.activeDays, 2);
  assert.equal(metrics.reviewedCount, 1);
  assert.equal(metrics.activatedCount, 1);
  assert.equal(metrics.oldActivatedCount, 1);
});

test("validation activation remains after a used bookmark is archived", () => {
  const bookmark = createBookmark({ id: "real", title: "真实旧收藏", createdAt: "2026-07-01T00:00:00Z", status: "archived" }, now);
  const metrics = getValidationMetrics({
    bookmarks: [bookmark],
    reviewEvents: [{ itemId: "real", eventType: "use", occurredAt: "2026-08-05T01:00:00Z" }],
    startedAt: "2026-08-01T00:00:00Z",
    now,
  });
  assert.equal(metrics.activatedCount, 1);
  assert.equal(metrics.oldActivatedCount, 1);
});

test("validation history remains after a real bookmark is deleted", () => {
  const metrics = getValidationMetrics({
    bookmarks: [],
    reviewEvents: [
      { itemId: "deleted-real", eventType: "use", occurredAt: "2026-08-05T01:00:00Z", isDemo: false, itemCreatedAt: "2026-07-01T00:00:00Z" },
      { itemId: "deleted-real", eventType: "deleted", occurredAt: "2026-08-06T01:00:00Z", isDemo: false, itemCreatedAt: "2026-07-01T00:00:00Z" },
    ],
    startedAt: "2026-08-01T00:00:00Z",
    now,
  });
  assert.equal(metrics.activatedCount, 1);
  assert.equal(metrics.oldActivatedCount, 1);
  assert.equal(metrics.activeDays, 2);
});

test("validation treats the standard used event name as activation", () => {
  const bookmark = createBookmark({ id: "standard-used", title: "标准事件", createdAt: "2026-07-01T00:00:00Z" }, now);
  const metrics = getValidationMetrics({
    bookmarks: [bookmark],
    reviewEvents: [{ itemId: bookmark.id, eventType: "used", occurredAt: "2026-08-05T01:00:00Z" }],
    startedAt: "2026-08-01T00:00:00Z",
    now,
  });
  assert.equal(metrics.activatedCount, 1);
});

test("canonicalizeUrl removes tracking parameters and normalizes the host", () => {
  assert.equal(
    canonicalizeUrl("https://WWW.Example.com/article/?utm_source=feed&b=2&a=1#section"),
    "https://example.com/article?a=1&b=2",
  );
});

test("createBookmark rejects a blank title", () => {
  assert.throws(() => createBookmark({ title: "  " }), /标题不能为空/);
});

test("updateBookmark records used and archived timestamps", () => {
  const bookmark = createBookmark({ title: "测试" }, now);
  const used = updateBookmark(bookmark, { status: "used" }, "2026-08-08T08:00:00.000Z");
  assert.equal(used.usedAt, "2026-08-08T08:00:00.000Z");
  const archived = updateBookmark(used, { status: "archived" }, "2026-08-09T08:00:00.000Z");
  assert.equal(archived.usedAt, null);
  assert.equal(archived.archivedAt, "2026-08-09T08:00:00.000Z");
});

test("search matches title, tags and summary with multiple words", () => {
  const bookmark = createBookmark({ title: "AI 产品设计", tags: ["界面"], summary: "行动反馈回路" }, now);
  assert.equal(matchesSearch(bookmark, "AI 反馈"), true);
  assert.equal(matchesSearch(bookmark, "知识管理"), false);
});

test("filterBookmarks combines state, project and query", () => {
  const bookmarks = [
    createBookmark({ id: "a", title: "AI 文章", status: "to_read", projectIds: ["p1"] }, now),
    createBookmark({ id: "b", title: "设计文章", status: "to_read", projectIds: ["p2"] }, now),
    createBookmark({ id: "c", title: "AI 归档", status: "archived", projectIds: ["p1"] }, now),
  ];
  const result = filterBookmarks(bookmarks, { query: "AI", status: "to_read", projectId: "p1" });
  assert.deepEqual(result.map((item) => item.id), ["a"]);
});

test("daily review covers rule categories without duplicate bookmarks", () => {
  const projects = [{ id: "p1", status: "active" }];
  const bookmarks = [
    createBookmark({ id: "project", title: "项目资料", status: "to_action", projectIds: ["p1"], createdAt: "2026-07-01T00:00:00Z" }, now),
    createBookmark({ id: "old", title: "旧收藏", status: "inbox", createdAt: "2026-07-01T00:00:00Z" }, now),
    createBookmark({ id: "read", title: "待读", status: "to_read", createdAt: "2026-08-01T00:00:00Z" }, now),
    createBookmark({ id: "ref", title: "参考", status: "reference", createdAt: "2026-07-01T00:00:00Z" }, now),
    createBookmark({ id: "new", title: "最新", status: "inbox", createdAt: "2026-08-05T00:00:00Z" }, now),
    createBookmark({ id: "used", title: "已使用", status: "used", createdAt: "2026-07-01T00:00:00Z" }, now),
  ];
  const review = getDailyReview(bookmarks, projects, { today: now, limit: 5 });
  assert.equal(review.length, 5);
  assert.equal(new Set(review.map(({ bookmark }) => bookmark.id)).size, 5);
  assert.equal(review.some(({ bookmark }) => bookmark.id === "used"), false);
  assert.equal(review[0].reason, "推进当前项目");
});

test("daily review is deterministic for the same date", () => {
  const bookmarks = Array.from({ length: 8 }, (_, index) => createBookmark({ id: `b${index}`, title: `收藏 ${index}`, status: "inbox" }, now));
  const first = getDailyReview(bookmarks, [], { today: now, limit: 3 });
  const second = getDailyReview(bookmarks, [], { today: now, limit: 3 });
  assert.deepEqual(first.map(({ bookmark }) => bookmark.id), second.map(({ bookmark }) => bookmark.id));
});

test("daily review excludes snoozed items until their reminder date", () => {
  const bookmarks = [
    createBookmark({ id: "later", title: "稍后", nextReviewAt: "2026-08-10T00:00:00Z" }, now),
    createBookmark({ id: "ready", title: "现在" }, now),
  ];
  const review = getDailyReview(bookmarks, [], { today: now, limit: 5 });
  assert.deepEqual(review.map(({ bookmark }) => bookmark.id), ["ready"]);
});

test("data cleaning report identifies duplicates, orphan projects and context gaps", () => {
  const projects = [{ id: "p1", name: "项目", status: "active", createdAt: now, updatedAt: now }];
  const rich = createBookmark({ id: "rich", title: "完整链接", url: "https://example.com/a", summary: "这是一段足够长的摘要内容", viewCount: 3, projectIds: ["p1"], createdAt: "2026-07-01T00:00:00Z" }, now);
  const duplicate = createBookmark({ id: "dup", title: "example.com", url: "https://www.example.com/a?utm_source=x", createdAt: "2026-07-02T00:00:00Z" }, now);
  const orphan = createBookmark({ id: "orphan", title: "孤立项目", projectIds: ["missing"], createdAt: "2026-07-03T00:00:00Z" }, now);
  const restricted = createBookmark({ id: "xhs", title: "小红书", url: "https://xhslink.com/abc", createdAt: "2026-07-04T00:00:00Z" }, now);
  const report = getDataCleaningReport({ bookmarks: [rich, duplicate, orphan, restricted], projects }, { now: "2026-08-25T00:00:00.000Z" });
  assert.equal(report.metrics.duplicateGroups, 1);
  assert.equal(report.metrics.orphanProjectRefs, 1);
  assert.equal(report.metrics.missingContext, 1);
  assert.equal(report.actions.some((action) => action.type === "archive_duplicate" && action.itemIds.includes("dup") && action.keepId === "rich"), true);
  assert.deepEqual(report.issues.map((issue) => issue.type).slice(0, 2), ["orphan_projects", "duplicates"]);
});

test("action priority report ranks actionable and context-risk bookmarks", () => {
  const projects = [{ id: "p1", name: "项目", status: "active", createdAt: now, updatedAt: now }];
  const action = createBookmark({ id: "action", title: "立刻推进", status: "to_action", importance: "high", nextAction: "写进本周方案", projectIds: ["p1"], summary: "这是一条有清晰用途的收藏", createdAt: "2026-07-01T00:00:00Z" }, now);
  const restricted = createBookmark({ id: "xhs", title: "小红书选题", url: "https://xhslink.com/abc", status: "inbox", createdAt: "2026-07-02T00:00:00Z" }, now);
  const snoozed = createBookmark({ id: "later", title: "以后再说", status: "to_action", nextReviewAt: "2026-09-01T00:00:00Z", createdAt: "2026-07-02T00:00:00Z" }, now);
  const report = getActionPriorityReport({ bookmarks: [restricted, snoozed, action], projects }, { now: "2026-08-25T00:00:00.000Z" });
  assert.equal(report.items[0].id, "action");
  assert.equal(report.items.some((item) => item.id === "xhs" && item.lane === "补上下文"), true);
  assert.equal(report.items.some((item) => item.id === "later"), false);
  assert.deepEqual(report.recommendedIds.slice(0, 2), ["action", "xhs"]);
});
