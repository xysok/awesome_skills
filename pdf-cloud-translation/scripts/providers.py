"""Cloud adapters; only the selected provider receives text."""
import functools
import json
import os
import re
from pathlib import Path
from dotenv import dotenv_values

TARGET = "zh"
def credentials(*names):
    path = Path(os.getenv('PDF_TRANSLATION_ENV', '/opt/data/.env')).expanduser()
    values = dotenv_values(path, interpolate=False)
    vals = [(os.getenv(name) or values.get(name) or '').strip() for name in names]
    if not all(vals):
        raise RuntimeError(f'请在 {path} 中填写：' + ', '.join(names))
    return vals


def translator(provider, source):
    if provider == 'tencent':
        aid, secret = credentials('TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY')
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.tmt.v20180321 import tmt_client
        profile = ClientProfile(httpProfile=HttpProfile(reqTimeout=45))
        client = tmt_client.TmtClient(credential.Credential(aid, secret), os.getenv('TENCENT_REGION', 'ap-guangzhou'), profile)
        def request(text):
            payload = dict(SourceText=text, Source=source, Target=TARGET, ProjectId=0)
            return json.loads(client.call('TextTranslate', payload))['Response']['TargetText']
    elif provider == 'aliyun':
        aid, secret = credentials('ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET')
        from alibabacloud_alimt20181012.client import Client
        from alibabacloud_alimt20181012.models import TranslateGeneralRequest
        from alibabacloud_tea_openapi.models import Config
        from alibabacloud_tea_util.models import RuntimeOptions
        client = Client(Config(access_key_id=aid, access_key_secret=secret, endpoint='mt.aliyuncs.com', protocol='HTTPS'))
        def request(text):
            req = TranslateGeneralRequest(format_type='text', source_language=source, target_language=TARGET, scene='general', source_text=text)
            res = client.translate_general_with_options(req, RuntimeOptions(connect_timeout=10000, read_timeout=45000)).body
            if str(res.code) != '200' or not res.data:
                raise RuntimeError(f'业务错误码 {res.code}')
            return res.data.translated
    else:
        raise ValueError('不支持的翻译服务商')
    @functools.lru_cache(maxsize=4096)
    def cached(text):
        try:
            result = request(text)
            if not isinstance(result, str) or not result.strip():
                raise RuntimeError('译文为空')
            return result.strip()
        except Exception as e:
            # SDK messages may include sensitive request data. Log only safe error class.
            code = getattr(e, 'code', None)
            safe_code = code if provider == 'tencent' and isinstance(code, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.]{0,80}', code) else type(e).__name__
            raise RuntimeError(f'{provider} 翻译请求失败（{safe_code}）；请检查权限、语种及配额') from None
    return cached
