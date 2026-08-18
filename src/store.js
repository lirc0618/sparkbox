import { canonicalizeUrl, createBookmark, getActionPriorityReport, getDailyReview, getDateKey, getDataCleaningReport, linkSupplementMessage, normalizeTags, updateBookmark, uid } from "./domain.js";

export const STORAGE_KEY = "sparkbox.personal.v1";
export const RECOVERY_STORAGE_KEY = "sparkbox.personal.corrupt-backup";
export const SYNC_AUDIT_STORAGE_KEY = "sparkbox.personal.sync-audit.v1";
export const RECOVERY_POINTS_STORAGE_KEY = "sparkbox.personal.recovery-points.v1";
const DEMO_BOOKMARK_IDS = new Set(["bm_activation", "bm_progressive", "bm_focus", "bm_ai_apps", "bm_weekly_review", "bm_design"]);
const REVIEW_EVENT_TYPES = new Set(["surfaced", "opened", "used", "added_to_project", "snoozed", "skipped", "dismissed", "deleted", "view", "use", "later", "skip"]);
const SYNC_AUDIT_TYPES = new Set(["cloud_upload", "cloud_pull", "object_push", "object_pull", "object_merge", "conflict", "offline", "auth", "network", "recovery"]);
const SYNC_AUDIT_STATUSES = new Set(["success", "warning", "error", "info"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function stateChecksum(value) {
  return hashText(stableStringify(value));
}

function normalizePreferences(value) {
  const input = isRecord(value) ? value : {};
  const reviewSize = Number(input.reviewSize);
  const snoozeDays = Number(input.snoozeDays);
  const validationStartedAt = input.validationStartedAt && !Number.isNaN(new Date(input.validationStartedAt).getTime())
    ? new Date(input.validationStartedAt).toISOString()
    : null;
  return {
    reviewSize: Number.isInteger(reviewSize) && reviewSize >= 1 && reviewSize <= 5 ? reviewSize : 5,
    snoozeDays: Number.isFinite(snoozeDays) && snoozeDays >= 1 ? snoozeDays : 3,
    language: typeof input.language === "string" ? input.language : "zh-CN",
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : "Asia/Shanghai",
    theme: typeof input.theme === "string" ? input.theme : "light",
    validationStartedAt,
  };
}

function normalizeTombstones(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const entityType = String(entry.entityType || "").trim();
    const entityId = String(entry.entityId || "").trim();
    if (!entityType || !entityId || !["bookmark", "project", "review_event", "review_log", "review_selection"].includes(entityType)) return [];
    const deletedAt = entry.deletedAt && !Number.isNaN(new Date(entry.deletedAt).getTime()) ? new Date(entry.deletedAt).toISOString() : new Date().toISOString();
    const key = `${entityType}:${entityId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ entityType, entityId, deletedAt }];
  });
}

export function normalizeSyncAuditEvents(value, limit = 80) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const at = entry.at && !Number.isNaN(new Date(entry.at).getTime()) ? new Date(entry.at).toISOString() : null;
    const type = SYNC_AUDIT_TYPES.has(entry.type) ? entry.type : "network";
    const status = SYNC_AUDIT_STATUSES.has(entry.status) ? entry.status : "info";
    const title = String(entry.title || "同步事件").trim().slice(0, 80);
    if (!at || !title) return [];
    return [{
      id: String(entry.id || `${type}-${at}`).slice(0, 120),
      type,
      status,
      title,
      detail: String(entry.detail || "").trim().slice(0, 240),
      at,
      metrics: isRecord(entry.metrics) ? Object.fromEntries(Object.entries(entry.metrics).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))) : {},
    }];
  }).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, Math.max(1, limit));
}

function normalizeRecoveryPoint(entry) {
  if (!isRecord(entry) || !isRecord(entry.snapshot)) return null;
  const createdAt = entry.createdAt && !Number.isNaN(new Date(entry.createdAt).getTime()) ? new Date(entry.createdAt).toISOString() : null;
  const label = String(entry.label || "恢复点").trim().slice(0, 80);
  const reason = String(entry.reason || "manual").trim().slice(0, 40) || "manual";
  const checksum = String(entry.checksum || "").trim();
  if (!createdAt || !label || !checksum || stateChecksum(entry.snapshot) !== checksum) return null;
  return {
    id: String(entry.id || `rp_${createdAt}`).slice(0, 120),
    label,
    reason,
    createdAt,
    checksum,
    bookmarkCount: Number(entry.bookmarkCount || entry.snapshot.bookmarks?.length || 0),
    projectCount: Number(entry.projectCount || entry.snapshot.projects?.length || 0),
    snapshot: entry.snapshot,
  };
}

export function normalizeRecoveryPoints(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const point = normalizeRecoveryPoint(entry);
    return point ? [point] : [];
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.max(1, limit));
}

function makeRecoveryPoint(snapshot, { label = "恢复点", reason = "manual", createdAt = new Date().toISOString() } = {}) {
  const sanitized = sanitizeState(migrateBackup(snapshot));
  return normalizeRecoveryPoint({
    id: `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label,
    reason,
    createdAt,
    checksum: stateChecksum(sanitized),
    bookmarkCount: sanitized.bookmarks.length,
    projectCount: sanitized.projects.length,
    snapshot: sanitized,
  });
}

