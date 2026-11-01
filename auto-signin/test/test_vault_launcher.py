import unittest
import importlib.util
from pathlib import Path
from types import SimpleNamespace

SCRIPT=Path(__file__).parents[1]/'scripts'/'vault-launcher.py'

class VaultLauncherTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'The secure vault launcher is not implemented')
        spec=importlib.util.spec_from_file_location('signin_vault_launcher',SCRIPT)
        self.mod=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def test_one_platform_only(self):
        for platform, origin in [('cordcloud','https://www.cordcloud.us'),('jd','https://www.jd.com'),('taobao','https://www.taobao.com'),('wps','https://www.wps.cn')]:
            store=SimpleNamespace(get_meta=lambda h:SimpleNamespace(kind='login',origin=origin,identifier='fixture@example.test'),resolve_secret=lambda h:{'password':'test-only-password'})
            env=self.mod.credentials_for(store,'vault_fixture',platform)
            prefix=platform.upper()
            self.assertEqual(env,{prefix+'_EMAIL' if platform=='cordcloud' else prefix+'_USERNAME':'fixture@example.test',prefix+'_PASSWORD':'test-only-password'})

    def test_wrong_origin_never_resolves_secret(self):
        def forbidden(h):
            self.fail('Wrong-origin secret must not be read')
        store=SimpleNamespace(get_meta=lambda h:SimpleNamespace(kind='login',origin='https://evil.invalid',identifier='fixture'),resolve_secret=forbidden)
        with self.assertRaises(ValueError):
            self.mod.credentials_for(store,'vault_fixture','cordcloud')

    def test_unknown_platform_fails_closed(self):
        with self.assertRaises(ValueError):
            self.mod.credentials_for(None,'vault_fixture','other')

if __name__=='__main__':
    unittest.main()
