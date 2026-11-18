"""本地登录文件与 Windows 当前用户凭证存储。"""

import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import pywintypes
import win32crypt
from mcp.server.fastmcp.exceptions import ToolError
from qqmusic_api import Credential

CRYPTPROTECT_UI_FORBIDDEN = 1


class CredentialStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.template = directory / "login.json"
        self.saved = directory / "credential.dpapi"

    def generate_template(self) -> bool:
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            with self.template.open("x", encoding="utf-8") as file:
                file.write(json.dumps({"musicid": "", "musickey": ""}, indent=2) + "\n")
        except FileExistsError:
            return False
        return True

    def read_template(self) -> Credential:
        try:
            data = json.loads(self.template.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            raise ToolError("[LOGIN_TEMPLATE_MISSING] 先调用 login(stage='template')。") from None
        except (UnicodeError, json.JSONDecodeError):
            raise ToolError("[LOGIN_TEMPLATE_INVALID] login.json 必须是有效的 UTF-8 JSON。") from None

        if not isinstance(data, dict) or set(data) != {"musicid", "musickey"}:
            raise ToolError("[LOGIN_TEMPLATE_INVALID] login.json 只能包含 musicid 与 musickey。")
        musicid, musickey = data["musicid"], data["musickey"]
        if type(musicid) is int:
            musicid = str(musicid)
        if not isinstance(musicid, str) or not musicid.isascii() or not musicid.isdecimal():
            raise ToolError("[LOGIN_TEMPLATE_INVALID] musicid 必须为纯数字，建议使用 JSON 字符串。")
        if len(musicid) > 20 or not 0 < int(musicid) < 2**64:
            raise ToolError("[LOGIN_TEMPLATE_INVALID] musicid 超出有效范围。")
        if not isinstance(musickey, str) or not musickey or any(ch.isspace() for ch in musickey):
            raise ToolError("[LOGIN_TEMPLATE_INVALID] musickey 必须填写单条登录票据，不含空白。")
        return Credential(musicid=int(musicid), musickey=musickey)

    def save(self, credential: Credential) -> None:
        encrypted = win32crypt.CryptProtectData(
            credential.model_dump_json().encode("utf-8"),
            "QQ Music MCP",
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
        )
        file = NamedTemporaryFile(dir=self.directory, prefix=".credential-", delete=False)
        temporary = Path(file.name)
        try:
            with file:
                file.write(encrypted)
            temporary.replace(self.saved)
        finally:
            temporary.unlink(missing_ok=True)
        try:
            self.template.unlink()
        except OSError:
            raise ToolError(
                "[LOGIN_TEMPLATE_RETAINED] 凭证已保存，但清理 login.json 失败，请手动删除该文件。"
            ) from None

    def load(self) -> Credential | None:
        try:
            encrypted = self.saved.read_bytes()
        except FileNotFoundError:
            return None
        try:
            _, data = win32crypt.CryptUnprotectData(
                encrypted, None, None, None, CRYPTPROTECT_UI_FORBIDDEN
            )
        except pywintypes.error:
            raise ToolError("[LOGIN_STORE_INVALID] 当前 Windows 用户无法解密凭证，请重新导入。") from None
        return Credential.model_validate_json(data)
