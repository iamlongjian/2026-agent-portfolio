# LangGraph Quickstart 精读笔记

> **来源**：https://docs.langchain.com/oss/javascript/langgraph/quickstart
> **整理日期**：2026-11-02
> **对应计划**：第 1 周（Agent 到底是什么）
> **说明**：本文是 Quickstart 官方示例的逐段拆解。示例用 Anthropic 模型，国内需换成 DeepSeek / 通义。

---

## 〇、先记住这四件事

1. **LLM API 是无状态的** —— 模型不记得上一轮说了什么，所谓"记忆"是你每次把完整历史重新发过去
2. **Reducer 决定字段怎么合并** —— 同一个字段，包不包 `ReducedValue`，行为完全不同（覆盖 vs 累加）
3. **节点改状态，路由只决策** —— 节点返回状态更新对象，路由返回节点名字符串
4. **循环是 Agent 和 Workflow 的分界线** —— 落到代码就是 `.addEdge("toolNode", "llmCall")` 这一行

---

## 一、整体架构：六个片段

| # | 片段 | 产出 | 角色 |
| --- | --- | --- | --- |
| 1 | 工具定义 | `toolsByName` | 手脚（弹药） |
| 2 | State 定义 | `MessagesState` | 数据规格（弹匣） |
| 3 | `llmCall` 节点 | — | 大脑（思考） |
| 4 | `toolNode` 节点 | — | 手脚（行动） |
| 5 | `shouldContinue` 路由 | — | 岔路口（决策） |
| 6 | 组装 + 运行 | `agent` | 拼装并开火 |

**数据流**：

```
用户输入 → llmCall(思考) → shouldContinue(判断)
                              ├─ 有 tool_calls → toolNode(执行) ─┐
                              └─ 无 tool_calls → END            │
                                       ↑                        │
                                       └────────────────────────┘
                                          结果追加回 messages，循环
```

---

## 二、逐片段精读

### 片段 1：工具定义

```ts
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import * as z from "zod";

const model = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  temperature: 0,
});

const add = tool(({ a, b }) => a + b, {
  name: "add",
  description: "Add two numbers",
  schema: z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
});

// multiply、divide 同构，略

const toolsByName = {
  [add.name]: add,
  [multiply.name]: multiply,
  [divide.name]: divide,
};
const tools = Object.values(toolsByName);
const modelWithTools = model.bindTools(tools);
```

#### 关键认知

**① `name` / `description` / `schema.describe()` 全都是给 LLM 看的提示词**

不是文档注释。模型收到的是类似这样的文本：

```
你可以使用以下工具：
- add: Add two numbers
  参数: a (number) - First number
        b (number) - Second number
```

| 字段 | 谁在用 | 作用 |
| --- | --- | --- |
| `name` | LLM + 你的代码 | LLM 靠它**回传**要调哪个；代码靠它**查找**执行哪个 |
| `description` | **只有 LLM** | 决定"该不该用这个工具"的**唯一依据** |
| `schema` | LLM + 运行时 | LLM 照它生成参数；运行时照它校验 |

**推论**：`description` 写得烂，模型就选错工具。这是后续调优的主要抓手。

**② `toolsByName` 不是冗余**

模型只能回传**字符串名字**，不可能传函数引用。这张表负责"名字 → 函数"的还原：

```
模型返回: { name: "add", args: {a:3, b:5}, id: "call_1" }   ← 只是名字
                ↓
代码执行: toolsByName["add"]({ a:3, b:5 })                   ← 靠这张表找回来
```

**③ `bindTools` 不执行任何工具**

它只把工具清单**声明**给模型。对比：

```ts
await model.invoke("3+5 等于几")
// → 模型自己算，可能算错

await modelWithTools.invoke("3+5 等于几")
// → 模型返回 tool_calls: [{name:"add", args:{a:3,b:5}}]
//   它没算，只是"下单"了。执行要你自己写循环去接。
```

#### ⚠️ 踩坑

- **`divide` 除零不报错**：JS 里 `1/0` 返回 `Infinity`，模型拿到会一脸懵地编下去（第 3 周异常兜底的真实案例）
- **`tool` 导入路径**：`@langchain/core/tools` 和 `langchain` 两种写法都能用，以实际安装版本为准

---

### 片段 2：State 定义

```ts
import {
  StateGraph, StateSchema, MessagesValue, ReducedValue,
  GraphNode, ConditionalEdgeRouter, START, END,
} from "@langchain/langgraph";
import { z } from "zod/v4";

const MessagesState = new StateSchema({
  messages: MessagesValue,
  llmCalls: new ReducedValue(
    z.number().default(0),
    { reducer: (x, y) => x + y }
  ),
});
```

