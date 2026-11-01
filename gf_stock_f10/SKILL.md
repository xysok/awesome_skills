---
name: gf_stock_f10
description: >
  基于广发证券权威数据接口，查询个股 F10 基础信息，包括公司全称、板块、上市日期、主营业务和所属行业等。
  适用于快速了解上市公司基本面画像、核对个股静态资料。
category: syx-skills
---

# 广发证券股票 F10 基础信息 Skill（gf_stock_f10）

通过 **POST 请求** 调用广发证券 F10 工具，接口返回 JSON 格式内容。

## 前置条件

- 环境变量 `GF_SKILLS_APIKEY` 已设置（安装了本 skill 后通常已配置）
- `curl` 可用（默认已有）

## 工具说明

**service_name**: `wechat_f10`

**tool_name**: `f10_basic_post`

查询个股基本面信息，包括公司全名、板块、上市日期、主营业务和所属行业。

### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | 是 | 证券代码（纯数字），如 `000776` |
| `market` | string | 是 | 市场（大写）：`SH`=上海，`SZ`=深圳 |

### 关键返回字段

| 字段 | 说明 |
|------|------|
| `compName` | 公司全称 |
| `boardName` | 板块 |
| `listDate` | 上市日期 |
| `businessScope` | 主营业务范围 |
| `industries` | 所属行业 |

### 调用示例

```bash
curl -X POST 'https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $GF_SKILLS_APIKEY" \
  --data '{
    "service_name": "wechat_f10",
    "tool_name": "f10_basic_post",
    "args": {
      "code": "000776",
      "market": "SZ"
    }
  }'
```

## Python 封装（适合 execute_code 或脚本中使用）

```python
import os, json, urllib.request

API_URL = "https://mcp-api.gf.com.cn/gf-skills/skills/mcp/call"

def get_f10(code: str, market: str) -> dict:
    """查询个股 F10 基础信息，code 为纯数字，market 为 'SH' 或 'SZ'"""
    API_KEY = os.environ.get("GF_SKILLS_APIKEY", "")
    req = urllib.request.Request(
        API_URL,
        data=json.dumps({
            "service_name": "wechat_f10",
            "tool_name": "f10_basic_post",
            "args": {"code": code, "market": market}
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

- 股票 F10 / 公司基本面 / 公司全称 / 主营业务
- 某只股票的板块 / 上市日期 / 所属行业
- 查股票基本信息 / 查个股资料
- 广发证券 F10 / gf f10

## 数据限制

1. 适合单只股票查询。如需批量查询多只个股，建议分批请求。
2. `code` 为纯数字，不带市场前缀（与 `gf_stock_valuation` 不同）。
3. `market` 必须大写（`SH` / `SZ`）。

## 数据为空时的排查步骤

1. 股票代码是否为纯数字（不带 `SZ`/`SH` 前缀）。
2. 市场参数是否为 `SH` 或 `SZ`（大写）。
3. 代码与市场是否匹配（如上交所股票用 `SH`，深交所用 `SZ`）。
