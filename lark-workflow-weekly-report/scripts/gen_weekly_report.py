#!/usr/bin/env python3
"""周报生成脚本 — 读取多维表格中的本周日报，汇总生成周报。

用法:
  python gen_weekly_report.py [--date YYYY-MM-DD] [--write-base]

说明:
  - --date 必须为周五日期（周窗口由周五倒推一周一~五）；缺省为当前自然周的周五。
  - 无 --write-base 时仅打印预览；--write-base 将周报写回多维表格。
  - 无第三方依赖（纯标准库），配置见 DR_* 环境变量或 <脚本目录>/.env。

配置:
  DR_BASE_TOKEN / DR_TABLE_ID / DR_LARK_RUNJS / DR_ENV_FILE
  模板: templates/weekly_report.env.example
"""
import re, sys, argparse, os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import period_report_common as common

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TZ = timezone(timedelta(hours=8))
CFG = {}


# ----------------------------------------------------------------------------
# 配置加载：DR_* 环境变量或 <脚本目录>/.env（与日報 skill 同一套约定）
# ----------------------------------------------------------------------------
def _dotenv_load(path):
    """极简 .env 解析：仅 KEY=VALUE 行，# 开头为注释；不覆盖已存在的环境变量。"""
    if not path or not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        if k:
            os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def _default_runjs():
    return common.default_runjs()


def _load_config():
    shared_env = os.path.join(os.path.dirname(os.path.dirname(BASE_DIR)), "lark-workflow-daily-report", "scripts", ".env")
    _dotenv_load(os.environ.get("DR_ENV_FILE") or shared_env)
    get = os.environ.get
    return {
        "lark_runjs": get("DR_LARK_RUNJS", "") or _default_runjs(),
        "base_token": get("DR_BASE_TOKEN", ""),
        "table_id": get("DR_TABLE_ID", ""),
        "llm_api_key": get("DR_LLM_API_KEY", ""),
        "llm_base": get("DR_LLM_BASE", "https://api.openai.com/v1"),
        "llm_model": get("DR_LLM_MODEL", "gpt-4o-mini"),
    }


def get_week_range(date):
    """获取本周一到周五的日期范围（date 是周五日期）。"""
    friday = datetime.strptime(date, "%Y-%m-%d").date()
    if friday.weekday() != 4:
        raise ValueError("--date 必须是周五日期")
    monday = friday - timedelta(days=4)
    return [monday + timedelta(days=i) for i in range(5)]


def _fetch_records():
    return common.fetch_records(CFG)


def _is_type(rec, kind):
    return common.is_type(rec, kind)


def fetch_daily_reports(week_dates):
    """从 Base 读取本周的日报记录（按 报告日期/报告类型 过滤）。"""
    return common.qualified_daily_reports(_fetch_records(), week_dates[0].isoformat(),
                                          week_dates[-1].isoformat())


_NOISE_PATTERNS = ("无待办输入", "无实质工作内容", "误发", "致歉", "发错")


def _is_noise(item):
    """判定条目是否为噪声：空会议标题 / 占位 / 无实质内容（周报聚合时剔除）。"""
    s = item.strip()
    if not s:
        return True
    # 只有时间段没有标题的会议条目，如 （16:30-17:30）
    if re.match(r"^（\s*(?:\d{2}-\d{2}\s+)?\d{1,2}:\d{2}\s*[-—~]\s*\d{1,2}:\d{2}\s*）$", s):
        return True
    return any(p in s for p in _NOISE_PATTERNS)


def _with_date(item, mmdd):
    """日程条目若时间前无日期（如（10:00-10:30）标题），补成（MM-DD HH:mm-HH:mm）形式；
    已有日期或非日程条目原样返回。"""
    m = re.match(r"^（\s*\d{1,2}:\d{2}\s*[-—~]\s*\d{1,2}:\d{2}\s*）", item)
    if not m or not mmdd:
        return item
    inner = re.sub(r"\s+", " ", item[1:m.end() - 1].strip())
    return f"（{mmdd} {inner}）{item[m.end():]}"


def _bullets(text):
    """提取文本里所有『· xxx』条目，去掉·前缀、"暂无/无" 占位与噪声条目。"""
    out = []
    for line in (text or "").split("\n"):
        line = line.strip()
        if line.startswith("·"):
            item = line[1:].strip()
            if item and item not in ("暂无", "无", "无会议", "无日程") and not _is_noise(item):
                out.append(item)
    return out


