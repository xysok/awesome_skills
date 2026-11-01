# Awesome Skills

四个独立技能目录，包含技能说明、运行源码及必要的配置模板或测试。

| 目录 | 用途 |
|---|---|
| [lark-workflow-daily-report](lark-workflow-daily-report/) | 采集飞书日程、消息、待办，生成日报并按授权写入多维表格 |
| [lark-workflow-weekly-report](lark-workflow-weekly-report/) | 汇总本周合格日报，生成周报与下周推进重点 |
| [lark-workflow-monthly-report](lark-workflow-monthly-report/) | 汇总本月合格日报，生成月报与下月推进重点 |
| [auto-signin](auto-signin/) | CordCloud、京东、淘宝、WPS 签到执行器、验证与定时报表入口 |

## 飞书报告

需要 Python、Node.js、已安装且以 user 身份认证的 `@larksuite/cli`，以及 `openai` Python SDK（正式写库提炼需要）。每个目录均包含自己的 `scripts/period_report_common.py`，不依赖某个 Hermes profile 的公共脚本。

使用各目录 `templates/*.env.example` 配置环境。建议显式设置 `DR_ENV_FILE` 为私有配置文件绝对路径，并设置 `DR_LARK_RUNJS` 指向所安装 CLI 的 `scripts/run.js`。周/月报未指定 `DR_ENV_FILE` 时沿用相邻日报目录的 `scripts/.env`。不要提交真实配置。

```sh
python lark-workflow-daily-report/scripts/gen_daily_report.py --help
python lark-workflow-weekly-report/scripts/gen_weekly_report.py --help
python lark-workflow-monthly-report/scripts/run_monthly_report.py --help
```

### 当前实现与旧说明的差异

技能说明保留了原始流程背景；下列行为以随附源码为准：

- 三种报告正式写库均要求 LLM 成功提炼；缺 Key、截断或回读不一致均不应报告成功。
- 公共 Base 读取使用 `--limit 200 --offset N` 分页，并校验响应与记录 ID，不是仅取前 200 条。
- 新记录先完成提炼再创建；已有完整记录不覆盖，仅可补缺失提炼；同日期重复冲突拒绝写入。
- 月报当前直接汇总合格日报，不依赖先生成周报。来源缺失、草稿或覆盖不足有明确处理，不代表完整覆盖业务事实。
- 周报 `--date` 要求周五；月报默认会写库，预览必须显式传 `--preview`。
- 文中 `lark-shared`、`lark-base` 等其他技能为外部参考，不包含在本仓库；认证和命令参数应以安装版本的 `lark-cli --help` 为准。

真实采集会访问私人工作信息，真实写库及将数据交给所配置的 LLM 服务均需用户授权。本次发布没有运行真实采集、LLM 调用或飞书写库。

## 定时签到

```sh
cd auto-signin
npm ci
npm run check
npm test
```

Node.js 20+；浏览器执行需要 Playwright 兼容的 Chromium。定时入口为 `scripts/auto-signin-daily-report.sh`，由用户的调度器按授权时间调用；仓库发布不会创建或改动任何定时任务。

该技能含原部署环境的 Hermes vault/Xvfb 集成约定，**不是零配置通用安装包**：

- 默认状态目录仍为 `/opt/data/home/.local/state/auto-signin`；其他部署应通过 `executePlatform` 的 `stateDir` 选项配置独立私有目录。
- vault 桥接依赖 Hermes 内部 `VaultStore`，原路径为 `/opt/hermes`，Python 默认 `/opt/hermes/.venv/bin/python`；其他环境需配置相应 Python/模块路径。
- Linux 定时包装器默认使用 `/usr/bin/chromium` 和 Xvfb；可通过 `AUTO_SIGNIN_BROWSER_PATH`、`AUTO_SIGNIN_XVFB_PATH` 覆盖。原部署的 Xvfb 兜底路径与日志路径需按部署环境调整。
- Cookie、浏览器状态、vault 绑定、凭据、验证码、实际签到截图与报告不随仓库分发。使用者必须自行安全配置，不能把验证码或密码发到聊天中。
- 网站流程可能变化；离线测试通过不代表任意账号或后续日期的真实签到成功。

## 发布边界

原技能文件与其他 profile 未被修改。仅在导出副本中补齐公共模块、调整本地导入和定时入口相对路径、补充发布说明。排除了运行产物、依赖目录、真实 `.env`、会话、凭据及过时的明文凭据诊断脚本。
