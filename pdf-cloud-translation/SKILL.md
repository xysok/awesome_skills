---
name: pdf-cloud-translation
description: Use when translating PDFs. Reflow with Aliyun or Tencent.
---

# PDF 中文翻译

Use for local PDFs or authorized local copies of attachments. Default to Simplified Chinese and Aliyun; use Tencent when selected. Never silently switch providers or send a document to both. Do not expose secrets, alter originals, or write back to a cloud workspace unless asked. Confirm authorization for transmitting restricted content before sending extracted text to the selected cloud API.

Read [runbook](references/runbook.md) for the commands, dependencies, and review checklist. Use `scripts/pipeline.py` in this skill package;.

1. Extract locally into a page-indexed JSON manifest with source PDF fingerprint, coordinates and translation units. Inspect a representative page; verify heading, field and table ordering before translating a batch. Supply OCR language only when required and installed.
2. Translate units via one provider. Use a reviewed terminology JSON for domain-specific fields. Preserve literals and keep failures visible; do not treat the cloud response as proof of accuracy.
3. Reflow into a separate PDF, preserving section order and table structure where detected. Never pretend reflow is an exact facsimile. Keep unit IDs and source page markers. Inspect split columns, scans and complex tables against the original before use.
4. Read QA JSON and visually inspect representative pages. Resolve flagged units or call the output a review draft. Verify quantities, units, prices, dates and model numbers manually before relying on the document. Do not advance to full batch if the sample fails.
