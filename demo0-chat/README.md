# Demo0 · 最简流式对话

第 1 周产出：用 LangGraph + DeepSeek 跑通一个**不带工具**的多轮对话 Agent，前端 SSE 流式输出。

## 目录

```
demo0-chat/
├── server/     ← LangGraph 后端（Node/TS）→ 部署到 Render
└── web/        ← React 前端对话页         → 部署到 Vercel
```

## 环境准备

```bash
cd server
cp .env.example .env      # 然后填入真实 DEEPSEEK_API_KEY
npm install
```

`.env` 内容：

```
DEEPSEEK_API_KEY=sk-xxxxxxxx
```

> `.env` 已被 `.gitignore` 忽略，**不会提交**。Key 获取：https://platform.deepseek.com/ → API keys

## 关键信息

| 项 | 值 |
| --- | --- |
| 模型名 | `deepseek-flash`（**不是** `deepseek-chat`，那是旧名） |
| 环境变量 | `DEEPSEEK_API_KEY`（LangChain 自动读取） |
| 计费 | 空闲时段输入 1 元 / 输出 4 元（百万 tokens），周末全在空闲价 |

## 本周目标

- [ ] 用 TS 跑通 LangGraph 最简对话示例（不带工具）
- [ ] 搭极简 React 对话页，实现 SSE 流式输出
- [ ] 打断点看每一轮 state 怎么变化
- [ ] 部署：前端 → Vercel，后端 → Render
- [ ] 写 README（架构图 + 线上链接 + 踩坑）

## 参考

- [Quickstart 精读笔记](../notes/第01周/Quickstart精读笔记.md)
- [Thinking in LangGraph 总结](../notes/第01周/ThinkingInLangGraph总结.md)
- [官方 Quickstart](https://docs.langchain.com/oss/javascript/langgraph/quickstart)

## ⚠️ 安全

**永远不要把 `.env` 提交到 git。** 本仓库是公开作品集，Key 一旦泄露会被刷账单。
提交前先跑 `git status`，确认看不到 `.env`。
