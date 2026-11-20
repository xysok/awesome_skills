"""Extract → translate → reflow local PDFs, with editable JSON between stages."""
import argparse
from collections import Counter
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
import tempfile

import pymupdf as pdf

LITERAL = re.compile(r'https?://[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[\w]+(?:[-_/][\w]+)+(?:\.\d+)*\b|\b[A-Z]{1,8}\d+[A-Z0-9]*\b|\d+(?:[.,:/–-]\d+)*(?:\s?(?:EUR|USD|GBP|CHF|JPY|CNY|mm|cm|kg|mg|Hz|MHz|GB|TB|°C|%))?')


def hash_file(path):
    with path.open('rb') as f:
        h = sha256()
        for chunk in iter(lambda: f.read(1024*1024), b''):
            h.update(chunk)
        return h.hexdigest()


def extract(src, pages=None, ocr=None):
    units, issues, photos = [], [], []
    with pdf.open(src) as d:
        if not d.is_pdf or d.needs_pass or not len(d):
            raise ValueError('须提供可读取的未加密 PDF')
        idx = list(range(len(d))) if pages is None else [i-1 for i in pages]
        if not idx or idx != sorted(set(idx)) or min(idx)<0 or max(idx)>=len(d):
            raise ValueError('页码须为有效、升序、不重复的原文页码')
        for i in idx:
            pg=d[i]; tp=None
            if pg.rotation: issues.append([i+1,'原页有旋转，请检查阅读顺序'])
            if len(pg.get_text().strip())<20 and pg.get_image_info():
                if not ocr:
                    issues.append([i+1,'疑似扫描页，未做 OCR']); photos.append(i+1); continue
                tp=pg.get_textpage_ocr(language=ocr,dpi=220,full=True)
                issues.append([i+1,'OCR 文本需对照原页']); photos.append(i+1)
            if pg.get_image_info() and i+1 not in photos:
                photos.append(i+1); issues.append([i+1,'原图附于译文后；图中文字未单独翻译'])
            tables=[]
            if tp is None and not pg.rotation:
                tables=list(pg.find_tables().tables)
            nodes=[]
            for tb in tables:
                cells=[[str(v or '').strip() for v in r] for r in tb.extract()]
                if not cells:continue
                nodes.append((tuple(tb.bbox),{'kind':'table','cells':cells,'text':''}))
            for b in pg.get_text('dict',textpage=tp,flags=pdf.TEXTFLAGS_TEXT,sort=True)['blocks']:
                spans=[s for ln in b.get('lines',[]) for s in ln['spans'] if s['text'].strip()]
                if not spans:continue
                bb=pdf.Rect(b['bbox'])
                if any(bb.get_area() and (bb & pdf.Rect(tb.bbox)).get_area()/bb.get_area()>.85 for tb in tables):continue
                lines=[''.join(s['text'] for s in ln['spans']).strip() for ln in b['lines']]
                text=' '.join(v for v in lines if v).replace('\u00ad','')
                first=spans[0]
                u={'kind':'para','text':text,'size':round(first['size'],2),'font':first['font'],'color':first['color']}
                if any(ln.get('wmode') or abs(ln['dir'][1])>.01 for ln in b['lines']):issues.append([i+1,'存在旋转或纵排文字'])
                if ':' in text and ':' in lines[0] and len(text.split(':',1)[0])<50:
                    u.update(kind='field',label=text.split(':',1)[0].strip(),value=text.split(':',1)[1].strip())
                elif len(lines)==1 and len(text)<100 and (any('Bold' in s['font'] for s in spans) or first['size']>=15):u['kind']='heading'
                nodes.append((tuple(bb),u))
            if not nodes:issues.append([i+1,'未抽取到文字']); photos.append(i+1)
            for n,(bbox,u) in enumerate(sorted(nodes,key=lambda b:(round(b[0][1]/4),b[0][0])),1):
                units.append(dict(u,id=f'{i+1}:{n}',page=i+1,bbox=bbox))
    return {'digest':hash_file(src),'pages':[i+1 for i in idx],'units':units,'issues':issues,'reference_pages':sorted(set(photos))}


def translate(manifest, engine, glossary=None):
    glossary=glossary or {}; issues=[]; items={}; cache={}
    def one(s, unit, where):
        if s in glossary:return glossary[s]
        if s in cache:return cache[s]
        if not s or not any(c.isalpha() for c in LITERAL.sub('',s)):return s
        if len(s.encode())>1800:
            parts=re.split(r'(?<=[.!?;。！？；])\s+',s)
            if len(parts)>1:return ' '.join(one(piece,unit,where) for piece in parts)
            issues.append([unit,where,'超长且无可靠句界，保留原文']);return s
        bare=LITERAL.findall(s)
        # Prefer context-rich translation, then retry with protected literals only if needed.
        got=engine(s)
        if not got or Counter(LITERAL.findall(got))!=Counter(bare):
            token_count=[0]
            def mask(m):
                n=token_count[0];token_count[0]+=1;return f' [[QZX{n:03}XZQ]] '
            got=engine(LITERAL.sub(mask,s)) if bare else ''
            ids=[]
            def restore(m):
                n=int(m[1]);ids.append(n);return bare[n] if n<len(bare) else m[0]
            got=re.sub(r'\[\s*\[\s*QZX\s*(\d{3})\s*XZQ\s*\]\s*\]',restore,got or '',flags=re.I)
            if not got.strip() or Counter(ids)!=Counter(range(len(bare))) or Counter(LITERAL.findall(got))!=Counter(bare):
                issues.append([unit,where,'数字或标识符校验失败，保留原文']);return s
        if got.strip()==s.strip() and re.search('[A-Za-z]{3}',s):
            issues.append([unit,where,'译文与原文相同，请检查术语或语种']);return s
        cache[s]=got.strip();return cache[s]
    for u in manifest['units']:
        k=u['kind']; i=u['id']
        if k=='table':v={'cells':[[one(s,i,f'cell {a+1}/{b+1}') for b,s in enumerate(r)] for a,r in enumerate(u['cells'])]}
        elif k=='field':v={'label':one(u['label'],i,'label'),'value':one(u['value'],i,'value')}
        else:v={'text':one(u['text'],i,'text')}
        items[i]=v
    return {'digest':manifest['digest'],'items':items,'issues':issues}


