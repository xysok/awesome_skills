"""Strict Base transport shared only by Walker's weekly/monthly reports."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


def default_runjs():
    profile = Path(os.environ.get('HERMES_HOME') or Path(__file__).resolve().parents[1])
    candidates = [profile / '.local/bin/lark-cli']
    cli = shutil.which('lark-cli')
    if cli:
        candidates.append(Path(cli))
    candidates.append(profile / '.local/lib/node_modules/@larksuite/cli/scripts/run.js')
    for candidate in candidates:
        target = candidate.resolve()
        if target.is_file() and target.name == 'run.js':
            return str(target)
    raise RuntimeError('未找到 lark-cli run.js，请设置 DR_LARK_RUNJS')


def valid_id(rid):
    if not isinstance(rid, str) or not re.fullmatch(r'rec[A-Za-z0-9]+', rid):
        raise RuntimeError('缺少有效 record_id；重试前须查重')
    return rid


def cli(cfg, action, *args):
    if not all(cfg.get(k) for k in ('lark_runjs', 'base_token', 'table_id')):
        raise RuntimeError('缺少 CLI/Base 配置')
    cmd = ['node', cfg['lark_runjs'], 'base', action,
           '--base-token', cfg['base_token'], '--table-id', cfg['table_id'],
           *args, '--as', 'user', '--format', 'json']
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='strict', timeout=90)
    except (OSError, subprocess.SubprocessError, UnicodeError) as exc:
        raise RuntimeError(f'{action} 执行失败 ({type(exc).__name__})') from exc
    if result.returncode != 0:
        raise RuntimeError(f'{action} 退出码 {result.returncode}；未确认成功')
    try:
        envelope = json.loads(result.stdout)
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f'{action} 返回非 JSON') from exc
    if not isinstance(envelope, dict) or envelope.get('ok') is not True or not isinstance(envelope.get('data'), dict):
        raise RuntimeError(f'{action} 返回失败或无效信封')
    return envelope['data']


def decode_matrix(body):
    names, rows, ids = (body.get(k) for k in ('fields', 'data', 'record_id_list'))
    if (not isinstance(names, list) or not all(isinstance(n, str) for n in names)
            or len(names) != len(set(names)) or 'record_id' in names
            or not isinstance(rows, list) or not isinstance(ids, list) or len(rows) != len(ids)):
        raise RuntimeError('Base 矩阵 fields/data/record_id_list 不对应')
    result = []
    for rid, row in zip(ids, rows):
        valid_id(rid)
        if not isinstance(row, list) or len(row) != len(names):
            raise RuntimeError('Base 矩阵行长度与 fields 不对应')
        result.append(dict(zip(names, row), record_id=rid))
    if len(ids) != len(set(ids)):
        raise RuntimeError('Base 矩阵重复 record_id')
    return result


def fetch_records(cfg):
    records, seen, offset = [], set(), 0
    while True:
        body = cli(cfg, '+record-list', '--limit', '200', '--offset', str(offset))
        rows = decode_matrix(body)
        ids = {r['record_id'] for r in rows}
        if seen & ids:
            raise RuntimeError('分页重复 record_id，拒绝不完整数据')
        seen.update(ids)
        records.extend(rows)
        more = body.get('has_more')
        if type(more) is not bool:
            raise RuntimeError('分页缺少 has_more')
        if not more:
            return records
        next_offset = body.get('next_offset')
        if not rows or type(next_offset) is not int or next_offset <= offset:
            raise RuntimeError('分页 next_offset 无效或未前进')
        offset = next_offset


def is_type(record, kind):
    value = record.get('报告类型')
    return kind in value if isinstance(value, list) else value == kind


def qualified_daily_reports(records, start, end):
    """Select by occurrence day (daily report date); failed existing sources block publication."""
    selected = sorted((r for r in records if is_type(r, '日报')
                       and start <= str(r.get('报告日期') or '')[:10] <= end),
                      key=lambda r: str(r.get('报告日期') or '')[:10])
    for record in selected:
        day = str(record.get('报告日期') or '')[:10]
        fields = [record.get(k) for k in ('工作小结', '工作规划', '工作小结（提炼）')]
        if any(not isinstance(v, str) or not v.strip() for v in fields):
            raise RuntimeError(f'日报来源 {day} 不完整（正文/规划/提炼缺失），拒绝汇总')
        if any(marker in '\n'.join(fields) for marker in
               ('【草稿', '禁止正式写入', '采集草稿', '降级草稿', '（降级）', '[DEGRADED]', '规则回退', '待人工复核')):
            raise RuntimeError(f'日报来源 {day} 为降级草稿，拒绝汇总')
    unique = {}
    for record in selected:
        day = str(record['报告日期'])[:10]
        if day in unique:
            keys = ('工作小结', '工作规划', '工作小结（提炼）')
            if any(record[k] != unique[day][k] for k in keys):
                raise RuntimeError(f'日报来源重复日期 {day} 冲突，须人工确认')
        else:
            unique[day] = record
    return list(unique.values())


def explicit_item_dates(text, source_day):
    """Recognize explicit YYYY-MM-DD/MM-DD/Chinese dates; never reinterpret version numbers."""
    from datetime import date
    year = date.fromisoformat(source_day).year
    pattern = r'(?<!\d)(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})(?:日|号)?(?!\d)'
    dates = []
    for match in re.finditer(pattern, text):
        y, m, d = match.groups()
        try:
            dates.append(date(int(y) if y else year, int(m), int(d)))
        except ValueError:
            continue
    return dates


def fact_in_period(item, source_day, start, end):
    """Use explicit event dates when present; otherwise daily date is the occurrence evidence."""
    dates = explicit_item_dates(item, source_day)
    return any(start <= d.isoformat() <= end for d in dates) if dates else start <= source_day <= end


def latest_plan_candidates(records, next_start):
    """Only the last source's plan survives, labelled tentative with its original day."""
    from datetime import date, timedelta
    if not records:
        return []
    latest = max(records, key=lambda r: str(r.get('报告日期') or '')[:10])
    day = str(latest['报告日期'])[:10]
    source, start = date.fromisoformat(day), date.fromisoformat(next_start)
    out = []
    heading = ''
    for line in latest.get('工作规划', '').splitlines():
        if line.strip().startswith('【'):
            heading = line.strip()
            continue
        if not line.strip().startswith('·'):
            continue
        item = line.strip()[1:].strip()
        if not item or item in ('暂无', '无', '暂无明确规划'):
            continue
        dates = explicit_item_dates(item, day)
        time_text = item if dates or any(k in item for k in ('明日', '明天', '后天', '下周', '下月', '今日', '今天', '本周', '本月', '国庆后')) else heading + item
        # Any explicit overdue component is excluded conservatively, including mixed deadlines.
        if any(d < start for d in dates):
            continue
        relative = []
        if any(k in time_text for k in ('明日', '明天')):
            relative.append(source + timedelta(days=1))
        if '后天' in time_text:
            relative.append(source + timedelta(days=2))
        if '下周' in time_text:
            relative.append(source + timedelta(days=7-source.weekday()))
        if any(k in time_text for k in ('今日', '今天', '本周', '本月')):
            relative.append(source)
        if '国庆后' in time_text:
            relative.append(date(source.year, 10, 8))
        if any(d < start for d in relative):
            continue
        out.append(f'[候选；来源日报 {day}；未核实] {item}')
    return list(dict.fromkeys(out))


