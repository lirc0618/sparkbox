export const BOOKMARK_STATUSES = [
  { value: "inbox", label: "收件箱", tone: "amber" },
  { value: "to_read", label: "待阅读", tone: "blue" },
  { value: "to_action", label: "待处理", tone: "violet" },
  { value: "in_use", label: "正在使用", tone: "cyan" },
  { value: "used", label: "已使用", tone: "green" },
  { value: "reference", label: "长期参考", tone: "slate" },
  { value: "archived", label: "已归档", tone: "gray" },
];

export const STATUS_MAP = Object.fromEntries(BOOKMARK_STATUSES.map((status) => [status.value, status]));
const ACTIVE_STATUSES = new Set(["inbox", "to_read", "to_action", "in_use", "reference"]);

export function uid(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(/[,，#]/);
  return [...new Set(list.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
}

export function canonicalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

const LINK_ACCESS_RULES = [
  { label: "微信/公众号", hosts: ["mp.weixin.qq.com", "weixin.qq.com"], risk: "常需要在微信内打开，外部网页可能拿不到正文", contentType: "article", tags: ["微信", "需补充"] },
  { label: "小红书", hosts: ["xiaohongshu.com", "xhslink.com"], risk: "内容经常需要登录或 App 环境才能完整查看", contentType: "social", tags: ["小红书", "需补充"] },
  { label: "Bilibili", hosts: ["bilibili.com", "b23.tv"], risk: "视频内容无法仅凭链接还原，需要标题、简介或你的观看备注", contentType: "video", tags: ["视频", "需补充"] },
  { label: "抖音/TikTok", hosts: ["douyin.com", "iesdouyin.com", "tiktok.com"], risk: "短视频动态内容通常无法直接读取正文", contentType: "video", tags: ["短视频", "需补充"] },
  { label: "知乎", hosts: ["zhihu.com", "zhuanlan.zhihu.com"], risk: "部分内容会被登录墙或折叠正文限制", contentType: "article", tags: ["知乎", "需补充"] },
  { label: "X/Twitter", hosts: ["x.com", "twitter.com", "t.co"], risk: "帖子可能需要登录，且上下文容易缺失", contentType: "social", tags: ["社交内容", "需补充"] },
  { label: "Instagram", hosts: ["instagram.com"], risk: "图片或帖子通常需要登录，无法可靠读取视觉内容", contentType: "social", tags: ["社交内容", "需补充"] },
  { label: "Notion", hosts: ["notion.so", "notion.site"], risk: "页面可能是私有工作区，未授权时不能读取", contentType: "note", tags: ["Notion", "需授权"] },
  { label: "飞书/语雀文档", hosts: ["feishu.cn", "larksuite.com", "yuque.com"], risk: "团队文档常有权限限制", contentType: "note", tags: ["文档", "需授权"] },
  { label: "知识星球", hosts: ["zsxq.com"], risk: "内容通常需要成员登录后才能查看", contentType: "social", tags: ["知识星球", "需补充"] },
  { label: "微信读书", hosts: ["weread.qq.com"], risk: "划线和笔记可能需要登录账号才能访问", contentType: "note", tags: ["读书", "需补充"] },
];

function hostMatches(hostname, candidate) {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function classifyUrlAccess(value) {
  const raw = String(value || "").trim();
  if (!raw) return { restricted: false, label: "", risk: "", tip: "", contentType: "", tags: [] };
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const rule = LINK_ACCESS_RULES.find((item) => item.hosts.some((host) => hostMatches(hostname, host)));
    if (!rule) return { restricted: false, label: hostname, risk: "", tip: "", contentType: "", tags: [] };
    return {
      restricted: true,
      label: rule.label,
      risk: rule.risk,
      tip: "请补充可见标题、关键摘录、截图转写、保存原因或你想用它完成的下一步。AI 只会基于这些已提供信息做保守整理。",
      contentType: rule.contentType,
      tags: rule.tags,
    };
  } catch {
    return { restricted: false, label: "", risk: "", tip: "", contentType: "", tags: [] };
  }
}

export function linkSupplementMessage(url) {
  const access = classifyUrlAccess(url);
  if (access.restricted) return `${access.label} 链接可能无法直接读取：${access.risk}。${access.tip}`;
  return "Sparkbox 会先保存原链接；如果网页需要登录、在 App 内打开或内容没有公开正文，请补充标题、摘录或备注后再让 AI 整理。";
}

export function getDateKey(date = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function createBookmark(input, now = new Date().toISOString()) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("收藏标题不能为空");

  return {
    id: input.id || uid("bm"),
    isDemo: Boolean(input.isDemo),
    title,
    url: String(input.url || "").trim(),
    canonicalUrl: canonicalizeUrl(input.canonicalUrl || input.url),
    inputType: input.inputType || (input.url ? "url" : "text"),
    contentType: input.contentType || (input.url ? "article" : "note"),
    rawText: String(input.rawText || "").trim(),
    summary: String(input.summary || "").trim(),
    notes: String(input.notes || "").trim(),
    source: String(input.source || "手动收藏").trim() || "手动收藏",
    whySaved: String(input.whySaved || input.notes || "").trim(),
    whyValuable: String(input.whyValuable || "").trim(),
    nextAction: String(input.nextAction || "").trim(),
    importance: ["low", "medium", "high"].includes(input.importance) ? input.importance : "medium",
    processingStatus: input.processingStatus || "ready",
    processingError: String(input.processingError || "").trim(),
    tags: normalizeTags(input.tags),
    status: STATUS_MAP[input.status] ? input.status : "inbox",
    projectIds: [...new Set(input.projectIds || [])],
    createdAt: input.createdAt || now,
    updatedAt: now,
    lastViewedAt: input.lastViewedAt || null,
    viewCount: Number(input.viewCount || 0),
    lastRecommendedAt: input.lastRecommendedAt || null,
    recommendationCount: Number(input.recommendationCount || 0),
    skipCount: Number(input.skipCount || 0),
    usedAt: input.usedAt || null,
    nextReviewAt: input.nextReviewAt || null,
    useOutcome: String(input.useOutcome || "").trim(),
    archivedAt: input.status === "archived" ? input.archivedAt || now : null,
  };
}

function splitImportLine(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/https?:\/\/[^\s<>"')，。；;]+/i);
  if (!match) return { url: "", context: text };
  const url = match[0].replace(/[),.，。；;]+$/g, "");
  const context = text
    .replace(match[0], " ")
    .replace(/^[\s·:：\-—|]+|[\s·:：\-—|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { url, context };
}

function importLineToBookmark(raw, { textSource = "批量文字" } = {}) {
  const imported = splitImportLine(raw);
  const canonicalUrl = canonicalizeUrl(imported.url || raw);
  if (canonicalUrl) {
    const url = new URL(canonicalUrl);
    const access = classifyUrlAccess(imported.url || raw);
    const contextTitle = imported.context.slice(0, 60);
    return {
      title: contextTitle || (access.restricted ? `${access.label} 收藏` : url.hostname),
      url: imported.url || raw,
      rawText: imported.context,
      summary: imported.context,
      source: access.restricted ? access.label : url.hostname,
      inputType: "url",
      contentType: access.contentType || "article",
      processingStatus: "ready",
      processingError: access.restricted && !imported.context ? linkSupplementMessage(imported.url || raw) : "",
      tags: access.tags || [],
    };
  }
  return {
    title: String(raw || "").trim().slice(0, 60),
    rawText: raw,
    summary: raw,
    source: textSource,
    inputType: "text",
    contentType: "note",
    processingStatus: "ready",
  };
}

export function parseCaptureInput(value) {
  return importLineToBookmark(String(value || "").trim(), { textSource: "文字速记" });
}

export function parseBatchInput(value, limit = 200) {
  const unique = [...new Set(String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, limit);
  return unique.map((raw) => importLineToBookmark(raw));
}

export function getWeeklyActivationMetrics({ bookmarks = [], reviewEvents = [], now = new Date(), timeZone = "Asia/Shanghai" } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const since = new Date(current.getTime() - 6 * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const bookmarkById = new Map((bookmarks || []).map((bookmark) => [bookmark.id, bookmark]));
  const eventSnapshots = new Map();
  for (const event of reviewEvents || []) {
    if (typeof event.isDemo === "boolean") eventSnapshots.set(event.itemId, { isDemo: event.isDemo, createdAt: event.itemCreatedAt });
  }
  const isRealEvent = (event) => {
    const bookmark = bookmarkById.get(event.itemId);
    const snapshot = eventSnapshots.get(event.itemId);
    return bookmark ? !bookmark.isDemo : snapshot?.isDemo === false;
  };
  const events = (reviewEvents || []).filter((event) => {
    const occurred = new Date(event.occurredAt);
    return isRealEvent(event) && occurred >= since && occurred <= current;
  });
  const handledEvents = events.filter((event) => event.eventType !== "surfaced");
  const activationEvents = events.filter((event) => ["use", "used"].includes(event.eventType));
  const handledIds = new Set(handledEvents.map((event) => event.itemId));
  const activatedIds = new Set(activationEvents.map((event) => event.itemId));
  const oldActivated = activationEvents.filter((event) => {
    const createdAt = bookmarkById.get(event.itemId)?.createdAt || eventSnapshots.get(event.itemId)?.createdAt || event.itemCreatedAt;
    return createdAt && new Date(event.occurredAt) - new Date(createdAt) >= 7 * 86_400_000;
  });
  const outcomeEvents = handledEvents.filter((event) => String(event.outcomeNote || "").trim());
  const savedCount = (bookmarks || []).filter((bookmark) => !bookmark.isDemo && new Date(bookmark.createdAt) >= since && new Date(bookmark.createdAt) <= current).length;
  const activeDays = new Set(handledEvents.map((event) => getDateKey(new Date(event.occurredAt), timeZone))).size;
  const recentOutcomes = outcomeEvents.slice(-3).reverse().map((event) => ({
    title: bookmarkById.get(event.itemId)?.title || "已删除收藏",
    note: String(event.outcomeNote || "").trim(),
  }));
  const revivedTitles = oldActivated.slice(-3).reverse().map((event) => bookmarkById.get(event.itemId)?.title || "已删除收藏");
  const activationRate = handledIds.size ? Math.round((activatedIds.size / handledIds.size) * 100) : 0;
  const recommendation = handledIds.size < 3
    ? "先完成 3 张今日卡片，让系统知道哪些旧收藏还值得再出现。"
    : activatedIds.size < 1
      ? "本周已经开始回顾，下一步挑一条收藏写下具体使用结果。"
      : oldActivated.length < 1
        ? "试着激活一条保存超过 7 天的旧收藏，验证它是否还能产生行动。"
        : "本周已经形成闭环，继续记录成果会让下次推荐更准。";
  return {
    since: since.toISOString(),
    savedCount,
    handledCount: handledIds.size,
    activatedCount: activatedIds.size,
    oldActivatedCount: oldActivated.length,
    outcomeCount: outcomeEvents.length,
    activeDays,
    activationRate,
    recentOutcomes,
    revivedTitles,
    recommendation,
  };
}

export function getReviewCompletionState({ done = 0, total = 0, activatedCount = 0, outcomeCount = 0 } = {}) {
  if (!total) {
    return {
      complete: true,
      title: "今天没有新的回顾卡片",
      suggestion: "可以先导入几条真实收藏，或从收藏库里恢复一条想再次遇见的内容。",
      tone: "empty",
    };
  }
  if (done < total) {
    return {
      complete: false,
      title: `还剩 ${Math.max(0, total - done)} 张卡片`,
      suggestion: "每张卡片只做一个决定：打开看看、标记已用上，或稍后再来。",
      tone: "active",
    };
  }
  if (outcomeCount > 0 || activatedCount > 0) {
    return {
      complete: true,
      title: "今天的收藏已经变成行动",
      suggestion: "很好，已经记录到本周反馈里。明天继续用小剂量回顾维持节奏。",
      tone: "activated",
    };
  }
  return {
    complete: true,
    title: "今天的连接已经完成",
    suggestion: "如果有一条内容真的帮到了你，下次可以点“已用上”并写一句成果。",
    tone: "done",
  };
}

export function getValidationMetrics({ bookmarks, reviewEvents, startedAt, now = new Date(), timeZone = "Asia/Shanghai" }) {
  if (!startedAt) return { active: false };
  const started = new Date(startedAt);
  const current = now instanceof Date ? now : new Date(now);
  const elapsedMs = current.getTime() - started.getTime();
  const day = Math.max(0, Math.min(14, Math.floor(elapsedMs / 86_400_000) + 1));
  const end = new Date(started.getTime() + 14 * 86_400_000);
  const bookmarkById = new Map((bookmarks || []).map((bookmark) => [bookmark.id, bookmark]));
  const realBookmarks = (bookmarks || []).filter((bookmark) => !bookmark.isDemo);
  const eventSnapshots = new Map();
  for (const event of reviewEvents || []) {
    if (typeof event.isDemo === "boolean") eventSnapshots.set(event.itemId, { isDemo: event.isDemo, createdAt: event.itemCreatedAt });
  }
  const events = (reviewEvents || []).filter((event) => {
    const occurred = new Date(event.occurredAt);
    const bookmark = bookmarkById.get(event.itemId);
    const snapshot = eventSnapshots.get(event.itemId);
    const isReal = bookmark ? !bookmark.isDemo : snapshot?.isDemo === false;
    return isReal && occurred >= started && occurred < end && occurred <= current;
  });
  const activationEvents = events.filter((event) => ["use", "used"].includes(event.eventType));
  const activationByItem = new Map();
  for (const event of activationEvents) {
    if (!activationByItem.has(event.itemId)) activationByItem.set(event.itemId, event);
  }
  const handledIds = new Set(events.filter((event) => event.eventType !== "surfaced").map((event) => event.itemId));
  const activeDayKeys = new Set(events.map((event) => getDateKey(new Date(event.occurredAt), timeZone)));
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(started.getTime() + index * 86_400_000);
    const key = getDateKey(date, timeZone);
    return { key, count: events.filter((event) => getDateKey(new Date(event.occurredAt), timeZone) === key).length };
  });
  const oldActivatedCount = [...activationByItem.entries()].filter(([id, activation]) => {
    const createdAt = bookmarkById.get(id)?.createdAt || eventSnapshots.get(id)?.createdAt || activation.itemCreatedAt;
    return createdAt && new Date(activation.occurredAt) - new Date(createdAt) >= 7 * 86_400_000;
  }).length;
  return {
    active: true,
    day,
    daysRemaining: Math.max(0, 14 - day),
    complete: current >= end,
    savedCount: realBookmarks.length,
    activeDays: activeDayKeys.size,
    reviewedCount: handledIds.size,
    activatedCount: activationByItem.size,
    oldActivatedCount,
    activationRate: handledIds.size ? Math.min(100, Math.round((activationByItem.size / handledIds.size) * 100)) : 0,
    daily,
    targets: { saved: 30, activeDays: 10, oldActivated: 3 },
  };
}

export function updateBookmark(bookmark, changes, now = new Date().toISOString()) {
  const next = createBookmark({ ...bookmark, ...changes, id: bookmark.id, createdAt: bookmark.createdAt }, now);
  if (next.status === "used" && !next.usedAt) next.usedAt = now;
  if (next.status !== "used" && changes.status) next.usedAt = null;
  if (next.status === "archived" && !next.archivedAt) next.archivedAt = now;
  if (next.status !== "archived") next.archivedAt = null;
  return next;
}

export function matchesSearch(bookmark, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = [bookmark.title, bookmark.summary, bookmark.notes, bookmark.whySaved, bookmark.whyValuable, bookmark.rawText, bookmark.source, ...(bookmark.tags || [])]
    .join(" ")
    .toLocaleLowerCase();
  return normalized.split(/\s+/).every((word) => haystack.includes(word));
}

export function filterBookmarks(bookmarks, { query = "", status, projectId, includeArchived = false } = {}) {
  return bookmarks
    .filter((bookmark) => includeArchived || bookmark.status !== "archived")
    .filter((bookmark) => !status || bookmark.status === status)
    .filter((bookmark) => !projectId || bookmark.projectIds.includes(projectId))
    .filter((bookmark) => matchesSearch(bookmark, query))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function entityTimestamp(type, payload, fallback = "") {
  if (!payload || typeof payload !== "object") return fallback;
  if (type === "bookmark" || type === "project") return payload.updatedAt || payload.createdAt || fallback;
  if (type === "review_event") return payload.occurredAt || fallback;
  if (type === "review_log" || type === "review_selection") return payload.date || fallback;
  if (type === "preference") return payload.validationStartedAt || fallback;
  return fallback;
}

function shouldApplyRemote(localPayload, remotePayload, remoteItem, lastMergedAt = "") {
  if (!localPayload) return { apply: true, reason: "create" };
  if (stableStringify(localPayload) === stableStringify(remotePayload)) return { apply: false, reason: "same" };
  const remoteTime = new Date(remoteItem.clientUpdatedAt || remoteItem.updatedAt || 0).getTime();
  const localTime = new Date(entityTimestamp(remoteItem.entityType, localPayload, 0)).getTime();
  const lastMergedTime = lastMergedAt ? new Date(lastMergedAt).getTime() : 0;
  if (Number.isFinite(lastMergedTime) && lastMergedTime && localTime > lastMergedTime && remoteTime > lastMergedTime) {
    return remoteTime >= localTime ? { apply: true, reason: "remote_conflict" } : { apply: false, reason: "local_conflict" };
  }
  if (!Number.isFinite(localTime) || !localTime) return { apply: true, reason: "remote_newer" };
  if (!Number.isFinite(remoteTime) || !remoteTime) return { apply: false, reason: "local_newer" };
  return remoteTime >= localTime ? { apply: true, reason: "remote_newer" } : { apply: false, reason: "local_newer" };
}

function mergeMapEntry(map, id, payload, remoteItem, stats, options) {
  const localPayload = map.get(id);
  const decision = shouldApplyRemote(localPayload, payload, remoteItem, options.lastMergedAt);
  if (remoteItem.deleted) {
    if (!localPayload) { stats.skipped += 1; return; }
    if (decision.apply) { map.delete(id); stats.deleted += 1; return; }
    stats.conflicts += 1;
    stats.localWins += 1;
    return;
  }
  if (!decision.apply) {
    if (decision.reason === "same") stats.skipped += 1;
    else {
      stats.conflicts += 1;
      stats.localWins += 1;
    }
    return;
  }
  map.set(id, payload);
  if (decision.reason === "create") stats.created += 1;
  else {
    stats.updated += 1;
    if (decision.reason === "remote_conflict") stats.remoteWins += 1;
  }
}

export function applySyncItemsToState(state, items = [], options = {}) {
  const next = {
    ...state,
    bookmarks: [...(state.bookmarks || [])],
    projects: [...(state.projects || [])],
    preferences: { ...(state.preferences || {}) },
    reviewLog: { ...(state.reviewLog || {}) },
    reviewSelections: { ...(state.reviewSelections || {}) },
    reviewEvents: [...(state.reviewEvents || [])],
  };
  const stats = { incoming: 0, created: 0, updated: 0, deleted: 0, skipped: 0, conflicts: 0, localWins: 0, remoteWins: 0 };
  const bookmarks = new Map(next.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const projects = new Map(next.projects.map((project) => [project.id, project]));
  const events = new Map(next.reviewEvents.map((event) => [event.id || `${event.itemId}-${event.occurredAt}-${event.eventType}`, event]));

  for (const item of items || []) {
    if (!item || typeof item !== "object" || !item.entityType || !item.entityId) { stats.skipped += 1; continue; }
    stats.incoming += 1;
    const payload = item.payload && typeof item.payload === "object" ? item.payload : null;
    try {
      if (item.entityType === "bookmark") {
        if (item.deleted) mergeMapEntry(bookmarks, item.entityId, null, item, stats, options);
        else mergeMapEntry(bookmarks, item.entityId, createBookmark({ ...(payload || {}), id: item.entityId }, payload?.updatedAt || item.clientUpdatedAt || item.updatedAt), item, stats, options);
      } else if (item.entityType === "project") {
        if (item.deleted) mergeMapEntry(projects, item.entityId, null, item, stats, options);
        else if (payload?.name) mergeMapEntry(projects, item.entityId, { ...payload, id: item.entityId }, item, stats, options);
        else stats.skipped += 1;
      } else if (item.entityType === "preference" && payload) {
        const decision = shouldApplyRemote(next.preferences, payload, item, options.lastMergedAt);
        if (decision.apply) { next.preferences = { ...next.preferences, ...payload }; stats.updated += 1; }
        else if (decision.reason === "same") stats.skipped += 1;
        else { stats.conflicts += 1; stats.localWins += 1; }
      } else if (item.entityType === "review_event") {
        if (item.deleted) mergeMapEntry(events, item.entityId, null, item, stats, options);
        else if (payload?.itemId && payload?.eventType && payload?.occurredAt) mergeMapEntry(events, item.entityId, { ...payload, id: payload.id || item.entityId }, item, stats, options);
        else stats.skipped += 1;
      } else if (item.entityType === "review_log" && payload) {
        const local = next.reviewLog[item.entityId] || {};
        const remote = payload.log && typeof payload.log === "object" ? payload.log : {};
        const merged = item.deleted ? {} : { ...local, ...remote };
        if (stableStringify(local) === stableStringify(merged)) stats.skipped += 1;
        else { next.reviewLog[item.entityId] = merged; stats.updated += 1; }
      } else if (item.entityType === "review_selection" && payload) {
        const local = next.reviewSelections[item.entityId] || [];
        const remote = Array.isArray(payload.selection) ? payload.selection : [];
        const decision = shouldApplyRemote({ date: item.entityId, selection: local }, { date: item.entityId, selection: remote }, item, options.lastMergedAt);
        if (item.deleted) { delete next.reviewSelections[item.entityId]; stats.deleted += 1; }
        else if (decision.apply) { next.reviewSelections[item.entityId] = remote; stats.updated += 1; }
        else if (decision.reason === "same") stats.skipped += 1;
        else { stats.conflicts += 1; stats.localWins += 1; }
      } else {
        stats.skipped += 1;
      }
    } catch {
      stats.skipped += 1;
    }
  }

  next.bookmarks = [...bookmarks.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  next.projects = [...projects.values()].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  next.reviewEvents = [...events.values()].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const projectIds = new Set(next.projects.map((project) => project.id));
  const bookmarkIds = new Set(next.bookmarks.map((bookmark) => bookmark.id));
  next.bookmarks = next.bookmarks.map((bookmark) => ({ ...bookmark, projectIds: bookmark.projectIds.filter((id) => projectIds.has(id)) }));
  next.reviewEvents = next.reviewEvents.filter((event) => bookmarkIds.has(event.itemId) || event.eventType === "deleted");
  const knownIds = new Set([...bookmarkIds, ...next.reviewEvents.filter((event) => event.eventType === "deleted").map((event) => event.itemId)]);
  next.reviewLog = Object.fromEntries(Object.entries(next.reviewLog).map(([date, actions]) => [date, Object.fromEntries(Object.entries(actions || {}).filter(([id]) => knownIds.has(id))) ]));
  next.reviewSelections = Object.fromEntries(Object.entries(next.reviewSelections).map(([date, selection]) => [date, (Array.isArray(selection) ? selection : []).filter((entry) => knownIds.has(entry.id))]));
  return { state: next, stats };
}

function recentAuditCount(events, status, now, windowMs) {
  const current = now instanceof Date ? now : new Date(now);
  return (events || []).filter((event) => {
    if (status && event.status !== status) return false;
    const occurred = new Date(event.at);
    return !Number.isNaN(occurred.getTime()) && current - occurred <= windowMs;
  }).length;
}

function pushHealthIssue(issues, level, title, detail, action, penalty) {
  issues.push({ level, title, detail, action, penalty });
}

export function getSyncHealthReport({
  state = {},
  localSummary = {},
  remoteSummary = null,
  auditEvents = [],
  networkOnline = true,
  signedIn = false,
  cloudDirty = false,
  cloudConflict = null,
  cloudError = "",
  itemSyncError = "",
  itemMergeStats = null,
  pwaReady = false,
  now = new Date(),
} = {}) {
  const issues = [];
  const current = now instanceof Date ? now : new Date(now);
  const tombstoneCount = (state.syncTombstones || []).length;
  const localObjectCount = Number(localSummary.totalCount || 0);
  const remoteObjectCount = Number(remoteSummary?.totalCount || 0);
  const recentErrors = recentAuditCount(auditEvents, "error", current, 24 * 60 * 60 * 1000);
  const recentWarnings = recentAuditCount(auditEvents, "warning", current, 24 * 60 * 60 * 1000);
  const mergeConflicts = Number(itemMergeStats?.conflicts || 0);
  const localWins = Number(itemMergeStats?.localWins || 0);

  if (!networkOnline) pushHealthIssue(issues, "warning", "当前离线", "本机可以继续使用，但无法验证云端版本。", "联网后自动同步", 12);
  if (!signedIn) pushHealthIssue(issues, "warning", "未登录云同步", "数据仍在本机，无法跨设备校验。", "登录并拉取云端", 18);
  if (cloudDirty) pushHealthIssue(issues, "warning", "存在待上传更改", "本机有尚未写入云端的变更。", "立即同步", 14);
  if (cloudConflict) pushHealthIssue(issues, "critical", "发现整库版本冲突", "另一台设备可能已经更新过云端版本。", "先对象级合并", 28);
  if (cloudError) pushHealthIssue(issues, "critical", "整库同步失败", cloudError, "重试整库同步", 20);
  if (itemSyncError) pushHealthIssue(issues, "critical", "对象账本异常", itemSyncError, "刷新对象账本", 20);
  if (tombstoneCount) pushHealthIssue(issues, "warning", "删除墓碑待确认", `${tombstoneCount} 个删除记录还未确认写入云端。`, "刷新对象账本", Math.min(16, 4 + tombstoneCount * 2));
  if (signedIn && remoteSummary && remoteObjectCount && localObjectCount && Math.abs(remoteObjectCount - localObjectCount) > Math.max(4, localObjectCount * 0.2)) {
    pushHealthIssue(issues, "warning", "对象数量差异偏大", `本机 ${localObjectCount} 个对象，云端账本 ${remoteObjectCount} 个对象。`, "对象级拉取合并", 12);
  }
  if (mergeConflicts) pushHealthIssue(issues, "warning", "最近合并存在冲突", `${mergeConflicts} 个对象发生版本竞争，${localWins} 个保留本机版本。`, "导出备份后核对", Math.min(18, 8 + mergeConflicts * 3));
  if (recentErrors) pushHealthIssue(issues, "critical", "最近 24 小时有同步失败", `${recentErrors} 次失败记录需要处理。`, "查看审计时间线", Math.min(22, 10 + recentErrors * 4));
  if (recentWarnings >= 3) pushHealthIssue(issues, "warning", "最近警告较多", `24 小时内出现 ${recentWarnings} 次同步警告。`, "运行一键自检修复", Math.min(12, recentWarnings * 2));
  if (!pwaReady) pushHealthIssue(issues, "info", "离线外壳未确认", "核心页面尚未确认可离线打开。", "安装或刷新离线缓存", 5);

  const penalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const tone = score >= 85 ? "good" : score >= 65 ? "watch" : score >= 40 ? "risk" : "danger";
  const title = score >= 85 ? "同步健康" : score >= 65 ? "需要关注" : score >= 40 ? "存在风险" : "需要修复";
  const primaryAction = issues.find((issue) => issue.level === "critical")?.action || issues[0]?.action || "保持当前节奏";
  return {
    score,
    tone,
    title,
    primaryAction,
    issues: issues.sort((a, b) => b.penalty - a.penalty).slice(0, 6).map(({ penalty: _penalty, ...issue }) => issue),
    metrics: { tombstoneCount, localObjectCount, remoteObjectCount, recentErrors, recentWarnings, mergeConflicts, localWins },
  };
}

function bookmarkContextScore(bookmark) {
  const textScore = [bookmark.rawText, bookmark.summary, bookmark.notes, bookmark.whySaved, bookmark.whyValuable, bookmark.nextAction]
    .reduce((sum, value) => sum + Math.min(80, String(value || "").trim().length), 0);
  return textScore + (bookmark.tags?.length || 0) * 8 + (bookmark.projectIds?.length || 0) * 10;
}

function bookmarkHostLabel(bookmark) {
  try { return new URL(bookmark.url).hostname.replace(/^www\./, ""); }
  catch { return bookmark.source || "无来源"; }
}

function isWeakBookmarkTitle(bookmark) {
  const title = String(bookmark.title || "").trim();
  if (title.length <= 2) return true;
  const host = bookmarkHostLabel(bookmark).toLocaleLowerCase();
  const lower = title.toLocaleLowerCase();
  return lower === host || lower === bookmark.url?.toLocaleLowerCase() || /^(未命名|无标题|新收藏|收藏|链接|网页|article)$/i.test(title);
}

function compactCleaningItems(items, now) {
  return items.slice(0, 5).map((bookmark) => ({
    id: bookmark.id,
    title: bookmark.title,
    source: bookmark.source || bookmarkHostLabel(bookmark),
    status: bookmark.status,
    age: formatRelativeDate(bookmark.lastViewedAt || bookmark.lastRecommendedAt || bookmark.updatedAt || bookmark.createdAt, now),
  }));
}

function cleaningIssue(type, level, title, detail, action, items, extra = {}) {
  return {
    type,
    level,
    title,
    detail,
    action,
    count: items.length,
    items: compactCleaningItems(items, extra.now || new Date()),
    ...extra,
  };
}

function duplicateKeeper(group) {
  return [...group].sort((a, b) => {
    const scoreA = bookmarkContextScore(a) + Number(a.viewCount || 0) * 8 + Number(a.recommendationCount || 0) * 6 + (a.status === "used" ? 80 : 0);
    const scoreB = bookmarkContextScore(b) + Number(b.viewCount || 0) * 8 + Number(b.recommendationCount || 0) * 6 + (b.status === "used" ? 80 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
  })[0];
}

export function getDataCleaningReport(state = {}, { now = new Date() } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const bookmarks = Array.isArray(state.bookmarks) ? state.bookmarks : [];
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const projectIds = new Set(projects.map((project) => project.id));
  const active = bookmarks.filter((bookmark) => bookmark.status !== "archived");
  const realActive = active.filter((bookmark) => !bookmark.isDemo);
  const actions = [];
  const issues = [];

  const duplicateBuckets = new Map();
  for (const bookmark of realActive) {
    const key = bookmark.canonicalUrl || canonicalizeUrl(bookmark.url);
    if (!key) continue;
    duplicateBuckets.set(key, [...(duplicateBuckets.get(key) || []), bookmark]);
  }
  const duplicateGroups = [...duplicateBuckets.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => {
    const keep = duplicateKeeper(group);
    const duplicates = group.filter((bookmark) => bookmark.id !== keep.id);
    actions.push({
      id: `dedupe-${hashString(key).toString(36)}`,
      type: "archive_duplicate",
      safe: true,
      label: `归档 ${duplicates.length} 条重复副本`,
      detail: `保留信息最完整的「${keep.title}」，副本只归档不硬删除。`,
      itemIds: duplicates.map((bookmark) => bookmark.id),
      keepId: keep.id,
      canonicalUrl: key,
    });
    return { key, keep, duplicates, group };
  });
  const duplicateItems = duplicateGroups.flatMap((group) => group.duplicates);
  if (duplicateItems.length) issues.push(cleaningIssue("duplicates", "warning", "重复链接", `${duplicateGroups.length} 组链接存在多个活跃副本，容易让回顾和项目统计重复。`, "归档副本但保留恢复能力", duplicateItems, { now: current }));

  const orphaned = realActive.filter((bookmark) => (bookmark.projectIds || []).some((id) => !projectIds.has(id)));
  if (orphaned.length) {
    actions.push({
      id: "remove-orphan-project-refs",
      type: "remove_orphan_project_refs",
      safe: true,
      label: `修复 ${orphaned.length} 条孤立项目关联`,
      detail: "只移除已经不存在的项目 ID，不删除收藏内容。",
      itemIds: orphaned.map((bookmark) => bookmark.id),
    });
    issues.push(cleaningIssue("orphan_projects", "critical", "孤立项目关联", "部分收藏仍挂着已不存在的项目，会影响项目覆盖率和同步校验。", "移除无效项目指针", orphaned, { now: current }));
  }

  const missingContext = realActive.filter((bookmark) => {
    const access = classifyUrlAccess(bookmark.url);
    return access.restricted && bookmarkContextScore({ ...bookmark, projectIds: [] }) < 24;
  });
  if (missingContext.length) {
    actions.push({
      id: "flag-missing-context",
      type: "flag_missing_context",
      safe: true,
      label: `标记 ${missingContext.length} 条需补充上下文`,
      detail: "追加“需补充”标签和保守提示，避免 AI 编造登录墙正文。",
      itemIds: missingContext.map((bookmark) => bookmark.id),
    });
    issues.push(cleaningIssue("missing_context", "warning", "受限平台缺上下文", "这些链接可能在微信、小红书、Notion 等环境内，只有链接不足以可靠整理。", "补充标题、摘录或截图转写", missingContext, { now: current }));
  }

  const weakMetadata = realActive.filter((bookmark) => isWeakBookmarkTitle(bookmark) || (bookmarkContextScore(bookmark) < 28 && !bookmark.summary && !bookmark.rawText));
  if (weakMetadata.length) {
    actions.push({
      id: "review-weak-metadata",
      type: "manual_review",
      safe: false,
      label: `人工核对 ${weakMetadata.length} 条弱信息收藏`,
      detail: "需要你确认标题或保存原因，系统不会自动猜测内容。",
      itemIds: weakMetadata.map((bookmark) => bookmark.id),
    });
    issues.push(cleaningIssue("weak_metadata", "info", "标题或摘要质量偏弱", "有些条目缺少可搜索标题、摘要或保存原因，后续回顾时很难判断价值。", "人工补充保存原因", weakMetadata, { now: current }));
  }

  const dormant = realActive.filter((bookmark) => {
    const touchedAt = bookmark.lastViewedAt || bookmark.lastRecommendedAt || bookmark.createdAt;
    return ACTIVE_STATUSES.has(bookmark.status) && current - new Date(touchedAt) > 45 * 86_400_000;
  }).sort((a, b) => new Date(a.lastViewedAt || a.lastRecommendedAt || a.createdAt) - new Date(b.lastViewedAt || b.lastRecommendedAt || b.createdAt));
  if (dormant.length) {
    const selected = dormant.slice(0, 12);
    actions.push({
      id: "wake-dormant-review",
      type: "wake_dormant_review",
      safe: true,
      label: `唤醒 ${selected.length} 条沉睡收藏`,
      detail: "把最久未触达的条目放回待阅读队列，等待今日回顾重新判断。",
      itemIds: selected.map((bookmark) => bookmark.id),
    });
    issues.push(cleaningIssue("dormant", "info", "沉睡条目过多", `${dormant.length} 条收藏超过 45 天没有打开或推荐，可能已经失去行动连接。`, "小批量放回回顾", dormant, { now: current }));
  }

  const penalty = duplicateItems.length * 6 + orphaned.length * 10 + missingContext.length * 5 + Math.min(24, weakMetadata.length * 3) + Math.min(18, dormant.length * 2);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const tone = score >= 90 ? "good" : score >= 75 ? "watch" : score >= 55 ? "risk" : "danger";
  const title = score >= 90 ? "数据很干净" : score >= 75 ? "可安全清洗" : score >= 55 ? "需要批量整理" : "建议先做保护点";
  const safeActions = actions.filter((action) => action.safe);
  return {
    score,
    tone,
    title,
    summary: issues.length ? `发现 ${issues.length} 类数据质量问题，可先执行 ${safeActions.length} 个安全修复动作。` : "没有发现需要批量处理的数据质量问题。",
    issues: issues.sort((a, b) => ({ critical: 3, warning: 2, info: 1 }[b.level] || 0) - ({ critical: 3, warning: 2, info: 1 }[a.level] || 0)).slice(0, 6),
    actions,
    metrics: {
      activeCount: realActive.length,
      duplicateGroups: duplicateGroups.length,
      duplicateItems: duplicateItems.length,
      orphanProjectRefs: orphaned.reduce((sum, bookmark) => sum + (bookmark.projectIds || []).filter((id) => !projectIds.has(id)).length, 0),
      missingContext: missingContext.length,
      weakMetadata: weakMetadata.length,
      dormant: dormant.length,
      safeActionCount: safeActions.length,
      manualActionCount: actions.filter((action) => !action.safe).length,
      autoFixItemCount: safeActions.reduce((sum, action) => sum + (action.itemIds?.length || 0), 0),
    },
  };
}

function contextCompleteness(bookmark) {
  const fields = [bookmark.summary, bookmark.rawText, bookmark.notes, bookmark.whySaved, bookmark.whyValuable, bookmark.nextAction];
  const filled = fields.filter((value) => String(value || "").trim().length >= 12).length;
  return Math.min(100, Math.round((filled / 4) * 100) + Math.min(24, (bookmark.tags?.length || 0) * 4));
}

function actionPriorityItem(bookmark, projects, current) {
  const activeProjectIds = new Set(projects.filter((project) => project.status !== "completed").map((project) => project.id));
  const linkedProjects = (bookmark.projectIds || []).filter((id) => activeProjectIds.has(id));
  const access = classifyUrlAccess(bookmark.url);
  const context = contextCompleteness(bookmark);
  const hasContext = context >= 35;
  const touchedAt = bookmark.lastViewedAt || bookmark.lastRecommendedAt || bookmark.createdAt;
  const daysSinceTouch = daysBetween(touchedAt, current);
  const ageDays = daysBetween(bookmark.createdAt, current);
  const hasNextAction = String(bookmark.nextAction || "").trim().length >= 4;
  const reasons = [];
  let score = 0;

  const statusWeights = { to_action: 32, in_use: 30, to_read: 23, inbox: 15, reference: 12 };
  score += statusWeights[bookmark.status] || 0;
  if (bookmark.importance === "high") { score += 18; reasons.push("高重要度"); }
  else if (bookmark.importance === "medium") score += 8;
  if (hasNextAction) { score += 18; reasons.push("已有下一步"); }
  if (linkedProjects.length) { score += 14; reasons.push("已关联项目"); }
  if (access.restricted && !hasContext) { score += 24; reasons.push("需补上下文"); }
  if (!linkedProjects.length && ["to_action", "in_use"].includes(bookmark.status)) { score += 8; reasons.push("行动缺项目承接"); }
  if (!bookmark.lastViewedAt && ageDays >= 7) { score += 10; reasons.push("旧收藏未打开"); }
  if (daysSinceTouch > 21) { score += Math.min(20, 8 + Math.floor(daysSinceTouch / 10)); reasons.push("沉睡待唤醒"); }
  if (bookmark.recommendationCount > 0 && bookmark.status !== "used") { score += Math.min(12, bookmark.recommendationCount * 3); reasons.push("回顾过但未闭环"); }
  if (bookmark.skipCount) score -= Math.min(16, bookmark.skipCount * 5);
  if (bookmark.nextReviewAt && new Date(bookmark.nextReviewAt) > current) score -= 80;

  const qualityScore = Math.max(0, Math.min(100, Math.round(context * 0.45 + (linkedProjects.length ? 22 : 0) + (hasNextAction ? 20 : 0) + (bookmark.summary ? 13 : 0))));
  let lane = "重新唤醒";
  let primaryAction = "放入今日回顾";
  if (access.restricted && !hasContext) { lane = "补上下文"; primaryAction = "补充摘录或截图"; }
  else if (hasNextAction || ["to_action", "in_use"].includes(bookmark.status)) { lane = "立即推进"; primaryAction = bookmark.nextAction || "推进下一步"; }
  else if (linkedProjects.length) { lane = "推进项目"; primaryAction = "回到项目里使用"; }
  else if (isWeakBookmarkTitle(bookmark) || qualityScore < 35) { lane = "补元数据"; primaryAction = "补标题和保存原因"; }

  if (!reasons.length) reasons.push("值得再次遇见");
  return {
    id: bookmark.id,
    title: bookmark.title,
    source: bookmark.source || bookmarkHostLabel(bookmark),
    status: bookmark.status,
    score: Math.max(0, Math.min(100, Math.round(score))),
    qualityScore,
    tone: score >= 72 ? "hot" : score >= 52 ? "warm" : "cool",
    lane,
    primaryAction,
    reasons: reasons.slice(0, 4),
    whyNow: reasons.slice(0, 2).join(" · "),
    age: formatRelativeDate(touchedAt, current),
    projectIds: linkedProjects,
  };
}

export function getActionPriorityReport(state = {}, { now = new Date(), limit = 8 } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const bookmarks = Array.isArray(state.bookmarks) ? state.bookmarks : [];
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const candidates = bookmarks
    .filter((bookmark) => !bookmark.isDemo && ACTIVE_STATUSES.has(bookmark.status))
    .map((bookmark) => actionPriorityItem(bookmark, projects, current))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.qualityScore - b.qualityScore)
    .slice(0, Math.max(1, limit));
  const laneCounts = candidates.reduce((acc, item) => ({ ...acc, [item.lane]: (acc[item.lane] || 0) + 1 }), {});
  const hotCount = candidates.filter((item) => item.tone === "hot").length;
  const averageQuality = candidates.length ? Math.round(candidates.reduce((sum, item) => sum + item.qualityScore, 0) / candidates.length) : 100;
  const top = candidates[0];
  return {
    title: top ? "今天有明确推进对象" : "今天没有强优先级条目",
    summary: top ? `最优先处理「${top.title}」：${top.whyNow || top.primaryAction}。` : "当前收藏库没有需要立即推进的真实条目，可以先导入或补充新收藏。",
    items: candidates,
    recommendedIds: candidates.slice(0, 3).map((item) => item.id),
    nextFocus: top?.primaryAction || "导入几条真实收藏",
    metrics: { candidateCount: candidates.length, hotCount, averageQuality, laneCounts },
  };
}

function daysBetween(iso, today) {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.max(0, (today.getTime() - new Date(iso).getTime()) / 86_400_000);
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stablePick(items, dateKey) {
  return [...items].sort((a, b) => hashString(`${dateKey}:${a.id}`) - hashString(`${dateKey}:${b.id}`))[0];
}

export function getDailyReview(bookmarks, projects, options = {}) {
  const today = options.today ? new Date(options.today) : new Date();
  const dateKey = getDateKey(today, options.timeZone);
  const limit = Math.max(1, Math.min(5, options.limit || 5));
  const currentProjectIds = new Set(projects.filter((project) => project.status === "active").map((project) => project.id));
  const candidates = bookmarks.filter((bookmark) => ACTIVE_STATUSES.has(bookmark.status))
    .filter((bookmark) => !bookmark.nextReviewAt || new Date(bookmark.nextReviewAt) <= today);
  const selected = [];
  const selectedIds = new Set();

  const add = (pool, reason) => {
    const eligible = pool.filter((item) => !selectedIds.has(item.id));
    if (!eligible.length || selected.length >= limit) return;
    const bookmark = stablePick(eligible, `${dateKey}:${reason}`);
    selected.push({ bookmark, reason });
    selectedIds.add(bookmark.id);
  };

  add(candidates.filter((bookmark) => bookmark.projectIds.some((id) => currentProjectIds.has(id))), "推进当前项目");
  add(candidates.filter((bookmark) => !bookmark.lastViewedAt && daysBetween(bookmark.createdAt, today) >= 7), "一条未打开的旧收藏");
  add(candidates.filter((bookmark) => ["to_read", "to_action"].includes(bookmark.status)), "等待你处理");
  add(candidates.filter((bookmark) => bookmark.status === "reference"), "重新连接长期参考");
  add(candidates.filter((bookmark) => bookmark.status === "inbox" && daysBetween(bookmark.createdAt, today) <= 14), "最近收藏，尚未整理");

  const remainder = candidates
    .filter((bookmark) => !selectedIds.has(bookmark.id))
    .sort((a, b) => {
      const aScore = daysBetween(a.lastRecommendedAt || a.createdAt, today) - a.skipCount * 7;
      const bScore = daysBetween(b.lastRecommendedAt || b.createdAt, today) - b.skipCount * 7;
      return bScore - aScore;
    });

  for (const bookmark of remainder) {
    if (selected.length >= limit) break;
    selected.push({ bookmark, reason: "值得再次遇见" });
  }
  return selected;
}

export function getDashboardStats(bookmarks) {
  const active = bookmarks.filter((bookmark) => bookmark.status !== "archived");
  const used = bookmarks.filter((bookmark) => bookmark.status === "used");
  const reviewed = bookmarks.filter((bookmark) => bookmark.recommendationCount > 0);
  const activatedFromReview = reviewed.filter((bookmark) => bookmark.status === "used").length;
  return {
    total: active.length,
    inbox: active.filter((bookmark) => bookmark.status === "inbox").length,
    used: used.length,
    activated: reviewed.length ? Math.round((activatedFromReview / reviewed.length) * 100) : 0,
  };
}

export function getCollectionInsights({ bookmarks = [], reviewEvents = [], now = new Date(), timeZone = "Asia/Shanghai" } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const active = bookmarks.filter((bookmark) => bookmark.status !== "archived");
  const realActive = active.filter((bookmark) => !bookmark.isDemo);
  const restrictedNeedContext = realActive.filter((bookmark) => {
    const access = classifyUrlAccess(bookmark.url);
    const hasContext = [bookmark.rawText, bookmark.summary, bookmark.notes, bookmark.whySaved].some((value) => String(value || "").trim().length >= 12);
    return access.restricted && !hasContext;
  });
  const sourceCounts = new Map();
  for (const bookmark of realActive) sourceCounts.set(bookmark.source || "未知来源", (sourceCounts.get(bookmark.source || "未知来源") || 0) + 1);
  const sourceBreakdown = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([source, count]) => ({ source, count }));
  const events = reviewEvents.filter((event) => {
    const occurred = new Date(event.occurredAt);
    return occurred <= current && occurred >= new Date(current.getTime() - 13 * 86_400_000);
  });
  const dailyActivity = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(current.getTime() - (13 - index) * 86_400_000);
    const key = getDateKey(date, timeZone);
    const count = events.filter((event) => getDateKey(new Date(event.occurredAt), timeZone) === key && event.eventType !== "surfaced").length;
    return { key, count };
  });
  const projectCoverage = active.length ? Math.round((active.filter((bookmark) => bookmark.projectIds?.length).length / active.length) * 100) : 0;
  const dormant = active.filter((bookmark) => {
    const touchedAt = bookmark.lastViewedAt || bookmark.lastRecommendedAt || bookmark.createdAt;
    return current - new Date(touchedAt) > 21 * 86_400_000;
  }).length;
  const nextActions = [];
  if (restrictedNeedContext.length) nextActions.push(`补充 ${restrictedNeedContext.length} 条受限平台上下文`);
  if (projectCoverage < 50 && active.length) nextActions.push("把高价值收藏挂到项目");
  if (dormant) nextActions.push(`唤醒 ${dormant} 条沉睡收藏`);
  if (!nextActions.length) nextActions.push("继续记录已用上的结果");
  return {
    restrictedNeedContextCount: restrictedNeedContext.length,
    restrictedNeedContext: restrictedNeedContext.slice(0, 3),
    sourceBreakdown,
    dailyActivity,
    projectCoverage,
    dormantCount: dormant,
    nextActions: nextActions.slice(0, 3),
  };
}

export function formatRelativeDate(iso, now = new Date()) {
  if (!iso) return "从未";
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}
