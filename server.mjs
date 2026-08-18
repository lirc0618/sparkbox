import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import pg from "pg";
import { requireAuth } from "./src/eazo-auth.js";

const { Pool } = pg;
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const root = process.cwd();

function loadEnvFile() {
  try {
    const raw = readFileSync(join(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (key && process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // Local development may run before .env exists; API routes return a clear configuration error.
  }
}

loadEnvFile();

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
let schemaReady = false;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".zip": "application/zip",
};

const ALLOWED_STATUSES = new Set(["inbox", "to_read", "to_action", "in_use", "reference"]);
const ALLOWED_CONTENT_TYPES = new Set(["article", "video", "social", "tool", "product", "note", "other"]);
const MAX_IMAGE_BYTES = 4_500_000;
const RESTRICTED_LINK_RULES = [
  { label: "微信/公众号", hosts: ["mp.weixin.qq.com", "weixin.qq.com"], risk: "可能需要在微信内打开，外部服务通常无法读取完整正文" },
  { label: "小红书", hosts: ["xiaohongshu.com", "xhslink.com"], risk: "常需要登录或 App 环境才能查看完整内容" },
  { label: "Bilibili", hosts: ["bilibili.com", "b23.tv"], risk: "视频内容不能仅凭链接还原，需要标题、简介或观看备注" },
  { label: "Notion/私有文档", hosts: ["notion.so", "notion.site", "feishu.cn", "larksuite.com", "yuque.com"], risk: "页面可能有私有权限，未授权时无法读取" },
  { label: "知识星球/社群", hosts: ["zsxq.com"], risk: "内容通常需要成员登录后才能查看" },
  { label: "社交媒体", hosts: ["x.com", "twitter.com", "instagram.com", "douyin.com", "tiktok.com"], risk: "动态内容可能需要登录，且上下文容易缺失" },
];

function classifyRestrictedUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const hostname = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return RESTRICTED_LINK_RULES.find((rule) => rule.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) || null;
  } catch {
    return null;
  }
}

function hasSubstantialUserContext(bookmark) {
  return [bookmark.rawText, bookmark.summary, bookmark.notes, bookmark.whySaved]
    .some((value) => String(value || "").trim().length >= 12);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, maxBytes = 1_500_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("请求内容过大，请减少图片尺寸后重试"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("请求内容格式不正确"), { status: 400 });
  }
}

