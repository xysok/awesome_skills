"""日报生成入口（cron no_agent 模式）。调用 gen_daily_report.py --write-base。"""
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(BASE, "gen_daily_report.py")


def _setup_stdio():
    """Windows 控制台默认 GBK，统一 UTF-8，避免中文输出解码/编码崩溃。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main():
    _setup_stdio()
    r = subprocess.run(
        [sys.executable, TARGET, "--write-base"],
        cwd=BASE,
        capture_output=True,
        text=True,
        # 子进程 UTF-8 输出，按 UTF-8 解码；解码失败用替换符，绝不吞输出
        encoding="utf-8",
        errors="replace",
    )
    if r.stdout:
        sys.stdout.write(r.stdout)
    if r.stderr:
        sys.stderr.write(r.stderr)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())