function migrateBackup(value) {
  if (!isRecord(value)) return value;
  return {
    ...value,
    preferences: value.preferences == null ? normalizePreferences({}) : (isRecord(value.preferences) ? { ...normalizePreferences({}), ...value.preferences } : value.preferences),
    reviewLog: value.reviewLog == null ? {} : value.reviewLog,
    reviewSelections: value.reviewSelections == null ? {} : value.reviewSelections,
    reviewEvents: value.reviewEvents == null ? [] : value.reviewEvents,
    syncTombstones: normalizeTombstones(value.syncTombstones),
  };
}

function validateBackup(value) {
  if (!isRecord(value) || !Array.isArray(value.bookmarks) || !Array.isArray(value.projects) || !Array.isArray(value.reviewEvents)) return false;
  if (!isRecord(value.preferences) || !isRecord(value.reviewLog) || !isRecord(value.reviewSelections) || !Array.isArray(value.syncTombstones)) return false;
  const projectIds = new Set();
  for (const project of value.projects) {
    if (!isRecord(project) || typeof project.id !== "string" || !project.id.trim() || typeof project.name !== "string" || !project.name.trim() || projectIds.has(project.id)) return false;
    if (["description", "color", "status", "createdAt", "updatedAt"].some((field) => project[field] != null && typeof project[field] !== "string")) return false;
    projectIds.add(project.id);
  }
  const bookmarkIds = new Set();
  for (const bookmark of value.bookmarks) {
    if (!isRecord(bookmark) || typeof bookmark.id !== "string" || !bookmark.id.trim() || typeof bookmark.title !== "string" || !bookmark.title.trim() || bookmarkIds.has(bookmark.id)) return false;
    const stringFields = ["url", "canonicalUrl", "inputType", "contentType", "rawText", "summary", "notes", "source", "whySaved", "whyValuable", "nextAction", "importance", "processingStatus", "processingError", "status", "createdAt", "updatedAt", "lastViewedAt", "lastRecommendedAt", "usedAt", "nextReviewAt", "useOutcome", "archivedAt"];
    if (stringFields.some((field) => bookmark[field] != null && typeof bookmark[field] !== "string")) return false;
    if (bookmark.isDemo != null && typeof bookmark.isDemo !== "boolean") return false;
    if (["viewCount", "recommendationCount", "skipCount"].some((field) => bookmark[field] != null && (!Number.isFinite(Number(bookmark[field])) || Number(bookmark[field]) < 0))) return false;
    if (!Array.isArray(bookmark.tags) || bookmark.tags.some((tag) => typeof tag !== "string")) return false;
    if (!Array.isArray(bookmark.projectIds) || bookmark.projectIds.some((id) => typeof id !== "string" || !projectIds.has(id))) return false;
    bookmarkIds.add(bookmark.id);
  }
  const { reviewSize, snoozeDays, timeZone, validationStartedAt } = value.preferences;
  if (!Number.isInteger(Number(reviewSize)) || Number(reviewSize) < 1 || Number(reviewSize) > 5) return false;
  if (!Number.isFinite(Number(snoozeDays)) || Number(snoozeDays) < 1 || !isValidTimeZone(timeZone)) return false;
  if (validationStartedAt != null && Number.isNaN(new Date(validationStartedAt).getTime())) return false;
  const deletedIds = new Set(value.reviewEvents.filter((event) => isRecord(event) && event.eventType === "deleted").map((event) => event.itemId));
  const isKnownItem = (id) => bookmarkIds.has(id) || deletedIds.has(id);
  if (Object.values(value.reviewLog).some((entry) => !isRecord(entry) || Object.entries(entry).some(([id, action]) => !isKnownItem(id) || !REVIEW_EVENT_TYPES.has(action)))) return false;
  if (Object.values(value.reviewSelections).some((selection) => !Array.isArray(selection) || selection.some((entry) => !isRecord(entry) || !isKnownItem(entry.id)))) return false;
  if (value.reviewEvents.some((event) => !isRecord(event) || !isKnownItem(event.itemId) || !REVIEW_EVENT_TYPES.has(event.eventType) || Number.isNaN(new Date(event.occurredAt).getTime()))) return false;
  const tombstoneKeys = new Set();
  for (const tombstone of value.syncTombstones) {
    if (!isRecord(tombstone) || typeof tombstone.entityType !== "string" || typeof tombstone.entityId !== "string" || !tombstone.entityId.trim()) return false;
    if (!["bookmark", "project", "review_event", "review_log", "review_selection"].includes(tombstone.entityType)) return false;
    if (Number.isNaN(new Date(tombstone.deletedAt).getTime())) return false;
    const key = `${tombstone.entityType}:${tombstone.entityId}`;
    if (tombstoneKeys.has(key)) return false;
    tombstoneKeys.add(key);
  }
  return true;
}

