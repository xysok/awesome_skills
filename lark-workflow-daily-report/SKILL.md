---
name: lark-workflow-daily-report
version: 1.1.0
description: "日报生成工作流：采集飞书日程（含智能会议纪要）、工作会话消息、待办任务，经 LLM 提炼为结构化分节日报，并可写入多维表格；另支持将日报内容按四条主线（产品研发/市场活动/临床活动/其他事项）聚类提炼写入「工作小结（提炼）」列。用于生成指定日期的工作日报、运行日报生成脚本、提炼日报内容。"
metadata:
  requires:
    bins: ["lark-cli", "python3", "node"]
---

# 日报生成工作流

**独立发布说明：本目录已包含运行所需公共 Python 模块。认证使用下述 lark-cli 官方登录流程；文末其他 lark-* 技能为外部参考，不随本仓库分发。任何真实写库须有用户授权，写入后按记录 ID 回读核实。**

## 适用场景

- "运行日报生成脚本" / "生成今日日报" / "帮我生成日报"
- "把今天的会议结论、会话要点、待办整理成日报并提交"
- "下班前输出工作小结和明日规划"
- cron / 定时任务 no_agent 模式每天自动生成日报

## 前置条件

1. **lark-cli 已认证（user 身份）**，覆盖所需域：

   ```bash
   lark-cli auth login --domain calendar,vc,note,docs,minutes,im,task,base
   ```

2. **Python 3.8+** 且已安装依赖：

   ```bash
   pip install openai
   ```

3. **配置**：环境变量（`DR_*` 前缀）或 `<scripts目录>/.env`（环境变量优先）。模板见
   [`templates/daily_report.env.example`](templates/daily_report.env.example)。
   关键项：`DR_MY_OPEN_ID`（本人 open_id，必填）、`DR_LLM_API_KEY`（LLM 网关 Key，
   缺失时自动回退规则提炼）、`DR_BASE_TOKEN`/`DR_TABLE_ID`（仅 `--write-base` 需要）。

## 数据流

```
目标日期 {date}
  ├─► calendar +agenda --start/--end                 → 日程列表（会议/事件）
  │      └─► 逐场会议抓 AI 纪要结论：
  │           event_id → calendar +meeting --event-ids → meeting_id
  │           meeting_id → vc +detail --meeting-ids → note_id / minute_token
  │           note_id → note +detail → note_doc_token → docs +fetch → 摘『# 总结』段（主路径）
  │           minute_token → minutes +detail --summary                     （兜底）
  ├─► im +messages-search --query "" --start/--end   → 当日消息（翻页 ≤ 5 页 × 20 条）
  │      ├─► 过滤：无文本/链接开头/<4 字、机器人、排除会话
  │      ├─► 按 chat_id 聚合 → 判定单聊/群聊，剔除当日无我发言的会话
  │      └─► P2P 缺名反查：im +chat-messages-list --chat-id（对方姓名/备忘录/未知）
  ├─► task +get-my-tasks + task +get-related-tasks   → 待办（按 guid 去重、过滤已完成）
  │
  ▼
 LLM 提炼（OpenAI 兼容接口）→ 严格 JSON 4 键：会议结论 / 会话明细 / 待办要点 / 明日规划
  │       未配置 Key 或解析失败 → 规则回退提炼（报告不空）
  ▼
 组装分节日报（工作小结 + 工作规划）→ stdout 输出 / --write-base 写入多维表格
```

## 运行

```bash
# cron 入口（等价 gen_daily_report.py --write-base，日期默认今天）
python scripts/run_daily_report.py

# 预览指定日期日报（不写库，推荐先验证）
python scripts/gen_daily_report.py --date 2026-08-05 --mode report

# 写库
python scripts/gen_daily_report.py --date 2026-08-05 --write-base

# 只采集原始数据（meetings 内附智能纪要 conclusion）
python scripts/gen_daily_report.py --date 2026-08-05 --mode json
```

日期缺省为当天（Asia/Shanghai，UTC+8）。

## 输出结构

日报为分节文本（无一级标题，【】小节 + 『·』条目）：