function imageDataUrlByteSize(value) {
  const base64 = String(value || "").split(",")[1] || "";
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function ensureSchema() {
  if (schemaReady) return;
  if (!pool) throw Object.assign(new Error("DATABASE_URL 尚未配置"), { status: 503 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sparkbox_states (
      owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state JSONB NOT NULL,
      migrated_from_local BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sparkbox_states_updated_at_idx ON sparkbox_states(updated_at);
    CREATE TABLE IF NOT EXISTS sparkbox_sync_items (
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      version_hash TEXT NOT NULL,
      payload JSONB,
      deleted BOOLEAN NOT NULL DEFAULT false,
      client_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS sparkbox_sync_items_owner_updated_idx ON sparkbox_sync_items(owner_id, updated_at);
    CREATE INDEX IF NOT EXISTS sparkbox_sync_items_owner_type_idx ON sparkbox_sync_items(owner_id, entity_type);
  `);
  schemaReady = true;
}

function getHeader(request, name) {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : value || null;
}

function authenticate(request) {
  const result = requireAuth({ headers: { get: (name) => getHeader(request, name) } });
  if (!result.ok) {
    const error = new Error("请先登录后再同步云端数据");
    error.status = 401;
    throw error;
  }
  return result.user;
}

async function upsertUser(user) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO users (id, email, name, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = now()`,
    [user.id, user.email || null, user.name || null, user.avatarUrl || null],
  );
}

async function handleProfile(request, response) {
  try {
    const user = authenticate(request);
    await upsertUser(user);
    sendJson(response, 200, { ok: true, user });
  } catch (error) {
    sendJson(response, error.status || 500, { ok: false, error: error.message || "无法读取用户" });
  }
}

function assertStatePayload(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.bookmarks) || !Array.isArray(value.projects)) {
    throw Object.assign(new Error("同步数据格式不正确"), { status: 400 });
  }
}

function cloudStateMeta(row) {
  const state = row?.state && typeof row.state === "object" ? row.state : null;
  return {
    updatedAt: row?.updated_at || null,
    bookmarkCount: Array.isArray(state?.bookmarks) ? state.bookmarks.length : 0,
    projectCount: Array.isArray(state?.projects) ? state.projects.length : 0,
  };
}

function isSameInstant(left, right) {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && Math.abs(leftTime - rightTime) < 1000;
}

const SYNC_ENTITY_TYPES = new Set(["bookmark", "project", "preference", "review_event", "review_log", "review_selection"]);

function assertSyncItemsPayload(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    throw Object.assign(new Error("对象级同步数据格式不正确"), { status: 400 });
  }
  if (value.items.length > 1200) throw Object.assign(new Error("一次同步对象过多，请分批重试"), { status: 413 });
  for (const item of value.items) {
    if (!item || typeof item !== "object") throw Object.assign(new Error("同步对象格式不正确"), { status: 400 });
    if (!SYNC_ENTITY_TYPES.has(item.entityType)) throw Object.assign(new Error("同步对象类型不支持"), { status: 400 });
    if (typeof item.entityId !== "string" || !item.entityId.trim() || item.entityId.length > 220) throw Object.assign(new Error("同步对象 ID 不正确"), { status: 400 });
    if (typeof item.versionHash !== "string" || !item.versionHash.trim() || item.versionHash.length > 120) throw Object.assign(new Error("同步对象版本不正确"), { status: 400 });
    if (item.payload != null && (typeof item.payload !== "object" || Array.isArray(item.payload))) throw Object.assign(new Error("同步对象内容不正确"), { status: 400 });
  }
}

async function getSyncItemsSummary(ownerId) {
  const result = await pool.query(
    `SELECT
       count(*)::int AS total_count,
       count(*) FILTER (WHERE deleted)::int AS deleted_count,
       count(*) FILTER (WHERE entity_type = 'bookmark' AND NOT deleted)::int AS bookmark_count,
       count(*) FILTER (WHERE entity_type = 'project' AND NOT deleted)::int AS project_count,
       count(*) FILTER (WHERE entity_type = 'review_event' AND NOT deleted)::int AS review_event_count,
       max(updated_at) AS latest_updated_at
     FROM sparkbox_sync_items
     WHERE owner_id = $1`,
    [ownerId],
  );
  const row = result.rows[0] || {};
  return {
    totalCount: Number(row.total_count || 0),
    deletedCount: Number(row.deleted_count || 0),
    bookmarkCount: Number(row.bookmark_count || 0),
    projectCount: Number(row.project_count || 0),
    reviewEventCount: Number(row.review_event_count || 0),
    latestUpdatedAt: row.latest_updated_at || null,
  };
}

async function handleSyncItems(request, response) {
  try {
    const user = authenticate(request);
    await upsertUser(user);
    if (request.method === "GET") {
      const since = request.url ? new URL(request.url, `http://${request.headers.host}`).searchParams.get("since") : null;
      const params = since ? [user.id, since] : [user.id];
      const where = since ? "owner_id = $1 AND updated_at > $2" : "owner_id = $1";
      const items = await pool.query(
        `SELECT entity_type, entity_id, version_hash, payload, deleted, client_updated_at, updated_at
         FROM sparkbox_sync_items
         WHERE ${where}
         ORDER BY updated_at ASC
         LIMIT 1200`,
        params,
      );
      sendJson(response, 200, {
        ok: true,
        summary: await getSyncItemsSummary(user.id),
        items: items.rows.map((row) => ({
          entityType: row.entity_type,
          entityId: row.entity_id,
          versionHash: row.version_hash,
          payload: row.payload,
          deleted: Boolean(row.deleted),
          clientUpdatedAt: row.client_updated_at,
          updatedAt: row.updated_at,
        })),
      });
      return;
    }
    if (request.method === "PUT" || request.method === "POST") {
      const body = await readJsonBody(request, 2_500_000);
      assertSyncItemsPayload(body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const item of body.items) {
          await client.query(
            `INSERT INTO sparkbox_sync_items (owner_id, entity_type, entity_id, version_hash, payload, deleted, client_updated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
             ON CONFLICT (owner_id, entity_type, entity_id) DO UPDATE SET
               version_hash = EXCLUDED.version_hash,
               payload = EXCLUDED.payload,
               deleted = EXCLUDED.deleted,
               client_updated_at = EXCLUDED.client_updated_at,
               updated_at = now()`,
            [user.id, item.entityType, item.entityId, item.versionHash, item.deleted ? null : JSON.stringify(item.payload || {}), Boolean(item.deleted), item.clientUpdatedAt || null],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      sendJson(response, 200, { ok: true, updatedAt: new Date().toISOString(), summary: await getSyncItemsSummary(user.id) });
      return;
    }
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, error.status || 500, { ok: false, error: error.message || "对象级同步失败" });
  }
}

async function handleCloudState(request, response) {
  try {
    const user = authenticate(request);
    await upsertUser(user);
    if (request.method === "GET") {
      const result = await pool.query("SELECT state, migrated_from_local, updated_at FROM sparkbox_states WHERE owner_id = $1", [user.id]);
      sendJson(response, 200, { ok: true, state: result.rows[0]?.state || null, migratedFromLocal: Boolean(result.rows[0]?.migrated_from_local), updatedAt: result.rows[0]?.updated_at || null });
      return;
    }
    if (request.method === "PUT" || request.method === "POST") {
      const body = await readJsonBody(request);
      assertStatePayload(body.state);
      const remote = await pool.query("SELECT state, updated_at FROM sparkbox_states WHERE owner_id = $1", [user.id]);
      const remoteRow = remote.rows[0];
      const clientBase = body.baseUpdatedAt || body.knownUpdatedAt || null;
      if (remoteRow && !body.force && clientBase && !isSameInstant(remoteRow.updated_at, clientBase)) {
        sendJson(response, 409, {
          ok: false,
          error: "云端已有另一个设备更新，请先从云端刷新或确认覆盖。",
          conflict: true,
          remote: cloudStateMeta(remoteRow),
        });
        return;
      }
      const saved = await pool.query(
        `INSERT INTO sparkbox_states (owner_id, state, migrated_from_local, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (owner_id) DO UPDATE SET state = EXCLUDED.state, migrated_from_local = sparkbox_states.migrated_from_local OR EXCLUDED.migrated_from_local, updated_at = now()
         RETURNING updated_at`,
        [user.id, JSON.stringify(body.state), Boolean(body.migratedFromLocal)],
      );
      sendJson(response, 200, { ok: true, updatedAt: saved.rows[0]?.updated_at || new Date().toISOString() });
      return;
    }
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, error.status || 500, { ok: false, error: error.message || "云同步失败" });
  }
}

function getModelForCapability(capability = "text") {
  let modelMap = {};
  if (process.env.EAZO_AI_MODELS_JSON) {
    try { modelMap = JSON.parse(process.env.EAZO_AI_MODELS_JSON); } catch { modelMap = {}; }
  }
  return typeof modelMap[capability] === "string" ? modelMap[capability] : process.env.EAZO_AI_MODEL_KEY;
}

async function appAiChat({ capability = "text", messages, params = {}, viewerUserId = "" }) {
  const platformBase = process.env.EAZO_APP_AI_API_BASE?.replace(/\/$/, "") || process.env.EAZO_API_BASE?.replace(/\/$/, "");
  const appId = process.env.EAZO_APP_ID || process.env.NEXT_PUBLIC_EAZO_APP_ID;
  const privateKey = process.env.EAZO_PRIVATE_KEY;
  const modelKey = getModelForCapability(capability);

  if (!platformBase || !appId || !privateKey || !modelKey) {
    const error = new Error(`App AI 的 ${capability} 能力尚未配置完整，请先在 Eazo 中保存对应模型配置。`);
    error.status = 503;
    throw error;
  }

  const result = await fetch(`${platformBase}/api/app-ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-eazo-app-id": appId,
      Authorization: `Bearer ${privateKey}`,
    },
    body: JSON.stringify({ app_id: appId, model_key: modelKey, messages, viewer_user_id: viewerUserId || undefined, stream: false, params }),
    cache: "no-store",
  });

  if (!result.ok) {
    const body = await result.clone().json().catch(() => null);
    const code = body?.detail?.code || body?.code;
    const error = new Error(result.status === 402 && code === "app_ai_unavailable"
      ? "AI 功能暂时不可用。如需继续使用，请联系该应用的创作者。"
      : `App AI 请求失败：${result.status}`);
    error.status = result.status;
    error.code = code;
    throw error;
  }

  return result.json();
}

function extractJsonObject(value) {
  const text = String(value || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("AI 没有返回可解析的 JSON");
}

function stringField(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSuggestion(input) {
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => stringField(tag, 24)).filter(Boolean).slice(0, 8) : [];
  const projectNames = Array.isArray(input.projectNames) ? input.projectNames.map((name) => stringField(name, 80)).filter(Boolean).slice(0, 5) : [];
  const status = stringField(input.status, 30);
  const contentType = stringField(input.contentType, 30);
  return {
    title: stringField(input.title, 160),
    summary: stringField(input.summary, 520),
    source: stringField(input.source, 40),
    contentType: ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : "",
    whyValuable: stringField(input.whyValuable, 520),
    nextAction: stringField(input.nextAction, 260),
    tags,
    status: ALLOWED_STATUSES.has(status) ? status : "",
    projectNames,
    confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0, Math.min(1, Number(input.confidence))) : null,
  };
}

function normalizeImageExtraction(input) {
  const contentType = stringField(input.contentType, 30);
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => stringField(tag, 24)).filter(Boolean).slice(0, 8) : [];
  return {
    title: stringField(input.title, 160),
    visibleText: stringField(input.visibleText || input.rawText || input.text, 3000),
    summary: stringField(input.summary, 520),
    sourceHint: stringField(input.sourceHint || input.source, 40),
    contentType: ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : "",
    tags,
    confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0, Math.min(1, Number(input.confidence))) : null,
    warnings: Array.isArray(input.warnings) ? input.warnings.map((warning) => stringField(warning, 120)).filter(Boolean).slice(0, 4) : [],
  };
}

async function handleImageExtract(request, response) {
  try {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    let viewerUser = null;
    if (getHeader(request, "x-eazo-session")) {
      try {
        viewerUser = authenticate(request);
      } catch {
        viewerUser = null;
      }
    }
    const body = await readJsonBody(request, 7_000_000);
    const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
    const context = body.context && typeof body.context === "object" ? body.context : {};
    if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(imageDataUrl)) {
      sendJson(response, 400, { error: "请上传 PNG、JPG 或 WebP 截图" });
      return;
    }
    if (imageDataUrlByteSize(imageDataUrl) > MAX_IMAGE_BYTES) {
      sendJson(response, 413, { error: "截图太大了，请压缩到 4.5MB 以内再上传" });
      return;
    }

    const result = await appAiChat({
      capability: "vision",
      messages: [
        {
          role: "system",
          content: "你是 Sparkbox 的截图文字提取助手。用户会上传来自微信、小红书、知识星球、Notion、Bilibili 等平台的截图。只提取截图中可见的信息，不要推测截图外内容。只返回严格 JSON：title, visibleText, summary, sourceHint, contentType(article|video|social|tool|product|note|other), tags(2-6 个中文短标签), warnings, confidence(0-1)。如果文字很少或看不清，在 warnings 中说明。",
        },
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ language: "zh-CN", existingTitle: context.title || "", existingUrl: context.url || "", existingSource: context.source || "", userNote: context.notes || "" }) },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      viewerUserId: viewerUser?.id || "",
      params: { temperature: 0.1, max_tokens: 1200 },
    });
    const content = result?.choices?.[0]?.message?.content;
    const extraction = normalizeImageExtraction(extractJsonObject(content));
    if (!extraction.visibleText && !extraction.title && !extraction.summary && !extraction.sourceHint) {
      extraction.warnings = [...extraction.warnings, "没有识别到足够的可见文字，请换更清晰的截图或手动补充摘录。"].slice(0, 4);
    }
    sendJson(response, 200, { extraction });
  } catch (error) {
    if (error.status === 402 && error.code === "app_ai_unavailable") {
      sendJson(response, 402, { code: "app_ai_unavailable", message: error.message });
      return;
    }
    const message = error.status === 503
      ? "截图识别暂时不可用。你仍然可以手动粘贴可见摘录，Sparkbox 会继续保守整理。"
      : error.message || "截图提取失败";
    sendJson(response, error.status || 500, { error: message });
  }
}

async function handleOrganize(request, response) {
  try {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const viewerUser = getHeader(request, "x-eazo-session") ? authenticate(request) : null;
    const body = await readJsonBody(request);
    const bookmark = body.bookmark && typeof body.bookmark === "object" ? body.bookmark : {};
    const projects = Array.isArray(body.projects) ? body.projects.slice(0, 20) : [];
    const hasContent = [bookmark.title, bookmark.url, bookmark.rawText, bookmark.summary, bookmark.notes].some((value) => String(value || "").trim());
    if (!hasContent) {
      sendJson(response, 400, { error: "请先提供标题、链接、正文或备注后再整理" });
      return;
    }
    const accessRisk = classifyRestrictedUrl(bookmark.url);
    if (accessRisk && !hasSubstantialUserContext(bookmark)) {
      sendJson(response, 422, {
        code: "needs_user_context",
        error: `${accessRisk.label} 链接可能需要登录或 App 环境，AI 无法可靠读取正文。请补充可见标题、摘录、截图转写、保存原因或下一步意图后再整理。`,
        accessRisk,
      });
      return;
    }

    const messages = [
      {
        role: "system",
        content: "你是 Sparkbox 的收藏整理助手。你的任务是把用户保存的 URL 或文字整理成可行动的收藏记录。只返回严格 JSON，不要 Markdown。字段：title, summary, source, contentType(article|video|social|tool|product|note|other), whyValuable, nextAction, tags(3-5 个中文短标签), status(inbox|to_read|to_action|in_use|reference), projectNames(从用户已有项目中选择 0-2 个名字，不要编造项目), confidence(0-1)。不要伪造网页正文、作者观点、视频内容或平台内评论；遇到微信、小红书、知识星球、Notion、私有文档、社交媒体、视频链接时，只能基于用户提供的标题、摘录、备注、截图 OCR 转写和 rawText 做保守整理。如果信息不足，请把 summary/whyValuable/nextAction 写成需要用户补充的明确提示。", 
      },
      {
        role: "user",
        content: JSON.stringify({
          bookmark: {
            title: bookmark.title || "",
            url: bookmark.url || "",
            rawText: bookmark.rawText || "",
            summary: bookmark.summary || "",
            notes: bookmark.notes || "",
            source: bookmark.source || "",
            tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
            status: bookmark.status || "inbox",
          },
          existingProjects: projects.map((project) => ({ name: project.name, description: project.description || "" })),
          language: "zh-CN",
        }),
      },
    ];

    const result = await appAiChat({ capability: "text", messages, viewerUserId: viewerUser?.id || "", params: { temperature: 0.2, max_tokens: 900 } });
    const content = result?.choices?.[0]?.message?.content;
    const suggestion = normalizeSuggestion(extractJsonObject(content));
    sendJson(response, 200, { suggestion });
  } catch (error) {
    if (error.status === 402 && error.code === "app_ai_unavailable") {
      sendJson(response, 402, { code: "app_ai_unavailable", message: error.message });
      return;
    }
    sendJson(response, error.status || 500, { error: error.message || "AI 整理失败" });
  }
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/user/profile") {
      await handleProfile(request, response);
      return;
    }
    if (url.pathname === "/api/sync/state") {
      await handleCloudState(request, response);
      return;
    }
    if (url.pathname === "/api/sync/items") {
      await handleSyncItems(request, response);
      return;
    }
    if (url.pathname === "/api/ai/organize") {
      await handleOrganize(request, response);
      return;
    }
    if (url.pathname === "/api/ai/extract-image") {
      await handleImageExtract(request, response);
      return;
    }

    const pathname = decodeURIComponent(url.pathname);
    const publicPath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
    if (!/^(index\.html|offline\.html|styles\.css|manifest\.webmanifest|icon\.svg|sw\.js|sparkbox-mvp-full-export\.zip|src[/\\][\w.-]+\.js)$/.test(publicPath)) throw new Error("Not public");
    let filePath = join(root, publicPath);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || fileStat.isDirectory()) filePath = join(root, "index.html");
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, host, () => {
  console.log(`Sparkbox is running at http://${host}:${port}`);
});
