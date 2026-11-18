import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from qq_music_mcp.server import create_server


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_login_uses_local_template_and_persists_only_accepted_credentials(tmp_path):
    checked = []

    async def check_expired(credential):
        checked.append(credential.musicid)
        return credential.musicid != 123456789

    @asynccontextmanager
    async def client_factory(**_):
        yield SimpleNamespace(login=SimpleNamespace(check_expired=check_expired))

    app = create_server(tmp_path, client_factory=client_factory)
    template = tmp_path / "login.json"
    stored = tmp_path / "credential.dpapi"

    async with create_connected_server_and_client_session(app._mcp_server) as session:
        help_result = await session.call_tool("help")
        assert not help_result.isError
        assert "login.json" in help_result.content[0].text
        assert "submit" in help_result.content[0].text
        assert not template.exists()

        generated = await session.call_tool("login", {"stage": "template"})
        assert not generated.isError
        assert json.loads(template.read_text(encoding="utf-8")) == {"musicid": "", "musickey": ""}
        assert not stored.exists()

        template.write_text('{"musicid": "bad", "musickey": "test-secret-never-echo"}', encoding="utf-8")
        repeated = await session.call_tool("login", {"stage": "template"})
        assert not repeated.isError
        malformed = await session.call_tool("login", {"stage": "submit"})
        assert malformed.isError
        assert "test-secret-never-echo" not in str(malformed)
        assert checked == []
        assert template.exists()

        template.write_text('{"musicid": "999999999", "musickey": "test-secret-never-echo"}', encoding="utf-8")
        rejected = await session.call_tool("login", {"stage": "submit"})
        assert rejected.isError
        assert checked == [999999999]
        assert not stored.exists()
        assert template.exists()

        template.write_text('{"musicid": "123456789", "musickey": "test-secret-never-echo"}', encoding="utf-8-sig")
        imported = await session.call_tool("login", {"stage": "submit"})
        assert not imported.isError
        assert "test-secret-never-echo" not in str(imported)
        assert checked == [999999999, 123456789]
        assert b"test-secret-never-echo" not in stored.read_bytes()
        assert not template.exists()

    restarted = create_server(tmp_path, client_factory=client_factory)
    async with create_connected_server_and_client_session(restarted._mcp_server) as session:
        status = await session.call_tool("login", {"stage": "status"})
        assert not status.isError
        assert status.structuredContent["logged_in"] is True
        assert checked == [999999999, 123456789, 123456789]

        await session.call_tool("login", {"stage": "template"})
        template.write_text('{"musicid": "999999999", "musickey": "another-secret"}', encoding="utf-8")
        rejected = await session.call_tool("login", {"stage": "submit"})
        assert rejected.isError
        status = await session.call_tool("login", {"stage": "status"})
        assert status.structuredContent["logged_in"] is True
        assert checked[-2:] == [999999999, 123456789]