#### 导入说明

| 导入 | 是什么 |
| --- | --- |
| `StateGraph` | 图构建器（类），片段 6 才用 |
| `StateSchema` | State 定义模具（类） |
| `MessagesValue` | 预置消息合并器（常量，**不需要 new**） |
| `ReducedValue` | 自定义合并器包装（类，需要 new） |
| `GraphNode` | **纯类型** —— 节点函数类型 |
| `ConditionalEdgeRouter` | **纯类型** —— 条件边路由函数类型 |
| `START` / `END` | 入口/出口哨兵常量 |

> ⚠️ `GraphNode` 和 `ConditionalEdgeRouter` 是纯类型。若 tsconfig 开了 `verbatimModuleSyntax`，必须写成 `type GraphNode`，否则报错。

#### 三种字段类型

| 类型 | 更新行为 | 用在哪 |
| --- | --- | --- |
| 普通 Zod schema | **覆盖** | 简单字段 |
| `ReducedValue` | **自定义合并** | 累加器、数组拼接 |
| `MessagesValue` | **追加** | 对话历史 |

#### 核心：Reducer

每个字段都有一个 reducer，签名固定：

```ts
reducer(当前状态里的值, 节点返回的更新值) → 新值
//      ↑ left（累积值）    ↑ right（本次更新）
```

**默认 reducer 是"丢掉左边只留右边"** —— 也就是直接覆盖：

```ts
const State = new StateSchema({ foo: z.number() });
// state.foo = 1，节点返回 { foo: 2 } → 变成 2（1 没了）
```

#### `messages: MessagesValue`

`MessagesValue` 是官方预置的、专为消息列表设计的 reducer，行为是**追加**。

**为什么必须用它？** 不用的话每过一个节点就失忆：

```
节点A 返回 { messages: [用户提问] }  → [用户提问]
节点B 返回 { messages: [AI回答] }    → [AI回答]           ❌ 用户提问没了
用 MessagesValue                      → [用户提问, AI回答]  ✅
```

它还额外处理：按消息 ID 去重（流式输出同一条消息会更新多次）、识别 `tool_call` 与 `ToolMessage` 的配对。

#### `llmCalls: new ReducedValue(...)`

```ts
llmCalls: new ReducedValue(
  z.number().default(0),        // ① 值 schema + 初始值
  { reducer: (x, y) => x + y }  // ② 合并规则
),
```

**节点返回的是"增量"，不是"新总数"。** 累加由 reducer 完成：

```
图启动        → llmCalls = 0                 ← 来自 default(0)
第 1 次调 LLM → return { llmCalls: 1 } → reducer(0, 1) = 1
第 2 次调 LLM → return { llmCalls: 1 } → reducer(1, 1) = 2
```

写成普通字段 `z.number().default(0)` 就会永远是 1（被覆盖）。

> `default(0)` 不可省。没有它，第一次 reducer 执行时左边是 `undefined`，`undefined + 1 = NaN`。

#### 其他字段类型（本文未用但需知道）

- `UntrackedValue` —— 不进 checkpoint（不持久化），第 4 周人工中断会用到

---

### 片段 3：`llmCall` 节点

```ts
import { SystemMessage } from "@langchain/core/messages";

const llmCall: GraphNode<typeof MessagesState> = async (state) => {
  const response = await modelWithTools.invoke([
    new SystemMessage(
      "You are a helpful assistant tasked with performing arithmetic on a set of inputs."
    ),
    ...state.messages,
  ]);
  return {
    messages: [response],
    llmCalls: 1,
  };
};
```

#### 节点函数签名

```ts
(state, config) => 部分更新
```

- 收 `state`（当前全量状态）
- 返回**部分更新**（只返回变化的字段）
- `async` 因为要发网络请求

#### 消息数组的顺序

```ts
[
  new SystemMessage("你是算术助手..."),   // ① 指令，每次新建每次发
  ...state.messages                      // ② 展开全部对话历史
]
```

**为什么要把历史全带上？** 因为 LLM API 无状态。模型每次调用都是"第一次见面"，**所谓记忆是你每次把完整历史重新发过去**。

**顺序不能乱**：`SystemMessage` 必须在最前面。

#### 返回值

```ts
return { messages: [response], llmCalls: 1 };
```

- `response` 包成数组，因为 state 里 `messages` 是数组，reducer 合并的是数组
- `llmCalls: 1` 是**增量**，触发上一段的累加 reducer
- 返回里没提的字段**不动**

