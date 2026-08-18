import {
  BOOKMARK_STATUSES,
  STATUS_MAP,
  filterBookmarks,
  formatRelativeDate,
  getDateKey,
  classifyUrlAccess,
  getDashboardStats,
  getCollectionInsights,
  getReviewCompletionState,
  getValidationMetrics,
  applySyncItemsToState,
  getSyncHealthReport,
  getWeeklyActivationMetrics,
  getDataCleaningReport,
  getActionPriorityReport,
  linkSupplementMessage,
  parseBatchInput,
  parseCaptureInput,
} from "./domain.js";
import { createStore } from "./store.js";

let auth = null;
let sdkReady = false;

async function loadEazoSdk() {
  if (sdkReady) return true;
  if (!navigator.onLine) return false;
  try {
    const [{ auth: sdkAuth }, { setAppId }] = await Promise.all([
      import("https://esm.sh/@eazo/sdk@0.22.5"),
      import("https://esm.sh/@eazo/sdk@0.22.5/dist/internal/config"),
    ]);
    setAppId("i95j2XGyQCWmR14J");
    auth = sdkAuth;
    sdkReady = true;
    return true;
  } catch {
    return false;
  }
}

const store = createStore();
const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
let lastCloudSyncHash = "";
let cloudSyncTimer = null;

const MAX_SCREENSHOT_BYTES = 4_500_000;
const CONTENT_TYPE_LABELS = {
  article: "文章",
  video: "视频",
  social: "社交内容",
  tool: "工具",
  product: "产品",
  note: "文字笔记",
  other: "其他",
};

const ui = {
  query: "",
  status: "",
  smartFilter: "",
  modal: null,
  sidebarOpen: false,
  drag: null,
  suppressClickUntil: 0,
  aiBusyIds: new Set(),
  aiQueue: [],
  aiQueueRunning: false,
  screenshotExtracting: false,
  screenshotDraft: null,
  user: null,
  authLoading: true,
  cloudMode: false,
  cloudSyncing: false,
  cloudDirty: false,
  cloudError: "",
  cloudConflict: null,
  cloudLastSyncedAt: "",
  cloudRemoteUpdatedAt: "",
  cloudLastPulledAt: "",
  itemSyncing: false,
  itemSyncError: "",
  itemSyncLastSyncedAt: "",
  itemSyncLastPulledAt: "",
  itemSyncSummary: null,
  itemMergeStats: null,
  itemMergePreview: null,
  networkOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  pwaReady: false,
  pwaInstalling: false,
  installPrompt: null,
  authEmail: "",
  authCodeSent: false,
};