def source_coverage(records, start, end):
    """Calendar gaps are explicit, not proof of failed collection or a holiday calendar."""
    from datetime import date, timedelta
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    present = sorted({str(r.get('报告日期') or '')[:10] for r in records})
    weekdays = [first + timedelta(days=i) for i in range((last-first).days+1)
                if (first + timedelta(days=i)).weekday() < 5]
    missing = [d.isoformat() for d in weekdays if d.isoformat() not in present]
    return (f'【来源覆盖】日报；截至 {end}；合格来源日期: {", ".join(present)}；'
            f'缺失自然工作日（未核验节假日）: {", ".join(missing) or "无"}；'
            '仅汇总已有合格日报，不宣称整个周期业务事实完整。')


def get_record(cfg, rid):
    rows = decode_matrix(cli(cfg, '+record-get', '--record-id', valid_id(rid)))
    if len(rows) != 1 or rows[0]['record_id'] != rid:
        raise RuntimeError('回读 record_id 不匹配')
    return rows[0]


def verify_record(cfg, rid, expected):
    actual = get_record(cfg, rid)
    for name, value in expected.items():
        got = actual.get(name)
        # Base dates are returned as ISO timestamps in Asia/Shanghai.
        if name == '报告日期':
            got = str(got or '')[:10]
        elif name == '生成时间':
            got = str(got or '').replace('T', ' ')[:19]
        elif name == '报告类型' and isinstance(got, str):
            got = [got]
        if got != value:
            raise RuntimeError(f'回读 {rid} 字段「{name}」不符，未确认成功')
    return actual


