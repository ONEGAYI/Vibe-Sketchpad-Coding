import json
from contextlib import asynccontextmanager
from types import SimpleNamespace as Row

import httpx
import pywintypes
import pytest
import win32cred
from mcp.shared.memory import create_connected_server_and_client_session
from qqmusic_api import CredentialExpiredError
from winerror import ERROR_NOT_FOUND

from qq_music_mcp.server import create_server


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_search_create_and_edit_use_exact_playlist_and_track_ids(tmp_path):
    writes = []
    created = []

    song = Row(id=1234, type=1, mid="song-mid", name="同一首歌", singer=[Row(name="歌手")], album=Row(name="专辑"))

    async def search(keyword, search_type, *, num, page, highlight):
        assert (keyword, search_type, num, page, highlight) == ("一首歌", 0, 10, 1, False)
        return Row(song=[song], nextpage=-1)

    async def check_expired(credential):
        return False

    async def list_mine(account):
        assert account == 123456789
        return Row(playlists=created, total=len(created), finished=True)

    async def create(title):
        writes.append(("create", title))
        created.append(Row(id=87654321, dirid=17, title=title, songnum=1))
        return Row(retCode=0, id=87654321, dirid=17, name=title)

    async def detail(playlist_id, *, page, num):
        assert playlist_id == 87654321
        return Row(info=created[0], songs=[song], total=1, hasmore=0)

    async def add(dirid, song_info, *, tid):
        writes.append(("add", dirid, song_info, tid))
        return True

    async def remove(dirid, song_info, *, tid):
        writes.append(("remove", dirid, song_info, tid))
        return False

    async def delete(dirid):
        writes.append(("delete", dirid))
        return Row(retCode=0, dirid=dirid)

    async def like(song_info):
        writes.append(("like", song_info))
        raise CredentialExpiredError("test-secret-never-echo", code=104401)

    @asynccontextmanager
    async def client_factory(*, credential, device_path):
        if credential is None:
            yield Row(search=Row(search_by_type=search))
        else:
            assert credential.musicid == 123456789
            yield Row(
                login=Row(check_expired=check_expired),
                user=Row(get_created_songlist=list_mine),
                songlist=Row(create=create, get_detail=detail, add_songs=add, del_songs=remove, delete=delete,
                             like_song=like),
            )

    app = create_server(tmp_path, client_factory=client_factory)
    async with create_connected_server_and_client_session(app._mcp_server) as session:
        tools = {tool.name: tool for tool in (await session.list_tools()).tools}
        assert tools["delete_playlist"].annotations.destructiveHint is True
        search_result = await session.call_tool("search", {"query": "一首歌"})
        assert not search_result.isError
        track = search_result.structuredContent["items"][0]["track"]
        assert track == {"song_id": 1234, "song_type": 1}

        refused = await session.call_tool("create_playlist", {"title": "测试歌单"})
        assert refused.isError
        assert "[LOGIN_REQUIRED]" in refused.content[0].text
        assert not writes

        await session.call_tool("login", {"stage": "template"})
        (tmp_path / "login.json").write_text('{"musicid":"123456789","musickey":"mock-key"}', encoding="utf-8")
        assert not (await session.call_tool("login", {"stage": "submit"})).isError

        made = await session.call_tool("create_playlist", {"title": "测试歌单"})
        playlist_id = made.structuredContent["playlist_id"]
        assert playlist_id == 87654321
        listed = await session.call_tool("list_my_playlists")
        assert listed.structuredContent["items"][0]["playlist_id"] == playlist_id

        mismatched = await session.call_tool("add_tracks", {"playlist_id": 17, "tracks": [track]})
        assert mismatched.isError
        assert writes == [("create", "测试歌单")]

        added = await session.call_tool("add_tracks", {"playlist_id": playlist_id, "tracks": [track]})
        assert not added.isError
        assert writes[-1] == ("add", 17, [(1234, 1)], playlist_id)
        readback = await session.call_tool("get_playlist", {"playlist_id": playlist_id})
        assert readback.structuredContent["tracks"][0]["track"] == track

        removed = await session.call_tool("remove_tracks", {"playlist_id": playlist_id, "tracks": [track]})
        assert removed.isError
        assert writes[-1] == ("remove", 17, [(1234, 1)], playlist_id)

        expired = await session.call_tool("set_liked", {"track": track, "liked": True})
        assert expired.isError
        assert "[LOGIN_INVALID]" in expired.content[0].text
        assert "test-secret-never-echo" not in str(expired)

        declined = await session.call_tool("delete_playlist", {"playlist_id": playlist_id, "confirm_title": "别的歌单"})
        assert declined.isError
        assert not any(action[0] == "delete" for action in writes)
        assert not (await session.call_tool("delete_playlist", {
            "playlist_id": playlist_id, "confirm_title": "测试歌单"
        })).isError
        assert writes[-1] == ("delete", 17)