#### ⚠️ 这个节点不执行工具

`modelWithTools.invoke()` 的返回值有两种可能：

| 情况 | response 内容 | 下一步 |
| --- | --- | --- |
| 模型能直接答 | 普通文本 | → END |
| 模型要用工具 | **`tool_calls` 请求**（只是下单） | → `toolNode` |

**它只负责"决策"，不负责"执行"。**

---

### 片段 4：`toolNode` 节点

```ts
import { AIMessage, ToolMessage } from "@langchain/core/messages";

const toolNode: GraphNode<typeof MessagesState> = async (state) => {
  const lastMessage = state.messages.at(-1);

  if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const result: ToolMessage[] = [];
  for (const toolCall of lastMessage.tool_calls ?? []) {
    const tool = toolsByName[toolCall.name];
    const observation = await tool.invoke(toolCall);
    result.push(observation);
  }

  return { messages: result };
};
```

#### `state.messages.at(-1)`

取最后一条。`.at(-1)` 等价于 `arr[arr.length - 1]`，但**空数组时返回 `undefined` 而非报错**。

**为什么只看最后一条？** 因为要找"模型刚说的那句"。历史里可能也有旧的 `tool_calls`，但那些**已经执行过了**，不能重复执行。

#### 防御性检查

```ts
if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
  return { messages: [] };
}
```

- `== null`（非 `===`）同时覆盖 `null` 和 `undefined`
- `AIMessage.isInstance()` 是 LangChain 消息类的**静态方法**（类型守卫），因为 `tool_calls` 只有 `AIMessage` 才有，直接访问 `HumanMessage` 上的 `tool_calls` 会报错
- 返回 `{ messages: [] }` 是**空操作**：`旧消息 + [] = 旧消息`

#### 核心循环

```ts
for (const toolCall of lastMessage.tool_calls ?? []) {
```

一次可能有**多个** tool_call（模型同时要求算多个），所以是循环。`?? []` 防空。

```ts
const tool = toolsByName[toolCall.name];
```

🎯 **片段 1 那张表在这里终于用上。**

```ts
const observation = await tool.invoke(toolCall);
```

⚠️ **传整个 `toolCall` 对象，不是 `toolCall.args`。**

`toolCall` 结构：

```ts
{ name: "add", args: { a: 3, b: 5 }, id: "call_abc123" }
//                                    ↑ 关键
```

工具执行完要构造 `ToolMessage` 回给模型，而它**必须带 `id`**，模型才能把结果和请求配对：

```
AIMessage:   "我要调 add，id = call_abc123"
ToolMessage: "结果是 8，tool_call_id = call_abc123"   ← 靠 id 对上
```

传 `toolCall.args` 会丢 `id`，模型收到一堆不知道对应哪个请求的结果，会乱。

**变量名 `observation`** 不是随便起的，是 ReAct 模式的标准术语：

```
Thought（思考）→ Action（行动）→ Observation（观察）→ Thought...
   llmCall          工具调用请求      工具执行结果        回到 llmCall
```

#### 返回值

```ts
return { messages: result };
```

**只返回 `messages`，没有 `llmCalls`** —— 因为它没调用模型。

| 节点 | 返回 | 原因 |
| --- | --- | --- |
| `llmCall` | `{ messages, llmCalls: 1 }` | 调了模型，计数 +1 |
| `toolNode` | `{ messages }` | 没调模型，不动计数 |

---

### 片段 5：`shouldContinue` 路由函数

```ts
const shouldContinue: ConditionalEdgeRouter<{
  InputSchema: typeof MessagesState;
  Nodes: "toolNode";
}> = (state) => {
  const lastMessage = state.messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return END;
  }

  if (lastMessage.tool_calls?.length) {
    return "toolNode";
  }

  return END;
};
```

#### 路由函数 ≠ 节点

| | 节点 | 路由函数 |
| --- | --- | --- |
| 返回 | **状态更新对象** | **节点名字符串** 或 `END` |
| 作用 | **改变** state | **只决策，不碰 state** |
| 官方描述 | "emit updates to the State" | "no state updates, just routing" |

#### 泛型两个字段

**`InputSchema: typeof MessagesState`** —— 声明收到的 state 类型（纯编译期，让 `state.messages` 有提示）。

**`Nodes: "toolNode"`** —— 声明**允许返回哪些节点名**。这是类型安全的关键：手滑写成 `"toolNod"` 会立刻编译报错，而不是运行时崩溃。