def parse_daily_blocks(report_date, summary, planning):
    """解析单篇日报（结构：无一级标题、【】节标题、条目·）。
    返回 (meetings, at_items, issues, convs, todos, plans)。
    日程条目按日报报告日期补上 MM-DD 前缀。
    """
    rd10 = (report_date or "")[:10]
    mmdd = rd10[5:] if len(rd10) >= 10 else ""
    meetings, at_items, issues, convs, todos = [], [], [], [], []
    section = None
    for line in (summary or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("【"):
            if "日程会议" in line:
                section = "meetings"
            elif "会话消息@" in line:
                section = "at"      # 注意先于“会话消息”判断（其含 @ 子串会先命中）
            elif "问题解决" in line:
                section = "issues"
            elif "待办" in line:
                section = "todos"
            else:
                section = "work"   # 会话消息/工作事项/会议纪要等 → 工作事项
            continue
        if not line.startswith("·"):
            continue
        item = line[1:].strip()
        if not item or item in ("暂无", "无", "无会议", "无日程") or _is_noise(item):
            continue
        if section == "meetings":
            meetings.append(_with_date(item, mmdd))
        elif section == "at":
            at_items.append(item)
        elif section == "issues":
            issues.append(item)
        elif section == "todos":
            todos.append(item)
        else:
            convs.append(item)
    plans = _bullets(planning)
    return meetings, at_items, issues, convs, todos, plans


def generate_weekly_summary(daily_reports, period_end=None):
    """根据日报汇总生成周报：抓取条目并按序去重。work_items=会话+今日待办。"""
    all_meetings, all_at, all_issues, all_work, all_plans = [], [], [], [], []
    if not daily_reports:
        return dict(meetings=[], at_items=[], issues=[], work_items=[], plans=[])
    end_day = datetime.strptime(period_end or max(str(r['报告日期'])[:10] for r in daily_reports), '%Y-%m-%d').date()
    start = (end_day - timedelta(days=end_day.weekday())).isoformat()
    end = end_day.isoformat()
    for report in daily_reports:
        meetings, at_items, issues, convs, todos, plans = parse_daily_blocks(
            report.get("报告日期", ""), report.get("工作小结", ""),
            report.get("工作规划", ""))
        source_day = str(report.get('报告日期') or '')[:10]
        all_meetings += [i for i in meetings if common.fact_in_period(i, source_day, start, end)]
        all_at += [i for i in at_items if common.fact_in_period(i, source_day, start, end)]
        all_issues += [i for i in issues if common.fact_in_period(i, source_day, start, end)]
        all_work += [i for i in convs + todos if common.fact_in_period(i, source_day, start, end)]
    if daily_reports:
        last = datetime.strptime(period_end or max(str(r['报告日期'])[:10] for r in daily_reports), '%Y-%m-%d').date()
        next_start = last + timedelta(days=7-last.weekday())
        all_plans = common.latest_plan_candidates(daily_reports, next_start.isoformat())
    return {
        "meetings": list(dict.fromkeys(all_meetings)),
        "at_items": list(dict.fromkeys(all_at)),
        "issues": list(dict.fromkeys(all_issues)),
        "work_items": list(dict.fromkeys(all_work)),
        "plans": list(dict.fromkeys(all_plans)),
    }


def write_to_base(report_date, summary, planning):
    """查重、提炼、写入并回读验证；失败抛异常，完整记录不覆盖。"""
    return common.write_report(CFG, "周报", report_date, summary, planning,
                               build_distillation_prompt, 6000)


def build_distillation_prompt(summary_text, planning_text):
    """构造面向管理推进的周报提炼提示，避免把原始条目二次罗列。"""
    return (
        "根据本周已有合格日报的原始记录，写一份供产品经理复盘和推进使用的工作周报。"
        "必须保留来源覆盖及缺失说明，不得宣称未核验日期的事实完整。"
        "规划只是最后一篇合格日报的候选，不是已核实的未来承诺；保留来源日期，待确认后推进。不得从旧计划推导新成果。"
        "输出纯文本，不要 JSON，不要解释你的分析过程。\n\n"
        "核心目标：先从全周期信息中识别 2-5 条真正的主线事项，再判断各主线的阶段进展、问题/风险和下一步。"
        "不能按日期、会议、消息或原始条目逐条复述。证据不足时写「待确认」，不能补造结论、数字、责任人或完成状态。\n\n"
        "固定输出结构（标题必须保留；没有实质内容的主线可省略）：\n"
        "【周期总体判断】用 2-4 句说明本周最重要的推进结果、当前重心和需要关注的变化。\n"
        "【产品研发】/【市场活动】/【临床活动】/【其他事项】按此顺序。每一主线先用一句话给出阶段判断，"
        "再按相关项目归并为 1-3 条主线事项；每条严格写：\n"
        "· 主线事项：<对象/目标>\n"
        "  阶段进展：<本周期形成的结果、决策或里程碑，以及影响>\n"
        "  问题与风险：<阻塞、依赖、偏差或待确认点；没有则写「当前未见明确阻塞」>\n"
        "  推进规划：<下一周期可执行动作、预期产出、关键协同方或时间约束；仅使用原始规划和证据可支持的信息>\n"
        "【下周推进重点】列 3-5 条跨主线优先动作，按优先级排序；每条写清要推动什么和预期交付/判断点。\n\n"
        "写作规则：\n"
        "1. 以结果、变化、决策、风险和依赖为中心，而不是活动清单；合并同一项目的测试、会议、沟通和跟进。\n"
        "2. 保留工单号、版本号、医院/客户、责任人等可追溯信息；删除寒暄、无实质内容和重复事项。\n"
        "3. 每个阶段进展必须能从原始记录找到依据；问题必须与对应主线紧邻呈现。\n"
        "4. 语言直接、紧凑，周报控制在约 800-1200 字，不使用「统一分析」「综述如下」等过程性措辞。\n\n"
        f"本周工作小结（原始事实）：\n{summary_text}\n\n"
        f"已有下周规划（原始输入）：\n{planning_text}"
    )


def distill_and_update(record_id, summary_text, planning_text):
    """兼容入口：只对确切 ID 的已存正文补缺失提炼，不覆盖完整记录。"""
    common.resume_distillation(CFG, record_id, build_distillation_prompt, 6000)
    return True


def _setup_stdio():
    """Windows 控制台默认 GBK，统一 UTF-8，避免中文输出解码/编码崩溃。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main():
    try:
        return _main()
    except (RuntimeError, ValueError) as exc:
        print(f"[ERR] 报告生成中止: {exc}", file=sys.stderr)
        return 1


def _main():
    global CFG
    _setup_stdio()
    CFG = _load_config()

    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=str, default="")
    parser.add_argument("--write-base", action="store_true")
    args = parser.parse_args()

    # 确定周五日期
    if args.date:
        friday_str = args.date
    else:
        today = datetime.now(TZ).date()
        # 找到本周五（周六/周日也归本周）
        friday = today + timedelta(days=(4 - today.weekday()))
        friday_str = friday.strftime("%Y-%m-%d")

    # 获取本周日期范围
    week_dates = get_week_range(friday_str)
    week_range_str = f"{week_dates[0].strftime('%m/%d')}-{week_dates[-1].strftime('%m/%d')}"

    print(f"📊 工作周报 ({week_range_str})")
    print()

    # 读取本周日报
    daily_reports = fetch_daily_reports(week_dates)

    if not daily_reports:
        print("本周暂无日报数据")
        return 1

    coverage = common.source_coverage(daily_reports, week_dates[0].isoformat(), friday_str)
    print(coverage)
    present = {str(r.get("报告日期") or "")[:10] for r in daily_reports}
    missing = [d.isoformat() for d in week_dates if d.isoformat() not in present]
    if missing:
        print(f"[WARN] 日报来源覆盖 {len(present)}/5 个自然工作日；缺失日期: {', '.join(missing)}；可能含节假日，仅汇总已有记录，不宣称全周完整。", file=sys.stderr)

    # 生成周报内容
    summary = generate_weekly_summary(daily_reports, friday_str)
    meetings = summary["meetings"]
    at_items = summary["at_items"]
    issues = summary["issues"]
    work_items = summary["work_items"]
    plans = summary["plans"]

    # 格式化输出（对齐日报：【】节标题 + ·条目 + 段间空行）
    sec_m = [f"【本周日程会议】{len(meetings)}场"]
    sec_m += [f"· {m}" for m in meetings] or ["· 本周无重要会议"]
    sec_a = [f"【本周会话消息@】{len(at_items)}条"]
    sec_a += [f"· {a}" for a in at_items] or ["· 本周没有@我的消息"]
    sec_w = [f"【本周工作事项】{len(work_items)}项"]
    sec_w += [f"· {w}" for w in work_items] or ["· 本周暂无重要工作事项"]
    sec_i = [f"【本周问题解决】{len(issues)}项"]
    sec_i += [f"· {i}" for i in issues] or ["· 本周暂无未解决问题"]
    sec_p = [f"【下周工作规划】{len(plans)}条"]
    sec_p += [f"· {p}" for p in plans] or ["· 暂无明确规划"]

    print("\n\n".join(["\n".join(sec_m), "\n".join(sec_a), "\n".join(sec_w),
                       "\n".join(sec_i), "\n".join(sec_p)]))
    print("\n")

    # 写入 Base（工作小结=日程+会话消息@+工作事项+问题解决；工作规划=下周规划）
    if args.write_base:
        summary_text = "\n\n".join([coverage, "\n".join(sec_m), "\n".join(sec_a),
                                    "\n".join(sec_w), "\n".join(sec_i)])
        planning_text = "\n".join(sec_p)

        record_id = write_to_base(friday_str, summary_text, planning_text)
        common.valid_id(record_id)
        print(f"[OK] 报告已完成并回读验证（或已有完整记录）: {record_id}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())