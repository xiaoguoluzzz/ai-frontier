# AI Frontier 资讯站自动更新整改方案

日期：2026-10-19
目标：新闻、模型排行榜、研究突破三大板块每日自动更新，部署在 GitHub Pages 上始终展示最新内容。

---

## 一、现状问题

### 1. 架构问题（最关键）

`fetch-news.js` + Windows 计划任务只能更新**本地电脑上的 index.html**。部署到 GitHub Pages 之后，线上网站是仓库里的静态文件——本地脚本跑一万次，线上也不会变。这是"内容永远是旧的"的根本原因。

### 2. 各板块问题

| 板块 | 现状 | 问题 |
|------|------|------|
| AI 新闻 | 浏览器端经 allorigins.win 免费代理抓 RSS | 代理不稳定；只有打开页面时才更新；抓取失败回退到写死的旧新闻 |
| 模型排行榜 | `LEADERBOARDS` 数组写死在 HTML | 纯演示数据，无更新机制 |
| 研究突破 | `RESEARCH` / `PAPERS` 数组写死 | 永远是 AlphaProof、AlphaFold 等旧里程碑，无最新论文流 |
| 模型库 | `MODELS` 数组写死 | 新模型发布后无人维护 |

---

## 二、目标架构：GitHub Actions 每日构建

```
GitHub Actions（每天 08:00 定时触发，公开仓库免费额度充足）
    │
    ├─ build-data.js（或 Python）
    │    ├─ ① 抓新闻 RSS × 4（TechCrunch AI / Google AI Blog / The Verge AI / MIT News AI）
    │    ├─ ② 抓研究论文（arXiv cs.AI + cs.LG RSS、Semantic Scholar API）
    │    ├─ ③ 抓真实榜单（LMArena + Artificial Analysis，详见下文）
    │    └─ ④ 生成 data/news.json、data/papers.json、data/leaderboards.json
    │
    ├─ 与上次成功的数据合并（抓取失败的板块保留旧数据，绝不写空）
    ├─ 自动 commit + push
    └─ GitHub Pages 自动重新部署（1~2 分钟生效）
```

### 页面侧改造

- `index.html` 启动时 `fetch('./data/*.json')` 加载同源 JSON（无跨域问题，比 allorigins 稳定得多）
- 加载失败时回退到内置数据，页面永不白屏
- 页面显示"数据更新时间"戳，让用户知道新鲜度
- 删除浏览器端 allorigins 抓取逻辑（或保留为"手动刷新"备选，降低主路径复杂度）

---

## 三、排行榜数据源方案（真实榜单）

公开稳定的免费榜单 API 很少，采用**双源爬取 + 结构化解析**策略：

### 源 1：LMArena（lmarena.ai）— 社区投票竞技场分数

- 目标数据：各模型的 Arena Elo / 排名
- 抓取方式：优先尝试其公开 JSON/数据端点；若无则解析页面内嵌数据（LMArena 是客户端渲染，GitHub Actions 里用 Python + 简单 HTML/JSON 解析）
- 用途：对应站内「综合能力」榜

### 源 2：Artificial Analysis（artificialanalysis.ai）— 智能指数与性价比

- 目标数据：Intelligence Index、输出速度、价格
- 抓取方式：解析模型页 HTML 表格（服务端渲染较友好，稳定度高）
- 用途：可扩展出「性价比」「速度」两个新榜单维度

### 容错策略（重要）

- 每个源独立 try/catch：某个源挂了不影响另一个
- 抓取失败时**沿用上次成功的数据**，并在 JSON 里标注 `stale: true` + 上次更新时间
- 页面上对应榜单显示"数据截至 X 月 X 日"，而不是显示空白或报错
- 每月人工检查一次解析脚本是否被源站改版打挂（GitHub Actions 失败会发邮件通知）

### 榜单维度（最终落地）

| 站内榜单 | 数据来源 | 说明 |
|----------|----------|------|
| 综合能力 | LMArena Elo | 真实竞技场分数 |
| 数学推理 | Artificial Analysis / 含数学基准的公开成绩 | 若源数据缺此项则暂用 Elo 近似并标注 |
| 编程能力 | Artificial Analysis Coding Index | 真实数据 |
| 通用推理 | LMArena + AA 推理相关指数 | 综合 |

页面上移除"演示数据"免责声明，改为标注真实来源与抓取时间。

---

## 四、研究板块改造（里程碑 + 最新论文）

保留现有 6 个里程碑介绍卡（AlphaProof、AlphaFold 3 等，作为"经典突破"），新增「最新研究动态」区：

- 数据源：arXiv cs.AI + cs.LG RSS、Semantic Scholar API（免费、稳定、无需 key 的公开端点）
- 每日抓 8~12 条最新高相关论文（标题、作者、摘要、链接、日期）
- 按关键词自动归类：数学推理 / 模型架构 / 多模态 / 对齐安全 / 其它
- `PAPERS` 数组同步被每日更新替换

---

## 五、新闻板块改造

- 抓取逻辑从"浏览器端"搬到"GitHub Actions 服务端"（Node 原生 fetch，不需要 allorigins 代理）
- 保留现有 4 个 RSS 源 + 分类规则（模型发布 / 行业动态 / 技术突破 / 开源项目）
- 页面加载 `data/news.json`，每条带日期和原文链接
- 可选保留"手动刷新"按钮作为加分项

---

## 六、实施步骤（建议顺序）

1. **数据层**：写 `scripts/build-data.js`——先做新闻+论文（成熟稳定），输出 `data/*.json`
2. **页面层**：改造 `index.html` 支持外部 JSON 加载 + 内置数据回退 + 更新时间戳
3. **自动化**：写 `.github/workflows/daily-update.yml`，每天定时跑构建脚本并自动 commit
4. **排行榜**：写榜单抓取模块（先 Artificial Analysis，后 LMArena），接入 `data/leaderboards.json`
5. **研究增强**：接入 Semantic Scholar，做"最新论文"区
6. **联调**：手动触发 workflow 验证全链路，确认 Pages 重新部署后内容变新

## 七、技术要点与风险

| 事项 | 说明 |
|------|------|
| GitHub Actions 免费额度 | 公开仓库无限分钟（合理使用），私有仓库每月 2000 分钟；每天一次每次约 1 分钟，完全够用 |
| 自动 commit 需要权限 | workflow 里用 `GITHUB_TOKEN`，需 `permissions: contents: write` |
| 榜单爬虫脆弱性 | 无法完全消除；靠"失败保留旧数据 + 邮件通知 + 每月检查"兜底 |
| allorigins 依赖 | 主路径移除后，站点不再依赖第三方代理 |
| 数据文件体积 | JSON 每天几十 KB，一年也不会撑爆仓库（或可开启 git 历史清理） |
| 免责标注 | 真实榜单接入后注明数据来源名称与抓取时间，规避"官方评测"误解 |

## 八、验收标准

- [ ] 打开线上网站，新闻/论文/排行榜显示的是当天或前一天的内容
- [ ] 页面显示"数据更新时间：YYYY-MM-DD HH:mm"
- [ ] GitHub Actions 连续 3 天自动运行成功
- [ ] 人为关掉网络模拟抓取失败时，页面回退显示旧数据、不白屏
- [ ] 排行榜来源标注清晰，不再是"演示数据"
