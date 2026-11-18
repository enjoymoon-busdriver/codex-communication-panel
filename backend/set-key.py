"""Store one provider credential locally; the secret is never a process argument."""
import argparse
import getpass
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description="保存沟通模型服务商的本地密钥")
    parser.add_argument("provider", choices=("go", "deepseek", "custom"))
    provider = parser.parse_args().provider
    home = Path(os.environ.get("CODEX_COMMUNICATION_HOME") or Path.home() / ".forge-delegate")
    origin = None
    if provider == "custom":
        try:
            base = json.loads((home / "communication-settings.json").read_text())["customBaseUrl"]
            url = urlsplit(base)
            host = url.hostname.encode("idna").decode("ascii").lower()
            if (not host or url.username is not None or url.password is not None or url.query or url.fragment
                    or url.scheme != "https" and not (url.scheme == "http" and host in ("localhost", "127.0.0.1", "::1"))):
                raise ValueError("Invalid base URL")
            port = url.port
            host = f"[{host}]" if ":" in host else host
            origin = f"{url.scheme}://{host}"
            if port and port != {"http": 80, "https": 443}[url.scheme]:
                origin += f":{port}"
        except (OSError, AttributeError, KeyError, ValueError, TypeError):
            parser.exit(1, "请先在面板保存有效的自定义服务地址。\n")
    if sys.stdin.isatty():
        key = getpass.getpass("请输入密钥（输入隐藏）: ").strip()
    else:
        key = sys.stdin.readline().strip()
    if not key or not key.isascii() or any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
        parser.exit(1, "密钥不能为空或含有空白或控制字符。\n")
    payload = json.dumps({"origin": origin, "key": key}) if origin else key
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=home, delete=False) as out:
        tmp = Path(out.name)
        out.write(payload + "\n")
    try:
        tmp.replace(home / (provider + "-key"))
    finally:
        tmp.unlink(missing_ok=True)
    print("密钥已保存到本机。")


if __name__ == "__main__":
    main()