@pytest.mark.anyio
async def test_search_playlist_tracks_filters_all_pages_with_stable_result_pagination(tmp_path):
    playlist_id = 87654321
    upstream_calls = []
    songs = [
        Row(id=101, type=1, mid="first", name="Hello Live", singer=[Row(name="歌手")], album=Row(name="现场")),
        Row(id=102, type=1, mid="unrelated", name="Unrelated", singer=[Row(name="另一位")], album=Row(name="录音室")),
        Row(id=103, type=1, mid="second", name="重逢", singer=[Row(name="Hello 乐队")], album=Row(name="现场")),
        Row(id=104, type=1, mid="third", name="Encore", singer=[Row(name="歌手")], album=Row(name="Hello 现场")),
    ]

    def get_detail(requested_id, **_):
        upstream_calls.append(requested_id)

        async def paginate():
            yield Row(songs=songs[:2])
            yield Row(songs=songs[2:])

        return Row(paginate=paginate)

    @asynccontextmanager
    async def client_factory(*, credential, device_path):
        assert credential is None
        yield Row(songlist=Row(get_detail=get_detail))

    app = create_server(tmp_path, client_factory=client_factory)
    async with create_connected_server_and_client_session(app._mcp_server) as session:
        first = await session.call_tool(
            "search_playlist_tracks", {"playlist_id": playlist_id, "query": "  HELLO 现场  ", "page_size": 2}
        )
        assert not first.isError, first.content
        result = first.structuredContent
        assert result["playlist_id"] == playlist_id
        assert result["match_count"] == 3
        assert result["page"] == 1 and result["next_page"] == 2
        assert [song["track"] for song in result["tracks"]] == [
            {"song_id": 101, "song_type": 1},
            {"song_id": 103, "song_type": 1},
        ]

        second = await session.call_tool(
            "search_playlist_tracks",
            {"playlist_id": playlist_id, "query": "hello 现场", "page_size": 2, "page": 2},
        )
        assert not second.isError, second.content
        assert [song["name"] for song in second.structuredContent["tracks"]] == ["Encore"]
        assert second.structuredContent["next_page"] is None

        missing = await session.call_tool("search_playlist_tracks", {"playlist_id": playlist_id, "query": "不在歌单"})
        assert not missing.isError
        assert missing.structuredContent["match_count"] == 0
        assert missing.structuredContent["tracks"] == []
        assert missing.structuredContent["next_page"] is None

        blank = await session.call_tool("search_playlist_tracks", {"playlist_id": playlist_id, "query": "  "})
        assert blank.isError
        assert "[INVALID_QUERY]" in blank.content[0].text
        assert upstream_calls == [playlist_id, playlist_id, playlist_id]


