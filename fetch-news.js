#!/usr/bin/env node
/**
 * 【已废弃】fetch-news.js — 旧版"本地更新 index.html"脚本
 *
 * 旧方案直接改写 index.html 里的数组，只能更新本地文件，
 * 部署到 GitHub Pages 后线上内容不会变（见《AI-Frontier-整改方案》）。
 *
 * 现已由 scripts/build-data.js 取代：生成 data/news.json、
 * data/papers.json、data/leaderboards.json，由 GitHub Actions 每日构建，
 * 页面启动时加载同源 JSON。
 *
 * 运行本文件会自动转发到新脚本，命令与用法不变：
 *   node fetch-news.js
 */

"use strict";

console.warn("[提示] fetch-news.js 已废弃，正在转发到 scripts/build-data.js ...\n");
require("./scripts/build-data.js");