def render(src, m, t, dst):
    if src.resolve()==dst.resolve() or dst.exists():raise ValueError('输出不得覆盖原件或现有文件')
    if hash_file(src)!=m['digest'] or t['digest']!=m['digest'] or len(m['units'])!=len(t['items']) or {u['id'] for u in m['units']}!=set(t['items']):
        raise ValueError('原件指纹或翻译单元不匹配')
    if not m['units']:raise ValueError('没有可排版的翻译单元')
    sections=['<h1>中文译文｜非官方译本</h1>']; warnings=set(x[0] for x in t['issues']); last=None
    for u in m['units']:
        if u['page']!=last:last=u['page'];sections.append(f'<h2>原文第 {last} 页</h2>')
        i=u['id']; k=u['kind']; v=t['items'][i]
        if i in warnings:sections.append('<p><b>【此单元待复核，可能含原文】</b></p>')
        if k=='table':
            if [len(r) for r in v['cells']]!=[len(r) for r in u['cells']]:raise ValueError('表格行列不匹配')
            sections.append('<table>'+''.join('<tr>'+''.join(f'<td>{escape(s)}</td>' for s in r)+'</tr>' for r in v['cells'])+'</table>')
        elif k=='field':sections.append(f'<p><b>{escape(v["label"])}：</b>{escape(v["value"])}</p>')
        elif k=='heading':sections.append(f'<h3>{escape(v["text"])}</h3>')
        else:sections.append(f'<p>{escape(v["text"])}</p>')
    dst.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dst.parent) as td:
        f=Path(td)/'work.pdf'; writer=pdf.DocumentWriter(str(f)); story=pdf.Story(html=''.join(sections),user_css='body{font-family:sans-serif;font-size:11pt;line-height:1.48} h2{color:#17466c} td{border:1px solid #777;padding:3pt} table{width:100%;border-collapse:collapse}'); rect=pdf.paper_rect('a4'); box=pdf.Rect(45,42,rect.width-45,rect.height-42)
        try:
            for _ in range(len(m['units'])+30):
                dev=writer.begin_page(rect); more,_=story.place(box);story.draw(dev);writer.end_page()
                if not more:break
            else:raise ValueError('排版未收敛')
        finally:writer.close()
        with pdf.open(f) as out, pdf.open(src) as original:
            if not len(out) or any(not p.get_text().strip() for p in out):raise ValueError('译文回读失败')
            for n in m.get('reference_pages',[]):
                pg=out.new_page(width=rect.width,height=rect.height);pg.insert_text((45,28),f'Original page {n} - visual reference',fontsize=10);pg.show_pdf_page(box,original,n-1)
            candidate=Path(td)/'complete.pdf'
            out.save(candidate,deflate=True)
        # Atomic publication without overwriting another run's output.
        import os
        os.link(candidate,dst)
    return {'source_pages':m['pages'],'units':len(m['units']),'review':m.get('issues',[])+t['issues']}


def main():
    p=argparse.ArgumentParser(description=__doc__); s=p.add_subparsers(dest='stage',required=True)
    x=s.add_parser('extract');x.add_argument('pdf',type=Path);x.add_argument('units',type=Path);x.add_argument('--pages',type=int,nargs='+');x.add_argument('--ocr')
    x=s.add_parser('translate');x.add_argument('units',type=Path);x.add_argument('translations',type=Path);x.add_argument('--provider',choices=['aliyun','tencent'],default='aliyun');x.add_argument('--source',default='auto');x.add_argument('--glossary',type=Path)
    x=s.add_parser('render');x.add_argument('pdf',type=Path);x.add_argument('units',type=Path);x.add_argument('translations',type=Path);x.add_argument('out',type=Path)
    a=p.parse_args(); read=lambda path:json.loads(path.read_text(encoding='utf-8'))
    def write(path,obj):
        with path.open('x',encoding='utf-8') as f:json.dump(obj,f,ensure_ascii=False,indent=2)
    if a.stage=='extract':
        if a.units.exists():raise ValueError('单元文件已存在')
        m=extract(a.pdf,a.pages,a.ocr);write(a.units,m);print(len(m['units']),'units');return 0
    if a.stage=='translate':
        if a.translations.exists():raise ValueError('翻译文件已存在')
        from providers import translator
        t=translate(read(a.units),translator(a.provider,a.source),read(a.glossary) if a.glossary else None);write(a.translations,t);print(len(t['issues']),'units or fields require review');return 2 if t['issues'] else 0
    report_path=a.out.with_suffix('.qa.json')
    if report_path.exists() or report_path.resolve()==a.pdf.resolve():raise ValueError('报告不得覆盖现有文件')
    r=render(a.pdf,read(a.units),read(a.translations),a.out);write(report_path,r);print(json.dumps(r,ensure_ascii=False));return 2 if r['review'] else 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,RuntimeError) as exc:raise SystemExit(str(exc)) from None