def distill_text(cfg, prompt, max_tokens):
    """Strict streamed completion; at most one fresh retry, and only for truncation.

    The caller's budget is bounded at 16000 tokens; a length retry doubles it up to
    that cap. SDK/network retries are disabled. No partial attempt is concatenated.
    Signature is shared with daily reporting and remains unchanged.
    """
    if not cfg.get('llm_api_key'):
        raise RuntimeError('缺少 DR_LLM_API_KEY，拒绝写入未提炼报告')
    budget = min(max(int(max_tokens), 1), 16000)
    for attempt in (1, 2):
        started = time.monotonic()
        parts, finish, usage = [], None, None
        model, error = cfg.get('llm_model'), None
        try:
            from openai import OpenAI
            client = OpenAI(api_key=cfg['llm_api_key'], base_url=cfg['llm_base'], timeout=180, max_retries=0)
            stream = client.chat.completions.create(
                model=cfg['llm_model'],
                messages=[{'role': 'system', 'content': '你是医疗器械产品经理的周期复盘与推进规划助手。只依据提供的原始记录归并、判断和规划。'},
                          {'role': 'user', 'content': prompt}],
                max_tokens=budget, stream=True, stream_options={'include_usage': True})
            for chunk in stream:
                model = getattr(chunk, 'model', None) or model
                raw_usage = getattr(chunk, 'usage', None)
                if raw_usage is not None:
                    usage = raw_usage.model_dump() if hasattr(raw_usage, 'model_dump') else raw_usage
                if chunk.choices:
                    choice = chunk.choices[0]
                    parts.append(choice.delta.content or '')
                    if choice.finish_reason:
                        finish = choice.finish_reason
            text = ''.join(parts).strip()
        except Exception as exc:
            error = type(exc).__name__
            raise RuntimeError(f'LLM 提炼失败 ({type(exc).__name__})') from exc
        finally:
            # Metadata only: never log prompts, keys, provider messages or report text.
            print('[LLM] ' + json.dumps(dict(model=model, requested_model=cfg.get('llm_model'),
                  finish_reason=finish, usage=usage, duration_s=round(time.monotonic()-started, 3),
                  empty_body=not ''.join(parts).strip(), max_tokens=budget, attempt=attempt,
                  error=error), ensure_ascii=False, default=lambda _: None), file=sys.stderr)
        if finish == 'stop' and text:
            return text
        if finish == 'length' and attempt == 1 and budget < 16000:
            budget = min(budget * 2, 16000)
            continue
        raise RuntimeError(f'LLM 未完整完成 (finish_reason={finish}, empty_body={not bool(text)})，拒绝写入')


def resume_distillation(cfg, rid, prompt_builder, max_tokens):
    record = get_record(cfg, rid)
    for name in ('工作小结', '工作规划'):
        if not isinstance(record.get(name), str) or not record[name].strip():
            raise RuntimeError(f'已有记录 {rid} 缺少{name}，禁止覆盖')
    if isinstance(record.get('工作小结（提炼）'), str) and record['工作小结（提炼）'].strip():
        return rid
    text = distill_text(cfg, prompt_builder(record['工作小结'], record['工作规划']), max_tokens)
    payload = {'update_records': {rid: {'工作小结（提炼）': text}}}
    cli(cfg, '+record-batch-update', '--json', json.dumps(payload, ensure_ascii=False))
    expected = {k: record[k] for k in ('生成时间', '报告日期', '报告类型', '工作小结', '工作规划') if k in record}
    expected['工作小结（提炼）'] = text
    # Preserve returned date formats for comparisons below.
    if '报告日期' in expected:
        expected['报告日期'] = str(expected['报告日期'])[:10]
    if '生成时间' in expected:
        expected['生成时间'] = str(expected['生成时间']).replace('T', ' ')[:19]
    if isinstance(expected.get('报告类型'), str):
        expected['报告类型'] = [expected['报告类型']]
    verify_record(cfg, rid, expected)
    return rid


def write_report(cfg, kind, report_date, summary, planning, prompt_builder, max_tokens):
    from datetime import datetime, timedelta, timezone
    matches = [r for r in fetch_records(cfg) if is_type(r, kind) and str(r.get('报告日期') or '')[:10] == report_date]
    if len(matches) > 1:
        raise RuntimeError(f'{kind} {report_date} 存在重复记录，须人工处理，禁止覆盖')
    if matches:
        return resume_distillation(cfg, matches[0]['record_id'], prompt_builder, max_tokens)
    if not summary.strip() or not planning.strip():
        raise RuntimeError('正文或规划为空，拒绝创建')
    text = distill_text(cfg, prompt_builder(summary, planning), max_tokens)
    fields = {'生成时间': datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S'),
              '报告日期': report_date, '报告类型': [kind], '工作小结': summary,
              '工作规划': planning, '工作小结（提炼）': text}
    body = cli(cfg, '+record-batch-create', '--json', json.dumps({'create_records': [fields]}, ensure_ascii=False))
    ids = body.get('record_id_list')
    if not isinstance(ids, list) or len(ids) != 1:
        raise RuntimeError('创建返回 record_id_list 无效；重试前须查重')
    rid = valid_id(ids[0])
    verify_record(cfg, rid, fields)
    return rid
