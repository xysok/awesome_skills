// Test-only bootstrap: exercise the suite with the installed system browser.
// Preserve explicit executable overrides and every other launch option.
import { chromium } from 'playwright';
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ executablePath: '/usr/bin/chromium', ...options });
