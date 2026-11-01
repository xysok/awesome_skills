---
name: gf_etf_super_fund
description: >
  基于广发证券权威数据接口，查询发生大幅流入、大幅流出、持续流入、持续流出等超级资金异动的
  ETF 列表及近 14 日资金明细。适用于跟踪 ETF 资金异动、观察市场情绪、识别短期资金聚焦方向。
category: syx-skills
---

# 广发证券 ETF 超级资金异动 Skill（gf_etf_super_fund）

通过 **POST 请求** 调用广发证券 ETF 资金异动工具，接口返回 JSON 格式内容。

## 前置条件

- 环境变量 `GF_SKILLS_APIKEY` 已设置
- `curl` 可用（默认已有）

## 工具说明

**service_name**: `etf-super-fund`

**tool_name**: `gfmiddle_eits_super_fund_etf_superfund_get`

查询发生超级资金异动的 ETF 列表，返回结果包含近 14 日资金流入明细。

### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 异动类型：`大幅流入`、`大幅流出`、`持续流入`、`持续流出` |

### 关键返回字段

| 字段 | 说明 |
|------|------|
| `etfcode` / `etfname` | ETF 代码 / 简称 |
| `mktCd` | 市场，`SH` / `SZ` |
| `tradeDate` | 交易日期 |
| `fndNet` | 当日资金净流入（万元） |
| `fndNetPercent` | 资金强度（%） |
| `estimatedFundingCost` | 资金估算成本 |
| `capitalProfitMargin` | 资金盈利水平 |
| `details[].tradeDate` / `fndNetIn` | 历史明细：日期 / 当日资金净流入 |

### 调用示例

```bash
curl -X POST 'https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $GF_SKILLS_APIKEY" \
  --data '{
    "service_name": "etf-super-fund",
    "tool_name": "gfmiddle_eits_super_fund_etf_superfund_get",
    "args": {
      "type": "大幅流入"
    }
  }'
```

## Python 封装（适合 execute_code 或脚本中使用）

```python
import os, json, urllib.request

API_URL = "https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call"

def get_etf_super_fund(type_: str) -> dict:
    """查询 ETF 超级资金异动
    type_ 可选：大幅流入, 大幅流出, 持续流入, 持续流出
    """
    API_KEY = os.environ["GF_SKILLS_APIKEY"]
    req = urllib.request.Request(
        API_URL,
        data=json.dumps({
            "service_name": "etf-super-fund",
            "tool_name": "gfmiddle_eits_super_fund_etf_superfund_get",
            "args": {"type": type_}
        }).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        },
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())
```

## 触发条件

当用户提到以下内容时，应加载本 skill：

- ETF 资金 / ETF 异动 / ETF 流入 / ETF 流出
- 超级资金 / 大幅流入 / 大幅流出 / 持续流入 / 持续流出
- 资金方向 / 资金聚焦 / 资金异动
- 广发 ETF / gf etf / etf-super-fund

## 数据限制

1. 建议一次仅查询一种异动类型，避免返回数据过杂。
2. 若需对比多种类型（如同时看大幅流入 + 持续流入），拆分多次请求。
3. 返回结果中 `details[]` 包含近 14 日资金明细。

## 数据为空时的排查步骤

1. 异动类型是否为接口支持的固定值（`大幅流入`、`大幅流出`、`持续流入`、`持续流出`）。
2. 当前交易日是否存在对应类型的异动 ETF。
