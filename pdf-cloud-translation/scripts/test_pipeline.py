import tempfile
import unittest
from pathlib import Path
import pymupdf as pdf
import pipeline as p

class PipelineTests(unittest.TestCase):
    def test_roundtrip_and_source_binding(self):
        with tempfile.TemporaryDirectory() as td:
            src,out=Path(td)/'in.pdf',Path(td)/'out.pdf'
            with pdf.open() as d:
                pg=d.new_page();pg.insert_text((55,80),'1 Heading',fontname='hebo');pg.insert_text((55,110),'Amount: 1,234.56 EUR'); d.save(src)
            units=p.extract(src)
            self.assertEqual(units['units'][0]['kind'],'heading')
            result=p.translate(units,lambda s:s.replace('Heading','标题').replace('Amount','金额'))
            self.assertFalse(result['issues'])
            p.render(src,units,result,out)
            with pdf.open(out) as d:
                self.assertIn('1,234.56',d[0].get_text());self.assertIn('金额',d[0].get_text())
            with self.assertRaises(ValueError):p.render(out,units,result,Path(td)/'bad.pdf')

    def test_missing_identifier_is_flagged(self):
        m={'digest':'test','units':[{'id':'1:1','text':'Price: 99.50 EUR','kind':'field','label':'Price','value':'Total 99.50 EUR'}]}
        t=p.translate(m,lambda _:'金额被遗漏')
        self.assertEqual(len(t['issues']),1)
        self.assertIn('99.50 EUR',str(t['items']))

if __name__=='__main__':unittest.main()
