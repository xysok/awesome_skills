#!/usr/bin/env python3
"""月报生成脚本 — 从当月合格日报直接归纳月报，避免跨月周报及缺周污染。

用法:
  python run_monthly_report.py [--date YYYY-MM-DD] [--preview] [--force]

说明:
  - 默认仅在本月最后一个工作日执行；其它日期打印"跳过"并退出 0（cron 语义）。
  - --date:   以指定日期代替今天（月窗口与"最后工作日"判断均用该日期）。
  - --preview: 只打印预览，不写库（安全测试）。
  - --force:   跳过"最后工作日"守卫，强制执行（用于自定义 cron 调度，如每月最后一个周五）。
  - 默认写回多维表格（报告类型=月报，报告日期=执行日）。
  - 无第三方依赖（纯标准库），配置见 DR_* 环境变量或 <脚本目录>/.env。

配置:
  DR_BASE_TOKEN / DR_TABLE_ID / DR_LARK_RUNJS / DR_ENV_FILE
  模板: templates/monthly_report.env.example
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


def is_last_workday_of_month(d):
    """判断日期 d 是否为本月最后一个工作日（月末倒推到非周六日）。"""
    if d.month == 12:
        last_day = d.replace(year=d.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last_day = d.replace(month=d.month + 1, day=1) - timedelta(days=1)
    while last_day.weekday() >= 5:  # 周六=5, 周日=6
        last_day -= timedelta(days=1)
    return d == last_day


def _fetch_records():
    return common.fetch_records(CFG)


def _is_type(rec, kind):
    return common.is_type(rec, kind)


def fetch_monthly_reports(year_month, cutoff=None):
    """Compatibility name; facts now come from qualified daily reports, never weekly reports.

    Report date is the daily occurrence day; execution passes its cutoff explicitly.
    """
    import calendar
    first = datetime.strptime(year_month + '-01', '%Y-%m-%d').date()
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1]).isoformat()
    end = min(cutoff or last, last)
    if end < first.isoformat():
        raise ValueError('月报截至日期早于当月')
    return common.qualified_daily_reports(_fetch_records(), first.isoformat(), end)


_NOISE_PATTERNS = ("无待办输入", "无实质工作内容", "误发", "致歉", "发错")


def _is_noise(item):
    """判定条目是否为噪声：空会议标题 / 占位 / 无实质内容（月报聚合时剔除）。"""
    s = item.strip()
    if not s:
        return True
    # 只有时间段没有标题的会议条目，如 （16:30-17:30）
    if re.match(r"^（\s*(?:\d{2}-\d{2}\s+)?\d{1,2}:\d{2}\s*[-—~]\s*\d{1,2}:\d{2}\s*）$", s):
        return True
    return any(p in s for p in _NOISE_PATTERNS)


def _block_items(text, keys):
    """提取文本里指定【节标题】下的『· 条目』，剔除噪声。keys 为命中关键字列表。"""
    out, section = [], None
    for line in (text or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("【"):
            section = line
            continue
        if line.startswith("·") and section and any(k in section for k in keys):
            if '会话消息@' in section and '会话消息@' not in keys:
                continue
            item = line[1:].strip()
            if not item or item in ("暂无", "无", "无会议", "无日程") or _is_noise(item):
                continue
            out.append(item)
    return out


def generate_monthly_summary(weekly_reports, cutoff=None):
    """Argument name retained for compatibility; input is now qualified daily reports."""
    all_meetings, all_at, all_issues, all_work, all_plans = [], [], [], [], []
    if not weekly_reports:
        return dict(meetings=[], at_items=[], issues=[], work_items=[], plans=[])
    end = cutoff or max(str(r['报告日期'])[:10] for r in weekly_reports)
    start = end[:7] + '-01'
    for report in weekly_reports:
        day = str(report.get('报告日期') or '')[:10]
        def items(keys):
            return [i for i in _block_items(report.get('工作小结', ''), keys)
                    if common.fact_in_period(i, day, start, end)]
        # Daily-source migration: identical timed meetings on different days are distinct events.
        all_meetings += [re.sub(r'^（(?=\s*\d{1,2}:\d{2})', f'（{day[5:]} ', i)
                         for i in items(['日程会议'])]
        all_at += items(['会话消息@'])
        all_issues += items(['问题解决'])
        all_work += items(['工作事项', '待办', '会话消息', '会议纪要'])
    if weekly_reports:
        last = datetime.strptime(cutoff or max(str(r['报告日期'])[:10] for r in weekly_reports), '%Y-%m-%d').date()
        next_month = (last.replace(day=28) + timedelta(days=4)).replace(day=1)
        all_plans = common.latest_plan_candidates(weekly_reports, next_month.isoformat())
    return {
        "meetings": list(dict.fromkeys(all_meetings)),
        "at_items": list(dict.fromkeys(all_at)),
        "issues": list(dict.fromkeys(all_issues)),
        "work_items": list(dict.fromkeys(all_work)),
        "plans": list(dict.fromkeys(all_plans)),
    }


def write_to_base(report_date, summary, planning):
    """查重、提炼、写入并回读验证；失败抛异常，完整记录不覆盖。"""
    return common.write_report(CFG, "月报", report_date, summary, planning,
                               build_distillation_prompt, 12000)


def build_distillation_prompt(summary_text, planning_text):
    """构造面向管理推进的月报提炼提示，避免把跨周条目重新罗列。"""
    return (
        "根据当月截至执行日已有合格日报，写一份供产品经理复盘、对齐和决策使用的工作月报。"
        "数据源为当月日报，已不依赖周报。必须保留来源覆盖及缺失说明，不得宣称未核验日期事实完整。"
        "规划只是最后一篇合格日报的候选，不是已核实的未来承诺；保留来源日期，待确认后推进。不得从旧计划推导新成果。"
        "输出纯文本，不要 JSON，不要解释你的分析过程。\n\n"
        "核心目标：从跨周信息中拆解 3-6 条真正的主线事项，判断各事项所处阶段、已取得的实质进展、"
        "尚未闭环的问题/风险，并把下月行动收束为可推进的计划。不能按日期、会议、消息或原始条目逐条复述。"
        "证据不足时写「待确认」，不能补造结论、数字、责任人或完成状态。\n\n"
        "固定输出结构（标题必须保留；没有实质内容的主线可省略）：\n"
        "【周期总体判断】用 3-5 句说明本月最重要的成果、主线所处阶段、资源/协同重点和关键风险。\n"
        "【产品研发】/【市场活动】/【临床活动】/【其他事项】按此顺序。每一主线先用一句话给出阶段判断，"
        "再按相关项目归并为 1-3 条主线事项；每条严格写：\n"
        "· 主线事项：<对象/阶段目标>\n"
        "  阶段进展：<本周期形成的里程碑、决策、验证结果或业务影响>\n"
        "  问题与风险：<阻塞、跨部门依赖、证据缺口、进度偏差或待确认点；没有则写「当前未见明确阻塞」>\n"
        "  推进规划：<下月可执行动作、预期交付、关键协同方和已知时间约束；仅使用原始规划和证据可支持的信息>\n"
        "【下月推进重点】列 3-5 条跨主线优先动作，按优先级排序；每条写清目标、交付/判断点与必要协同。\n\n"
        "写作规则：\n"
        "1. 以成果、变化、关键决策、风险和依赖为中心；同一项目的测试、会议、沟通和跟进必须合并为一个推进叙事。\n"
        "2. 优先保留版本号、工单号、医院/客户、责任人等可追溯信息；删除寒暄、无实质内容和重复事项。\n"
        "3. 每个阶段进展必须能从原始记录找到依据；问题必须与对应主线紧邻呈现。\n"
        "4. 语言直接、聚焦，月报控制在约 1800-2600 字，不使用「统一分析」「综述如下」等过程性措辞。\n\n"
        f"本月工作小结（原始事实）：\n{summary_text}\n\n"
        f"已有下月规划（原始输入）：\n{planning_text}"
    )


def distill_and_update(record_id, summary_text, planning_text):
    """兼容入口：只对确切 ID 的已存正文补缺失提炼，不覆盖完整记录。"""
    common.resume_distillation(CFG, record_id, build_distillation_prompt, 12000)
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
    parser.add_argument("--preview", action="store_true", help="只打印预览，不写库")
    parser.add_argument("--force", action="store_true", help="跳过最后工作日守卫，强制执行")
    args = parser.parse_args()

    # 执行日：--date 或今天
    if args.date:
        today = datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        today = datetime.now(TZ).date()

    # 守卫：仅本月最后一个工作日执行（--force 可跳过）
    if not args.force and not is_last_workday_of_month(today):
        print("今天不是本月最后一个工作日，跳过月报生成")
        return 0

    report_date = today.strftime("%Y-%m-%d")
    year_month = today.strftime("%Y-%m")

    print(f"📅 工作月报 ({today.strftime('%Y年%m月')})")
    print()

    # 直接读取当月截至执行日的日报，排除首周上月事项及未来日报。
    weekly_reports = fetch_monthly_reports(year_month, report_date)

    if not weekly_reports:
        print("本月暂无合格日报数据")
        return 1

    coverage = common.source_coverage(weekly_reports, year_month + '-01', report_date)
    print('[INFO] 月报事实来源：当月合格日报（不再依赖周报）', file=sys.stderr)
    print(coverage)
    # 生成本月内容
    summary = generate_monthly_summary(weekly_reports, report_date)
    meetings = summary["meetings"]
    at_items = summary["at_items"]
    issues = summary["issues"]
    work_items = summary["work_items"]
    plans = summary["plans"]

    # 格式化输出（对齐日报：【】节标题 + ·条目 + 段间空行）
    sec_m = [f"【本月日程会议】{len(meetings)}场"]
    sec_m += [f"· {m}" for m in meetings] or ["· 本月无重要会议"]
    sec_a = [f"【本月会话消息@】{len(at_items)}条"]
    sec_a += [f"· {a}" for a in at_items] or ["· 本月没有@我的消息"]
    sec_w = [f"【本月工作事项】{len(work_items)}项"]
    sec_w += [f"· {w}" for w in work_items] or ["· 本月暂无重要工作事项"]
    sec_i = [f"【本月问题解决】{len(issues)}项"]
    sec_i += [f"· {i}" for i in issues] or ["· 本月暂无未解决问题"]
    sec_p = [f"【下月工作规划】{len(plans)}条"]
    sec_p += [f"· {p}" for p in plans] or ["· 暂无明确规划"]

    print("\n\n".join(["\n".join(sec_m), "\n".join(sec_a), "\n".join(sec_w),
                       "\n".join(sec_i), "\n".join(sec_p)]))
    print("\n")

    # 写入 Base（默认写库；--preview 只预览）
    if not args.preview:
        summary_text = "\n\n".join([coverage, "\n".join(sec_m), "\n".join(sec_a),
                                    "\n".join(sec_w), "\n".join(sec_i)])
        planning_text = "\n".join(sec_p)

        record_id = write_to_base(report_date, summary_text, planning_text)
        common.valid_id(record_id)
        print(f"[OK] 报告已完成并回读验证（或已有完整记录）: {record_id}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())