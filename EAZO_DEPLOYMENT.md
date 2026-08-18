# Eazo Creator 迁移与部署说明

## 当前迁移状态

项目已经接入 Eazo 邮箱登录、PostgreSQL 云端状态、对象级同步账本、冲突检测以及 App AI 接口。当前数据库使用 `sparkbox_states` 保存整份状态 JSON，并用 `sparkbox_sync_items` 支持对象级合并；下文的规范化业务表仍是下一阶段目标，不是当前实现。

本地运行可以不配置云端环境变量；云同步需要 `DATABASE_URL`，AI 还需要 Eazo App ID、API 地址和私钥。部署前先运行 `npm ci && npm test && npm run check`。

## 迁移目标

当前项目是已经跑通交互与规则的本地优先应用。下一阶段迁移应保留界面信息架构与可解释的每日回顾规则，逐步把 JSON 状态同步替换为规范化业务表，并增加异步网页提取与 AI 结构化处理。

Eazo Creator 的公开页面说明其覆盖前端、后端、数据库和部署，但没有公开列出“导入现有代码”的固定步骤。因此应以你当前 Creator 界面为准：如果支持上传项目文件，上传完整 ZIP；如果只支持对话生成，就把 ZIP 作为视觉/逻辑参考，并粘贴下面的迁移提示词。

发布前务必将应用可见性设为 `private` 或 `unlisted`，关闭公开发现与 Remix。Eazo 隐私政策说明，未选择私有、非公开或受限设置时，Creator 应用可能默认公开；公开应用也可能默认允许 Remix。

## 推荐实施顺序

1. 在 Eazo Creator 新建私人项目，名称为“收藏激活”。
2. 上传本项目 ZIP（若界面支持），并说明它是已验证的前端交互原型。
3. 粘贴下方迁移提示词，让 Creator 先完成数据库与真实 CRUD。
4. 使用本地“数据与设置”中的 JSON 导出功能准备测试数据，随后导入 20–30 条真实收藏。
5. 验收刷新持久化、重复链接、项目多对多关系和同日稳定回顾。
6. 最后再接网页提取与 AI，不要让抓取失败阻塞原始 URL 保存。
7. 部署前再次确认：private/unlisted、关闭 Remix、无测试隐私数据。

## 可直接粘贴的迁移提示词

```text
请将我上传的 Sparkbox 项目迁移为 Eazo Creator 原生的单用户私人应用。

上传项目是已经验证过交互、视觉和每日回顾规则的前端 MVP。请优先复用它的信息架构和界面，不要重新设计成聊天应用。目标是把浏览器 localStorage 数据层替换为 Eazo 原生后端与数据库，并完成可真实部署的持久化版本。

本轮要求：

1. 建立 items、projects、tags、item_tags、item_projects、review_events、user_settings 数据表；所有业务表保留 owner_id。
2. 将 src/store.js 中的收藏 CRUD、项目 CRUD、多项目关联、状态变更、行为记录和设置读写替换为真实数据库操作。
3. 保留 src/domain.js 中的 URL 规范化、重复检测、搜索和每日回顾规则。
4. 今日回顾同一天必须稳定；已使用、已归档、不再推荐和尚未到 next_review_at 的内容不得重新入选。
5. 保存 URL 时先立即创建原始记录，再异步执行网页提取和 AI 处理。抓取失败不得丢失 URL，不得编造摘要。
6. AI 输出：标题、来源域名、内容类型、约 120 字中文摘要、潜在价值、建议下一步、3–5 个标签、建议项目和置信度。
7. 保留当前桌面左侧导航、移动端底部导航、空状态、加载反馈、失败重试和删除二次确认。
8. JSON 导出必须包含全部业务数据。
9. 应用默认简体中文、Asia/Shanghai、每日回顾 3 条、稍后提醒 3 天。
10. 不实现公开注册、团队、支付、社区、知识图谱或复杂推荐模型。

请先完成数据库 schema 和真实 CRUD，逐项报告验收结果；不要用前端模拟状态、硬编码列表或假按钮代替后端功能。
```

## 推荐数据表映射

### items

`id, owner_id, input_type, source_url, canonical_url, source_domain, content_type, title, raw_text, summary, why_saved, why_valuable, next_action, importance, triage_status, lifecycle_status, processing_status, processing_error, ai_confidence, saved_at, last_reviewed_at, next_review_at, used_at, skip_count, created_at, updated_at`

### projects

`id, owner_id, name, goal, status, due_date, color, created_at, updated_at`

### 关联与行为

- `tags`：用户范围内 `normalized_name` 唯一。
- `item_tags`：收藏与标签多对多。
- `item_projects`：收藏与项目多对多。
- `review_events`：记录 surfaced、opened、used、added_to_project、snoozed、skipped、dismissed、deleted。
- `user_settings`：每日数量、语言、时区、默认稍后天数。

## Eazo 验收清单

- [ ] 新增 URL 后记录立即可见，刷新仍存在。
- [ ] 抓取失败保留原链接，并提供手动补充与重试。
- [ ] 规范化后的重复 URL 会提示已有记录。
- [ ] 一条收藏可关联多个项目。
- [ ] 搜索覆盖标题、摘要、正文、标签、收藏原因和项目名。
- [ ] 今日结果在同一天刷新后不变化。
- [ ] 稍后提醒未到期、已使用和 dismissed 内容不入选。
- [ ] 回顾动作写入 review_events。
- [ ] JSON 导出包含所有业务表。
- [ ] 手机和桌面都能完成收藏、整理、搜索、回顾和使用记录。
- [ ] 应用为 private/unlisted，公开发现与 Remix 已关闭。