@pytest.mark.anyio
async def test_weekly_playlist_top_ranks_official_play_counts_from_all_playlist_pages(tmp_path, monkeypatch):
    playlist_id = 87654321
    fake_key = "qmk-test-only"

    def read_credential(target, kind):
        assert (target, kind) == ("qq-music-mcp-report", win32cred.CRED_TYPE_GENERIC)
        return {"CredentialBlob": fake_key.encode("utf-16-le")}

    monkeypatch.setattr(win32cred, "CredRead", read_credential)

    def weekly(request):
        assert request.method == "POST"
        assert str(request.url) == "https://a.y.qq.com/me/report"
        assert request.headers["Authorization"] == f"Bearer {fake_key}"
        assert json.loads(request.content) == {"params": {"timeKey": "w"}, "comm": {"skill_version": "0.0.3"}}
        return httpx.Response(200, json={"weekData": {"songListen": [
            {"songMid": "one", "sum": 3},
            {"songMid": "outside", "sum": 90},
            {"songMid": "two", "sum": 9},
        ]}})

    def get_detail(target, *, num):
        assert (target, num) == (playlist_id, 100)

        async def paginate():
            yield Row(songs=[Row(mid="one", name="第一首", singer=[Row(name="甲")])])
            yield Row(songs=[Row(mid="two", name="第二首", singer=[Row(name="乙"), Row(name="丙")]),
                             Row(mid="not-ranked", name="未上榜", singer=[])])

        return Row(paginate=paginate)

    @asynccontextmanager
    async def client_factory(**_):
        yield Row(songlist=Row(get_detail=get_detail))

    http_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: http_client(transport=httpx.MockTransport(weekly), **kwargs))
    app = create_server(tmp_path, client_factory=client_factory)
    async with create_connected_server_and_client_session(app._mcp_server) as session:
        response = await session.call_tool("get_playlist_weekly_top", {"playlist_id": playlist_id})
        assert not response.isError, response.content
        result = response.structuredContent
        assert result == {
            "playlist_id": playlist_id,
            "period": "current_week",
            "report_track_count": 3,
            "match_count": 2,
            "tracks": [
                {"song_mid": "two", "name": "第二首", "artists": ["乙", "丙"], "play_count": 9},
                {"song_mid": "one", "name": "第一首", "artists": ["甲"], "play_count": 3},
            ],
        }
        limited = await session.call_tool("get_playlist_weekly_top", {"playlist_id": playlist_id, "limit": 1})
        assert not limited.isError, limited.content
        assert limited.structuredContent["tracks"] == result["tracks"][:1]
        assert limited.structuredContent["match_count"] == 2


@pytest.mark.anyio
async def test_weekly_playlist_top_explains_missing_or_rejected_key_without_exposing_it(tmp_path, monkeypatch):
    fake_key = "qmk-do-not-display"

    def missing_credential(*_):
        raise pywintypes.error(ERROR_NOT_FOUND, "CredRead", "not found")

    def reject_key(request):
        return httpx.Response(401, json={"msg": fake_key})

    @asynccontextmanager
    async def unexpected_playlist_read(**_):
        pytest.fail("No playlist request should follow a report authentication error")
        yield

    monkeypatch.setattr(win32cred, "CredRead", missing_credential)
    http_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: http_client(transport=httpx.MockTransport(reject_key), **kwargs))
    app = create_server(tmp_path, client_factory=unexpected_playlist_read)
    async with create_connected_server_and_client_session(app._mcp_server) as session:
        missing = await session.call_tool("get_playlist_weekly_top", {"playlist_id": 87654321})
        assert missing.isError and "[REPORT_KEY_REQUIRED]" in missing.content[0].text

        monkeypatch.setattr(win32cred, "CredRead", lambda *_: {"CredentialBlob": fake_key.encode("utf-16-le")})
        rejected = await session.call_tool("get_playlist_weekly_top", {"playlist_id": 87654321})
        assert rejected.isError and "[REPORT_KEY_REJECTED]" in rejected.content[0].text
        assert fake_key not in str(rejected)
