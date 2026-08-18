import test from "node:test";
import assert from "node:assert/strict";
import { getSyncHealthReport } from "../src/domain.js";

const now = "2026-08-10T08:00:00.000Z";

function baseState(overrides = {}) {
  return {
    syncTombstones: [],
    ...overrides,
  };
}

test("sync health reports a stable signed-in state as healthy", () => {
  const report = getSyncHealthReport({
    state: baseState(),
    localSummary: { totalCount: 12 },
    remoteSummary: { totalCount: 12 },
    auditEvents: [],
    networkOnline: true,
    signedIn: true,
    pwaReady: true,
    now,
  });

  assert.equal(report.score, 100);
  assert.equal(report.tone, "good");
  assert.equal(report.primaryAction, "保持当前节奏");
  assert.deepEqual(report.issues, []);
});

test("sync health penalizes conflicts, dirty state, tombstones and recent failures", () => {
  const report = getSyncHealthReport({
    state: baseState({ syncTombstones: [{ entityType: "bookmark", entityId: "a", deletedAt: now }] }),
    localSummary: { totalCount: 10 },
    remoteSummary: { totalCount: 30 },
    auditEvents: [
      { status: "error", at: "2026-08-10T07:00:00.000Z" },
      { status: "warning", at: "2026-08-10T06:00:00.000Z" },
      { status: "warning", at: "2026-08-10T05:00:00.000Z" },
      { status: "warning", at: "2026-08-10T04:00:00.000Z" },
    ],
    networkOnline: true,
    signedIn: true,
    cloudDirty: true,
    cloudConflict: { remote: {} },
    itemMergeStats: { conflicts: 2, localWins: 1 },
    pwaReady: false,
    now,
  });

  assert.equal(report.tone, "danger");
  assert.ok(report.score < 40);
  assert.equal(report.primaryAction, "先对象级合并");
  assert.ok(report.issues.some((issue) => issue.title === "发现整库版本冲突"));
  assert.equal(report.metrics.tombstoneCount, 1);
  assert.equal(report.metrics.recentErrors, 1);
  assert.equal(report.metrics.recentWarnings, 3);
});

test("sync health ignores old audit failures outside 24 hours", () => {
  const report = getSyncHealthReport({
    state: baseState(),
    localSummary: { totalCount: 5 },
    remoteSummary: { totalCount: 5 },
    auditEvents: [{ status: "error", at: "2026-08-08T07:00:00.000Z" }],
    networkOnline: true,
    signedIn: true,
    pwaReady: true,
    now,
  });

  assert.equal(report.metrics.recentErrors, 0);
  assert.equal(report.score, 100);
});