function daysAgo(days, hours = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

export function makeSeedState() {
  const projectA = {
    id: "project_collection",
    name: "个人收藏系统",
    description: "把散落的收藏变成会再次出现、真正被使用的内容资产。",
    color: "#6c5ce7",
    status: "active",
    createdAt: daysAgo(18),
    updatedAt: daysAgo(1),
  };
  const projectB = {
    id: "project_growth",
    name: "个人成长",
    description: "学习、思考和生活方式的长期实验。",
    color: "#00a896",
    status: "active",
    createdAt: daysAgo(40),
    updatedAt: daysAgo(6),
  };

  const bookmarks = [
    createBookmark({
      id: "bm_activation",
      title: "如何让收藏真正产生复利",
      url: "https://example.com/collection-compound",
      summary: "收藏的价值不在数量，而在于它是否能在正确的时间重新出现，并促成一次行动。",
      source: "微信文章",
      tags: ["知识管理", "产品思考"],
      status: "to_action",
      projectIds: [projectA.id],
      createdAt: daysAgo(12),
    }, daysAgo(12)),
    createBookmark({
      id: "bm_progressive",
      title: "渐进式总结：从收藏到自己的知识",
      url: "https://example.com/progressive-summarization",
      summary: "通过多轮标记与压缩，让信息在每次使用时变得更有价值。",
      source: "博客",
      tags: ["笔记方法", "知识管理"],
      status: "to_read",
      projectIds: [projectA.id],
      createdAt: daysAgo(9),
    }, daysAgo(9)),
    createBookmark({
      id: "bm_focus",
      title: "深度工作的四个日常原则",
      summary: "减少切换、固定仪式、记录专注时长，并用休息保护下一次投入。",
      source: "小红书",
      tags: ["专注", "习惯"],
      status: "reference",
      projectIds: [projectB.id],
      createdAt: daysAgo(28),
      lastViewedAt: daysAgo(14),
      viewCount: 2,
    }, daysAgo(14)),
    createBookmark({
      id: "bm_ai_apps",
      title: "AI 原生应用的界面不该只是聊天框",
      url: "https://example.com/ai-native-ui",
      summary: "将 AI 能力放进行动、状态和反馈回路，而不仅是一个万能输入框。",
      source: "产品博客",
      tags: ["AI", "产品设计"],
      status: "inbox",
      projectIds: [],
      createdAt: daysAgo(2),
    }, daysAgo(2)),
    createBookmark({
      id: "bm_weekly_review",
      title: "一个可持续的每周复盘模板",
      summary: "复盘不是总结流水账，而是重新安排注意力。包含：成果、阻碍、放弃项、下周实验。",
      source: "Bilibili",
      tags: ["复盘", "效率"],
      status: "in_use",
      projectIds: [projectB.id],
      createdAt: daysAgo(22),
      lastViewedAt: daysAgo(3),
      viewCount: 3,
    }, daysAgo(3)),
    createBookmark({
      id: "bm_design",
      title: "用状态而不是文件夹管理信息",
      summary: "分类回答“它是什么”，状态回答“接下来做什么”。两者应该分开。",
      source: "播客笔记",
      tags: ["信息架构", "工作流"],
      status: "used",
      projectIds: [projectA.id],
      createdAt: daysAgo(35),
      usedAt: daysAgo(5),
      useOutcome: "采用了七阶段状态模型，并用在本项目 MVP 中。",
      recommendationCount: 1,
    }, daysAgo(5)),
  ].map((bookmark) => ({ ...bookmark, isDemo: true }));

  return {
    version: 1,
    bookmarks,
    projects: [projectA, projectB],
    preferences: { reviewSize: 5, snoozeDays: 3, language: "zh-CN", timeZone: "Asia/Shanghai", theme: "light", validationStartedAt: null },
    reviewLog: {},
    reviewSelections: {},
    reviewEvents: [],
    syncTombstones: [],
  };
}

function sanitizeState(value) {
  if (!value || !Array.isArray(value.bookmarks) || !Array.isArray(value.projects)) return makeSeedState();
  return {
    version: 1,
    bookmarks: value.bookmarks.flatMap((bookmark) => {
      try {
        const restored = createBookmark(bookmark, bookmark.updatedAt);
        return [{ ...restored, isDemo: Boolean(bookmark.isDemo || DEMO_BOOKMARK_IDS.has(bookmark.id)) }];
      }
      catch {
        return [createBookmark({
          id: bookmark?.id || uid("bm"),
          title: String(bookmark?.title || "无法读取的收藏"),
          notes: "原记录格式异常，已隔离归档。请从 JSON 备份核对并手动恢复。",
          status: "archived",
          source: "数据恢复",
          tags: [],
          projectIds: [],
          processingStatus: "failed",
          processingError: "持久化记录格式损坏",
          createdAt: bookmark?.createdAt,
        })];
      }
    }),
    projects: value.projects,
    preferences: normalizePreferences(value.preferences),
    reviewLog: isRecord(value.reviewLog) ? value.reviewLog : {},
    reviewSelections: isRecord(value.reviewSelections) ? value.reviewSelections : {},
    reviewEvents: Array.isArray(value.reviewEvents) ? value.reviewEvents : [],
    syncTombstones: normalizeTombstones(value.syncTombstones),
  };
}

export function createStore(storage = globalThis.localStorage) {
  let state;
  let loadError = null;
  let storageError = null;
  let recoveryRaw = null;
  let syncAudit = [];
  let recoveryPoints = [];
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY);
    try { syncAudit = normalizeSyncAuditEvents(JSON.parse(storage?.getItem(SYNC_AUDIT_STORAGE_KEY) || "[]")); } catch { syncAudit = []; }
    try { recoveryPoints = normalizeRecoveryPoints(JSON.parse(storage?.getItem(RECOVERY_POINTS_STORAGE_KEY) || "[]")); } catch { recoveryPoints = []; }
    state = raw ? sanitizeState(JSON.parse(raw)) : makeSeedState();
  } catch (error) {
    loadError = error;
    recoveryRaw = typeof raw === "string" ? raw : null;
    try {
      if (recoveryRaw) storage?.setItem(RECOVERY_STORAGE_KEY, recoveryRaw);
    } catch {
      // The in-memory copy remains exportable even if the recovery key cannot be written.
    }
    state = makeSeedState();
  }

  const listeners = new Set();
  const tombstoneKey = (entry) => `${entry.entityType}:${entry.entityId}`;
  const tombstone = (entityType, entityId, deletedAt = new Date().toISOString()) => ({ entityType, entityId, deletedAt });
  const withTombstones = (current, additions = []) => {
    const merged = new Map((current.syncTombstones || []).map((entry) => [tombstoneKey(entry), entry]));
    for (const entry of additions) merged.set(tombstoneKey(entry), entry);
    return { ...current, syncTombstones: [...merged.values()] };
  };
  const commit = (nextState, { silent = false } = {}) => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(nextState));
      storageError = null;
      loadError = null;
    } catch (error) {
      storageError = error;
      if (!silent) throw new Error("浏览器存储不可用，本次修改没有保存。请先导出或清理站点空间后重试。");
      return false;
    }
    state = nextState;
    listeners.forEach((listener) => listener(state));
    return true;
  };
  const persistSyncAudit = () => {
    try { storage?.setItem(SYNC_AUDIT_STORAGE_KEY, JSON.stringify(syncAudit)); } catch { /* sync audit is diagnostic only */ }
  };
  const persistRecoveryPoints = () => {
    try { storage?.setItem(RECOVERY_POINTS_STORAGE_KEY, JSON.stringify(recoveryPoints)); } catch { /* recovery points are best-effort */ }
  };
  const commitAudit = (entry = {}) => {
    const at = entry.at && !Number.isNaN(new Date(entry.at).getTime()) ? new Date(entry.at).toISOString() : new Date().toISOString();
    const event = normalizeSyncAuditEvents([{ ...entry, at, id: entry.id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }], 1)[0];
    if (!event) return null;
    syncAudit = normalizeSyncAuditEvents([event, ...syncAudit], 80);
    persistSyncAudit();
    return event;
  };
  const createRecoveryPoint = (options = {}) => {
    const point = makeRecoveryPoint(state, options);
    if (!point) throw new Error("恢复点创建失败：当前数据未通过校验");
    recoveryPoints = normalizeRecoveryPoints([point, ...recoveryPoints], 5);
    persistRecoveryPoints();
    return point;
  };
  const verifyRecoveryPoint = (id) => {
    const point = recoveryPoints.find((item) => item.id === id);
    if (!point) return { ok: false, error: "找不到这个恢复点" };
    const normalized = normalizeRecoveryPoint(point);
    if (!normalized) return { ok: false, error: "恢复点校验失败，快照可能损坏" };
    const migrated = migrateBackup(normalized.snapshot);
    return validateBackup(migrated)
      ? { ok: true, point: normalized, checksum: normalized.checksum }
      : { ok: false, error: "恢复点内容格式不完整" };
  };

  const applyReview = (id, action, metadata = {}) => {
    const now = new Date().toISOString();
    const today = getDateKey(new Date(), state.preferences.timeZone || "Asia/Shanghai");
    const bookmark = state.bookmarks.find((item) => item.id === id);
    if (!bookmark) return null;
    const changes = {
      lastRecommendedAt: now,
      recommendationCount: bookmark.recommendationCount + 1,
    };
    if (action === "skip") changes.skipCount = bookmark.skipCount + 1;
    else if (["view", "use", "later", "added_to_project"].includes(action)) changes.skipCount = 0;
    if (action === "view") {
      changes.lastViewedAt = now;
      changes.viewCount = bookmark.viewCount + 1;
    }
    const updated = updateBookmark(bookmark, { ...changes, ...(metadata.bookmarkChanges || {}) }, now);
    const reviewEvent = {
      id: uid("review"),
      itemId: id,
      eventType: action,
      reason: String(metadata.reason || ""),
      outcomeNote: String(metadata.outcomeNote || ""),
      occurredAt: now,
      isDemo: bookmark.isDemo,
      itemCreatedAt: bookmark.createdAt,
    };
    const nextState = {
      ...state,
      bookmarks: metadata.deleteAfter
        ? state.bookmarks.filter((item) => item.id !== id)
        : state.bookmarks.map((item) => item.id === id ? updated : item),
      reviewLog: {
        ...state.reviewLog,
        [today]: { ...(state.reviewLog[today] || {}), [id]: action },
      },
      reviewEvents: [...state.reviewEvents, reviewEvent],
    };
    commit(metadata.deleteAfter ? withTombstones(nextState, [tombstone("bookmark", id, now)]) : nextState);
    return updated;
  };

  const applyDataCleaningActions = (actionIds = []) => {
    const report = getDataCleaningReport(state);
    const selected = new Set(Array.isArray(actionIds) && actionIds.length ? actionIds : report.actions.filter((action) => action.safe).map((action) => action.id));
    const actions = report.actions.filter((action) => selected.has(action.id) && action.safe);
    if (!actions.length) return { applied: 0, touched: 0, archived: 0, flagged: 0, repaired: 0, woken: 0, skipped: report.actions.length };
    const now = new Date().toISOString();
    createRecoveryPoint({ label: "批量清洗前保护点", reason: "before_cleaning" });
    const actionByType = new Map(actions.map((action) => [action.type, action]));
    const duplicateIds = new Set(actions.filter((action) => action.type === "archive_duplicate").flatMap((action) => action.itemIds || []));
    const orphanIds = new Set(actionByType.get("remove_orphan_project_refs")?.itemIds || []);
    const contextIds = new Set(actionByType.get("flag_missing_context")?.itemIds || []);
    const dormantIds = new Set(actionByType.get("wake_dormant_review")?.itemIds || []);
    const projectIds = new Set(state.projects.map((project) => project.id));
    let archived = 0;
    let flagged = 0;
    let repaired = 0;
    let woken = 0;
    const bookmarks = state.bookmarks.map((bookmark) => {
      let changes = {};
      if (duplicateIds.has(bookmark.id) && bookmark.status !== "archived") {
        changes = { ...changes, status: "archived", notes: [bookmark.notes, `批量清洗：重复链接副本已于 ${now} 归档，原文未删除。`].filter(Boolean).join("\n") };
        archived += 1;
      }
      if (orphanIds.has(bookmark.id)) {
        const validProjectIds = (bookmark.projectIds || []).filter((id) => projectIds.has(id));
        if (validProjectIds.length !== (bookmark.projectIds || []).length) {
          changes = { ...changes, projectIds: validProjectIds };
          repaired += 1;
        }
      }
      if (contextIds.has(bookmark.id)) {
        const tags = normalizeTags([...(bookmark.tags || []), "需补充"]);
        const processingError = bookmark.processingError || linkSupplementMessage(bookmark.url);
        changes = { ...changes, tags, processingError, processingStatus: bookmark.processingStatus === "ready" ? "ready" : bookmark.processingStatus };
        flagged += 1;
      }
      if (dormantIds.has(bookmark.id) && !duplicateIds.has(bookmark.id) && bookmark.status !== "to_read" && bookmark.status !== "used") {
        changes = { ...changes, status: "to_read", nextReviewAt: null };
        woken += 1;
      }
      return Object.keys(changes).length ? updateBookmark(bookmark, changes, now) : bookmark;
    });
    const touched = new Set([...duplicateIds, ...orphanIds, ...contextIds, ...dormantIds]).size;
    commit({ ...state, bookmarks });
    return { applied: actions.length, touched, archived, flagged, repaired, woken, skipped: Math.max(0, report.actions.length - actions.length) };
  };

  const promotePriorityQueue = (ids = []) => {
    const report = getActionPriorityReport(state, { limit: 8 });
    const selectedIds = (Array.isArray(ids) && ids.length ? ids : report.recommendedIds).filter(Boolean).slice(0, 5);
    if (!selectedIds.length) return { promoted: 0, ids: [], focus: report.nextFocus };
    const now = new Date().toISOString();
    const timeZone = state.preferences.timeZone || "Asia/Shanghai";
    const today = getDateKey(new Date(), timeZone);
    const byId = new Map(report.items.map((item) => [item.id, item]));
    const existing = state.reviewSelections[today] || getDailyReview(state.bookmarks, state.projects, { limit: 5, timeZone }).map(({ bookmark, reason }) => ({ id: bookmark.id, reason }));
    const validIds = selectedIds.filter((id) => state.bookmarks.some((bookmark) => bookmark.id === id && bookmark.status !== "archived"));
    if (!validIds.length) return { promoted: 0, ids: [], focus: report.nextFocus };
    createRecoveryPoint({ label: "优先队列推进前保护点", reason: "before_priority_push" });
    const pushed = validIds.map((id) => ({
      id,
      reason: `行动优先：${byId.get(id)?.lane || "值得推进"}${byId.get(id)?.whyNow ? ` · ${byId.get(id).whyNow}` : ""}`,
    }));
    const nextSelection = [...pushed, ...existing.filter((entry) => !validIds.includes(entry.id))].slice(0, 5);
    const promotedSet = new Set(validIds);
    const bookmarks = state.bookmarks.map((bookmark) => {
      if (!promotedSet.has(bookmark.id)) return bookmark;
      const nextStatus = ["inbox", "reference"].includes(bookmark.status) ? "to_action" : bookmark.status;
      return updateBookmark(bookmark, { status: nextStatus, nextReviewAt: null, lastRecommendedAt: bookmark.lastRecommendedAt || now }, now);
    });
    commit({ ...state, bookmarks, reviewSelections: { ...state.reviewSelections, [today]: nextSelection } });
    return { promoted: validIds.length, ids: validIds, focus: byId.get(validIds[0])?.primaryAction || report.nextFocus };
  };

  return {
    getState: () => state,
    getSyncAudit: () => syncAudit,
    getSyncAuditSummary: () => ({
      total: syncAudit.length,
      errors: syncAudit.filter((event) => event.status === "error").length,
      warnings: syncAudit.filter((event) => event.status === "warning").length,
      latestAt: syncAudit[0]?.at || null,
    }),
    addSyncAuditEvent: commitAudit,
    getRecoveryPoints: () => recoveryPoints,
    getRecoveryPointSummary: () => ({ total: recoveryPoints.length, latestAt: recoveryPoints[0]?.createdAt || null, verified: recoveryPoints.filter((point) => verifyRecoveryPoint(point.id).ok).length }),
    createRecoveryPoint,
    verifyRecoveryPoint,
    getDataCleaningReport: () => getDataCleaningReport(state),
    getActionPriorityReport: () => getActionPriorityReport(state),
    applyDataCleaningActions,
    promotePriorityQueue,
    getStorageStatus: () => ({ loadError, storageError, recoveryRaw }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addBookmark(input) {
      const canonicalUrl = canonicalizeUrl(input.url);
      const duplicate = canonicalUrl && state.bookmarks.find((bookmark) => bookmark.canonicalUrl === canonicalUrl && bookmark.status !== "archived");
      if (duplicate && !input.allowDuplicate) {
        const error = new Error("这个链接已经收藏过了");
        error.code = "DUPLICATE_URL";
        error.bookmarkId = duplicate.id;
        error.input = input;
        throw error;
      }
      const bookmark = createBookmark(input);
      commit({ ...state, bookmarks: [bookmark, ...state.bookmarks] });
      return bookmark;
    },
    addBookmarks(inputs) {
      if (!Array.isArray(inputs)) throw new Error("批量导入内容格式不正确");
      const knownUrls = new Set(state.bookmarks.filter((bookmark) => bookmark.status !== "archived").map((bookmark) => bookmark.canonicalUrl).filter(Boolean));
      const added = [];
      let skipped = 0;
      for (const input of inputs.slice(0, 200)) {
        const canonicalUrl = canonicalizeUrl(input.url);
        if (canonicalUrl && knownUrls.has(canonicalUrl)) {
          skipped += 1;
          continue;
        }
        const bookmark = createBookmark({ ...input, isDemo: false });
        added.push(bookmark);
        if (canonicalUrl) knownUrls.add(canonicalUrl);
      }
      if (added.length) commit({ ...state, bookmarks: [...added, ...state.bookmarks] });
      return { added: added.length, skipped, bookmarks: added };
    },
    updateBookmark(id, changes) {
      let updated;
      const nextState = {
        ...state,
        bookmarks: state.bookmarks.map((bookmark) => {
          if (bookmark.id !== id) return bookmark;
          updated = updateBookmark(bookmark, changes);
          return updated;
        }),
      };
      if (!updated) throw new Error("找不到这条收藏");
      commit(nextState);
      return updated;
    },
    deleteBookmark(id) {
      const now = new Date().toISOString();
      const reviewLog = Object.fromEntries(Object.entries(state.reviewLog).map(([date, actions]) => {
        const { [id]: _removed, ...remaining } = actions;
        return [date, remaining];
      }));
      const reviewSelections = Object.fromEntries(Object.entries(state.reviewSelections).map(([date, selection]) => [date, selection.filter((entry) => entry.id !== id)]));
      const removedEvents = state.reviewEvents.filter((event) => event.itemId === id && event.id).map((event) => tombstone("review_event", event.id, now));
      commit(withTombstones({
        ...state,
        bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id),
        reviewLog,
        reviewSelections,
        reviewEvents: state.reviewEvents.filter((event) => event.itemId !== id),
      }, [tombstone("bookmark", id, now), ...removedEvents]));
    },
    addProject(input) {
      const name = String(input.name || "").trim();
      if (!name) throw new Error("项目名称不能为空");
      const now = new Date().toISOString();
      const project = {
        id: uid("project"),
        name,
        description: String(input.description || "").trim(),
        color: input.color || "#6c5ce7",
        status: input.status || "active",
        createdAt: now,
        updatedAt: now,
      };
      commit({ ...state, projects: [project, ...state.projects] });
      return project;
    },
    updateProject(id, changes) {
      commit({
        ...state,
        projects: state.projects.map((project) => project.id === id ? { ...project, ...changes, updatedAt: new Date().toISOString() } : project),
      });
    },
    deleteProject(id) {
      const now = new Date().toISOString();
      commit(withTombstones({
        ...state,
        projects: state.projects.filter((project) => project.id !== id),
        bookmarks: state.bookmarks.map((bookmark) => updateBookmark(bookmark, { projectIds: bookmark.projectIds.filter((projectId) => projectId !== id) })),
      }, [tombstone("project", id, now)]));
    },
    recordReview(id, action, metadata = {}) {
      return applyReview(id, action, metadata);
    },
    handleReview(id, action, metadata = {}) {
      return applyReview(id, action, metadata);
    },
    getTodayReview(limit = 5) {
      const timeZone = state.preferences.timeZone || "Asia/Shanghai";
      const today = getDateKey(new Date(), timeZone);
      let selection = state.reviewSelections[today];
      if (!selection) {
        selection = getDailyReview(state.bookmarks, state.projects, { limit: 5, timeZone }).map(({ bookmark, reason }) => ({ id: bookmark.id, reason }));
        const nextState = { ...state, reviewSelections: { ...state.reviewSelections, [today]: selection } };
        if (loadError) state = nextState;
        else commit(nextState, { silent: true });
      }
      return selection.slice(0, Math.max(1, Math.min(5, limit)))
        .map(({ id, reason }) => ({ bookmark: state.bookmarks.find((item) => item.id === id), reason }))
        .filter(({ bookmark }) => bookmark);
    },
    pinToTodayReview(id, reason = "手动钉到今日回顾") {
      const bookmark = state.bookmarks.find((item) => item.id === id);
      if (!bookmark) throw new Error("找不到这条收藏");
      const timeZone = state.preferences.timeZone || "Asia/Shanghai";
      const today = getDateKey(new Date(), timeZone);
      const selection = state.reviewSelections[today] || getDailyReview(state.bookmarks, state.projects, { limit: 5, timeZone }).map(({ bookmark: item, reason: why }) => ({ id: item.id, reason: why }));
      const nextSelection = [{ id, reason }, ...selection.filter((entry) => entry.id !== id)].slice(0, 5);
      const now = new Date().toISOString();
      commit({
        ...state,
        bookmarks: state.bookmarks.map((item) => item.id === id ? updateBookmark(item, { status: item.status === "archived" ? "to_read" : item.status, nextReviewAt: null }, now) : item),
        reviewSelections: { ...state.reviewSelections, [today]: nextSelection },
      });
      return bookmark;
    },
    updatePreferences(changes) {
      commit({ ...state, preferences: { ...state.preferences, ...changes } });
    },
    startValidation(startedAt = new Date().toISOString()) {
      const parsed = new Date(startedAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("验证开始时间无效");
      commit({ ...state, preferences: { ...state.preferences, validationStartedAt: parsed.toISOString() } });
    },
    restoreBackup(value, options = {}) {
      const migrated = migrateBackup(value);
      if (!validateBackup(migrated)) throw new Error("备份文件格式或关联关系不正确，现有数据未被修改");
      if (options.protect !== false) createRecoveryPoint({ label: options.protectLabel || "恢复备份前保护点", reason: "before_restore" });
      const restored = sanitizeState(migrated);
      commit(restored, { silent: Boolean(options.silent) });
      recoveryRaw = null;
      try { storage?.removeItem?.(RECOVERY_STORAGE_KEY); } catch { /* keep the successful restore */ }
      return { bookmarks: restored.bookmarks.length, projects: restored.projects.length };
    },
    replaceState(nextState, options = {}) {
      const migrated = migrateBackup(nextState);
      if (!validateBackup(migrated)) throw new Error("合并后的同步数据不完整，现有数据未被修改");
      const restored = sanitizeState(migrated);
      commit(restored, { silent: Boolean(options.silent) });
      return { bookmarks: restored.bookmarks.length, projects: restored.projects.length };
    },
    clearSyncTombstones(keys = []) {
      const keySet = new Set(keys);
      if (!keySet.size) return 0;
      const remaining = (state.syncTombstones || []).filter((entry) => !keySet.has(tombstoneKey(entry)));
      const removed = (state.syncTombstones || []).length - remaining.length;
      if (removed) commit({ ...state, syncTombstones: remaining }, { silent: true });
      return removed;
    },
    clearSyncAudit() {
      const removed = syncAudit.length;
      syncAudit = [];
      persistSyncAudit();
      return removed;
    },
    restoreRecoveryPoint(id) {
      const verified = verifyRecoveryPoint(id);
      if (!verified.ok) throw new Error(verified.error);
      createRecoveryPoint({ label: "恢复点回滚前保护点", reason: "before_recovery_point_restore" });
      const restored = sanitizeState(verified.point.snapshot);
      commit(restored);
      recoveryRaw = null;
      return { bookmarks: restored.bookmarks.length, projects: restored.projects.length, checksum: verified.checksum };
    },
    deleteRecoveryPoint(id) {
      const before = recoveryPoints.length;
      recoveryPoints = recoveryPoints.filter((point) => point.id !== id);
      if (before !== recoveryPoints.length) persistRecoveryPoints();
      return before - recoveryPoints.length;
    },
    reset(options = {}) {
      if (options.protect !== false) createRecoveryPoint({ label: options.protectLabel || "重置前保护点", reason: "before_reset" });
      commit(makeSeedState());
      recoveryRaw = null;
      try { storage?.removeItem?.(RECOVERY_STORAGE_KEY); } catch { /* reset already succeeded */ }
    },
  };
}
