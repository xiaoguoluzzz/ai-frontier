#!/usr/bin/env node
/**
 * AI Frontier — 全站数据构建脚本
 *
 * 在 GitHub Actions（每日定时）或本地手动运行，生成：
 *   data/news.json         AI 新闻（TechCrunch / Google AI Blog / The Verge / MIT News 的 RSS）
 *   data/papers.json       最新研究论文（arXiv cs.AI + cs.LG、Semantic Scholar API）
 *   data/leaderboards.json 真实榜单（LMArena 社区投票 + Artificial Analysis 智能指数/基准）
 *
 * 容错策略（与《AI-Frontier-整改方案》一致）：
 *   - 每个数据源独立 try/catch，单源失败不影响其它源
 *   - 板块抓取结果为空时，沿用上一次成功的数据并在 JSON 里标注 stale: true
 *   - 绝不写入空数组覆盖旧数据；页面侧另有内置数据兜底，永不白屏
 *
 * 用法：
 *   node scripts/build-data.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── 基础工具 ─────────────────────────────────────────────

function fetchText(url, opts) {
  opts = opts || {};
  return fetch(url, {
    headers: Object.assign(
      {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml, application/json, text/html, */*"
      },
      opts.headers || {}
    ),
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeout || 20000)
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractItems(xml) {
  const items = [];
  let m;
  const reItem = /<item[\s>]([\s\S]*?)<\/item>/g;
  const reEntry = /<entry[\s>]([\s\S]*?)<\/entry>/g;
  while ((m = reItem.exec(xml))) items.push(m[1]);
  while ((m = reEntry.exec(xml))) items.push(m[1]);
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i");
  const m = block.match(re);
  return m ? stripHtml(m[1]) : "";
}

function extractLink(block) {
  const a = block.match(/<link[^>]*href=["']([^"']+)["']/);
  if (a) return a[1];
  const l = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  return l ? stripHtml(l[1]) : "";
}

function extractDate(block) {
  const d =
    extractTag(block, "pubDate") ||
    extractTag(block, "published") ||
    extractTag(block, "updated") ||
    extractTag(block, "dc:date");
  if (!d) return "";
  const t = Date.parse(d);
  return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
}