```
【日程会议】N场
· （MM-DD HH:mm-HH:mm）会议标题：结论要点
【会话消息】a个单聊、b个群聊
· 会话名：主题/关键结论/下一步（1-2 句）
【会话消息@】N条
· 当天发到我这里的消息与我参与的关键讨论（单聊对方发来的消息 + 群聊@我，不含我发出的消息；去重、无寒暄）
【问题解决】
· 卡点：xxx；可求助：xxx（未解决卡点 + 可求助对象）
【明日规划】
· 动词开头（梳理/确认/推进/跟进…），最多 5 条，『卡他人→紧急』排序
```

### LLM 提炼协议（prompt 内置在 gen_daily_report.py，改协议需改脚本）

输入：报告日期 + 日程（含智能纪要）+ 原始会话 + 待办列表 + 会话消息@(单聊与我+群聊@我的消息原文)。
输出：严格 JSON，仅 5 键：

```json
{"会议结论": [], "会话明细": [{"会话": "", "类型": "单聊|群聊", "要点": ""}], "会话消息@": [], "问题解决": [], "明日规划": []}
```

规则：
1. **会议结论**顺序必须与日程输入完全对齐，单条对应单场会议，开头**不重复会议标题**（报告自带『标题：』前缀），无实质内容为空串；
2. **会话明细**每条工作会话一条，提炼主题/结论/下一步 1-2 句，删除问候/闲聊，不残留"问：/说：/我："句式；
3. **会话消息@**只收当天发到我这边的消息（来源：单聊中对方发来的消息 + 群聊文本 @我的显示名，**不含我本人发出的消息**），按议题合并去重、每条一句，空输入输出 `[]`；
4. **问题解决**基于当天会议/会话/待办分析未解决卡点与可求助对象，格式「卡点：xxx；可求助：xxx」（可求助为**本人以外**的同事姓名+角色，无则『待确认』，不编造），最多 5 条，无卡点输出 `[]`；
5. **明日规划**动词开头，按『能卡他人进度→紧急』排序，最多 5 条，面向明日执行；
6. 解析失败 / 未配置 Key / 接口异常 → `_fallback_refine` 规则回退（取每会话最长消息为要点、@原文前几条、待办标题为卡点与规划），保证报告不空。

## Base 写入字段

`base +record-batch-create` → 表字段：**生成时间 / 报告日期 / 报告类型（"日报"）/ 工作小结 / 工作规划**。

## 工作小结（提炼）列（默认步骤）

日报写库后**默认执行提炼**：把 `工作小结` 按主题聚类浓缩后填入同表 `工作小结（提炼）` 文本列
（该列需预先在表中创建，`text` 类型；与周报/月报共用同一列）。
即"生成今日日报 / --write-base" 完成后，应紧接着按本节方法提炼并 `+record-batch-update` 写入该列，
不要只写脚本输出的五个字段；用户单独说"提炼日报内容"亦走本节。

### 触发

- "生成今日日报" / "运行日报生成脚本"（含 --write-base → 写库后默认提炼）
- "提炼日报内容" / "优化提炼方式" / "填入工作小结（提炼）"

### 提炼方法（与月报/周报 skill 同一套，2026-08 实践验证）

1. **聚类优先，勿平铺罗列**：先分析条目间相关性，合并同类项再统一呈现。示例：不同会议/会话反馈的同类产品问题 → 并归"产品优化"子类；不同医院的合作/验证 → 并归"临床活动"分条。
2. **固定主线**：产品研发 / 市场活动 / 临床活动 / 其他事项（按此顺序）；**当日某主线无内容时整节省略**，只保留有实质进展的主线。
3. **价值线思维**：从"做了什么"转向"产生了什么结果/影响"；四问过滤——重要？紧急？有变化？要交接？
4. **每条统一结构**：`对象 → 进展/结果 → 状态`；保留责任人、缺陷单/工单/经费号等编号。
5. **简报语言**：每主题先一句直接陈述概述，**禁止"统一分析""综述如下"等过程术语**；剔除寒暄/闲聊/备忘录条目。
6. **粒度参考**：单日日报（约 8-20 条目）提炼后约 200-400 字、每主题 1-3 条——当日摘要而非流水账，逐条对应会后可查原始日报。

