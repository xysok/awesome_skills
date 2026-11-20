# 运行与验收

使用隔离环境，勿把依赖装进 Hermes 本身。在技能目录运行 `python3 -m venv .venv` 和 `.venv/bin/python -m pip install -r scripts/requirements.txt`。

```bash
PY=.venv/bin/python
"$PY" scripts/pipeline.py extract input.pdf units.json --pages 1 2
"$PY" scripts/pipeline.py translate units.json zh.json --provider aliyun --source de
"$PY" scripts/pipeline.py render input.pdf units.json zh.json output.zh.pdf
"$PY" -m unittest discover -s scripts -v
```

先试 1–2 页；省略 `--pages` 提取全部。可换 `--provider tencent`；不自动切换。凭证默认只从 `/opt/data/.env` 加载本工具所需的键（可用 `PDF_TRANSLATION_ENV` 指定路径）。阿里云用 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`；腾讯云用 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`。不把密钥放入安装包或输入 JSON。

可加 `--glossary glossary.json`，格式为 `{"Beschaffer":"采购方","Verfahren":"采购程序"}`，仅完整字段或单元精确匹配。逐条审校可编辑 `zh.json` 的 `items`，保持单元 ID、结构和数值不变。退出码 2 表示已生成中间结果或 PDF，但需查看 `issues` 或 `.qa.json`；不等于完成审校。若已有输出，请换新文件名。中间件含文档正文，限制访问。

按检测到的字段和有线框表格重排，页码指向原文，不承诺等字体、等页数、保留链接热区或复刻版式。多栏、无边框/合并单元格、公式、图中文字需人工对照。图像页可附整页原文作为参照；文本过少的疑似扫描页可传 `--ocr deu+eng`，需要本机配置对应的 Tesseract 语言数据。翻译前预览源单元；交付前逐页抽查顺序、表格行列、数字及标识，检查待复核项和实际版面。需要精确原版坐标时，把同版本单元与原 PDF 对齐，按版式定制，不复用另一份文件的坐标或手工合并 ID。
