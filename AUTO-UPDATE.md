# AI Frontier — 数据每日自动更新说明

## 架构总览

新闻、论文、排行榜三大板块通过 **GitHub Actions 每日构建** 自动更新，部署在 GitHub Pages 上始终展示最新内容：

```
GitHub Actions（每天 08:00 北京时间定时触发，公开仓库免费）
    │
    ├─ scripts/build-data.js
    │    ├─ ① 抓新闻 RSS × 4（TechCrunch AI / Google AI Blog / The Verge AI / MIT News AI）
    │    ├─ ② 抓研究论文（arXiv cs.AI + cs.LG、Semantic Scholar API）
    │    ├─ ③ 抓真实榜单（LMArena 社区投票 + Artificial Analysis 智能指数/基准）
    │    └─ ④ 生成 data/news.json、data/papers.json、data/leaderboards.json
    │
    ├─ 与上次成功的数据合并（抓取失败的板块保留旧数据并标注 stale，绝不写空）
    ├─ 自动 commit + push（GITHUB_TOKEN，permissions: contents: write）
    └─ GitHub Pages 自动重新部署（1~2 分钟生效）
```

页面侧（`index.html`）启动时 `fetch('./data/*.json')` 加载同源 JSON，无跨域问题、不依赖第三方代理；加载失败时回退内置兜底数据，页面永不白屏。页面各板块显示「数据更新时间」，榜单标注真实来源与抓取时间。

> **为什么不用本地计划任务更新 index.html？** 旧方案（fetch-news.js + Windows 计划任务）只能改本地文件，线上 GitHub Pages 是仓库里的静态文件，本地跑一万次线上也不会变。现在数据以 JSON 文件形式入库，由 Actions 提交后线上自动生效。

## 日常使用

### 自动更新（主机制，零操作）

1. 将本项目推送到 **GitHub 公开仓库**，并开启 GitHub Pages（部署分支 = 仓库根目录或 main）
2. `.github/workflows/daily-update.yml` 每天 08:00 自动运行
3. 无需开机、无需任何本地操作

**手动触发一次验证全链路**：仓库页 → Actions → Daily Data Update → Run workflow。成功后 1~2 分钟内刷新线上页面，确认「数据更新时间」变为当天、新闻/论文内容变新。

### 本地手动更新（可选备用）

用于本地预览，或无法使用 GitHub Actions 时：

- 双击 `update-news.bat`（内部运行 `node scripts/build-data.js`）
- 或命令行：`node scripts/build-data.js`

注意：本地更新的是本地 `data/*.json`，需 `git push` 后才会影响线上。

`setup-daily-update.bat` 可注册 Windows 计划任务每天本地更新（仅作备用；GitHub Actions 才是主机制）。

`fetch-news.js` 已废弃，运行时自动转发到 `scripts/build-data.js`。

## 数据源

| 板块 | 文件 | 数据源 |
|------|------|--------|
| AI 新闻 | `data/news.json` | TechCrunch AI / Google AI Blog / The Verge AI / MIT News AI（RSS） |
| 研究论文 | `data/papers.json` | arXiv cs.AI + cs.LG（RSS）、Semantic Scholar API |
| 综合能力榜 | `data/leaderboards.json` | LMArena 社区投票竞技场（失败时用 Artificial Analysis 智能指数） |
| 数学推理榜 | 同上 | Artificial Analysis（AIME 25；缺测时用智能指数近似并标注） |
| 编程能力榜 | 同上 | Artificial Analysis（LiveCodeBench / FrontierCode） |
| 通用推理榜 | 同上 | Artificial Analysis（GPQA / HLE） |

新闻按标题自动分类（模型发布 / 行业动态 / 技术突破 / 开源项目）；论文按关键词自动归类（数学推理 / 模型架构 / 多模态 / 对齐安全 / 其它）。

## 容错策略

1. **单源失败不影响其它源**：每个源独立 try/catch，一个 RSS 或榜单源挂了不影响整体
2. **失败保留旧数据**：板块抓取结果为空时沿用上一次成功的数据，JSON 标注 `stale: true`，页面显示「数据截至 X 月 X 日（沿用历史数据）」
3. **绝不写空**：脚本不会用空数组覆盖旧数据文件
4. **页面永不白屏**：`data/*.json` 加载失败（如离线、file:// 直接打开）时回退内置兜底数据
5. **榜单爬虫脆弱性**：源站改版可能导致解析失败，靠上述兜底 + Actions 失败邮件通知 + 每月人工检查解析脚本

## 验收清单

- [ ] 打开线上网站，新闻/论文/排行榜显示的是当天或前一天的内容
- [ ] 页面显示「数据更新时间：YYYY-MM-DD HH:mm」
- [ ] GitHub Actions 连续 3 天自动运行成功
- [ ] 断网或删除 data 目录后，页面回退显示内置数据、不白屏
- [ ] 排行榜标注真实来源与抓取时间，不再是「演示数据」

## 技术说明

| 事项 | 说明 |
|------|------|
| GitHub Actions 免费额度 | 公开仓库不限分钟（合理使用）；每天一次约 1 分钟 |
| 自动 commit 权限 | workflow 使用 `GITHUB_TOKEN`，已配置 `permissions: contents: write` |
| 数据文件体积 | JSON 每天几十 KB，不会撑爆仓库 |
| 免责标注 | 榜单标注数据来源名称与抓取时间，仅供学习交流，非官方评测结论 |
| 抓取时间 | 以 GitHub Actions 运行时 UTC 为准，页面按浏览器本地时区展示 |