### 读写 Base 的操作要点

- 读日报全文：`lark-cli base +record-get --base-token <token> --table-id <id> --record-id <rid> --format json --as user`。
  返回为**矩阵**：记录在 `data.data`（一行数组），列顺序以 `data.fields` 为准，**勿按位猜字段**。
- 写入：`lark-cli base +record-batch-update --base-token <token> --table-id <id> --json '{"update_records":{"<rid>":{"工作小结（提炼）":"<text>"}}}' --as user`。
- Windows 注意：PowerShell 会把裸 `@file` 当 splatting 解析，传文件必须加引号 `--json "@payload.json"`；
  长中文文本用 Python 脚本（`PYTHONUTF8=1`）生成 UTF-8 JSON payload 文件再 `--json @file` 传入，避免 shell 转义与 GBK 乱码。

### 验证

- 更新后 `+record-get` 读回该列，核对字符数与关键条目；确认 `工作小结`/`工作规划` 原字段未被污染；验证完清理临时 payload 文件。

## 配置表

| 变量 | 必填 | 含义 |
|---|---|---|
| `DR_LLM_API_KEY` | 建议 | LLM 网关 Key；缺失 → 规则回退提炼 |
| `DR_LLM_BASE` | 否 | OpenAI 兼容 Base URL（默认 `https://api.openai.com/v1`） |
| `DR_LLM_MODEL` | 否 | 模型名（默认 `gpt-4o-mini`） |
| `DR_MY_OPEN_ID` | **是** | 本人 open_id（消息归属 is_me 判断；为空则会话聚合为空） |
| `DR_MY_NAME` | 推荐 | 飞书显示名（群聊「@我」识别，形如 `沈宇轩`；不填则群聊@检测关闭，仅单聊计入【会话消息@】） |
| `DR_EX_BOTS` | 否 | 排除的机器人 open_id，逗号分隔 |
| `DR_EX_CHATS` | 否 | 排除的会话 chat_id，逗号分隔 |
| `DR_BASE_TOKEN` | write 时 | 日报多维表格 base token |
| `DR_TABLE_ID` | write 时 | 日报表 id |
| `DR_LARK_RUNJS` | 否 | lark-cli `scripts/run.js` 绝对路径（默认定位 npm 全局安装） |
| `DR_ENV_FILE` | 否 | `.env` 文件路径（默认 `<scripts目录>/.env`） |

## 权限表

| 命令 | 所需 scope | 参考 |
|---|---|---|
| `calendar +agenda` | `calendar:calendar.event:read` | ../lark-calendar |
| `calendar +meeting` | 会议关联查询 | ../lark-calendar |
| `vc +detail` | 会议与纪要关联 | ../lark-vc |
| `note +detail` / `docs +fetch` | 纪要/文档读取 | ../lark-note / ../lark-doc |
| `minutes +detail --summary` | 妙记读取 | ../lark-minutes |
| `im +messages-search` / `im +chat-messages-list` | 消息读取 | ../lark-im |
| `task +get-my-tasks` / `task +get-related-tasks` | 待办读取 | ../lark-task |
| `base +record-batch-create` | Base 记录写入 | ../lark-base |
| `base +record-get` | Base 记录读取（提炼列读回验证） | ../lark-base |
| `base +record-batch-update` | Base 记录写入（提炼列写入） | ../lark-base |

具体 scope 名以各 skill 为准；认证用 `lark-cli auth login --domain calendar,vc,note,docs,minutes,im,task,base`。

## 常见坑

1. **GBK/UTF-8**：Windows 下 `subprocess.run(text=True)` 默认按本地代码页（GBK）解码子进程输出，
   子进程输出 UTF-8 中文会抛 `UnicodeDecodeError` 且吞掉 stdout。脚本已统一
   `encoding="utf-8", errors="replace"` 并 `sys.stdout/stderr.reconfigure(encoding="utf-8")`，勿改回。
2. **openai 未安装**：报 `ModuleNotFoundError: No module named 'openai'` → `pip install openai`
   （LLM 提炼用 openai SDK 对接 OpenAI 兼容网关）。