> `END` 不用写进 `Nodes` —— 它是全局哨兵，任何路由都能返回。
> 官方多目的地示例：`Nodes: "process" | "summarize"`

#### 守卫返回 `END`（与 `toolNode` 的差别）

| 节点 | 守卫失败时 | 含义 |
| --- | --- | --- |
| `toolNode` | `{ messages: [] }` | 空操作 |
| `shouldContinue` | `END` | **结束流程** |

**这是 fail-safe 设计**：路由必须给出明确去向，状态异常时继续转下去没意义，稳妥做法是停。

#### 循环开关

```ts
if (lastMessage.tool_calls?.length) {
  return "toolNode";
}
```

**为什么用 `.length` 而不是直接判数组？**

```ts
if ([])              // → true   ❌ 空数组是 truthy，会误判
if ([].length)       // → false  ✅ 正确
```

有些模型返回**空数组**而非 `undefined`。`.length` 两种情况都覆盖：`undefined?.length` → `undefined`（falsy）、`[].length` → `0`（falsy）。

**这个防御写法值得养成习惯。**

---

### 片段 6：组装与运行

```ts
const agent = new StateGraph(MessagesState)
  .addNode("llmCall", llmCall)
  .addNode("toolNode", toolNode)
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "llmCall")
  .compile();

import { HumanMessage } from "@langchain/core/messages";
const result = await agent.invoke({
  messages: [new HumanMessage("Add 3 and 4.")],
});

for (const message of result.messages) {
  console.log(`[${message.type}]: ${message.text}`);
}
```

#### 逐行

**`new StateGraph(MessagesState)`** —— 建图并绑定 state 规格（片段 2 的产出在这里被消费）。

**`.addNode("llmCall", llmCall)`** —— 注册节点。两个参数：**名字**（字符串）+ **函数**。

> ⚠️ **隐式契约，常见 bug 来源**：`addNode` 注册的名字，必须和路由函数返回的字符串**完全一致**。
> ```ts
> .addNode("toolNode", toolNode)   // 注册名 "toolNode"
> return "toolNode";               // 路由返回值必须一模一样
> ```
> 改名忘改路由 → 运行时找不到节点而崩溃。

**`.addEdge(START, "llmCall")`** —— 指定入口：第一个跑 `llmCall`。

**`.addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])`** —— 三个参数：

| 参数 | 含义 |
| --- | --- |
| `"llmCall"` | 在哪个节点之后判断 |
| `shouldContinue` | 判断函数 |
| `["toolNode", END]` | **可能的目的地列表** |

> `END` 要写进目的地列表，但不用写进 `Nodes` 泛型。

**`.addEdge("toolNode", "llmCall")`** ⭐ —— **这一行是 Agent 的灵魂，它制造了循环**。

```ts
.addEdge("toolNode", END)       // 退化成直线 → 普通 Workflow
.addEdge("toolNode", "llmCall") // 循环回自己 → Agent
```

**"循环回自己"就是 Agent 和 Workflow 的分界线。**

**`.compile()`** —— 编译成可执行对象，会做校验（孤立节点、边指向不存在的节点等），然后冻结。编译后不能再改结构。

> `.compile()` 还能接收 checkpointer 配置（第 4 周人工中断用），现在不传就是纯内存运行。

**`agent.invoke({ messages: [...] })`** —— 入参形状由 state 规格决定。只传 `HumanMessage`，因为 `SystemMessage` 是 `llmCall` 节点里临时加的（系统提示词属于"节点逻辑"，不属于"对话数据"）。

**打印**：
- `result.messages` —— 跑完后的完整消息历史
- `message.type` —— `"human"` / `"ai"` / `"system"` / `"tool"`
- `message.text` —— 文本内容（LangChain 便捷 getter）

---

## 三、完整执行轨迹（"Add 3 and 4."）

```
① 初始 state
   messages = [HumanMessage("Add 3 and 4.")]

② llmCall 执行（第 1 次）
   发给模型：[SystemMessage, HumanMessage("Add 3 and 4.")]
   返回：AIMessage { tool_calls: [{ name:"add", args:{a:3,b:4}, id:"call_1" }] }
   → state.messages 2 条，llmCalls = 1

③ shouldContinue
   最后一条是 AIMessage，tool_calls.length = 1 → 真
   return "toolNode"

④ toolNode 执行
   toolsByName["add"] → add({a:3, b:4}) → 7
   ToolMessage { content: "7", tool_call_id: "call_1" }
   → state.messages 3 条

⑤ addEdge("toolNode", "llmCall") 生效 → 回到 ②

⑥ llmCall 执行（第 2 次）
   发给模型：[SystemMessage, Human, AIMessage, ToolMessage]
   ↑ 这次带上了工具结果，模型才知道"7 是算出来的"
   返回：AIMessage("3 + 4 = 7")
   → state.messages 4 条，llmCalls = 2

⑦ shouldContinue
   最后一条是 AIMessage，无 tool_calls → 假
   return END

⑧ 结束，打印
   [human]: Add 3 and 4.
   [ai]:                      ← 第一条 AI 消息只有 tool_calls 没有文本，所以空
   [tool]: 7
   [ai]: 3 + 4 = 7
```

