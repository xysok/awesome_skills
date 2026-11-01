---
name: gf_lhb_list
description: >
  基于广发证券权威数据接口，查询指定交易日、指定市场的龙虎榜异常交易个股列表，
  返回上榜原因、成交额、涨跌幅等关键信息。适用于快速定位当日异动个股、分析龙虎榜上榜原因、复盘市场情绪。
category: finance
---

# 广发证券龙虎榜个股列表 Skill（gf_lhb_list）

通过 **POST 请求** 调用广发证券龙虎榜工具，接口返回 JSON 格式内容。

## 前置条件

- 环境变量 `GF_SKILLS_APIKEY` 已设置（安装了本 skill 后通常已配置）
- `curl` 可用（默认已有）

## 使用方式

### 单市场查询

```bash
curl -X POST 'https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $GF_SKILLS_APIKEY" \
  --data '{
    "service_name": "lhb",
    "tool_name": "lhb_aborttrade_market_date_get",
    "args": {
      "date": 20260313,
      "market": "sh"
    }
  }'
```

### 双市场同日查询（上海 + 深圳）

```bash
for market in sh sz; do
  echo "=== $market ==="
  curl -s -X POST 'https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call' \
    --header 'Content-Type: application/json' \
    --header "Authorization: Bearer $GF_SKILLS_APIKEY" \
    --data "{
      \"service_name\": \"lhb\",
      \"tool_name\": \"lhb_aborttrade_market_date_get\",
      \"args\": {
        \"date\": 20260313,
        \"market\": \"$market\"
      }
    }"
  echo ""
done
```

### 通过 Python 调用（适合在 execute_code 或脚本中使用）

```python
import os, json, urllib.request

def query_lhb(date: int, market: str) -> dict:
    """查询龙虎榜数据"""
    url = "https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.environ['GF_SKILLS_APIKEY']}"
    }
    payload = {
        "service_name": "lhb",
        "tool_name": "lhb_aborttrade_market_date_get",
        "args": {"date": date, "market": market}
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())
```

## 工具说明

| 字段 | 值 |
|------|-----|
| **service_name** | `lhb` |
| **tool_name** | `lhb_aborttrade_market_date_get` |

获取指定日期、指定市场上榜的异常交易个股列表。

### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `date` | integer | 是 | 日期，格式 `YYYYMMDD`，如 `20260313` |
| `market` | string | 是 | 交易市场：`sh`=上海，`sz`=深圳 |

### 关键返回字段

| 字段 | 说明 |
|------|------|
| `trdCode` | 交易代码 |
| `secuSht` | 证券简称 |
| `clsPrc` | 收盘价 |
| `dayChgRat` | 日涨跌幅（%） |
| `tnvVol` / `tnvVal` | 成交量 / 成交额（元） |
| `items[].rsnSht` | 上榜原因 |
| `items[].rsnCode` | 上榜原因代码 |
| `items[].beginDate` / `endDate` | 统计区间 |

### 调用示例

```json
{
  "service_name": "lhb",
  "tool_name": "lhb_aborttrade_market_date_get",
  "args": {
    "date": 20260313,
    "market": "sh"
  }
}
```

## 触发条件

当用户提到以下内容时，应加载本 skill：

- 龙虎榜 / 龙虎榜个股 / 异常交易
- 广发证券龙虎榜 / gf lhb
- 某日的上榜个股 / 异动个股
- 查询某日上海/深圳市场的龙虎榜
- 市场情绪复盘 / 短线异动分析

## 数据限制说明

1. 优先查询单个交易日的数据。
2. 若连续跨多个日期批量查询，建议拆分请求，避免返回内容过长。
3. 交易日才会产生龙虎榜数据（非交易日返回空）。

## 数据为空时的排查步骤

1. 日期是否为交易日（非交易日/周末无数据）。
2. 市场参数是否为 `sh` 或 `sz`。
3. 当日对应市场是否存在龙虎榜上榜个股（并非每个交易日都有上榜股票）。

## 常见错误处理

| 现象 | 可能原因 | 处理方式 |
|------|----------|----------|
| `401 Unauthorized` | API Key 无效或过期 | 重新到广发 Skills 页面获取新 key |
| 空 JSON 或无数据返回 | 非交易日或无上榜个股 | 确认日期，换交易日重试 |
| `curl: (6) Could not resolve host` | 网络不通 | 检查域名解析和网络连接 |