function slugify(title, index) {
  const base = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return (base || "item") + "-" + index;
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter(function (x) {
    const k = keyFn(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log("✓ 已写入 " + path.relative(ROOT, file));
}

/** 板块合并：抓到新数据用新数据；否则沿用旧数据并标 stale；都为空则返回 null（不覆盖） */
function mergeSection(prevItems, freshItems) {
  if (freshItems && freshItems.length) {
    return { items: freshItems, stale: false };
  }
  if (prevItems && prevItems.length) {
    return { items: prevItems, stale: true };
  }
  return { items: [], stale: true };
}

// ── 新闻分类 / 模型识别 ─────────────────────────────────

function classify(title, fallback) {
  const t = String(title).toLowerCase();
  if (/\b(open[- ]?source|open weights|weights released|under (an? )?(mit|apache|cc)\b)/.test(t)) return "open-source";
  if (
    /\b(release|launch|unveil|debut|introduce|announce|announces|rolls? out|new model|gpt|claude|gemini|llama|deepseek|qwen|mistral|opus|sonnet)\b/.test(t)
  )
    return "model-release";
  if (/\b(breakthrough|research|paper|benchmark|reasoning|math|science|discovery|achieves|solve|proof)\b/.test(t)) return "breakthrough";
  return fallback || "industry";
}

function detectModel(title) {
  const candidates = [
    { k: /gpt-?5\.5|gpt-?5\b|chatgpt/i, slug: "gpt-5-5", name: "GPT-5.5", company: "OpenAI" },
    { k: /claude.*opus|opus.*4\.7/i, slug: "claude-opus-4-7", name: "Claude Opus 4.7", company: "Anthropic" },
    { k: /claude.*sonnet|sonnet.*4\.6/i, slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", company: "Anthropic" },
    { k: /gemini.*3.*deep|deep think/i, slug: "gemini-3-deep-think", name: "Gemini 3 Deep Think", company: "Google" },
    { k: /gemini/i, slug: "gemini-3", name: "Gemini 3", company: "Google" },
    { k: /deepseek/i, slug: "deepseek-v4", name: "DeepSeek V4", company: "DeepSeek" },
    { k: /qwen/i, slug: "qwen3-max", name: "Qwen3-Max", company: "阿里云" },
    { k: /llama.*maverick|maverick/i, slug: "llama-4-maverick", name: "Llama 4 Maverick", company: "Meta" },
    { k: /llama.*scout|scout/i, slug: "llama-4-scout", name: "Llama 4 Scout", company: "Meta" }
  ];
  for (const c of candidates) if (c.k.test(title)) return c;
  return null;
}

// ── ① 新闻（RSS × 4） ───────────────────────────────────

const NEWS_SOURCES = [
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", category: "industry" },
  { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", category: "breakthrough" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", category: "industry" },
  { name: "MIT News AI", url: "https://news.mit.edu/rss/topic/artificial-intelligence2", category: "breakthrough" }
];
const MODEL_SOURCES = [
  { name: "OpenAI", url: "https://openai.com/blog/rss.xml", category: "model-release" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", category: "industry" },
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", category: "industry" }
];
const MAX_PER_SOURCE = 5;

async function grabFeed(src, collector, label) {
  try {
    const xml = await fetchText(src.url);
    const items = extractItems(xml).slice(0, MAX_PER_SOURCE);
    items.forEach(function (raw) {
      const title = extractTag(raw, "title");
      const summary = extractTag(raw, "description") || extractTag(raw, "summary") || extractTag(raw, "content");
      const link = extractLink(raw);
      const date = extractDate(raw);
      if (!title) return;
      collector.push({
        title: title.slice(0, 120),
        summary: summary.slice(0, 240),
        link: link,
        date: date,
        source: src.name,
        category: classify(title, src.category)
      });
    });
    console.log("  ✓ " + label + " · " + src.name + " → " + items.length + " 条");
  } catch (e) {
    console.log("  ✗ " + label + " · " + src.name + " 失败: " + e.message);
  }
}

async function buildNews(prev) {
  console.log("\n[1/3] 抓取新闻 RSS ...");
  const news = [];
  const models = [];
  for (const src of NEWS_SOURCES) await grabFeed(src, news, "新闻");
  for (const src of MODEL_SOURCES) await grabFeed(src, models, "模型");

  const modelSignals = models
    .map(function (n) {
      return { n: n, m: detectModel(n.title) };
    })
    .filter(function (x) {
      return x.m;
    });

  const dedupe = function (arr) {
    return dedupeBy(arr, function (n) {
      return n.title.toLowerCase().slice(0, 60);
    });
  };

  const finalNews = dedupe(news)
    .sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    })
    .slice(0, 14);

  const finalModels = dedupe(modelSignals.map(function (x) { return x.n; })).slice(0, 6);

  const toItem = function (n, i, model) {
    return {
      id: String(i + 1),
      slug: slugify(n.title, i + 1),
      title: n.title,
      summary: (model ? model.name + " 相关动态：" : "") + (n.summary || n.title),
      category: model ? "model-release" : n.category,
      publishedAt: n.date || new Date().toISOString().slice(0, 10),
      source: n.source,
      sourceUrl: n.link,
      relatedModels: model ? [model.slug] : [],
      content: [
        ["p", n.summary || n.title],
        ["p", "来源：" + n.source + (n.link ? "。点击「查看原文」阅读完整报道。" : "。")]
      ]
    };
  };

  const items = [];
  finalModels.forEach(function (n) {
    const m = detectModel(n.title);
    if (m) items.push(toItem(n, items.length + 1, m));
  });
  finalNews.forEach(function (n) {
    if (detectModel(n.title)) return; // 与模型动态去重
    items.push(toItem(n, items.length + 1, null));
  });

  const merged = mergeSection(prev && prev.items, items.slice(0, 18));
  console.log("  新闻合计 " + merged.items.length + " 条" + (merged.stale ? "（沿用旧数据）" : ""));
  return {
    updatedAt: merged.stale && prev && prev.updatedAt ? prev.updatedAt : nowIso(),
    builtAt: nowIso(),
    stale: merged.stale,
    sources: NEWS_SOURCES.map(function (s) { return s.name; }),
    items: merged.items
  };
}

// ── ② 研究论文（arXiv + Semantic Scholar） ───────────────

const ARXIV_SOURCES = [
  { name: "arXiv cs.AI", url: "https://export.arxiv.org/rss/cs.AI" },
  { name: "arXiv cs.LG", url: "https://export.arxiv.org/rss/cs.LG" }
];

const PAPER_CATEGORIES = [
  { id: "数学推理", k: /\b(math|theorem|reasoning|arithmetic|geometry|olympiad|proof|algebra)\b/i },
  { id: "模型架构", k: /\b(architecture|transformer|mixture of experts|\bmoe\b|scaling|training|efficient|attention|parameter)\b/i },
  { id: "多模态", k: /\b(multimodal|vision|image|video|speech|audio|visual|vlm)\b/i },
  { id: "对齐安全", k: /\b(alignment|safety|rlhf|dpo|interpretability|jailbreak|robustness|harmless|red team)\b/i }
];

function classifyPaper(title, summary) {
  const t = (title || "") + " " + (summary || "");
  for (const c of PAPER_CATEGORIES) if (c.k.test(t)) return c.id;
  return "其它";
}

async function buildPapers(prev) {
  console.log("\n[2/3] 抓取研究论文 ...");
  const collected = [];

  for (const src of ARXIV_SOURCES) {
    try {
      const xml = await fetchText(src.url);
      extractItems(xml)
        .slice(0, 8)
        .forEach(function (raw) {
          const title = extractTag(raw, "title");
          const summary = extractTag(raw, "description") || extractTag(raw, "summary") || "";
          const link = extractLink(raw) || "";
          const date = extractDate(raw);
          if (!title) return;
          collected.push({
            title: title.slice(0, 160),
            authors: extractTag(raw, "author") || src.name,
            venue: (date ? date + " · " : "") + src.name,
            link: link,
            date: date,
            summary: summary.slice(0, 240),
            category: classifyPaper(title, summary)
          });
        });
      console.log("  ✓ " + src.name + " → 抓取成功");
    } catch (e) {
      console.log("  ✗ " + src.name + " 失败: " + e.message);
    }
  }

  // Semantic Scholar（免费公开端点，限流时静默跳过）
  try {
    const url =
      "https://api.semanticscholar.org/graph/v1/paper/search" +
      "?query=large+language+model+reasoning&limit=8" +
      "&fields=title,authors,year,venue,publicationDate,url,abstract";
    const json = JSON.parse(await fetchText(url, { headers: { Accept: "application/json" } }));
    (json.data || []).forEach(function (p) {
      const title = p.title || "";
      if (!title) return;
      const authors = (p.authors || [])
        .slice(0, 3)
        .map(function (a) { return a.name; })
        .join(", ");
      collected.push({
        title: title.slice(0, 160),
        authors: authors || "Semantic Scholar",
        venue: (p.publicationDate || (p.year ? String(p.year) : "") ? (p.publicationDate || p.year) + " · " : "") + (p.venue || "Semantic Scholar"),
        link: p.url || (p.externalIds && p.externalIds.DOI ? "https://doi.org/" + p.externalIds.DOI : ""),
        date: p.publicationDate ? String(p.publicationDate).slice(0, 10) : "",
        summary: String(p.abstract || "").slice(0, 240),
        category: classifyPaper(title, p.abstract || "")
      });
    });
    console.log("  ✓ Semantic Scholar → " + (json.data || []).length + " 条");
  } catch (e) {
    console.log("  ✗ Semantic Scholar 失败: " + e.message);
  }

  const items = dedupeBy(collected, function (p) {
    return p.title.toLowerCase().slice(0, 60);
  })
    .sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    })
    .slice(0, 12)
    .map(function (p, i) {
      return Object.assign({ id: "p" + (i + 1), slug: slugify(p.title, i + 1) }, p);
    });

  const merged = mergeSection(prev && prev.items, items);
  console.log("  论文合计 " + merged.items.length + " 条" + (merged.stale ? "（沿用旧数据）" : ""));
  return {
    updatedAt: merged.stale && prev && prev.updatedAt ? prev.updatedAt : nowIso(),
    builtAt: nowIso(),
    stale: merged.stale,
    sources: ["arXiv cs.AI", "arXiv cs.LG", "Semantic Scholar"],
    items: merged.items
  };
}

// ── ③ 排行榜（LMArena + Artificial Analysis） ────────────

/** 从 Next.js RSC 载荷（self.__next_f.push）中拼出纯文本 */
function extractNextFBlob(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      chunks.push(JSON.parse(m[1]));
    } catch (e) {
      /* 忽略无法解码的分片 */
    }
  }
  return chunks.join("");
}