**关键在第 ⑥ 步**：第二次调模型时历史里多了 `ToolMessage`，模型这才知道"7 是工具算出来的"。

`llmCalls` 结束时 = 2，但打印循环里没有它（只遍历了 `messages`）。想看加一行 `console.log(result.llmCalls)`。

---

## 四、核心概念速查

### Reducer

| 字段写法 | 合并行为 |
| --- | --- |
| `foo: z.number()` | 覆盖 |
| `foo: new ReducedValue(schema, { reducer })` | 按 reducer 合并 |
| `messages: MessagesValue` | 追加（预置） |
| `foo: new UntrackedValue(schema)` | 覆盖，但不进 checkpoint |

签名固定：`reducer(累积值, 本次更新) → 新值`

### 四种消息类型

| 类型 | 谁产生 | 作用 |
| --- | --- | --- |
| `SystemMessage` | 你（写死） | 设定行为、角色、规则 |
| `HumanMessage` | 用户 | 用户输入 |
| `AIMessage` | 模型 | 回复（可能含 `tool_calls`） |
| `ToolMessage` | 你的代码 | 工具执行结果，喂回模型 |

### 节点 vs 路由

| | 节点 | 路由 |
| --- | --- | --- |
| 返回 | 状态更新对象 | 节点名字符串 / `END` |
| 改 state | ✅ | ❌ |

### 累加 vs 覆盖

`llmCalls: 1` 是**增量**不是新总数。累加由 reducer 完成。

---

## 五、踩坑清单

- [ ] `GraphNode` / `ConditionalEdgeRouter` 是纯类型，`verbatimModuleSyntax` 下必须加 `type`
- [ ] `addNode` 的注册名必须和路由返回值字符串**完全一致**
- [ ] `tool.invoke(toolCall)` 传**整个对象**，不是 `.args`（否则丢 `id`，结果无法配对）
- [ ] `divide` 除零返回 `Infinity`，不报错
- [ ] 判数组用 `.length`，空数组是 truthy
- [ ] `llmCalls` 的 `default(0)` 不可省，否则 `undefined + 1 = NaN`
- [ ] 用 `MessagesValue` 而非普通数组字段，否则对话历史被覆盖
- [ ] 国内需把 `ChatAnthropic` 换成 `ChatDeepSeek` / `ChatOpenAI`（通义走 OpenAI 兼容协议）

---

## 六、周末实操清单（第 1 周）

- [ ] 把 `ChatAnthropic` 换成自己选的模型（DeepSeek / 通义）
- [ ] 跑通 Quickstart，确认输出是 `[human] → [ai] → [tool] → [ai]` 四段
- [ ] 打印 `result.llmCalls`，确认是 2
- [ ] **在 `llmCall` 节点里打断点**，看每一轮 `state.messages` 怎么增长（这是计划里明确要求的）
- [ ] 故意把 `shouldContinue` 的 `"toolNode"` 改成 `"toolNod"`，看报什么错（理解隐式契约）
- [ ] 试一次除零：`"Divide 5 by 0."`，看 Agent 怎么处理 `Infinity`
- [ ] 搭极简 React 对话页 + SSE 流式输出
- [ ] 部署：前端 `demo0-chat/web/` → Vercel，后端 `demo0-chat/server/` → Render

---

## 七、自查题（对应计划第 102 行）

> **"Agent 和普通调 LLM 接口的区别？"**

**参考答案**：

普通调用是**一问一答的直线**；Agent 是**带循环的系统** —— 模型自己决定要不要调工具、调几次、何时停，工具结果喂回模型继续决策，直到模型认为任务完成。

落到代码上，区别就是两处：

1. `.addEdge("toolNode", "llmCall")` —— 回边，制造循环
2. `shouldContinue` 条件边 —— 让**模型**（而非你）决定循环何时终止

---

*笔记整理于 2026-11-02，基于 LangGraph JS 官方 Quickstart 实测核对。*