3. **`im +messages-search` 不能加 `--format json`**：需 `no_format=True` 才返回完整 messages 列表。
4. **翻页上限**：`fetch()` 最多 5 页 × 每页 20 条，当日消息超 ~100 条会被截断，需要时调大循环。
5. **待办 pending 过滤**：必须按 `completed == False 且 status != "done"` 过滤，否则混入已完成任务。
6. **会议结论对齐**：LLM 输出会议结论数组按索引与日程对齐；LLM 异常时用空串占位，不串位。
7. **身份**：全程 `--as user`；`DR_MY_OPEN_ID` 为空会把所有消息判为"非我发言"，聚合结果为空。
8. **群聊@判定靠显示名（`DR_MY_NAME`）**：`im +messages-search` 返回体没有结构化 mention 字段，
   group 文本中的 @ 渲染为 `@显示名`；单聊计为「与我对话」但【会话消息@】**只收对方发来的消息**
   （`is_me` 为真的本人消息一律排除，包括单聊我方发言与群聊我方发言；`sender_type != user` 的
   机器人通知也排除）。未配 `DR_MY_NAME` 时群聊不计。提炼输入会注入「报告作者: 本人」，
   防止『可求助：本人』类错误。
9. **群名缺失**：部分群在搜索返回里没有 `chat_name`，直接放行会出现「群聊1」式自造名；
   `resolve_group_names` 用 `im chats get --chat-id` 反查（未命名群返回成员列表式真实名称），失败静默保留兜底。
10. **摘要窗口**：纪要正文只取『# 总结』起 1600 字符，并剥除 markdown 图片与 HTML 标签，控制 token 噪音。
11. **写库 argv 中文**：`--json` 传中文时依赖 Windows wide-char argv，无需 `ensure_ascii`；若在非 Windows
   环境出问题，改为写临时文件再 `--file`（lark-cli 支持时）。
12. **日程日期**：日程条目带日期前缀，形如 `（08-27 10:00-10:30）会议标题`。日报按报告日期
   确定性补充（`build_report` 内 `MM-DD + time` 拼接，`MM`/`DD` 取 `report_date` 前 10 位）；
   不依赖 LLM 输出格式。周报/月报聚合时沿用该日期前缀。
13. **LLM 输出偶发非字符串/控制字符**：模型偶发把「问题解决」条目输出为对象（`{"卡点":...}`）
   或 JSON 字符串内含未转义控制字符，导致 `re.search`/`json.loads` 抛
   `expected string or bytes-like object, got 'dict'` / `Invalid control character`，进而整体回退
   规则提炼（日报质量骤降、【问题解决】【明日规划】变成待办标题直抄）。脚本已修复：
   `_sanitize_issue_names` 用 `_issue_to_str` 先把 dict 元素规整为「卡点…；可求助…」字符串，
   `json.loads(..., strict=False)` 容忍控制字符。若再遇 LLM 解析失败回退，先检查这两处，
   不要直接修改 LLM 协议 prompt。

## 验证

1. 先 `--mode report`（不写库）确认采集 + 提炼输出结构正确；
2. 清空 `DR_LLM_API_KEY` 再跑一次，确认规则回退路径仍输出非空报告；
3. 再 `--write-base` 写库，去多维表格核对记录字段；
4. cron 入口 `run_daily_report.py` 退出码 0 且 stderr 出现 `[OK] 已写入多维表格: <日期>`。

## 参考

- [`../lark-shared/SKILL.md`](../lark-shared/SKILL.md) — 认证、权限（必读）
- [../lark-calendar/SKILL.md](../lark-calendar/SKILL.md) — `+agenda` / `+meeting`
- [../lark-note/SKILL.md](../lark-note/SKILL.md) / [../lark-minutes/SKILL.md](../lark-minutes/SKILL.md) — 纪要/妙记
- [../lark-im/SKILL.md](../lark-im/SKILL.md) — `+messages-search` / `+chat-messages-list`
- [../lark-task/SKILL.md](../lark-task/SKILL.md) — `+get-my-tasks` / `+get-related-tasks`
- [../lark-base/SKILL.md](../lark-base/SKILL.md) — `+record-batch-create`