const icons = {
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3L12 3Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14Z"/><path d="m19 13-.8 2.2-2.2.8 2.2.8L19 19l.8-2.2L22 16l-2.2-.8L19 13Z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 5h16v15H4z"/><path d="M8 5V3h8v2M8 9h8"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h7l2 2h9v11H3z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m4 16-.7 4.7L8 20l11-11-4-4L4 16Z"/><path d="m13 7 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m5 12 4 4L19 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12m-4-4 4 4 4-4M4 20h16"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function hasSupplementContext(bookmark) {
  return [bookmark.rawText, bookmark.summary, bookmark.notes, bookmark.whySaved].some((value) => String(value || "").trim().length >= 12);
}

function shouldDeferAiForSupplement(bookmark) {
  const access = classifyUrlAccess(bookmark.url);
  return Boolean(bookmark.url && access.restricted && !hasSupplementContext(bookmark));
}

function needsActionNow(bookmark) {
  return bookmark.status !== "archived" && (["inbox", "to_action", "in_use"].includes(bookmark.status) || Boolean(bookmark.nextAction?.trim()));
}

function isDormantBookmark(bookmark) {
  const touchedAt = bookmark.lastViewedAt || bookmark.lastRecommendedAt || bookmark.createdAt;
  return Date.now() - new Date(touchedAt).getTime() > 21 * 86_400_000;
}

function applySmartFilter(bookmarks, filter) {
  if (filter === "needs-context") return bookmarks.filter(shouldDeferAiForSupplement);
  if (filter === "no-project") return bookmarks.filter((bookmark) => bookmark.status !== "archived" && !bookmark.projectIds.length);
  if (filter === "action-now") return bookmarks.filter(needsActionNow);
  if (filter === "dormant") return bookmarks.filter(isDormantBookmark);
  return bookmarks;
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [page = "inbox", id] = hash.split("/");
  return { page, id };
}

function navigate(path) {
  ui.sidebarOpen = false;
  location.hash = `#/${path}`;
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.innerHTML = `${icons.check}<span>${escapeHtml(message)}</span>`;
  toastRegion.append(element);
  setTimeout(() => element.remove(), 2600);
}

function statusOptions(selected) {
  return BOOKMARK_STATUSES.map((status) => `<option value="${status.value}" ${status.value === selected ? "selected" : ""}>${status.label}</option>`).join("");
}

function contentTypeLabel(value) {
  return CONTENT_TYPE_LABELS[value] || "未判断";
}

function currentNav(page, id, target, targetId) {
  return page === target && (!targetId || id === targetId) ? "active" : "";
}

function sidebarTemplate(state, current) {
  const inboxCount = state.bookmarks.filter((item) => item.status === "inbox").length;
  const activeCount = state.bookmarks.filter((item) => item.status !== "archived").length;
  return `
    ${ui.sidebarOpen ? '<div class="sidebar-scrim" data-action="close-sidebar"></div>' : ""}
    <aside class="sidebar ${ui.sidebarOpen ? "open" : ""}" aria-label="主导航">
      <a class="brand" href="#/inbox">
        <span class="brand-mark">${icons.sparkles}</span>
        <span>Sparkbox</span>
      </a>
      <nav>
        <div class="nav-section">
          <p class="nav-label">收藏</p>
          <a class="nav-link ${currentNav(current.page, current.id, "inbox")}" href="#/inbox">${icons.inbox}<span>收件箱</span><span class="nav-count">${inboxCount}</span></a>
          <a class="nav-link ${currentNav(current.page, current.id, "bookmarks")}" href="#/bookmarks">${icons.library}<span>全部收藏</span><span class="nav-count">${activeCount}</span></a>
          <a class="nav-link ${currentNav(current.page, current.id, "review")}" href="#/review">${icons.sun}<span>今日回顾</span></a>
          <a class="nav-link ${currentNav(current.page, current.id, "validation")}" href="#/validation">${icons.target}<span>14 天验证</span></a>
        </div>
        <div class="nav-section">
          <p class="nav-label">项目</p>
          <a class="nav-link ${currentNav(current.page, current.id, "projects") && !current.id ? "active" : ""}" href="#/projects">${icons.folder}<span>全部项目</span><span class="nav-count">${state.projects.length}</span></a>
          ${state.projects.filter((project) => project.status !== "completed").slice(0, 5).map((project) => `
            <a class="nav-link ${currentNav(current.page, current.id, "projects", project.id)}" href="#/projects/${project.id}">
              <span class="project-dot" style="background:${escapeHtml(project.color)}"></span>
              <span>${escapeHtml(project.name)}</span>
            </a>`).join("")}
        </div>
      </nav>
      <div class="sidebar-spacer"></div>
      <button class="nav-link btn-quiet" data-action="settings">${icons.settings}<span>数据与设置</span></button>
      <div class="storage-note">${icons.shield}<span>数据仅保存在<br/>当前浏览器</span></div>
    </aside>`;
}

function mobileNavTemplate(current) {
  return `<nav class="mobile-bar" aria-label="移动端导航">
    <a class="${current.page === "review" ? "active" : ""}" href="#/review">${icons.sun}<span>今日</span></a>
    <a class="${current.page === "inbox" ? "active" : ""}" href="#/inbox">${icons.inbox}<span>收件箱</span></a>
    <a class="${current.page === "bookmarks" || current.page === "bookmark" ? "active" : ""}" href="#/bookmarks">${icons.library}<span>资料库</span></a>
    <a class="${current.page === "projects" ? "active" : ""}" href="#/projects">${icons.folder}<span>项目</span></a>
  </nav>`;
}

function formatDateTime(value) {
  if (!value) return "从未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
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

function buildSyncItems(state) {
  const items = [];
  const push = (entityType, entityId, payload, clientUpdatedAt, deleted = false) => {
    const stablePayload = stableStringify(deleted ? { deleted: true, entityType, entityId } : payload);
    items.push({ entityType, entityId, payload: deleted ? null : payload, versionHash: hashText(stablePayload), clientUpdatedAt: clientUpdatedAt || new Date().toISOString(), deleted });
  };
  for (const bookmark of state.bookmarks) push("bookmark", bookmark.id, bookmark, bookmark.updatedAt || bookmark.createdAt);
  for (const project of state.projects) push("project", project.id, project, project.updatedAt || project.createdAt);
  push("preference", "main", state.preferences, state.preferences.validationStartedAt || state.bookmarks[0]?.updatedAt || new Date().toISOString());
  for (const event of state.reviewEvents || []) push("review_event", event.id || `${event.itemId}-${event.occurredAt}-${event.eventType}`, event, event.occurredAt);
  for (const [date, log] of Object.entries(state.reviewLog || {})) push("review_log", date, { date, log }, date);
  for (const [date, selection] of Object.entries(state.reviewSelections || {})) push("review_selection", date, { date, selection }, date);
  for (const tombstone of state.syncTombstones || []) push(tombstone.entityType, tombstone.entityId, null, tombstone.deletedAt, true);
  return items;
}

function localSyncSummary(state) {
  const items = buildSyncItems(state);
  return {
    totalCount: items.length,
    bookmarkCount: state.bookmarks.length,
    projectCount: state.projects.length,
    reviewEventCount: (state.reviewEvents || []).length,
    deletedCount: (state.syncTombstones || []).length,
    latestUpdatedAt: items.map((item) => item.clientUpdatedAt).filter(Boolean).sort().at(-1) || null,
  };
}

function describeMergeStats(stats) {
  if (!stats) return "尚未拉取对象级变更";
  const changed = (stats.created || 0) + (stats.updated || 0) + (stats.deleted || 0);
  if (!stats.incoming) return "云端暂无对象级变更";
  if (!changed && !stats.conflicts) return `已检查 ${stats.incoming} 个对象，没有需要合并的远端更改`;
  return `新增 ${stats.created || 0} · 更新 ${stats.updated || 0} · 删除 ${stats.deleted || 0} · 冲突 ${stats.conflicts || 0}`;
}

function auditSync(type, status, title, detail = "", metrics = {}) {
  store.addSyncAuditEvent?.({ type, status, title, detail, metrics });
}

function auditTypeLabel(type) {
  return ({ cloud_upload: "整库上传", cloud_pull: "整库拉取", object_push: "对象上传", object_pull: "对象拉取", object_merge: "对象合并", conflict: "冲突", offline: "离线", auth: "登录", network: "网络", recovery: "恢复" })[type] || "同步";
}

function auditTimelineTemplate() {
  const events = store.getSyncAudit?.() || [];
  const summary = store.getSyncAuditSummary?.() || { total: 0, errors: 0, warnings: 0, latestAt: null };
  const latest = events.slice(0, 8);
  return `<div class="sync-audit-panel">
    <div class="sync-audit-head"><div><strong>同步审计时间线</strong><span>${summary.total ? `最近 ${summary.total} 条 · ${summary.errors} 个失败 · ${summary.warnings} 个警告` : "开始记录同步链路事件"}</span></div>${summary.total ? `<button type="button" class="btn btn-small btn-quiet" data-action="clear-sync-audit">清空记录</button>` : ""}</div>
    ${latest.length ? `<ol class="sync-audit-list">${latest.map((event) => `<li class="audit-${event.status}"><span class="audit-dot"></span><div><div class="audit-row"><strong>${escapeHtml(event.title)}</strong><em>${escapeHtml(auditTypeLabel(event.type))} · ${formatDateTime(event.at)}</em></div>${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="sync-note">还没有同步审计记录。下一次登录、上传、拉取、合并或离线恢复都会写入这里。</p>`}
  </div>`;
}

function currentSyncHealthReport(state, localSummary, remoteSummary) {
  return getSyncHealthReport({
    state,
    localSummary,
    remoteSummary,
    auditEvents: store.getSyncAudit?.() || [],
    networkOnline: ui.networkOnline,
    signedIn: Boolean(ui.user),
    cloudDirty: ui.cloudDirty,
    cloudConflict: ui.cloudConflict,
    cloudError: ui.cloudError,
    itemSyncError: ui.itemSyncError,
    itemMergeStats: ui.itemMergeStats || ui.itemMergePreview,
    pwaReady: ui.pwaReady,
  });
}

function syncHealthTemplate(report) {
  const issueList = report.issues.length
    ? report.issues.map((issue) => `<li class="health-${issue.level}"><strong>${escapeHtml(issue.title)}</strong><p>${escapeHtml(issue.detail)}</p><small>建议：${escapeHtml(issue.action)}</small></li>`).join("")
    : `<li class="health-info"><strong>未发现明显风险</strong><p>本机、对象账本和最近审计记录处于稳定状态。</p><small>建议：继续自动同步</small></li>`;
  return `<div class="sync-health-card health-${report.tone}">
    <div class="sync-health-score"><div><strong>${report.score}</strong><span>/100</span></div><p>${escapeHtml(report.title)}</p></div>
    <div class="sync-health-body"><div class="sync-audit-head"><div><strong>同步健康自检</strong><span>主建议：${escapeHtml(report.primaryAction)}</span></div><button type="button" class="btn btn-small" data-action="repair-sync-health">一键自检修复</button></div><ul class="sync-health-list">${issueList}</ul></div>
  </div>`;
}

function cloudStatus() {
  if (!ui.networkOnline) return { label: "离线可用", tone: "offline", detail: "本机数据可继续使用，联网后再同步" };
  if (ui.authLoading) return { label: "同步检查中", tone: "checking", detail: "正在确认 Eazo 登录状态" };
  if (!ui.user) return { label: "本地模式", tone: "local", detail: "登录后可跨设备同步" };
  if (ui.cloudConflict) return { label: "发现多端冲突", tone: "error", detail: "云端已有其他设备的新版本" };
  if (ui.cloudError) return { label: "同步异常", tone: "error", detail: ui.cloudError };
  if (ui.itemSyncError) return { label: "对象账本异常", tone: "error", detail: ui.itemSyncError };
  if (ui.cloudSyncing || ui.itemSyncing) return { label: "同步中", tone: "syncing", detail: "正在保存或读取云端数据" };
  if (ui.cloudDirty) return { label: "有未同步更改", tone: "dirty", detail: `上次同步：${formatDateTime(ui.cloudLastSyncedAt)}` };
  if (ui.cloudMode) return { label: "云端已同步", tone: "online", detail: `上次同步：${formatDateTime(ui.cloudLastSyncedAt || ui.cloudLastPulledAt)}` };
  return { label: "已登录", tone: "signed", detail: "等待首次同步" };
}

function topbarTemplate() {
  const status = cloudStatus();
  const cloudText = `${status.label}${ui.user ? ` · ${escapeHtml(ui.user.name || ui.user.email || "Eazo 用户")}` : ""}`;
  return `
    <header class="topbar">
      <button class="btn icon-btn btn-quiet mobile-only" data-action="open-sidebar" aria-label="打开菜单">${icons.menu}</button>
      <label class="search-wrap">
        <span class="screen-reader">搜索收藏</span>
        ${icons.search}
        <input id="global-search" class="search-input" type="search" value="${escapeHtml(ui.query)}" placeholder="搜索标题、标签、来源…" autocomplete="off" />
        ${ui.query ? `<button class="search-clear" type="button" data-action="clear-search" aria-label="清除搜索">${icons.close}</button>` : '<span class="kbd" style="position:absolute;right:13px;top:13px">/</span>'}
      </label>
      <div class="topbar-actions">
        <button class="btn btn-small cloud-chip cloud-${status.tone}" data-action="open-sync" title="${escapeHtml(status.detail)}">${icons.shield}<span>${cloudText}</span></button>
        <button class="btn btn-small pwa-chip ${ui.pwaReady ? "pwa-ready" : ""}" data-action="install-pwa" title="${ui.pwaReady ? "核心页面已可离线打开" : "安装到主屏并缓存核心页面"}">${icons.download}<span>${ui.pwaReady ? "离线已就绪" : "安装"}</span></button>
        <button class="btn btn-primary" data-action="new-bookmark">${icons.plus}<span>添加收藏</span></button>
      </div>
    </header>`;
}

function storageRecoveryTemplate() {
  const { recoveryRaw } = store.getStorageStatus();
  if (!recoveryRaw) return "";
  return `<section class="storage-warning" role="status"><span>${icons.shield}</span><div><strong>检测到一份无法读取的旧数据</strong><p>系统已保留原始内容。请先下载恢复文件，再决定继续使用示例数据或恢复一份正常备份。</p></div><button class="btn btn-small" data-action="export-recovery">下载原始数据</button></section>`;
}

function bookmarkCard(bookmark, state) {
  const projects = state.projects.filter((project) => bookmark.projectIds.includes(project.id));
  const href = safeUrl(bookmark.url);
  const access = classifyUrlAccess(bookmark.url);
  const needsSupplement = !hasSupplementContext(bookmark) && (Boolean(bookmark.processingError) || access.restricted);
  const aiActionLabel = bookmark.processingStatus === "failed" ? "重试 AI 整理" : bookmark.processingStatus === "queued" ? "等待 AI 自动整理" : bookmark.processingStatus === "processing" ? "AI 整理中" : "AI 整理收藏";
  return `
    <article class="bookmark-card" data-bookmark-id="${bookmark.id}">
      <div class="bookmark-main">
        <div class="bookmark-topline"><span class="source-favicon">${escapeHtml(bookmark.source.slice(0, 1).toUpperCase())}</span><span class="source-name">${escapeHtml(bookmark.source)}</span>${bookmark.processingStatus === "queued" ? '<span class="processing-note ai-note">等待 AI</span>' : bookmark.processingStatus === "processing" ? '<span class="processing-note ai-note">AI 整理中</span>' : bookmark.processingStatus === "failed" ? '<span class="processing-note ai-failed">可重试整理</span>' : needsSupplement ? '<span class="processing-note">需补充上下文</span>' : bookmark.whyValuable || bookmark.nextAction ? '<span class="processing-note ai-ready">AI 已整理</span>' : ""}</div>
        <h3 class="bookmark-title" tabindex="0" data-action="open-detail" data-id="${bookmark.id}">${escapeHtml(bookmark.title)}</h3>
        ${href ? `<a class="external-icon" href="${escapeHtml(href)}" target="_blank" rel="noopener" aria-label="打开原链接">${icons.external}</a>` : ""}
        ${bookmark.summary ? `<p class="bookmark-summary">${escapeHtml(bookmark.summary)}</p>` : needsSupplement ? `<p class="bookmark-summary supplement-copy">${escapeHtml(access.restricted ? `${access.label} 可能需要登录或 App 环境。建议补充摘录/备注后再整理。` : "如果原网页需要登录或动态加载，请补充摘录/备注后再整理。")}</p>` : ""}
        <div class="bookmark-meta">
          ${bookmark.tags.slice(0, 3).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}
          ${projects.slice(0, 2).map((project) => `<a class="project-pill" href="#/projects/${project.id}"><span class="mini-dot" style="background:${escapeHtml(project.color)}"></span>${escapeHtml(project.name)}</a>`).join("")}
          ${(bookmark.tags.length || projects.length) ? '<span class="meta-divider"></span>' : ""}
          <span>保存于 ${formatRelativeDate(bookmark.createdAt)}</span>
        </div>
      </div>
      <div class="bookmark-side">
        <select class="status-select status-${bookmark.status}" data-action="change-status" data-id="${bookmark.id}" aria-label="修改状态">${statusOptions(bookmark.status)}</select>
        <div class="card-actions">
          <button class="card-action ai-action ${bookmark.processingStatus === "failed" ? "ai-retry" : ""}" data-action="ai-organize" data-id="${bookmark.id}" aria-label="${aiActionLabel}" title="${aiActionLabel}" ${ui.aiBusyIds.has(bookmark.id) || bookmark.processingStatus === "queued" ? "disabled" : ""}>${ui.aiBusyIds.has(bookmark.id) || bookmark.processingStatus === "queued" ? icons.clock : icons.sparkles}</button>
          <button class="card-action" data-action="edit-bookmark" data-id="${bookmark.id}" aria-label="编辑收藏">${icons.edit}</button>
          <button class="card-action" data-action="archive-bookmark" data-id="${bookmark.id}" aria-label="归档收藏">${icons.archive}</button>
        </div>
      </div>
    </article>`;
}

function emptyState(title, text, action = true) {
  return `<div class="empty-state"><div><span class="empty-icon">${icons.bookmark}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action ? `<button class="btn btn-primary" data-action="new-bookmark">${icons.plus} 添加第一条收藏</button>` : ""}</div></div>`;
}

function listTemplate(bookmarks, state, emptyTitle = "这里还没有收藏", emptyText = "把最近真正感兴趣的内容放进来，让它在合适的时候再次出现。") {
  if (!bookmarks.length) return emptyState(emptyTitle, emptyText, !ui.query);
  return `<div class="bookmark-list">${bookmarks.map((bookmark) => bookmarkCard(bookmark, state)).join("")}</div>`;
}

function pinboardTargetsTemplate(state) {
  const activeProjects = state.projects.filter((project) => project.status !== "completed").slice(0, 4);
  return `<section class="pinboard-targets" aria-label="拖拽整理区">
    <div class="drop-zone review-drop" data-drop-type="review"><strong>${icons.sun} 今日回顾</strong><span>长按收藏拖到这里，固定到今天</span></div>
    <div class="drop-zone inbox-drop" data-drop-type="status" data-status="inbox"><strong>${icons.inbox} 收件箱</strong><span>放回待整理</span></div>
    ${activeProjects.map((project) => `<div class="drop-zone project-drop" data-drop-type="project" data-project-id="${project.id}"><strong><span class="mini-dot" style="background:${escapeHtml(project.color)}"></span>${escapeHtml(project.name)}</strong><span>吸附到项目</span></div>`).join("")}
  </section>`;
}

function starterGuideTemplate(state) {
  const realCount = state.bookmarks.filter((bookmark) => !bookmark.isDemo).length;
  const needsContext = state.bookmarks.filter(shouldDeferAiForSupplement).length;
  return `<section class="starter-guide" aria-label="新用户启动流程">
    <div class="starter-copy"><span class="starter-kicker">3 分钟启动</span><h2>先跑通一条真实收藏</h2><p>不用一次整理完所有历史收藏。先导入几条、补充一条上下文，再让 AI 保守整理并进入今日回顾。</p></div>
    <div class="starter-steps">
      <button type="button" class="starter-step" data-action="batch-import"><span>1</span><strong>导入 3–5 条</strong><small>${realCount ? `已导入 ${realCount} 条真实收藏` : "粘贴链接、文字或平台收藏清单"}</small></button>
      <button type="button" class="starter-step" data-action="new-bookmark"><span>2</span><strong>补充上下文</strong><small>${needsContext ? `${needsContext} 条需要摘录、备注或截图` : "遇到登录墙就上传截图或粘贴摘录"}</small></button>
      <a class="starter-step" href="#/review"><span>3</span><strong>进入今日回顾</strong><small>每天挑少量旧收藏推进成行动</small></a>
    </div>
  </section>`;
}

function weeklyFeedbackTemplate(state) {
  const metrics = getWeeklyActivationMetrics({ bookmarks: state.bookmarks, reviewEvents: state.reviewEvents, timeZone: state.preferences.timeZone || "Asia/Shanghai" });
  const outcomeList = metrics.recentOutcomes.length
    ? metrics.recentOutcomes.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.note)}</span></li>`).join("")
    : `<li><strong>还没有成果记录</strong><span>标记“已使用”时写下它实际帮你完成了什么。</span></li>`;
  const revivedText = metrics.revivedTitles.length ? metrics.revivedTitles.join("、") : "本周还没有复活 7 天前的旧收藏";
  return `<section class="weekly-feedback" aria-label="本周激活反馈">
    <div class="weekly-head"><div><span class="starter-kicker">Weekly loop</span><h2>本周收藏复活反馈</h2><p>${escapeHtml(metrics.recommendation)}</p></div><a class="btn btn-small" href="#/review">继续回顾</a></div>
    <div class="weekly-metrics">
      <div><span>${icons.bookmark} 新增</span><strong>${metrics.savedCount}</strong><small>真实收藏</small></div>
      <div><span>${icons.sun} 处理</span><strong>${metrics.handledCount}</strong><small>今日卡片</small></div>
      <div><span>${icons.check} 激活</span><strong>${metrics.activatedCount}</strong><small>${metrics.activationRate}% 转化</small></div>
      <div><span>${icons.activity} 旧收藏</span><strong>${metrics.oldActivatedCount}</strong><small>复活</small></div>
    </div>
    <div class="weekly-detail"><div><h3>最近成果</h3><ul>${outcomeList}</ul></div><div><h3>旧收藏复活</h3><p>${escapeHtml(revivedText)}</p><small>${metrics.activeDays} 天发生过回顾 · ${metrics.outcomeCount} 条有成果记录</small></div></div>
  </section>`;
}

function actionPriorityTemplate(state, { compact = false } = {}) {
  const report = store.getActionPriorityReport?.() || getActionPriorityReport(state);
  const topItems = report.items.slice(0, compact ? 3 : 5);
  const itemList = topItems.length
    ? topItems.map((item, index) => `<article class="priority-item priority-${item.tone}">
      <div class="priority-rank">${index + 1}</div><div><div class="priority-title-row"><strong>${escapeHtml(item.title)}</strong><span>${item.score}</span></div><p>${escapeHtml(item.primaryAction)}</p><div class="priority-tags"><span>${escapeHtml(item.lane)}</span><span>质量 ${item.qualityScore}</span><span>${escapeHtml(item.age)}</span>${item.reasons.slice(0, 2).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div></div><button type="button" class="btn btn-small" data-action="promote-one-priority" data-id="${item.id}">推进</button>
    </article>`).join("")
    : `<article class="priority-item empty"><div class="priority-rank">✓</div><div><strong>没有强优先级条目</strong><p>先导入真实收藏，或补充已有条目的摘要、项目和下一步。</p></div></article>`;
  return `<section class="priority-panel" aria-label="行动优先级队列">
    <div class="priority-head"><div><span class="starter-kicker">Action queue</span><h2>今天最值得处理的收藏</h2><p>${escapeHtml(report.summary)}</p></div><div class="priority-focus"><strong>${report.metrics.hotCount}</strong><span>高优先</span><small>平均质量 ${report.metrics.averageQuality}</small></div></div>
    <div class="priority-actions"><button type="button" class="btn btn-primary" data-action="promote-priority-queue" ${report.recommendedIds.length ? "" : "disabled"}>一键加入今日回顾</button><span>${report.metrics.candidateCount} 条候选 · 下一步：${escapeHtml(report.nextFocus)}</span></div>
    <div class="priority-list">${itemList}</div>
  </section>`;
}

function insightDashboardTemplate(state) {
  const insights = getCollectionInsights({ bookmarks: state.bookmarks, reviewEvents: state.reviewEvents, timeZone: state.preferences.timeZone || "Asia/Shanghai" });
  const maxDay = Math.max(1, ...insights.dailyActivity.map((day) => day.count));
  const sourceItems = insights.sourceBreakdown.length
    ? insights.sourceBreakdown.map((item) => `<li><span>${escapeHtml(item.source)}</span><b>${item.count}</b></li>`).join("")
    : `<li><span>暂无真实来源</span><b>0</b></li>`;
  const contextItems = insights.restrictedNeedContext.length
    ? insights.restrictedNeedContext.map((bookmark) => `<li><button type="button" data-action="edit-bookmark" data-id="${bookmark.id}">${escapeHtml(bookmark.title)}</button><small>${escapeHtml(bookmark.source)}</small></li>`).join("")
    : `<li><span>受限平台上下文充足</span><small>继续保持保守整理</small></li>`;
  return `<section class="insight-dashboard" aria-label="数据洞察仪表盘">
    <div class="insight-head"><div><span class="starter-kicker">Collection health</span><h2>收藏是否正在变成行动？</h2><p>把“堆了多少”改成看“被回顾、被使用、能推进项目多少”。</p></div><a class="btn btn-small" href="#/validation">看 14 天验证</a></div>
    <div class="insight-grid">
      <div class="insight-card"><span>项目覆盖</span><strong>${insights.projectCoverage}%</strong><small>有多少有效收藏已经挂到项目</small></div>
      <div class="insight-card"><span>需补上下文</span><strong>${insights.restrictedNeedContextCount}</strong><small>微信/小红书等受限内容缺摘录</small></div>
      <div class="insight-card"><span>沉睡收藏</span><strong>${insights.dormantCount}</strong><small>超过 21 天未被再次触达</small></div>
    </div>
    <div class="insight-body"><div class="insight-panel"><h3>14 天处理趋势</h3><div class="mini-activity-chart">${insights.dailyActivity.map((day) => `<span style="height:${Math.max(6, Math.round((day.count / maxDay) * 100))}%" title="${day.key}: ${day.count} 次"></span>`).join("")}</div><p>${insights.nextActions.map(escapeHtml).join(" · ")}</p></div><div class="insight-panel"><h3>来源集中度</h3><ul class="source-list">${sourceItems}</ul></div><div class="insight-panel"><h3>补上下文队列</h3><ul class="context-list">${contextItems}</ul></div></div>
  </section>`;
}

function mobileCaptureAssistantTemplate() {
  return `<section class="mobile-capture-assistant" aria-label="移动采集助手">
    <div><span class="starter-kicker">Mobile capture</span><h2>手机里看到的内容，先安全接住</h2><p>适合从微信、小红书、Notion、备忘录复制内容；如果只有截图，也可以先打开截图补充。</p></div>
    <div class="mobile-capture-actions">
      <button type="button" class="mobile-capture-card" data-action="paste-quick-clipboard">${icons.download}<strong>粘贴剪贴板</strong><span>自动识别链接 + 标题/摘录</span></button>
      <button type="button" class="mobile-capture-card" data-action="capture-screenshot-bookmark">${icons.eye}<strong>截图补充</strong><span>先建收藏，再读取截图文字</span></button>
      <button type="button" class="mobile-capture-card" data-action="batch-import">${icons.library}<strong>批量迁移</strong><span>一行一条导入收藏清单</span></button>
    </div>
  </section>`;
}

function inboxPage(state) {
  const stats = getDashboardStats(state.bookmarks);
  const items = filterBookmarks(state.bookmarks, { query: ui.query, status: "inbox" });
  const todayReview = store.getTodayReview(state.preferences.reviewSize);
  return `
    <div class="page-head">
      <div><p class="eyebrow">Capture · Connect · Act</p><h1 class="page-title">早上好，今天想激活什么？</h1><p class="page-subtitle">先快速整理新收藏，再从旧内容里推进一件真正重要的事。</p></div>
      <a class="btn" href="#/review">${icons.sun} 开始今日回顾 <span class="tag">${todayReview.length}</span></a>
    </div>
    ${starterGuideTemplate(state)}
    ${mobileCaptureAssistantTemplate()}
    ${weeklyFeedbackTemplate(state)}
    ${actionPriorityTemplate(state)}
    ${insightDashboardTemplate(state)}
    <form id="quick-capture-form" class="quick-capture">
      <div class="quick-capture-copy"><strong>快速收藏</strong><span>粘贴一个链接，或直接输入一段文字</span><button class="btn btn-small batch-trigger" type="button" data-action="batch-import">批量导入</button></div>
      <div class="quick-capture-row"><input class="quick-input" name="capture" required placeholder="https://… 或任何值得留下的想法" aria-label="快速收藏链接或文字"/><button class="btn btn-primary" type="submit">${icons.plus} 保存</button></div>
      <p class="local-fallback">Sparkbox 会先确保原始内容不丢失；受限平台不会伪造摘要，补充摘录或截图后再让 AI 整理。</p>
    </form>
    ${pinboardTargetsTemplate(state)}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">${icons.inbox} 待整理</div><div class="stat-value">${stats.inbox}<span class="stat-note">条</span></div></div>
      <div class="stat-card"><div class="stat-label">${icons.library} 有效收藏</div><div class="stat-value">${stats.total}<span class="stat-note">条</span></div></div>
      <div class="stat-card"><div class="stat-label">${icons.check} 已转化使用</div><div class="stat-value">${stats.used}<span class="stat-note">条</span></div></div>
      <div class="stat-card"><div class="stat-label">${icons.activity} 激活率</div><div class="stat-value">${stats.activated}<span class="stat-note">%</span></div></div>
    </div>
    <div class="section-head"><h2 class="section-title">收件箱</h2><span class="section-note">${items.length} 条等待整理</span></div>
    ${listTemplate(items, state, ui.query ? "没有匹配结果" : "收件箱已经清空", ui.query ? "试试更短的关键词，或搜索标签与来源。" : "很好，所有新收藏都已有下一步。")}`;
}

function allBookmarksPage(state) {
  const statuses = [{ value: "", label: "全部" }, ...BOOKMARK_STATUSES];
  const smartFilters = [
    { value: "", label: "全部队列", count: state.bookmarks.filter((bookmark) => bookmark.status !== "archived").length },
    { value: "needs-context", label: "需补上下文", count: state.bookmarks.filter(shouldDeferAiForSupplement).length },
    { value: "action-now", label: "可行动", count: state.bookmarks.filter(needsActionNow).length },
    { value: "no-project", label: "未入项目", count: state.bookmarks.filter((bookmark) => bookmark.status !== "archived" && !bookmark.projectIds.length).length },
    { value: "dormant", label: "沉睡 21 天", count: state.bookmarks.filter((bookmark) => bookmark.status !== "archived" && isDormantBookmark(bookmark)).length },
  ];
  let items = filterBookmarks(state.bookmarks, { query: ui.query, status: ui.status || undefined, includeArchived: ui.status === "archived" });
  if (ui.query) {
    const query = ui.query.toLocaleLowerCase();
    const projectIds = state.projects
      .filter((project) => `${project.name} ${project.description}`.toLocaleLowerCase().includes(query))
      .map((project) => project.id);
    const projectItems = filterBookmarks(state.bookmarks, { status: ui.status || undefined, includeArchived: ui.status === "archived" })
      .filter((bookmark) => bookmark.projectIds.some((id) => projectIds.includes(id)));
    items = [...new Map([...items, ...projectItems].map((item) => [item.id, item])).values()];
  }
  items = applySmartFilter(items, ui.smartFilter);
  return `
    <div class="page-head"><div><p class="eyebrow">Your library</p><h1 class="page-title">全部收藏</h1><p class="page-subtitle">分类说明内容是什么，状态决定下一步做什么。用智能队列先处理最影响质量的收藏。</p></div></div>
    ${pinboardTargetsTemplate(state)}
    <section class="organize-panel" aria-label="智能整理队列"><div><strong>整理优先级</strong><p>先补上下文、再挂项目、最后处理沉睡收藏，减少收藏库里的灰色地带。</p></div><div class="smart-filters">${smartFilters.map((filter) => `<button class="smart-chip ${ui.smartFilter === filter.value ? "active" : ""}" data-action="smart-filter" data-filter="${filter.value}"><span>${filter.label}</span><b>${filter.count}</b></button>`).join("")}</div></section>
    <div class="section-head"><div class="filters">${statuses.map((status) => `<button class="filter-chip ${ui.status === status.value ? "active" : ""}" data-action="filter-status" data-status="${status.value}">${status.label}</button>`).join("")}</div><span class="section-note hide-tablet">${items.length} 条结果</span></div>
    ${listTemplate(items, state, ui.query || ui.smartFilter ? "没有匹配结果" : "收藏库还是空的", ui.query || ui.smartFilter ? "换一个关键词，或清除状态/智能队列筛选后再试。" : "从一条真实收藏开始建立你的激活系统。")}`;
}

function projectCard(project, state) {
  const count = state.bookmarks.filter((bookmark) => bookmark.projectIds.includes(project.id) && bookmark.status !== "archived").length;
  const active = state.bookmarks.filter((bookmark) => bookmark.projectIds.includes(project.id) && ["to_action", "in_use"].includes(bookmark.status)).length;
  return `<article class="project-card">
    <span class="project-accent" style="background:${escapeHtml(project.color)}"></span>
    <button class="card-action project-menu" data-action="edit-project" data-id="${project.id}" aria-label="编辑项目">${icons.dots}</button>
    <a href="#/projects/${project.id}">
      <span class="project-icon" style="background:${escapeHtml(project.color)}">${icons.folder}</span>
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.description || "把相关收藏放进一个有明确目的的容器。")}</p>
      <div class="project-footer"><span>${count} 条收藏 · ${active} 条推进中</span><span class="project-arrow">${icons.arrowRight}</span></div>
    </a>
  </article>`;
}

function projectsPage(state, projectId) {
  if (projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return notFoundPage("找不到这个项目");
    const items = filterBookmarks(state.bookmarks, { query: ui.query, projectId });
    return `
      <a class="back-link" href="#/projects">${icons.arrowLeft} 所有项目</a>
      <div class="page-head"><div><p class="eyebrow">Active project</p><h1 class="page-title"><span class="project-dot" style="display:inline-block;width:13px;height:13px;background:${escapeHtml(project.color)}"></span> ${escapeHtml(project.name)}</h1><p class="page-subtitle">${escapeHtml(project.description)}</p></div><button class="btn" data-action="edit-project" data-id="${project.id}">${icons.edit} 编辑项目</button></div>
      <div class="section-head"><h2 class="section-title">项目收藏</h2><span class="section-note">${items.length} 条</span></div>
      ${listTemplate(items, state, ui.query ? "没有匹配结果" : "项目中还没有收藏", ui.query ? "换一个关键词再试。" : "编辑收藏，把它关联到这个项目。")}`;
  }
  return `
    <div class="page-head"><div><p class="eyebrow">Turn knowledge into progress</p><h1 class="page-title">项目</h1><p class="page-subtitle">项目不是分类文件夹，而是让收藏服务于一个正在发生的目标。</p></div><button class="btn btn-primary" data-action="new-project">${icons.plus} 新建项目</button></div>
    ${state.projects.length ? `<div class="project-grid">${state.projects.map((project) => projectCard(project, state)).join("")}</div>` : emptyState("还没有项目", "创建一个正在推进的目标，再把相关收藏关联进来。", false)}`;
}

function reviewPage(state) {
  const dateKey = getDateKey(new Date(), state.preferences.timeZone || "Asia/Shanghai");
  const log = state.reviewLog[dateKey] || {};
  let review = store.getTodayReview(state.preferences.reviewSize);
  const loggedItems = Object.keys(log)
    .map((id) => state.bookmarks.find((bookmark) => bookmark.id === id))
    .filter(Boolean)
    .map((bookmark) => ({ bookmark, reason: "今日已经处理" }));
  const seen = new Set(review.map(({ bookmark }) => bookmark.id));
  review = [...review, ...loggedItems.filter(({ bookmark }) => !seen.has(bookmark.id))];
  const done = review.filter(({ bookmark }) => log[bookmark.id]).length;
  const total = review.length;
  const todayEvents = (state.reviewEvents || []).filter((event) => getDateKey(new Date(event.occurredAt), state.preferences.timeZone || "Asia/Shanghai") === dateKey);
  const completion = getReviewCompletionState({
    done,
    total,
    activatedCount: todayEvents.filter((event) => ["use", "used"].includes(event.eventType)).length,
    outcomeCount: todayEvents.filter((event) => String(event.outcomeNote || "").trim()).length,
  });
  const dateText = new Intl.DateTimeFormat("zh-CN", { timeZone: state.preferences.timeZone || "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return `
    <section class="review-hero"><div class="review-hero-inner"><div><p class="review-date">${escapeHtml(dateText)}</p><h1>${escapeHtml(completion.complete ? completion.title : "与一些值得的内容，再见一面")}</h1><p>${escapeHtml(completion.suggestion)}</p></div><div class="review-progress"><strong>${done}/${total}</strong><span>今日已处理</span><div class="progress-bar"><div class="progress-fill" style="width:${total ? (done / total) * 100 : 100}%"></div></div></div></div></section>
    ${weeklyFeedbackTemplate(state)}
    ${actionPriorityTemplate(state, { compact: true })}
    ${completion.complete ? `<section class="review-complete review-complete-${completion.tone}"><span>${icons.check}</span><div><strong>${escapeHtml(completion.title)}</strong><p>${escapeHtml(completion.suggestion)}</p></div><button class="btn btn-small" data-action="batch-import">导入下一批</button></section>` : ""}
    <div class="section-head"><h2 class="section-title">今日卡片</h2><span class="section-note">每张卡只做一个决定</span></div>
    ${review.length ? `<div class="review-stack">${review.map(({ bookmark, reason }) => reviewCard(bookmark, reason, log[bookmark.id], state)).join("")}</div>` : emptyState("没有需要回顾的内容", "添加几条收藏，或把已归档内容恢复到活跃状态。")}`;
}

function reviewCard(bookmark, reason, action, state) {
  const project = state.projects.find((item) => bookmark.projectIds.includes(item.id));
  const summary = bookmark.summary || bookmark.notes || "这条收藏还没有摘要，打开详情看看当时为什么留下它。";
  return `<article class="review-card ${action ? "done" : ""}">
    <div class="review-reason">${icons.sparkles} ${escapeHtml(action ? `已处理 · ${actionLabel(action)}` : reason)}</div>
    <div class="review-card-main"><h3>${escapeHtml(bookmark.title)}</h3><p>${escapeHtml(summary)}</p></div>
    <div class="bookmark-meta review-meta">
      <span class="tag">${STATUS_MAP[bookmark.status]?.label || bookmark.status}</span>
      ${project ? `<span class="project-pill"><span class="mini-dot" style="background:${escapeHtml(project.color)}"></span>${escapeHtml(project.name)}</span>` : ""}
      <span>上次查看：${formatRelativeDate(bookmark.lastViewedAt)}</span>
    </div>
    <div class="review-actions ${action ? "done-actions" : ""}">${action ? `
      <button class="btn btn-small" data-action="open-detail" data-id="${bookmark.id}">${icons.eye} 查看详情</button>
    ` : `
      <button class="btn btn-primary btn-small review-primary" data-action="review-view" data-id="${bookmark.id}">${icons.eye} 看一眼</button>
      <button class="btn btn-small review-primary" data-action="review-use" data-id="${bookmark.id}">${icons.check} 已用上</button>
      <button class="btn btn-small" data-action="review-later" data-id="${bookmark.id}">${icons.clock} 稍后</button>
      <details class="review-more"><summary>更多</summary><div>
        <button class="btn btn-small" data-action="review-project" data-id="${bookmark.id}">${icons.folder} 加入项目</button>
        <button class="btn btn-quiet btn-small" data-action="review-skip" data-id="${bookmark.id}">跳过</button>
        <button class="btn btn-quiet btn-small" data-action="review-dismiss" data-id="${bookmark.id}">${icons.archive} 不再推荐</button>
        <button class="btn btn-quiet btn-small" data-action="review-delete" data-id="${bookmark.id}">${icons.trash} 删除</button>
      </div></details>
    `}
    </div>
  </article>`;
}

function actionLabel(action) {
  return ({ view: "已查看", use: "已使用", later: "稍后处理", skip: "已跳过", dismissed: "不再推荐", added_to_project: "已加入项目", deleted: "已删除" })[action] || "已处理";
}

function validationPage(state) {
  const metrics = getValidationMetrics({
    bookmarks: state.bookmarks,
    reviewEvents: state.reviewEvents,
    startedAt: state.preferences.validationStartedAt,
    timeZone: state.preferences.timeZone || "Asia/Shanghai",
  });
  if (!metrics.active) {
    return `<div class="validation-intro">
      <span class="validation-mark">${icons.target}</span>
      <p class="eyebrow">14-day local experiment</p>
      <h1>先验证收藏是否真的会被用起来</h1>
      <p>从开始当天起，本面板只统计你的真实收藏，不包含内置示例。目标不是收藏更多，而是在 14 天内激活至少 3 条旧内容。</p>
      <div class="validation-goals"><span>导入 30 条真实收藏</span><span>至少 10 天发生回顾</span><span>激活 3 条旧收藏</span></div>
      <button class="btn btn-primary" data-action="start-validation">${icons.target} 开始 14 天验证</button>
    </div>`;
  }

  const targetRows = [
    { label: "真实收藏", value: metrics.savedCount, target: metrics.targets.saved, unit: "条" },
    { label: "活跃天数", value: metrics.activeDays, target: metrics.targets.activeDays, unit: "天" },
    { label: "激活旧收藏", value: metrics.oldActivatedCount, target: metrics.targets.oldActivated, unit: "条" },
  ];
  const maxDaily = Math.max(1, ...metrics.daily.map((item) => item.count));
  const recommendation = metrics.savedCount < 10
    ? "先批量导入最近真正收藏过的内容，不要为了凑数添加演示资料。"
    : metrics.activeDays < Math.min(3, metrics.day)
      ? "收藏已经够用，下一步是连续回来完成每日回顾。"
      : metrics.oldActivatedCount < 1
        ? "尝试从今日卡片中选择一条保存超过 7 天的内容，并把它用于当前项目。"
        : "闭环已经开始运转，继续保持小剂量回顾并记录真实结果。";

  return `
    <div class="page-head"><div><p class="eyebrow">14-day validation</p><h1 class="page-title">第 ${metrics.day} 天</h1><p class="page-subtitle">${metrics.complete ? "验证周期已完成，可以根据真实结果决定下一步。" : `还剩 ${metrics.daysRemaining} 天。示例数据不会计入验证结果。`}</p></div><button class="btn" data-action="restart-validation">重新开始</button></div>
    <section class="validation-status"><div><span>周期进度</span><strong>${Math.round((metrics.day / 14) * 100)}%</strong></div><div class="validation-track"><span style="width:${Math.min(100, (metrics.day / 14) * 100)}%"></span></div></section>
    <div class="stats-grid validation-stats">
      <div class="stat-card"><div class="stat-label">${icons.bookmark} 真实收藏</div><div class="stat-value">${metrics.savedCount}<span class="stat-note">条</span></div></div>
      <div class="stat-card"><div class="stat-label">${icons.sun} 已回顾内容</div><div class="stat-value">${metrics.reviewedCount}<span class="stat-note">条</span></div></div>
      <div class="stat-card"><div class="stat-label">${icons.check} 已激活</div><div class="stat-value">${metrics.activatedCount}<span class="stat-note">条</span></div></div>
      <div class="stat-card"><div class="stat-label">${icons.activity} 转化率</div><div class="stat-value">${metrics.activationRate}<span class="stat-note">%</span></div></div>
    </div>
    <div class="validation-grid">
      <section class="validation-panel"><div class="section-head"><h2 class="section-title">验证目标</h2><span class="section-note">14 天结束后判断</span></div>
        <div class="goal-list">${targetRows.map((row) => `<div class="goal-row"><div><strong>${row.label}</strong><span>${row.value}/${row.target} ${row.unit}</span></div><div class="goal-track"><span style="width:${Math.min(100, (row.value / row.target) * 100)}%"></span></div></div>`).join("")}</div>
      </section>
      <section class="validation-panel"><div class="section-head"><h2 class="section-title">每日活动</h2><span class="section-note">每次处理今日卡片都会记录</span></div>
        <div class="activity-chart">${metrics.daily.map((item, index) => `<div class="activity-day ${index < metrics.day ? "elapsed" : ""}" title="${item.key}：${item.count} 次"><span style="height:${item.count ? Math.max(18, (item.count / maxDaily) * 100) : 4}%"></span><small>${index + 1}</small></div>`).join("")}</div>
      </section>
    </div>
    <section class="next-step-card"><span>${icons.sparkles}</span><div><strong>此刻最值得做</strong><p>${escapeHtml(recommendation)}</p></div>${metrics.savedCount < 30 ? '<button class="btn btn-small" data-action="batch-import">批量导入</button>' : '<a class="btn btn-small" href="#/review">开始回顾</a>'}</section>`;
}

function detailPage(state, id) {
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return notFoundPage("找不到这条收藏");
  const projects = state.projects.filter((project) => bookmark.projectIds.includes(project.id));
  const href = safeUrl(bookmark.url);
  const access = classifyUrlAccess(bookmark.url);
  const needsSupplement = !hasSupplementContext(bookmark) && (Boolean(bookmark.processingError) || access.restricted);
  const history = (state.reviewEvents || []).filter((event) => event.itemId === id).slice(-8).reverse();
  return `<div class="detail-wrap">
    <a class="back-link" href="#/bookmarks">${icons.arrowLeft} 返回收藏库</a>
    <article class="detail-card">
      <div class="detail-top"><div class="detail-source"><span class="source-favicon">${escapeHtml(bookmark.source.slice(0, 1))}</span>${escapeHtml(bookmark.source)}</div><div style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn btn-small ai-action" data-action="ai-organize" data-id="${bookmark.id}" ${ui.aiBusyIds.has(bookmark.id) ? "disabled" : ""}>${ui.aiBusyIds.has(bookmark.id) ? icons.clock : icons.sparkles} AI 整理</button><button class="btn btn-small" data-action="edit-bookmark" data-id="${bookmark.id}">${icons.edit} 编辑</button><button class="btn btn-quiet btn-small" data-action="archive-bookmark" data-id="${bookmark.id}">${icons.archive} 归档</button></div></div>
      <select class="status-select status-${bookmark.status}" data-action="change-status" data-id="${bookmark.id}" style="margin-bottom:15px">${statusOptions(bookmark.status)}</select>
      <h1>${escapeHtml(bookmark.title)}</h1>
      ${bookmark.summary ? `<p class="detail-summary">${escapeHtml(bookmark.summary)}</p>` : ""}
      ${href ? `<a class="detail-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${icons.external}<span>${escapeHtml(href)}</span></a>` : ""}
      <div class="bookmark-meta">${bookmark.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}${projects.map((project) => `<a class="project-pill" href="#/projects/${project.id}"><span class="mini-dot" style="background:${escapeHtml(project.color)}"></span>${escapeHtml(project.name)}</a>`).join("")}</div>
      ${needsSupplement ? `<section class="ai-insight-card supplement-panel"><div><strong>${icons.shield} 需要补充上下文</strong><span>${access.restricted ? escapeHtml(access.label) : "受限网页"}</span></div><p>${escapeHtml(bookmark.processingError || linkSupplementMessage(bookmark.url))}</p><p><b>建议补充</b>可见标题、正文摘录、视频简介、截图转写、保存原因，或你想用它推动的下一步。</p><button class="btn btn-small" data-action="edit-bookmark" data-id="${bookmark.id}">补充信息</button></section>` : ""}
      ${(bookmark.whyValuable || bookmark.nextAction) ? `<section class="ai-insight-card"><div><strong>${icons.sparkles} AI 整理建议</strong><span>${bookmark.processingStatus === "ready" ? "已写入收藏" : "等待确认"}</span></div>${bookmark.whyValuable ? `<p><b>潜在价值</b>${escapeHtml(bookmark.whyValuable)}</p>` : ""}${bookmark.nextAction ? `<p><b>下一步</b>${escapeHtml(bookmark.nextAction)}</p>` : ""}</section>` : ""}
      ${bookmark.rawText ? `<section class="detail-block"><h2>可见摘录</h2><div class="detail-notes">${escapeHtml(bookmark.rawText)}</div></section>` : ""}
      <section class="detail-block"><h2>我的备注</h2><div class="detail-notes">${escapeHtml(bookmark.notes || "还没有备注。编辑这条收藏，写下你当时为什么保存它。")}</div></section>
      ${bookmark.useOutcome ? `<section class="detail-block"><h2>使用结果</h2><div class="outcome-box">${escapeHtml(bookmark.useOutcome)}</div></section>` : ""}
      <section class="detail-block"><h2>激活记录</h2><div class="detail-grid"><div class="detail-stat"><span>保存时间</span><strong>${formatRelativeDate(bookmark.createdAt)}</strong></div><div class="detail-stat"><span>查看次数</span><strong>${bookmark.viewCount} 次</strong></div><div class="detail-stat"><span>推荐次数</span><strong>${bookmark.recommendationCount} 次</strong></div><div class="detail-stat"><span>跳过次数</span><strong>${bookmark.skipCount} 次</strong></div></div></section>
      ${history.length ? `<section class="detail-block"><h2>最近回顾历史</h2><div class="history-list">${history.map((event) => `<div class="history-row"><span>${escapeHtml(actionLabel(event.eventType))}</span><time>${new Intl.DateTimeFormat("zh-CN", { timeZone: state.preferences.timeZone || "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurredAt))}</time></div>`).join("")}</div></section>` : ""}
    </article>
  </div>`;
}

function notFoundPage(message = "页面不存在") {
  return emptyState(message, "返回收件箱，继续整理你的收藏。", false) + '<p style="text-align:center"><a class="btn" href="#/inbox">返回收件箱</a></p>';
}

function pageTemplate(state, current) {
  if (current.page === "inbox") return inboxPage(state);
  if (current.page === "bookmarks") return allBookmarksPage(state);
  if (current.page === "projects") return projectsPage(state, current.id);
  if (current.page === "review") return reviewPage(state);
  if (current.page === "validation") return validationPage(state);
  if (current.page === "bookmark") return detailPage(state, current.id);
  return notFoundPage();
}

function confidenceLabel(value) {
  if (!Number.isFinite(Number(value))) return "未判断";
  if (Number(value) >= 0.75) return "较高";
  if (Number(value) >= 0.45) return "中等";
  return "较低，需要人工检查";
}

function screenshotDraftField(field, label, value, { checked = true, multiline = false, disabled = false } = {}) {
  const text = String(value || "").trim();
  const unavailable = disabled || !text;
  return `<label class="screenshot-field ${multiline ? "wide" : ""} ${unavailable ? "muted" : ""}"><input type="checkbox" data-screenshot-field="${field}" ${checked && !unavailable ? "checked" : ""} ${unavailable ? "disabled" : ""}/><span><b>${escapeHtml(label)}</b>${multiline ? `<pre>${escapeHtml(text || "未识别到可写入内容")}</pre>` : `<strong>${escapeHtml(text || "未识别")}</strong>`}</span></label>`;
}

function screenshotDraftTemplate(draft) {
  const extraction = draft?.extraction || {};
  const warnings = Array.isArray(extraction.warnings) ? extraction.warnings : [];
  const tagText = Array.isArray(extraction.tags) && extraction.tags.length ? extraction.tags.join("、") : "";
  const visibleText = String(extraction.visibleText || "").trim();
  return `<section class="screenshot-draft" aria-label="截图识别确认">
    <div class="screenshot-draft-head"><div><strong>${icons.eye} 待确认的截图识别结果</strong><span>逐字段勾选要采纳的内容，AI 识别不会自动覆盖你的表单。</span></div><button type="button" class="btn btn-small btn-quiet" data-action="cancel-screenshot-draft">忽略</button></div>
    ${warnings.length ? `<div class="screenshot-warning">${escapeHtml(warnings[0])}</div>` : ""}
    <div class="screenshot-draft-grid">
      <div><span>标题线索</span><strong>${escapeHtml(extraction.title || "未识别")}</strong></div>
      <div><span>来源线索</span><strong>${escapeHtml(extraction.sourceHint || "未识别")}</strong></div>
      <div><span>内容类型</span><strong>${escapeHtml(contentTypeLabel(extraction.contentType))}</strong></div>
      <div><span>识别信心</span><strong>${escapeHtml(confidenceLabel(extraction.confidence))}</strong></div>
    </div>
    <div class="screenshot-field-list">
      ${screenshotDraftField("title", "标题", extraction.title)}
      ${screenshotDraftField("source", "来源", extraction.sourceHint)}
      ${screenshotDraftField("summary", "摘要", extraction.summary)}
      ${screenshotDraftField("contentType", "内容类型", contentTypeLabel(extraction.contentType), { disabled: !extraction.contentType })}
      ${screenshotDraftField("tags", "标签", tagText)}
      ${screenshotDraftField("rawText", "可见文字", visibleText, { multiline: true })}
    </div>
    <div class="screenshot-draft-actions"><button type="button" class="btn btn-primary btn-small" data-action="apply-screenshot-draft" data-mode="selected">写入勾选项</button><button type="button" class="btn btn-small" data-action="apply-screenshot-draft" data-mode="text-only">只追加可见文字</button></div>
  </section>`;
}

function renderScreenshotDraftPanel() {
  const target = app.querySelector("[data-screenshot-draft]");
  if (target) target.innerHTML = ui.screenshotDraft ? screenshotDraftTemplate(ui.screenshotDraft) : "";
}

function bookmarkModal(state, bookmark) {
  const editing = Boolean(bookmark);
  const data = bookmark || { title: "", url: "", rawText: "", summary: "", notes: "", source: "", tags: [], status: "inbox", contentType: "article", importance: "medium", projectIds: [] };
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-panel>
    <div class="modal-head"><div><h2 id="modal-title">${editing ? "编辑收藏" : "添加一条收藏"}</h2><p>${editing ? "整理状态、关联项目，或补充使用语境。" : "先保存下来，再决定它的下一步。"}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
    <form id="bookmark-form" data-id="${bookmark?.id || ""}">
      <div class="modal-body"><div class="form-grid">
        <label class="form-field full"><span class="form-label">标题</span><input class="input" name="title" required maxlength="160" value="${escapeHtml(data.title)}" placeholder="这条内容讲了什么？" autofocus /></label>
        <label class="form-field full"><span class="form-label">链接 <span class="optional">可选</span></span><input class="input" name="url" type="url" value="${escapeHtml(data.url)}" placeholder="https://" /></label>
        <label class="form-field"><span class="form-label">来源</span><input class="input" name="source" maxlength="40" value="${escapeHtml(data.source)}" placeholder="微信 / 小红书 / 网页" /></label>
        <label class="form-field"><span class="form-label">状态</span><select class="select" name="status">${statusOptions(data.status)}</select></label>
        <label class="form-field"><span class="form-label">内容类型</span><select class="select" name="contentType"><option value="article" ${data.contentType === "article" ? "selected" : ""}>文章</option><option value="video" ${data.contentType === "video" ? "selected" : ""}>视频</option><option value="social" ${data.contentType === "social" ? "selected" : ""}>社交内容</option><option value="tool" ${data.contentType === "tool" ? "selected" : ""}>工具</option><option value="product" ${data.contentType === "product" ? "selected" : ""}>产品</option><option value="note" ${data.contentType === "note" ? "selected" : ""}>文字笔记</option><option value="other" ${data.contentType === "other" ? "selected" : ""}>其他</option></select></label>
        <label class="form-field"><span class="form-label">重要程度</span><select class="select" name="importance"><option value="low" ${data.importance === "low" ? "selected" : ""}>低</option><option value="medium" ${data.importance === "medium" ? "selected" : ""}>中</option><option value="high" ${data.importance === "high" ? "selected" : ""}>高</option></select></label>
        <label class="form-field full"><span class="form-label">一句话摘要 <span class="optional">可选</span></span><textarea class="textarea" name="summary" maxlength="500" placeholder="为什么值得留下？">${escapeHtml(data.summary)}</textarea></label>
        <label class="form-field full"><span class="form-label">可见摘录 / 截图转写 <span class="optional">遇到登录墙时很有用</span></span><textarea class="textarea" name="rawText" maxlength="3000" placeholder="粘贴你能看到的正文片段、视频简介、笔记划线，或把截图里的关键信息转写在这里。AI 只会基于这些内容保守整理。">${escapeHtml(data.rawText || "")}</textarea></label>
        <div class="form-field full screenshot-tools"><div><strong>截图补充</strong><span>上传微信、小红书、知识星球、Notion 等截图；识别结果会先让你确认，不会直接覆盖表单。</span></div><button type="button" class="btn btn-small" data-action="choose-screenshot" ${ui.screenshotExtracting ? "disabled" : ""}>${ui.screenshotExtracting ? icons.clock : icons.sparkles} ${ui.screenshotExtracting ? "识别中" : "读取截图"}</button><input id="screenshot-file" class="screen-reader" type="file" accept="image/png,image/jpeg,image/webp" /></div>
        <div class="form-field full" data-screenshot-draft>${ui.screenshotDraft ? screenshotDraftTemplate(ui.screenshotDraft) : ""}</div>
        <label class="form-field full"><span class="form-label">我的备注 <span class="optional">可选</span></span><textarea class="textarea" name="notes" maxlength="1200" placeholder="我为什么保存它？准备怎么使用它？">${escapeHtml(data.notes)}</textarea></label>
        <label class="form-field full"><span class="form-label">标签 <span class="optional">用逗号分隔</span></span><input class="input" name="tags" value="${escapeHtml(data.tags.join(", "))}" placeholder="AI, 产品设计, 待实践" /></label>
        <div class="form-field full"><span class="form-label">关联项目</span><div class="checkbox-grid">${state.projects.length ? state.projects.map((project) => `<label class="check-card"><input type="checkbox" name="projectIds" value="${project.id}" ${data.projectIds.includes(project.id) ? "checked" : ""}/><span class="check-dot" style="background:${escapeHtml(project.color)}"></span><span>${escapeHtml(project.name)}</span></label>`).join("") : '<span class="section-note">还没有项目，可稍后关联。</span>'}</div></div>
      </div></div>
      <div class="modal-footer">${editing ? `<button type="button" class="btn btn-danger" data-action="delete-bookmark" data-id="${bookmark.id}" style="margin-right:auto">${icons.trash} 删除</button>` : ""}<button type="button" class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${editing ? "保存修改" : "添加收藏"}</button></div>
    </form>
  </section></div>`;
}

function projectModal(project) {
  const data = project || { name: "", description: "", color: "#6c5ce7", status: "active" };
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-panel>
    <div class="modal-head"><div><h2 id="modal-title">${project ? "编辑项目" : "新建项目"}</h2><p>给收藏一个正在发生的使用场景。</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
    <form id="project-form" data-id="${project?.id || ""}"><div class="modal-body"><div class="form-grid">
      <label class="form-field full"><span class="form-label">项目名称</span><input class="input" name="name" required maxlength="80" value="${escapeHtml(data.name)}" placeholder="例如：个人收藏系统" autofocus /></label>
      <label class="form-field full"><span class="form-label">项目说明</span><textarea class="textarea" name="description" maxlength="300" placeholder="这个项目想推动什么？">${escapeHtml(data.description)}</textarea></label>
      <label class="form-field"><span class="form-label">标识颜色</span><input class="input" name="color" type="color" value="${escapeHtml(data.color)}" style="padding:5px" /></label>
      <label class="form-field"><span class="form-label">项目状态</span><select class="select" name="status"><option value="active" ${data.status === "active" ? "selected" : ""}>进行中</option><option value="paused" ${data.status === "paused" ? "selected" : ""}>已暂停</option><option value="completed" ${data.status === "completed" ? "selected" : ""}>已完成</option></select></label>
    </div>${project ? `<div class="danger-zone"><p>删除项目不会删除其中的收藏，只会解除关联。</p><button type="button" class="btn btn-danger btn-small" data-action="delete-project" data-id="${project.id}">${icons.trash} 删除项目</button></div>` : ""}</div>
    <div class="modal-footer"><button type="button" class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${project ? "保存修改" : "创建项目"}</button></div></form>
  </section></div>`;
}

function outcomeModal(bookmark) {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-panel>
    <div class="modal-head"><div><h2 id="modal-title">这条收藏带来了什么？</h2><p>${escapeHtml(bookmark.title)}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
    <form id="outcome-form" data-id="${bookmark.id}"><div class="modal-body"><div class="outcome-prompts"><button type="button" class="outcome-chip" data-action="fill-outcome" data-text="把一个方法用进了当前项目，并形成了下一步行动。">用于项目</button><button type="button" class="outcome-chip" data-action="fill-outcome" data-text="读完后提炼出一个可复用判断，已加入长期参考。">沉淀认知</button><button type="button" class="outcome-chip" data-action="fill-outcome" data-text="确认这条内容暂时不再需要，已完成清理。">完成清理</button></div><label class="form-field"><span class="form-label">使用结果 <span class="optional">建议写一句，方便周报统计</span></span><textarea class="textarea" name="useOutcome" autofocus placeholder="例如：把其中一个方法用在了本周计划中；做出了一个购买/放弃决策；把一段观点放入项目方案。">${escapeHtml(bookmark.useOutcome)}</textarea></label><p class="outcome-hint">这条记录会进入“本周收藏复活反馈”，帮助你看到收藏是否真的转化成行动。</p></div><div class="modal-footer"><button type="button" class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${icons.check} 标记已使用</button></div></form>
  </section></div>`;
}

function batchImportModal() {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-panel>
    <div class="modal-head"><div><h2 id="modal-title">批量导入收藏</h2><p>每行一条链接或文字，最多 200 条。可以把“链接 + 标题/摘录”放在同一行。</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
    <form id="batch-import-form"><div class="modal-body">
      <div class="import-helper"><strong>${icons.download} 支持真实迁移格式</strong><p>浏览器书签、备忘录、微信/小红书复制列表都可以先粘贴进来；受限平台如果同一行带有标题或摘录，AI 会优先基于这些可见内容整理。</p><button type="button" class="btn btn-small" data-action="paste-import-clipboard">从剪贴板粘贴</button></div>
      <label class="form-field"><span class="form-label">链接或文字</span><textarea class="textarea batch-textarea" name="items" required autofocus placeholder="小红书爆款标题 https://xhslink.com/... 这段笔记讲了选题角度\nhttps://mp.weixin.qq.com/... 公众号文章标题 + 你能看到的一段摘录\n一个稍后想实践的产品想法"></textarea></label>
      <div class="import-notes"><span>${icons.check} 重复链接会自动跳过</span><span>${icons.shield} 登录墙内容不会被伪造摘要</span><span>${icons.sparkles} 同行补充会自动写入摘录</span></div>
    </div><div class="modal-footer"><button type="button" class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">导入到收件箱</button></div></form>
  </section></div>`;
}

function recoveryReasonLabel(reason) {
  return ({ manual: "手动", before_restore: "恢复前", before_reset: "重置前", before_delete: "删除前", before_cleaning: "清洗前", before_priority_push: "推进前", before_recovery_point_restore: "回滚前" })[reason] || "保护点";
}

function recoveryPointsTemplate() {
  const points = store.getRecoveryPoints?.() || [];
  const summary = store.getRecoveryPointSummary?.() || { total: 0, verified: 0, latestAt: null };
  const pointList = points.length
    ? points.map((point) => {
      const verification = store.verifyRecoveryPoint?.(point.id);
      return `<li class="recovery-point ${verification?.ok ? "verified" : "broken"}"><div><strong>${escapeHtml(point.label)}</strong><p>${escapeHtml(recoveryReasonLabel(point.reason))} · ${formatDateTime(point.createdAt)} · ${point.bookmarkCount} 条收藏 / ${point.projectCount} 项目</p><small>${verification?.ok ? `校验通过：${point.checksum}` : escapeHtml(verification?.error || "校验失败")}</small></div><div><button type="button" class="btn btn-small" data-action="verify-recovery-point" data-id="${point.id}">校验</button><button type="button" class="btn btn-small" data-action="restore-recovery-point" data-id="${point.id}">回滚</button><button type="button" class="btn btn-small btn-quiet" data-action="delete-recovery-point" data-id="${point.id}">删除</button></div></li>`;
    }).join("")
    : `<li class="recovery-point empty"><div><strong>还没有恢复点</strong><p>创建一个可校验快照后，危险操作前会自动追加保护点。</p><small>最多保留最近 5 个恢复点</small></div></li>`;
  return `<section class="recovery-panel"><div class="recovery-head"><div><h3>可验证恢复点</h3><p>${summary.total ? `已保存 ${summary.total} 个，其中 ${summary.verified} 个校验通过` : "独立于主数据保存，回滚前会再次校验。"}</p></div><button type="button" class="btn btn-small" data-action="create-recovery-point">创建恢复点</button></div><ul>${pointList}</ul></section>`;
}

function dataCleaningTemplate(state) {
  const report = store.getDataCleaningReport?.() || getDataCleaningReport(state);
  const safeActions = (report.actions || []).filter((action) => action.safe);
  const issueList = report.issues.length
    ? report.issues.map((issue) => `<li class="cleaning-issue issue-${issue.level}"><div><strong>${escapeHtml(issue.title)}</strong><p>${escapeHtml(issue.detail)}</p><small>${escapeHtml(issue.action)} · ${issue.count} 条</small></div><div class="cleaning-mini-items">${(issue.items || []).slice(0, 3).map((item) => `<span>${escapeHtml(item.title)} · ${escapeHtml(item.age)}</span>`).join("")}</div></li>`).join("")
    : `<li class="cleaning-issue empty"><div><strong>数据质量稳定</strong><p>没有发现重复链接、孤立项目或需要批量处理的缺上下文条目。</p><small>继续保持小剂量回顾即可</small></div></li>`;
  const actionList = safeActions.length
    ? safeActions.map((action) => `<span>${escapeHtml(action.label)}</span>`).join("")
    : `<span>暂无可自动执行的安全修复</span>`;
  return `<section class="cleaning-panel cleaning-${report.tone}">
    <div class="cleaning-head"><div><h3>批量清洗中心</h3><p>${escapeHtml(report.summary)}</p></div><div class="cleaning-score"><strong>${report.score}</strong><span>${escapeHtml(report.title)}</span></div></div>
    <div class="cleaning-metrics"><div><b>${report.metrics.duplicateItems}</b><span>重复副本</span></div><div><b>${report.metrics.orphanProjectRefs}</b><span>孤立关联</span></div><div><b>${report.metrics.missingContext}</b><span>缺上下文</span></div><div><b>${report.metrics.dormant}</b><span>沉睡条目</span></div></div>
    <ul class="cleaning-list">${issueList}</ul>
    <div class="cleaning-actions"><div>${actionList}</div><button type="button" class="btn btn-primary" data-action="apply-data-cleaning" ${safeActions.length ? "" : "disabled"}>创建保护点并执行安全清洗</button></div>
    ${(report.actions || []).some((action) => !action.safe) ? `<p class="cleaning-note">弱标题、弱摘要等需要人工判断的项目只进入诊断，不会自动改写或删除。</p>` : ""}
  </section>`;
}

function cloudOverviewTemplate(state) {
  const status = cloudStatus();
  const localSummary = localSyncSummary(state);
  const summary = ui.itemSyncSummary || localSummary;
  const remoteReady = Boolean(ui.itemSyncSummary?.totalCount);
  const mergeStats = ui.itemMergePreview || ui.itemMergeStats;
  const health = currentSyncHealthReport(state, localSummary, ui.itemSyncSummary);
  return `<div class="sync-overview cloud-${status.tone}">
    <div class="sync-overview-head"><span>${icons.shield}</span><div><strong>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.detail)}</p></div></div>
    ${syncHealthTemplate(health)}
    <div class="sync-meta-grid">
      <div><span>网络状态</span><strong>${ui.networkOnline ? "在线" : "离线"}</strong></div>
      <div><span>离线外壳</span><strong>${ui.pwaReady ? "已缓存" : "准备中"}</strong></div>
      <div><span>本机更改</span><strong>${ui.cloudDirty ? "等待上传" : "已入账"}</strong></div>
      <div><span>上次上传</span><strong>${formatDateTime(ui.cloudLastSyncedAt)}</strong></div>
      <div><span>云端版本</span><strong>${formatDateTime(ui.cloudRemoteUpdatedAt)}</strong></div>
      <div><span>本次数据</span><strong>${state.bookmarks.length} 条 / ${state.projects.length} 项目</strong></div>
    </div>
    <div class="item-sync-panel">
      <div><strong>对象级同步账本</strong><span>${remoteReady ? "云端已记录到单条收藏/项目/事件粒度" : "本机已生成对象清单，等待首次上传"}</span></div>
      <div class="item-sync-stats">
        <span><b>${summary.totalCount || 0}</b> 对象</span>
        <span><b>${summary.bookmarkCount || 0}</b> 收藏</span>
        <span><b>${summary.projectCount || 0}</b> 项目</span>
        <span><b>${summary.reviewEventCount || 0}</b> 回顾事件</span>
        <span><b>${summary.deletedCount || 0}</b> 墓碑</span>
      </div>
      <small>账本更新时间：${formatDateTime(ui.itemSyncLastSyncedAt || ui.itemSyncLastPulledAt || summary.latestUpdatedAt)}</small>
      ${mergeStats ? `<div class="merge-preview"><strong>${ui.itemMergePreview ? "合并预览" : "最近合并"}</strong><p>${escapeHtml(describeMergeStats(mergeStats))}</p>${mergeStats.localWins ? `<small>有 ${mergeStats.localWins} 个对象保留本机新版本，建议导出备份后再手动核对。</small>` : mergeStats.remoteWins ? `<small>有 ${mergeStats.remoteWins} 个对象以云端较新版本为准。</small>` : ""}</div>` : ""}
      ${ui.itemSyncError ? `<p class="sync-error">${escapeHtml(ui.itemSyncError)}</p>` : ""}
    </div>
    ${auditTimelineTemplate()}
    ${ui.cloudConflict ? `<div class="sync-conflict"><strong>需要你选择恢复方式</strong><p>云端版本更新于 ${formatDateTime(ui.cloudConflict.remote?.updatedAt)}，包含 ${Number(ui.cloudConflict.remote?.bookmarkCount || 0)} 条收藏。本机改动仍保留，建议先导出备份再决定。</p><div><button type="button" class="btn btn-small" data-action="export-data">先导出本机备份</button><button type="button" class="btn btn-small" data-action="merge-item-ledger">对象级合并</button><button type="button" class="btn btn-small" data-action="pull-cloud">整库读取云端</button><button type="button" class="btn btn-small btn-danger" data-action="force-cloud-upload">覆盖云端</button></div></div>` : ""}
    ${ui.cloudError ? `<p class="sync-error">${escapeHtml(ui.cloudError)}</p>` : ""}
  </div>`;
}

function settingsModal(state) {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-panel>
    <div class="modal-head"><div><h2 id="modal-title">数据与设置</h2><p>${ui.cloudMode ? "当前数据已绑定账号并自动同步。" : "未登录时数据只保存在当前浏览器中。"}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
    <form id="settings-form"><div class="modal-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr"><div class="detail-stat"><span>收藏</span><strong>${state.bookmarks.length} 条</strong></div><div class="detail-stat"><span>项目</span><strong>${state.projects.length} 个</strong></div></div><div class="detail-block"><h2>云同步</h2><p class="page-subtitle">登录 Eazo 后，收藏、项目、设置和回顾记录会保存到云端。</p>${cloudOverviewTemplate(state)}<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button type="button" class="btn" data-action="open-sync">${icons.shield} ${ui.user ? "管理云同步" : "登录并同步"}</button></div></div><div class="detail-block"><h2>回顾设置</h2><div class="form-grid"><label class="form-field"><span class="form-label">每日回顾数量</span><select class="select" name="reviewSize">${[1,2,3,4,5].map((size) => `<option value="${size}" ${state.preferences.reviewSize === size ? "selected" : ""}>${size} 条</option>`).join("")}</select></label><label class="form-field"><span class="form-label">默认稍后天数</span><select class="select" name="snoozeDays">${[1,3,7,14].map((days) => `<option value="${days}" ${Number(state.preferences.snoozeDays || 3) === days ? "selected" : ""}>${days} 天</option>`).join("")}</select></label><label class="form-field full"><span class="form-label">时区</span><input class="input" value="${escapeHtml(state.preferences.timeZone || "Asia/Shanghai")}" disabled /></label></div></div><div class="detail-block"><h2>隐私与 AI 边界</h2><div class="privacy-grid"><div class="privacy-card"><strong>${icons.shield} 登录墙不硬抓</strong><p>微信、小红书、Notion、知识星球等受限内容只基于你提供的标题、摘录、备注或截图可见文字整理。</p></div><div class="privacy-card"><strong>${icons.eye} 截图需确认</strong><p>截图只用于提取可见信息，结果会先展示为可勾选字段，不会自动覆盖你的收藏记录。</p></div><div class="privacy-card"><strong>${icons.sparkles} AI 输出可追溯</strong><p>AI 不会伪造正文或平台内评论；信息不足时会提示补充，而不是编造摘要。</p></div><div class="privacy-card"><strong>${icons.download} 数据可带走</strong><p>未登录时数据留在浏览器；登录后绑定到账号云同步。你仍可随时导出备份或删除记录。</p></div></div></div><div class="detail-block"><h2>数据备份</h2><p class="page-subtitle">先导出完整 JSON 备份；恢复备份会在校验通过后替换当前数据，系统会自动创建恢复前保护点。</p><div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="btn" data-action="export-data">${icons.download} 导出数据</button><button type="button" class="btn" data-action="choose-restore">恢复备份</button></div><input id="restore-file" class="screen-reader" type="file" accept="application/json,.json" /></div>${dataCleaningTemplate(state)}${recoveryPointsTemplate()}<div class="danger-zone"><p>重置会清除你添加的内容，并恢复为初始示例数据。系统会先创建“重置前保护点”，但仍建议确认后操作。</p><button type="button" class="btn btn-danger" data-action="reset-data">恢复示例数据</button></div></div>
    <div class="modal-footer"><button type="button" class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存设置</button></div></form>
  </section></div>`;
}

function syncModal() {
  const state = store.getState();
  if (ui.user) {
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="sync-title" data-modal-panel>
      <div class="modal-head"><div><h2 id="sync-title">Eazo 云同步</h2><p>${escapeHtml(ui.user.email || ui.user.name || "已登录账号")}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
      <div class="modal-body">${cloudOverviewTemplate(state)}<div class="sync-actions"><button class="btn btn-primary" data-action="sync-now">立即同步</button><button class="btn" data-action="merge-item-ledger">对象级拉取合并</button><button class="btn" data-action="pull-cloud">整库从云端刷新</button><button class="btn" data-action="refresh-item-ledger">刷新对象账本</button><button class="btn" data-action="migrate-local">上传当前本地数据</button><button class="btn btn-quiet" data-action="logout">退出登录</button></div><p class="sync-note">自动同步失败时，本机更改会保留为“等待上传”；对象级账本会按收藏、项目、回顾事件拆分合并，避免整库覆盖另一台设备的新内容。</p></div>
    </section></div>`;
  }
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="sync-title" data-modal-panel>
    <div class="modal-head"><div><h2 id="sync-title">登录并开启云同步</h2><p>用邮箱验证码登录，之后数据会绑定到你的 Eazo 账号。</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div>
    <form id="sync-login-form"><div class="modal-body"><label class="form-field"><span class="form-label">邮箱</span><input class="input" name="email" type="email" required value="${escapeHtml(ui.authEmail)}" placeholder="you@example.com" /></label>${ui.authCodeSent ? `<label class="form-field" style="margin-top:12px"><span class="form-label">验证码</span><input class="input" name="code" inputmode="numeric" required placeholder="6 位验证码" /></label>` : ""}${ui.cloudError ? `<p class="sync-error">${escapeHtml(ui.cloudError)}</p>` : ""}</div><div class="modal-footer"><button type="button" class="btn" data-action="send-login-code">${ui.authCodeSent ? "重新发送" : "发送验证码"}</button><button class="btn btn-primary" type="submit" ${ui.authCodeSent ? "" : "disabled"}>登录并同步</button></div></form>
  </section></div>`;
}

function modalTemplate(state) {
  if (!ui.modal) return "";
  if (ui.modal.type === "bookmark") return bookmarkModal(state, state.bookmarks.find((item) => item.id === ui.modal.id));
  if (ui.modal.type === "project") return projectModal(state.projects.find((item) => item.id === ui.modal.id));
  if (ui.modal.type === "outcome") return outcomeModal(state.bookmarks.find((item) => item.id === ui.modal.id));
  if (ui.modal.type === "batch") return batchImportModal();
  if (ui.modal.type === "settings") return settingsModal(state);
  if (ui.modal.type === "sync") return syncModal();
  return "";
}

function render({ restoreSearch = false } = {}) {
  const state = store.getState();
  const current = route();
  const titles = { inbox: "收件箱", bookmarks: "全部收藏", projects: "项目", review: "今日回顾", validation: "14 天验证", bookmark: "收藏详情" };
  document.title = `${titles[current.page] || "Sparkbox"} · Sparkbox`;
  app.innerHTML = `<div class="app-shell ${escapeHtml(current.page)}">${sidebarTemplate(state, current)}<main class="main"><div class="main-inner">${topbarTemplate()}${storageRecoveryTemplate()}${pageTemplate(state, current)}</div></main>${mobileNavTemplate(current)}${modalTemplate(state)}</div>`;
  bindPinboardInteractions();
  if (ui.modal) {
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => app.querySelector("[autofocus], .modal-close")?.focus());
  } else {
    document.body.style.overflow = "";
  }
  if (restoreSearch) {
    const search = document.querySelector("#global-search");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
}

function openModal(type, id, context = {}) {
  if (type === "bookmark") ui.screenshotDraft = null;
  ui.modal = { type, id, ...context };
  render();
}

function closeModal() {
  ui.modal = null;
  ui.screenshotDraft = null;
  render();
}

async function getSessionHeader() {
  if (!auth && !(await loadEazoSdk())) return null;
  return auth.getSessionHeader();
}

async function authedFetch(url, options = {}) {
  const session = await getSessionHeader();
  if (!session) throw new Error("请先登录");
  return fetch(url, { ...options, headers: { ...(options.headers || {}), "x-eazo-session": session } });
}

async function syncItemManifest(state = store.getState(), { silent = true } = {}) {
  if (!ui.user || !ui.networkOnline) return null;
  ui.itemSyncing = true;
  ui.itemSyncError = "";
  if (!silent) render();
  try {
    const items = buildSyncItems(state);
    const tombstoneKeys = (state.syncTombstones || []).map((entry) => `${entry.entityType}:${entry.entityId}`);
    const response = await authedFetch("/api/sync/items", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "对象级同步失败");
    const cleared = store.clearSyncTombstones?.(tombstoneKeys) || 0;
    const latestState = cleared ? store.getState() : state;
    ui.itemSyncSummary = data.summary || localSyncSummary(latestState);
    ui.itemSyncLastSyncedAt = data.updatedAt || new Date().toISOString();
    auditSync("object_push", "success", "对象账本已上传", `写入 ${items.length} 个对象${cleared ? `，确认 ${cleared} 个删除墓碑` : ""}`, { objects: items.length, tombstonesCleared: cleared });
    return ui.itemSyncSummary;
  } catch (error) {
    ui.itemSyncError = error.message || "对象级同步失败";
    auditSync("object_push", "error", "对象账本上传失败", ui.itemSyncError);
    if (!silent) toast(ui.itemSyncError);
    return null;
  } finally {
    ui.itemSyncing = false;
    render();
  }
}

async function fetchItemSyncSummary({ silent = true, merge = false } = {}) {
  if (!ui.user || !ui.networkOnline) return null;
  ui.itemSyncing = true;
  ui.itemSyncError = "";
  if (!silent) render();
  try {
    const since = ui.itemSyncLastPulledAt || ui.itemSyncLastSyncedAt || "";
    const response = await authedFetch(`/api/sync/items${since ? `?since=${encodeURIComponent(since)}` : ""}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "读取对象级同步失败");
    ui.itemSyncSummary = data.summary || null;
    const pulledAt = new Date().toISOString();
    const mergeResult = applySyncItemsToState(store.getState(), data.items || [], { lastMergedAt: ui.itemSyncLastSyncedAt || ui.cloudLastSyncedAt || "" });
    ui.itemMergePreview = mergeResult.stats;
    if (merge) {
      const changed = mergeResult.stats.created + mergeResult.stats.updated + mergeResult.stats.deleted;
      if (changed || mergeResult.stats.conflicts) {
        store.replaceState(mergeResult.state, { silent: true });
        lastCloudSyncHash = JSON.stringify(store.getState());
        ui.cloudDirty = mergeResult.stats.localWins > 0;
      }
      ui.itemMergeStats = mergeResult.stats;
      ui.itemMergePreview = null;
      ui.itemSyncLastPulledAt = pulledAt;
      auditSync("object_merge", mergeResult.stats.conflicts ? "warning" : "success", "对象级合并完成", describeMergeStats(mergeResult.stats), mergeResult.stats);
      if (!silent) toast(`对象级合并完成：${describeMergeStats(mergeResult.stats)}`);
    } else {
      auditSync("object_pull", "info", "对象账本已读取", describeMergeStats(mergeResult.stats), mergeResult.stats);
    }
    return { ...data, mergeStats: mergeResult.stats };
  } catch (error) {
    ui.itemSyncError = error.message || "读取对象级同步失败";
    auditSync("object_pull", "error", "对象账本读取失败", ui.itemSyncError);
    if (!silent) toast(ui.itemSyncError);
    return null;
  } finally {
    ui.itemSyncing = false;
    render();
  }
}

function markCloudDirty() {
  if (!ui.user || ui.cloudSyncing || ui.authLoading) return;
  ui.cloudDirty = true;
  clearTimeout(cloudSyncTimer);
  if (!ui.networkOnline) {
    render();
    return;
  }
  cloudSyncTimer = setTimeout(() => pushCloudState({ silent: true }), 900);
}

async function pushCloudState({ migrated = false, silent = false, force = false } = {}) {
  if (!ui.user) throw new Error("请先登录");
  if (!ui.networkOnline) {
    ui.cloudDirty = true;
    ui.cloudError = "当前离线，本机更改会在联网后保留为待同步";
    auditSync("offline", "warning", "离线期间保留本机更改", ui.cloudError);
    if (!silent) toast(ui.cloudError);
    render();
    return;
  }
  const state = store.getState();
  const hash = JSON.stringify(state);
  if (!migrated && !force && hash === lastCloudSyncHash) {
    ui.cloudDirty = false;
    await syncItemManifest(state, { silent: true });
    auditSync("cloud_upload", "info", "整库状态无需上传", "本机状态与上次云端同步一致，已刷新对象账本");
    if (!silent) toast("云端已是最新，对象级同步账本也已刷新");
    render();
    return;
  }
  ui.cloudSyncing = true;
  ui.cloudError = "";
  if (force) ui.cloudConflict = null;
  if (!silent) render();
  try {
    const response = await authedFetch("/api/sync/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, migratedFromLocal: migrated, baseUpdatedAt: ui.cloudRemoteUpdatedAt || ui.cloudLastSyncedAt || null, force }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409 || data.conflict) {
        ui.cloudConflict = { remote: data.remote || {}, detectedAt: new Date().toISOString() };
        ui.cloudRemoteUpdatedAt = data.remote?.updatedAt || ui.cloudRemoteUpdatedAt;
        auditSync("conflict", "warning", "发现整库版本冲突", `云端版本更新于 ${formatDateTime(data.remote?.updatedAt)}`);
      }
      throw new Error(data.error || "云同步失败");
    }
    lastCloudSyncHash = hash;
    ui.cloudMode = true;
    ui.cloudDirty = false;
    ui.cloudConflict = null;
    ui.cloudLastSyncedAt = data.updatedAt || new Date().toISOString();
    ui.cloudRemoteUpdatedAt = ui.cloudLastSyncedAt;
    await syncItemManifest(state, { silent: true });
    auditSync("cloud_upload", force ? "warning" : "success", force ? "已用本机覆盖云端" : "整库状态已上传", force ? "本机数据强制成为云端版本，并刷新对象账本" : "收藏、项目、设置和回顾记录已写入云端", { bookmarks: state.bookmarks.length, projects: state.projects.length });
    if (!silent) toast(force ? "已用本机数据覆盖云端，并刷新对象级账本" : "云端数据已同步，对象级账本已刷新");
  } catch (error) {
    ui.cloudDirty = true;
    ui.cloudError = error.message || "云同步失败";
    auditSync("cloud_upload", ui.cloudConflict ? "warning" : "error", ui.cloudConflict ? "整库上传遇到冲突" : "整库上传失败", ui.cloudError);
    if (!silent || ui.cloudConflict) toast(ui.cloudError);
  } finally {
    ui.cloudSyncing = false;
    render();
  }
}

async function pullCloudState() {
  if (!ui.user) return;
  if (!ui.networkOnline) {
    ui.cloudError = "当前离线，无法读取云端数据";
    auditSync("offline", "warning", "离线时无法读取云端", ui.cloudError);
    toast(ui.cloudError);
    render();
    return;
  }
  ui.cloudSyncing = true;
  ui.cloudError = "";
  render();
  try {
    const response = await authedFetch("/api/sync/state");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "读取云端数据失败");
    ui.cloudRemoteUpdatedAt = data.updatedAt || "";
    ui.cloudLastPulledAt = new Date().toISOString();
    if (data.state) {
      store.restoreBackup(data.state, { silent: true });
      lastCloudSyncHash = JSON.stringify(store.getState());
      ui.cloudMode = true;
      ui.cloudDirty = false;
      ui.cloudConflict = null;
      ui.cloudLastSyncedAt = data.updatedAt || ui.cloudLastPulledAt;
      await fetchItemSyncSummary({ silent: true, merge: true });
      auditSync("cloud_pull", "success", "整库状态已从云端读取", `云端版本：${formatDateTime(data.updatedAt)}`, { bookmarks: store.getState().bookmarks.length, projects: store.getState().projects.length });
      toast("已加载云端数据，并完成对象级账本合并");
    } else {
      await pushCloudState({ migrated: true, silent: true });
      auditSync("cloud_upload", "success", "首次迁移到云端", "云端为空，已把当前本机数据作为初始版本");
      toast("已把当前本地数据迁移到云端");
    }
  } catch (error) {
    ui.cloudError = error.message || "读取云端数据失败";
    auditSync("cloud_pull", "error", "读取云端数据失败", ui.cloudError);
    toast(ui.cloudError);
  } finally {
    ui.cloudSyncing = false;
    render();
  }
}

async function repairSyncHealth() {
  const report = currentSyncHealthReport(store.getState(), localSyncSummary(store.getState()), ui.itemSyncSummary);
  auditSync("network", "info", "启动同步健康自检", `当前评分 ${report.score}/100，主建议：${report.primaryAction}`);
  if (!ui.networkOnline) return toast("当前离线，联网后才能执行同步修复");
  if (!ui.user) {
    openModal("sync");
    return toast("请先登录 Eazo，再执行云同步自检修复");
  }
  ui.cloudError = "";
  ui.itemSyncError = "";
  render();
  try {
    if (ui.cloudConflict) await fetchItemSyncSummary({ silent: true, merge: true });
    if (ui.cloudDirty) await pushCloudState({ silent: true });
    else await syncItemManifest(store.getState(), { silent: true });
    await fetchItemSyncSummary({ silent: true, merge: true });
    const latest = currentSyncHealthReport(store.getState(), localSyncSummary(store.getState()), ui.itemSyncSummary);
    auditSync("object_merge", latest.score >= report.score ? "success" : "warning", "同步健康自检完成", `评分 ${report.score} → ${latest.score}，${latest.issues.length} 个待关注项`, latest.metrics);
    toast(`同步健康自检完成：${latest.score}/100`);
  } catch (error) {
    const message = error.message || "同步健康自检失败";
    auditSync("object_merge", "error", "同步健康自检失败", message);
    toast(message);
  } finally {
    render();
  }
}

async function refreshAuth() {
  ui.authLoading = true;
  render();
  try {
    if (!(await loadEazoSdk())) {
      ui.user = null;
      ui.authLoading = false;
      ui.cloudError = ui.networkOnline ? "云同步 SDK 暂时不可用" : "当前离线，暂不检查登录状态";
      auditSync(ui.networkOnline ? "auth" : "offline", "warning", "登录状态检查未完成", ui.cloudError);
      render();
      return;
    }
    await auth.getToken();
    ui.user = auth.user;
    ui.authLoading = false;
    if (ui.user) {
      await pullCloudState();
    }
    else render();
  } catch {
    ui.user = null;
    ui.authLoading = false;
    auditSync("auth", "warning", "登录状态检查失败", "继续保留本地模式");
    render();
  }
}

async function sendLoginCode() {
  if (!ui.networkOnline) return toast("当前离线，无法发送验证码");
  const form = app.querySelector("#sync-login-form");
  const email = String(new FormData(form).get("email") || "").trim();
  if (!email) return toast("请先填写邮箱");
  ui.authEmail = email;
  ui.cloudError = "";
  render();
  try {
    await auth.sendEmailCode(email);
    ui.authCodeSent = true;
    toast("验证码已发送");
  } catch (error) {
    ui.cloudError = error.message || "验证码发送失败";
    toast(ui.cloudError);
  } finally {
    render();
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    ui.pwaReady = true;
    render();
    registration.addEventListener?.("updatefound", () => {
      ui.pwaReady = true;
      render();
    });
  } catch {
    ui.pwaReady = false;
    render();
  }
}

async function installPwa() {
  if (ui.installPrompt) {
    ui.pwaInstalling = true;
    render();
    const prompt = ui.installPrompt;
    ui.installPrompt = null;
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    ui.pwaInstalling = false;
    render();
    return;
  }
  toast(ui.pwaReady ? "核心页面已可离线打开；可从浏览器菜单添加到主屏" : "正在准备离线缓存，请稍后再试");
}

async function loginWithCode(form) {
  if (!ui.networkOnline) return toast("当前离线，无法登录云同步");
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const code = String(data.get("code") || "").trim();
  if (!email || !code) return toast("请填写邮箱和验证码");
  ui.cloudError = "";
  render();
  try {
    await auth.loginWithEmailCode(email, code);
    ui.user = auth.user;
    ui.authCodeSent = false;
    ui.modal = null;
    await pullCloudState();
  } catch (error) {
    ui.cloudError = error.message || "登录失败";
    toast(ui.cloudError);
    render();
  }
}

function bindPinboardInteractions() {
  const cards = app.querySelectorAll(".bookmark-card");
  cards.forEach((card) => {
    card.addEventListener("pointerdown", startPinboardDrag);
  });
}

function startPinboardDrag(event) {
  if (event.button !== 0 || ui.modal) return;
  if (event.target.closest("button, a, input, textarea, select")) return;
  const card = event.currentTarget;
  const id = card.dataset.bookmarkId;
  if (!id) return;

  const drag = {
    card,
    id,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    ghost: null,
    overZone: null,
    started: false,
    timer: null,
  };
  ui.drag = drag;

  const move = (moveEvent) => movePinboardDrag(moveEvent, drag);
  const end = (endEvent) => finishPinboardDrag(endEvent, drag, move, end);
  drag.timer = setTimeout(() => beginPinboardDrag(drag), 220);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end, { once: true });
  window.addEventListener("pointercancel", end, { once: true });
}

function beginPinboardDrag(drag) {
  if (ui.drag !== drag || drag.started) return;
  const rect = drag.card.getBoundingClientRect();
  const ghost = drag.card.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.started = true;
  drag.card.classList.add("drag-source", "pin-charging");
  document.body.classList.add("pinboard-dragging");
  app.querySelectorAll(".drop-zone").forEach((zone) => zone.classList.add("drop-armed"));
  positionDragGhost(drag);
}

function movePinboardDrag(event, drag) {
  if (ui.drag !== drag) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
  if (!drag.started && distance > 12) {
    clearTimeout(drag.timer);
    ui.drag = null;
    window.removeEventListener("pointermove", (moveEvent) => movePinboardDrag(moveEvent, drag));
    return;
  }
  if (!drag.started) return;
  event.preventDefault();
  positionDragGhost(drag);
  const element = document.elementFromPoint(drag.x, drag.y);
  const zone = element?.closest?.(".drop-zone") || null;
  if (zone !== drag.overZone) {
    drag.overZone?.classList.remove("drop-hover");
    zone?.classList.add("drop-hover");
    drag.overZone = zone;
  }
}

function positionDragGhost(drag) {
  if (!drag.ghost) return;
  const x = drag.x - drag.startX;
  const y = drag.y - drag.startY;
  drag.ghost.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(0deg) scale(1.03)`;
}

function finishPinboardDrag(_event, drag, move, end) {
  clearTimeout(drag.timer);
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointercancel", end);
  if (ui.drag !== drag) return;
  ui.drag = null;
  if (!drag.started) return;

  ui.suppressClickUntil = Date.now() + 350;
  const zone = drag.overZone;
  drag.overZone?.classList.remove("drop-hover");
  drag.ghost?.remove();
  drag.card.classList.remove("drag-source", "pin-charging");
  document.body.classList.remove("pinboard-dragging");
  app.querySelectorAll(".drop-zone").forEach((dropZone) => dropZone.classList.remove("drop-armed"));

  if (!zone) {
    toast("松手时没有命中整理区");
    render();
    return;
  }
  applyPinboardDrop(drag.id, zone);
}

function applyPinboardDrop(id, zone) {
  const state = store.getState();
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;
  const type = zone.dataset.dropType;
  try {
    if (type === "project") {
      const projectId = zone.dataset.projectId;
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) throw new Error("找不到这个项目");
      const projectIds = [...new Set([...bookmark.projectIds, projectId])];
      store.updateBookmark(id, { projectIds, status: bookmark.status === "inbox" ? "to_action" : bookmark.status });
      toast(`已吸附到项目「${project.name}」`);
    } else if (type === "review") {
      store.pinToTodayReview(id);
      toast("已钉到今日回顾");
    } else if (type === "status") {
      const status = zone.dataset.status || "inbox";
      store.updateBookmark(id, { status });
      toast(`已放回“${STATUS_MAP[status]?.label || "收件箱"}”`);
    }
    render();
  } catch (error) {
    toast(error.message || "整理失败，请再试一次");
    render();
  }
}

function readBookmarkForm(form) {
  const data = new FormData(form);
  return {
    title: data.get("title"),
    url: data.get("url"),
    source: data.get("source"),
    status: data.get("status"),
    summary: data.get("summary"),
    rawText: data.get("rawText"),
    notes: data.get("notes"),
    whySaved: data.get("notes"),
    tags: data.get("tags"),
    contentType: data.get("contentType"),
    importance: data.get("importance"),
    projectIds: data.getAll("projectIds"),
  };
}

function fileToDataUrl(file) {
  if (!file || !/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error("请上传 PNG、JPG 或 WebP 截图");
  if (file.size > MAX_SCREENSHOT_BYTES) throw new Error("截图太大了，请压缩到 4.5MB 以内再上传");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("无法读取这张截图，请换一张图片重试"));
    reader.readAsDataURL(file);
  });
}

function mergeTagText(current, incoming = []) {
  const all = [...String(current || "").split(/[,，#]/), ...incoming].map((tag) => String(tag || "").trim()).filter(Boolean);
  return [...new Set(all)].slice(0, 12).join(", ");
}

function setFieldValue(form, name, value, { append = false, preferEmpty = false } = {}) {
  const field = form.elements[name];
  if (!field || value == null || !String(value).trim()) return false;
  if (append) {
    field.value = [field.value, value].map((item) => String(item || "").trim()).filter(Boolean).join("\n\n");
    return true;
  }
  if (!preferEmpty || !String(field.value || "").trim()) {
    field.value = value;
    return true;
  }
  return false;
}

function hasUsefulScreenshotExtraction(extraction = {}) {
  return [extraction.visibleText, extraction.title, extraction.summary, extraction.sourceHint]
    .some((value) => String(value || "").trim().length >= 4);
}

function getSelectedScreenshotFields(form, mode) {
  if (mode === "text-only") return new Set(["rawText"]);
  if (mode !== "selected") return new Set(["title", "source", "summary", "contentType", "tags", "rawText"]);
  return new Set([...form.querySelectorAll("[data-screenshot-field]:checked")].map((input) => input.dataset.screenshotField));
}

function fillOutcome(text) {
  const field = app.querySelector('#outcome-form textarea[name="useOutcome"]');
  if (!field) return;
  field.value = [field.value, text].map((item) => String(item || "").trim()).filter(Boolean).join(field.value.trim() ? "\n" : "");
  field.focus();
}

async function pasteImportClipboard() {
  const field = app.querySelector('#batch-import-form textarea[name="items"]');
  if (!field) return;
  if (!navigator.clipboard?.readText) return toast("当前浏览器不支持读取剪贴板，请手动粘贴");
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error("剪贴板里没有可导入的文字");
    field.value = [field.value, text].map((item) => String(item || "").trim()).filter(Boolean).join("\n");
    field.focus();
    toast("已从剪贴板粘贴到批量导入框");
  } catch (error) {
    toast(error.message || "无法读取剪贴板，请手动粘贴");
  }
}

async function pasteQuickClipboard() {
  const form = app.querySelector("#quick-capture-form");
  const field = form?.elements.capture;
  if (!form || !field) return;
  if (!navigator.clipboard?.readText) return toast("当前浏览器不支持读取剪贴板，请手动粘贴到快速收藏框");
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error("剪贴板里没有可保存的内容");
    field.value = text.trim();
    form.requestSubmit();
  } catch (error) {
    toast(error.message || "无法读取剪贴板，请手动粘贴");
  }
}

function openScreenshotCapture() {
  openModal("bookmark");
  const input = document.querySelector("#screenshot-file");
  if (input) input.click();
  else toast("已打开添加收藏，可点击“读取截图”上传图片");
}

function applyScreenshotDraftToForm(mode = "selected") {
  const form = app.querySelector("#bookmark-form");
  const draft = ui.screenshotDraft;
  if (!form || !draft) return;
  const extraction = draft.extraction || {};
  const selected = getSelectedScreenshotFields(form, mode);
  if (!selected.size) return toast("请至少勾选一个要写入的识别字段");
  let writes = 0;
  if (selected.has("rawText")) writes += Number(setFieldValue(form, "rawText", extraction.visibleText, { append: true }));
  if (selected.has("title")) writes += Number(setFieldValue(form, "title", extraction.title, { preferEmpty: true }));
  if (selected.has("source")) writes += Number(setFieldValue(form, "source", extraction.sourceHint, { preferEmpty: true }));
  if (selected.has("summary")) writes += Number(setFieldValue(form, "summary", extraction.summary, { preferEmpty: true }));
  if (selected.has("contentType") && extraction.contentType && form.elements.contentType) {
    form.elements.contentType.value = extraction.contentType;
    writes += 1;
  }
  if (selected.has("tags") && Array.isArray(extraction.tags) && extraction.tags.length && form.elements.tags) {
    form.elements.tags.value = mergeTagText(form.elements.tags.value, extraction.tags);
    writes += 1;
  }
  ui.screenshotDraft = null;
  renderScreenshotDraftPanel();
  toast(writes ? `已写入 ${writes} 个截图识别字段，请确认后保存` : "没有可写入的新内容，你可以手动补充摘录");
}

async function extractScreenshotIntoForm(file) {
  const form = app.querySelector("#bookmark-form");
  if (!form) return;
  const button = app.querySelector('[data-action="choose-screenshot"]');
  const originalButtonHtml = button?.innerHTML || "";
  try {
    ui.screenshotExtracting = true;
    ui.screenshotDraft = null;
    renderScreenshotDraftPanel();
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icons.clock} 识别中`;
    }
    const formData = new FormData(form);
    const imageDataUrl = await fileToDataUrl(file);
    const session = await getSessionHeader().catch(() => null);
    const response = await fetch("/api/ai/extract-image", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session ? { "x-eazo-session": session } : {}) },
      body: JSON.stringify({
        imageDataUrl,
        context: {
          title: formData.get("title"),
          url: formData.get("url"),
          source: formData.get("source"),
          notes: formData.get("notes"),
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "截图提取失败");
    const extraction = data.extraction || {};
    if (!hasUsefulScreenshotExtraction(extraction)) {
      throw new Error("这张截图没有识别到足够文字。请换更清晰的截图，或手动粘贴可见摘录。");
    }
    ui.screenshotDraft = { extraction, fileName: file.name || "截图", createdAt: Date.now() };
    renderScreenshotDraftPanel();
    toast(`截图已读取${extraction.warnings?.length ? `：${extraction.warnings[0]}` : "，请确认后写入表单"}`);
  } catch (error) {
    toast(error.message || "截图提取失败，请稍后再试");
  } finally {
    ui.screenshotExtracting = false;
    if (button) {
      button.disabled = false;
      button.innerHTML = originalButtonHtml;
    }
    const input = app.querySelector("#screenshot-file");
    if (input) input.value = "";
  }
}

function projectIdsFromSuggestion(names, state) {
  const normalizedNames = new Set((names || []).map((name) => String(name).trim().toLocaleLowerCase()).filter(Boolean));
  if (!normalizedNames.size) return [];
  return state.projects
    .filter((project) => normalizedNames.has(project.name.toLocaleLowerCase()))
    .map((project) => project.id);
}

function queueAiOrganize(id, { silent = false } = {}) {
  if (!id || ui.aiBusyIds.has(id) || ui.aiQueue.includes(id)) return;
  const bookmark = store.getState().bookmarks.find((item) => item.id === id);
  if (!bookmark) return;
  if (shouldDeferAiForSupplement(bookmark)) {
    store.updateBookmark(id, { processingStatus: "ready", processingError: linkSupplementMessage(bookmark.url) });
    if (!silent) toast("这个链接可能需要登录，请先补充摘录或备注");
    render();
    return;
  }
  ui.aiQueue.push(id);
  if (bookmark.processingStatus !== "processing") {
    store.updateBookmark(id, { processingStatus: "queued", processingError: "" });
  }
  if (!silent) toast("已加入 AI 自动整理队列");
  render();
  runAiQueue();
}

async function runAiQueue() {
  if (ui.aiQueueRunning) return;
  ui.aiQueueRunning = true;
  while (ui.aiQueue.length) {
    const id = ui.aiQueue.shift();
    await organizeBookmarkWithAi(id, { fromQueue: true });
  }
  ui.aiQueueRunning = false;
}

async function organizeBookmarkWithAi(id, { fromQueue = false } = {}) {
  if (ui.aiBusyIds.has(id)) return;
  ui.aiQueue = ui.aiQueue.filter((queuedId) => queuedId !== id);
  const state = store.getState();
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;
  if (shouldDeferAiForSupplement(bookmark)) {
    store.updateBookmark(id, { processingStatus: "ready", processingError: linkSupplementMessage(bookmark.url) });
    if (!fromQueue) toast("这个平台可能无法公开读取内容，请编辑收藏补充摘录或备注后再整理");
    render();
    return;
  }

  ui.aiBusyIds.add(id);
  store.updateBookmark(id, { processingStatus: "processing", processingError: "" });
  render();
  if (!fromQueue) toast("AI 正在整理这条收藏");

  try {
    const response = await fetch("/api/ai/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookmark,
        projects: state.projects.map((project) => ({ name: project.name, description: project.description })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "AI 整理失败");

    const suggestion = data.suggestion || {};
    const projectIds = [...new Set([...bookmark.projectIds, ...projectIdsFromSuggestion(suggestion.projectNames, state)])];
    const tags = Array.isArray(suggestion.tags) && suggestion.tags.length ? suggestion.tags : bookmark.tags;
    store.updateBookmark(id, {
      title: suggestion.title || bookmark.title,
      summary: suggestion.summary || bookmark.summary,
      source: suggestion.source || bookmark.source,
      contentType: suggestion.contentType || bookmark.contentType,
      whyValuable: suggestion.whyValuable || bookmark.whyValuable,
      nextAction: suggestion.nextAction || bookmark.nextAction,
      tags,
      status: suggestion.status || bookmark.status,
      projectIds,
      processingStatus: "ready",
      processingError: "",
    });
    if (!fromQueue) toast("AI 已完成整理，并写入收藏");
  } catch (error) {
    store.updateBookmark(id, { processingStatus: "failed", processingError: error.message || "AI 整理失败，请稍后再试" });
    if (!fromQueue) toast(error.message || "AI 整理失败，请稍后再试");
  } finally {
    ui.aiBusyIds.delete(id);
    render();
  }
}

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === "sync-login-form") {
      await loginWithCode(form);
      return;
    }
    if (form.id === "bookmark-form") {
      const id = form.dataset.id;
      const values = readBookmarkForm(form);
      const fromReview = Boolean(ui.modal?.fromReview);
      if (id && fromReview) store.handleReview(id, "added_to_project", { bookmarkChanges: values });
      else if (id) store.updateBookmark(id, values);
      else store.addBookmark(values);
      ui.modal = null;
      ui.screenshotDraft = null;
      render();
      toast(id ? "收藏已更新" : "收藏已添加到收件箱");
    }
    if (form.id === "quick-capture-form") {
      const raw = String(new FormData(form).get("capture") || "").trim();
      if (!raw) throw new Error("请先粘贴链接、摘录或想法");
      const bookmark = store.addBookmark(parseCaptureInput(raw));
      form.reset();
      queueAiOrganize(bookmark.id, { silent: true });
      toast(shouldDeferAiForSupplement(bookmark) ? "已保存。这个平台可能需要登录，请补充摘录、备注或截图后再让 AI 整理" : "已安全保存，AI 将自动整理");
    }
    if (form.id === "batch-import-form") {
      const data = new FormData(form);
      const items = parseBatchInput(data.get("items"));
      if (!items.length) throw new Error("请至少输入一条链接或文字");
      const result = store.addBookmarks(items);
      ui.modal = null;
      navigate("inbox");
      const deferred = (result.bookmarks || []).filter(shouldDeferAiForSupplement).length;
      (result.bookmarks || []).forEach((bookmark) => queueAiOrganize(bookmark.id, { silent: true }));
      render();
      toast(`已导入 ${result.added} 条${result.skipped ? `，跳过 ${result.skipped} 条重复链接` : ""}${deferred ? `，其中 ${deferred} 条需要补充上下文` : "，AI 将后台整理"}`);
    }
    if (form.id === "project-form") {
      const id = form.dataset.id;
      const data = new FormData(form);
      const values = { name: data.get("name"), description: data.get("description"), color: data.get("color"), status: data.get("status") };
      if (id) store.updateProject(id, values);
      else store.addProject(values);
      ui.modal = null;
      render();
      toast(id ? "项目已更新" : "项目已创建");
    }
    if (form.id === "outcome-form") {
      const id = form.dataset.id;
      const data = new FormData(form);
      store.handleReview(id, "use", { bookmarkChanges: { status: "used", useOutcome: data.get("useOutcome") }, outcomeNote: data.get("useOutcome") });
      ui.modal = null;
      render();
      toast("已记录这次使用成果");
    }
    if (form.id === "settings-form") {
      const data = new FormData(form);
      store.updatePreferences({ reviewSize: Number(data.get("reviewSize")), snoozeDays: Number(data.get("snoozeDays")) });
      ui.modal = null;
      render();
      toast("设置已保存");
    }
  } catch (error) {
    if (error.code === "DUPLICATE_URL") {
      if (confirm("这个链接已经收藏过了。要打开已有收藏吗？")) {
        ui.modal = null;
        navigate(`bookmark/${error.bookmarkId}`);
      } else if (confirm("仍要把它保存为一条独立副本吗？")) {
        store.addBookmark({ ...error.input, allowDuplicate: true });
        ui.modal = null;
        render();
        toast("已保存为独立副本");
      }
    } else {
      toast(error.message || "保存失败，请检查输入");
    }
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "global-search") {
    if (event.isComposing) return;
    ui.query = event.target.value;
    render({ restoreSearch: true });
  }
});

app.addEventListener("compositionend", (event) => {
  if (event.target.id === "global-search") {
    ui.query = event.target.value;
    render({ restoreSearch: true });
  }
});

app.addEventListener("change", async (event) => {
  if (event.target.id === "screenshot-file") {
    const file = event.target.files?.[0];
    if (!file) return;
    await extractScreenshotIntoForm(file);
    return;
  }
  if (event.target.id === "restore-file") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!confirm(`确定用“${file.name}”替换当前全部数据吗？建议先导出当前备份。`)) {
        event.target.value = "";
        return;
      }
      const result = store.restoreBackup(backup, { protectLabel: `恢复 ${file.name} 前保护点` });
      auditSync("recovery", "warning", "恢复备份前已创建保护点", file.name);
      ui.modal = null;
      ui.query = "";
      ui.status = "";
      ui.smartFilter = "";
      navigate("inbox");
      render();
      toast(`备份已恢复：${result.bookmarks} 条收藏，${result.projects} 个项目`);
    } catch (error) {
      event.target.value = "";
      toast(error instanceof SyntaxError ? "无法读取这个 JSON 文件，现有数据未被修改" : error.message);
    }
    return;
  }
  const select = event.target.closest('[data-action="change-status"]');
  if (select) {
    store.updateBookmark(select.dataset.id, { status: select.value });
    render();
    toast(`状态已改为“${STATUS_MAP[select.value].label}”`);
  }
});

app.addEventListener("keydown", (event) => {
  if (event.target.matches('[data-action="open-detail"]') && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    navigate(`bookmark/${event.target.dataset.id}`);
  }
});

app.addEventListener("click", (event) => {
  if (Date.now() < ui.suppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.target.classList.contains("modal-backdrop")) {
    closeModal();
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target || target.classList.contains("modal-backdrop")) return;
  const { action, id } = target.dataset;
  if (action === "open-sidebar") { ui.sidebarOpen = true; render(); }
  if (action === "close-sidebar") { ui.sidebarOpen = false; render(); }
  if (action === "open-sync") openModal("sync");
  if (action === "send-login-code") sendLoginCode();
  if (action === "sync-now") pushCloudState();
  if (action === "pull-cloud") pullCloudState();
  if (action === "refresh-item-ledger") syncItemManifest(store.getState(), { silent: false });
  if (action === "merge-item-ledger") fetchItemSyncSummary({ silent: false, merge: true });
  if (action === "repair-sync-health") repairSyncHealth();
  if (action === "clear-sync-audit" && confirm("确定清空本机同步审计记录吗？不会影响收藏数据和云端数据。")) {
    const removed = store.clearSyncAudit?.() || 0;
    render();
    toast(`已清空 ${removed} 条同步审计记录`);
  }
  if (action === "create-recovery-point") {
    const point = store.createRecoveryPoint?.({ label: "手动恢复点", reason: "manual" });
    auditSync("recovery", "success", "已创建恢复点", `${point.bookmarkCount} 条收藏 / ${point.projectCount} 个项目 · ${point.checksum}`);
    render();
    toast("恢复点已创建并校验通过");
  }
  if (action === "verify-recovery-point") {
    const result = store.verifyRecoveryPoint?.(id);
    auditSync("recovery", result?.ok ? "success" : "error", result?.ok ? "恢复点校验通过" : "恢复点校验失败", result?.ok ? result.checksum : result?.error);
    toast(result?.ok ? "恢复点校验通过" : result?.error || "恢复点校验失败");
    render();
  }
  if (action === "restore-recovery-point" && confirm("确定回滚到这个恢复点吗？当前状态会先自动保存为新的保护点。")) {
    const result = store.restoreRecoveryPoint?.(id);
    auditSync("recovery", "warning", "已回滚到恢复点", `${result.bookmarks} 条收藏 / ${result.projects} 个项目 · ${result.checksum}`);
    ui.modal = null;
    ui.query = "";
    ui.status = "";
    ui.smartFilter = "";
    navigate("inbox");
    render();
    toast("已回滚到恢复点，回滚前状态也已保护");
  }
  if (action === "delete-recovery-point" && confirm("确定删除这个恢复点吗？不会影响当前收藏数据。")) {
    const removed = store.deleteRecoveryPoint?.(id) || 0;
    auditSync("recovery", "info", "恢复点已删除", `删除 ${removed} 个恢复点`);
    render();
    toast(removed ? "恢复点已删除" : "没有找到这个恢复点");
  }
  if (action === "apply-data-cleaning" && confirm("确定执行批量安全清洗吗？系统会先创建保护点；重复链接只归档，缺上下文只标记，不会硬删除内容。")) {
    const result = store.applyDataCleaningActions?.() || { applied: 0, touched: 0 };
    auditSync("recovery", "warning", "批量清洗前已创建保护点", `执行 ${result.applied} 个动作，影响 ${result.touched} 条收藏`);
    render();
    toast(result.applied ? `已安全清洗 ${result.touched} 条收藏` : "暂无可执行的安全清洗动作");
  }
  if (action === "promote-priority-queue" && confirm("确定把优先级最高的收藏加入今日回顾吗？系统会先创建保护点，并保留现有今日卡片。")) {
    const result = store.promotePriorityQueue?.() || { promoted: 0, focus: "" };
    auditSync("recovery", "warning", "优先队列推进前已创建保护点", `推进 ${result.promoted} 条收藏 · ${result.focus || "今日回顾"}`);
    navigate("review");
    render();
    toast(result.promoted ? `已把 ${result.promoted} 条高优先收藏加入今日回顾` : "暂无可推进的优先收藏");
  }
  if (action === "promote-one-priority") {
    const result = store.promotePriorityQueue?.([id]) || { promoted: 0, focus: "" };
    auditSync("recovery", "info", "单条优先收藏已推进", `推进 ${result.promoted} 条收藏 · ${result.focus || id}`);
    navigate("review");
    render();
    toast(result.promoted ? "已加入今日回顾" : "这条收藏暂时无法推进");
  }
  if (action === "install-pwa") installPwa();
  if (action === "force-cloud-upload" && confirm("确定用本机数据覆盖云端吗？建议先导出备份，避免覆盖另一台设备的新内容。")) pushCloudState({ force: true });
  if (action === "migrate-local") pushCloudState({ migrated: true });
  if (action === "logout") { auth.logout().then(() => { ui.user = null; ui.cloudMode = false; ui.cloudDirty = false; ui.cloudLastSyncedAt = ""; ui.cloudRemoteUpdatedAt = ""; ui.modal = null; toast("已退出登录，继续使用本地模式"); render(); }); }
  if (action === "new-bookmark") openModal("bookmark");
  if (action === "batch-import") openModal("batch");
  if (action === "paste-import-clipboard") pasteImportClipboard();
  if (action === "paste-quick-clipboard") pasteQuickClipboard();
  if (action === "capture-screenshot-bookmark") openScreenshotCapture();
  if (action === "fill-outcome") fillOutcome(target.dataset.text || "");
  if (action === "edit-bookmark") openModal("bookmark", id);
  if (action === "review-project") openModal("bookmark", id, { fromReview: true });
  if (action === "new-project") openModal("project");
  if (action === "edit-project") openModal("project", id);
  if (action === "settings") openModal("settings");
  if (action === "choose-restore") document.querySelector("#restore-file")?.click();
  if (action === "choose-screenshot") document.querySelector("#screenshot-file")?.click();
  if (action === "apply-screenshot-draft") applyScreenshotDraftToForm(target.dataset.mode || "all");
  if (action === "cancel-screenshot-draft") { ui.screenshotDraft = null; renderScreenshotDraftPanel(); toast("已忽略这次截图识别结果"); }
  if (action === "close-modal") closeModal();
  if (action === "clear-search") { ui.query = ""; render(); }
  if (action === "filter-status") { ui.status = target.dataset.status; render(); }
  if (action === "smart-filter") { ui.smartFilter = target.dataset.filter || ""; render(); }
  if (action === "open-detail") navigate(`bookmark/${id}`);
  if (action === "ai-organize") organizeBookmarkWithAi(id);
  if (action === "archive-bookmark") {
    store.updateBookmark(id, { status: "archived" });
    if (route().page === "bookmark") navigate("bookmarks");
    else render();
    toast("收藏已归档");
  }
  if (action === "delete-bookmark" && confirm("确定永久删除这条收藏吗？系统会先创建删除前保护点。")) {
    store.createRecoveryPoint?.({ label: "删除收藏前保护点", reason: "before_delete" });
    store.deleteBookmark(id);
    auditSync("recovery", "warning", "删除收藏前已创建保护点", id);
    ui.modal = null;
    navigate("bookmarks");
    render();
    toast("收藏已删除");
  }
  if (action === "delete-project" && confirm("确定删除这个项目吗？收藏内容会保留，系统会先创建删除前保护点。")) {
    store.createRecoveryPoint?.({ label: "删除项目前保护点", reason: "before_delete" });
    store.deleteProject(id);
    auditSync("recovery", "warning", "删除项目前已创建保护点", id);
    ui.modal = null;
    navigate("projects");
    render();
    toast("项目已删除，收藏内容已保留");
  }
  if (action === "review-view") {
    store.recordReview(id, "view");
    navigate(`bookmark/${id}`);
  }
  if (action === "review-use") openModal("outcome", id);
  if (action === "review-later") {
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + Number(store.getState().preferences.snoozeDays || 3));
    store.handleReview(id, "later", { bookmarkChanges: { status: "to_read", nextReviewAt: nextReviewAt.toISOString() } });
    render();
    toast(`已放入待阅读，${store.getState().preferences.snoozeDays || 3} 天后再次出现`);
  }
  if (action === "review-skip") {
    const before = store.getState().bookmarks.find((bookmark) => bookmark.id === id);
    store.recordReview(id, "skip");
    render();
    if (before && before.skipCount + 1 >= 3 && confirm("这条收藏已经连续被跳过多次。要将它设为不再推荐吗？")) {
      store.handleReview(id, "dismissed", { bookmarkChanges: { status: "archived" } });
      render();
      toast("已设为不再推荐");
    } else toast("今天先跳过，推荐权重已调整");
  }
  if (action === "review-dismiss" && confirm("确定不再推荐这条收藏吗？它会被归档，但仍可在资料库的“已归档”中找到。")) {
    store.handleReview(id, "dismissed", { bookmarkChanges: { status: "archived" } });
    render();
    toast("已设为不再推荐");
  }
  if (action === "review-delete" && confirm("确定永久删除这条收藏吗？系统会先创建删除前保护点。")) {
    store.createRecoveryPoint?.({ label: "回顾删除前保护点", reason: "before_delete" });
    store.handleReview(id, "deleted", { deleteAfter: true });
    auditSync("recovery", "warning", "回顾删除前已创建保护点", id);
    render();
    toast("收藏已删除");
  }
  if (action === "export-data") {
    const blob = new Blob([JSON.stringify(store.getState(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sparkbox-backup-${getDateKey(new Date(), store.getState().preferences.timeZone)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("数据备份已导出");
  }
  if (action === "export-recovery") {
    const raw = store.getStorageStatus().recoveryRaw;
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sparkbox-recovery-${getDateKey(new Date(), store.getState().preferences.timeZone)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("原始数据已下载，请妥善保存");
  }
  if (action === "start-validation") {
    store.startValidation();
    render();
    toast("14 天验证已开始，从现在起记录真实使用数据");
  }
  if (action === "restart-validation" && confirm("确定从今天重新开始 14 天验证吗？收藏和历史记录不会删除，但本轮指标会从现在重新计算。")) {
    store.startValidation();
    render();
    toast("新的 14 天验证周期已开始");
  }
  if (action === "reset-data" && confirm("确定清除当前数据并恢复示例内容吗？系统会先创建重置前保护点。")) {
    store.reset();
    auditSync("recovery", "warning", "重置前已创建保护点", "已恢复示例数据");
    ui.modal = null;
    ui.query = "";
    ui.status = "";
    ui.smartFilter = "";
    navigate("inbox");
    render();
    toast("已恢复示例数据");
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("online", () => {
  ui.networkOnline = true;
  ui.cloudError = "";
  auditSync("network", "info", "网络已恢复", ui.cloudDirty ? "正在尝试同步本机更改" : "开始检查对象级云端变更");
  if (ui.cloudDirty && ui.user) pushCloudState({ silent: true });
  else if (ui.user) fetchItemSyncSummary({ silent: true, merge: true });
  toast(ui.cloudDirty ? "已联网，正在尝试同步本机更改" : "已恢复联网");
  render();
});
window.addEventListener("offline", () => {
  ui.networkOnline = false;
  ui.cloudError = "";
  auditSync("offline", "warning", "网络已离线", "本机数据仍可查看，联网后会继续同步");
  toast("已进入离线模式，本机数据仍可查看");
  render();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  ui.installPrompt = event;
  render();
});
window.addEventListener("appinstalled", () => {
  ui.installPrompt = null;
  ui.pwaReady = true;
  toast("已安装到主屏");
  render();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.modal) closeModal();
  if (event.key === "/" && !ui.modal && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    document.querySelector("#global-search")?.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openModal("bookmark");
  }
});

store.subscribe(markCloudDirty);
registerServiceWorker();
if (!location.hash) location.replace("#/inbox");
render();
refreshAuth();