/** 在文本中提取 key 之后的 JSON 数组（字符串感知的括号匹配） */
function extractJsonArrayAfter(text, key) {
  const idx = text.indexOf(key);
  if (idx < 0) return null;
  const start = text.indexOf("[", idx + key.length - 1);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length && j < start + 500000; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, j + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Artificial Analysis：解析 models 页内嵌的 initialModels 数组。
 * 字段含 intelligenceIndex、aime25（数学）、livecodebench（编程）、gpqa（推理）等。
 */
async function scrapeArtificialAnalysis() {
  const html = await fetchText("https://artificialanalysis.ai/models", { timeout: 30000 });
  const blob = extractNextFBlob(html) || html;
  let models = extractJsonArrayAfter(blob, '"initialModels":[');
  if (!models || !models.length) {
    // 兜底：直接在原文里找
    models = extractJsonArrayAfter(html.replace(/\\"/g, '"'), '"initialModels":[');
  }
  if (!models || !models.length) throw new Error("未找到 initialModels 数据块");

  const cleaned = models
    .filter(function (m) {
      return m && typeof m === "object" && m.name;
    })
    .map(function (m) {
      const creator = m.creator && typeof m.creator === "object" ? m.creator.name : m.creator;
      return {
        name: m.shortName || m.name,
        fullName: m.name,
        company: creator || "",
        releaseDate: m.releaseDate || "",
        isOpenWeights: !!m.isOpenWeights,
        intelligenceIndex: numOrNull(m.intelligenceIndex),
        aime25: numOrNull(m.aime25),
        livecodebench: numOrNull(m.livecodebench),
        frontierCode: numOrNull(m.frontierCode),
        gpqa: numOrNull(m.gpqa),
        hle: numOrNull(m.hle),
        mmmuPro: numOrNull(m.mmmuPro),
        priceIn: numOrNull(m.price1mInputTokens),
        priceOut: numOrNull(m.price1mOutputTokens)
      };
    })
    .filter(function (m) {
      return m.intelligenceIndex != null;
    });

  if (!cleaned.length) throw new Error("initialModels 解析为空");
  console.log("  ✓ Artificial Analysis → " + cleaned.length + " 个模型");
  return cleaned;
}

function numOrNull(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * LMArena / arena.ai：解析排行条目（rank / modelDisplayName / modelOrganization / rating / votes）。
 * 数据可能以转义 JSON 形式嵌在 HTML 里，两种形态都尝试。
 */
async function scrapeLMArena() {
  const urls = ["https://lmarena.ai/leaderboard", "https://arena.ai/leaderboard"];
  let html = null;
  for (const u of urls) {
    try {
      html = await fetchText(u, { timeout: 30000 });
      break;
    } catch (e) {
      console.log("  · " + u + " 不可用: " + e.message);
    }
  }
  if (!html) throw new Error("LMArena 页面均不可达");

  const entryRe =
    /\\?"rank\\?"\s*:\s*(\d+)\s*,\s*\\?"rankUpper\\?"\s*:\s*\d+\s*,\s*\\?"rankLower\\?"\s*:\s*\d+\s*,\s*\\?"modelKey\\?"\s*:\s*\\?"(?:[^"\\]|\\.)*?\\?"\s*,\s*\\?"modelDisplayName\\?"\s*:\s*\\?"((?:[^"\\]|\\.)+?)\\?"\s*,\s*\\?"rating\\?"\s*:\s*([0-9.]+)\s*,\s*\\?"ratingUpper\\?"\s*:\s*[0-9.]+\s*,\s*\\?"ratingLower\\?"\s*:\s*[0-9.]+\s*,\s*\\?"votes\\?"\s*:\s*(\d+)\s*,\s*\\?"modelOrganization\\?"\s*:\s*\\?"((?:[^"\\]|\\.)+?)\\?"/g;

  const pool = html + "\n" + extractNextFBlob(html).replace(/"/g, '\\"');
  const byName = new Map();
  let m;
  while ((m = entryRe.exec(pool))) {
    const name = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (byName.has(name)) continue;
    byName.set(name, {
      rank: parseInt(m[1], 10),
      model: name,
      company: m[5].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      rating: parseFloat(m[3]),
      votes: parseInt(m[4], 10)
    });
  }
  const entries = Array.from(byName.values()).sort(function (a, b) {
    return a.rank - b.rank;
  });
  if (!entries.length) throw new Error("未解析到排行条目");
  console.log("  ✓ LMArena → " + entries.length + " 个模型");
  return entries;
}

/** 基准值格式化：0~1 小数按百分比展示，其余按原值展示 */
function formatScore(raw) {
  if (raw == null || !isFinite(raw)) return "—";
  if (Math.abs(raw) <= 1.5) return (raw * 100).toFixed(1) + "%";
  if (Math.abs(raw) >= 100) return String(Math.round(raw));
  return raw.toFixed(1);
}

/** 把指标数组转成排行榜条目（score 原始值 + displayScore 展示文案 + barPct 条形图百分比） */
function toBoardEntries(list, metricKey, limit) {
  const scored = list
    .filter(function (m) {
      return m[metricKey] != null;
    })
    .sort(function (a, b) {
      return b[metricKey] - a[metricKey];
    })
    .slice(0, limit || 8);
  const max = scored.length ? scored[0][metricKey] : 1;
  return scored.map(function (m, i) {
    const raw = m[metricKey];
    return {
      rank: i + 1,
      model: m.name || m.fullName || m.model,
      company: m.company || "",
      score: raw,
      displayScore: formatScore(raw),
      barPct: Math.max(6, Math.round((raw / (max || 1)) * 100))
    };
  });
}

async function buildLeaderboards(prev) {
  console.log("\n[3/3] 抓取模型排行榜 ...");
  let aa = null;
  let arena = null;

  try {
    aa = await scrapeArtificialAnalysis();
  } catch (e) {
    console.log("  ✗ Artificial Analysis 失败: " + e.message);
  }
  try {
    arena = await scrapeLMArena();
  } catch (e) {
    console.log("  ✗ LMArena 失败: " + e.message);
  }

  const freshBoards = [];
  const builtAt = nowIso();

  // 综合能力：优先 LMArena 社区投票；否则 Artificial Analysis 智能指数
  if (arena && arena.length) {
    const maxRating = arena[0].rating || 1;
    freshBoards.push({
      id: "comprehensive",
      name: "综合能力",
      description: "综合评估模型在多个任务上的整体表现",
      source: "LMArena（社区投票竞技场）",
      sourceUrl: "https://lmarena.ai/leaderboard",
      scoreLabel: "Arena 分",
      updatedAt: builtAt,
      stale: false,
      entries: arena.slice(0, 8).map(function (e, i) {
        const scaled = e.rating * 1000;
        return {
          rank: i + 1,
          model: e.model,
          company: e.company,
          score: scaled,
          displayScore: String(Math.round(scaled)),
          barPct: Math.max(6, Math.round((e.rating / (maxRating || 1)) * 100)),
          votes: e.votes
        };
      })
    });
  } else if (aa && aa.length) {
    const board = {
      id: "comprehensive",
      name: "综合能力",
      description: "综合评估模型在多个任务上的整体表现",
      source: "Artificial Analysis 智能指数",
      sourceUrl: "https://artificialanalysis.ai/models",
      scoreLabel: "智能指数",
      updatedAt: builtAt,
      stale: false,
      entries: toBoardEntries(aa, "intelligenceIndex", 8)
    };
    freshBoards.push(board);
  }

  // 数学推理：AA aime25；缺测时用智能指数近似并标注
  if (aa && aa.length) {
    const hasMath = aa.some(function (m) { return m.aime25 != null; });
    freshBoards.push({
      id: "math",
      name: "数学推理",
      description: hasMath
        ? "评估模型在数学问题求解上的能力（AIME 25 基准）"
        : "评估模型在数学问题求解上的能力（部分模型缺数学基准成绩，暂用智能指数近似排序）",
      source: hasMath ? "Artificial Analysis（AIME 25）" : "Artificial Analysis 智能指数（近似）",
      sourceUrl: "https://artificialanalysis.ai/models",
      scoreLabel: hasMath ? "AIME 25" : "智能指数",
      updatedAt: builtAt,
      stale: false,
      entries: toBoardEntries(aa, hasMath ? "aime25" : "intelligenceIndex", 8),
      approx: !hasMath
    });
  }

  // 编程能力：AA LiveCodeBench（缺测用 frontierCode）
  if (aa && aa.length) {
    const hasCode = aa.some(function (m) { return m.livecodebench != null; });
    const key = hasCode ? "livecodebench" : "frontierCode";
    const hasAny = aa.some(function (m) { return m[key] != null; });
    if (hasAny) {
      const benchName = hasCode ? "LiveCodeBench" : "FrontierCode";
      freshBoards.push({
        id: "coding",
        name: "编程能力",
        description: "评估模型在代码生成和理解上的表现（" + benchName + " 基准）",
        source: "Artificial Analysis（" + benchName + "）",
        sourceUrl: "https://artificialanalysis.ai/models",
        scoreLabel: benchName,
        updatedAt: builtAt,
        stale: false,
        entries: toBoardEntries(aa, key, 8)
      });
    }
  }

  // 通用推理：AA GPQA（缺测用 HLE）
  if (aa && aa.length) {
    const hasGpqa = aa.some(function (m) { return m.gpqa != null; });
    const key = hasGpqa ? "gpqa" : "hle";
    const hasAny = aa.some(function (m) { return m[key] != null; });
    if (hasAny) {
      freshBoards.push({
        id: "reasoning",
        name: "通用推理",
        description: "评估模型的逻辑推理和问题求解能力（" + (hasGpqa ? "GPQA" : "HLE") + " 基准）",
        source: "Artificial Analysis（" + (hasGpqa ? "GPQA" : "HLE") + "）",
        sourceUrl: "https://artificialanalysis.ai/models",
        scoreLabel: hasGpqa ? "GPQA" : "HLE",
        updatedAt: builtAt,
        stale: false,
        entries: toBoardEntries(aa, key, 8)
      });
    }
  }

  // 与上次成功的榜单合并：新榜单缺失的板块沿用旧数据
  const prevBoards = prev && Array.isArray(prev.boards) ? prev.boards : [];
  const prevById = {};
  prevBoards.forEach(function (b) {
    prevById[b.id] = b;
  });

  const finalIds = ["comprehensive", "math", "coding", "reasoning"];
  const boards = [];
  let anyFresh = freshBoards.length > 0;

  finalIds.forEach(function (id) {
    const fresh = freshBoards.find(function (b) {
      return b.id === id;
    });
    if (fresh && fresh.entries && fresh.entries.length) {
      boards.push(fresh);
    } else if (prevById[id] && prevById[id].entries && prevById[id].entries.length) {
      const old = Object.assign({}, prevById[id]);
      old.stale = true;
      boards.push(old);
      console.log("  · 板块「" + old.name + "」抓取失败，沿用 " + (old.updatedAt || "历史") + " 的数据");
    }
  });

  if (!boards.length) {
    console.log("  ✗ 全部榜单源均失败且无历史数据，保留原有 leaderboards.json");
    return prev;
  }

  return {
    updatedAt: anyFresh ? builtAt : (prev && prev.updatedAt) || builtAt,
    builtAt: builtAt,
    stale: !anyFresh,
    boards: boards
  };
}

// ── 主流程 ─────────────────────────────────────────────

async function run() {
  console.log("AI Frontier 数据构建开始 ...");
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const prevNews = readJson(path.join(DATA_DIR, "news.json"));
  const prevPapers = readJson(path.join(DATA_DIR, "papers.json"));
  const prevBoards = readJson(path.join(DATA_DIR, "leaderboards.json"));

  const news = await buildNews(prevNews);
  const papers = await buildPapers(prevPapers);
  let leaderboards = await buildLeaderboards(prevBoards);

  // 写文件（板块为空时保留旧文件不覆盖）
  if (news.items && news.items.length) writeJson(path.join(DATA_DIR, "news.json"), news);
  else console.log("· news.json 无可用数据，保持原文件不变");

  if (papers.items && papers.items.length) writeJson(path.join(DATA_DIR, "papers.json"), papers);
  else console.log("· papers.json 无可用数据，保持原文件不变");

  if (leaderboards && leaderboards.boards && leaderboards.boards.length) {
    writeJson(path.join(DATA_DIR, "leaderboards.json"), leaderboards);
  } else {
    console.log("· leaderboards.json 无可用数据，保持原文件不变");
  }

  console.log("\n构建完成。");
}

run().catch(function (e) {
  console.error("构建失败:", e && e.stack ? e.stack : e);
  process.exit(1);
});
