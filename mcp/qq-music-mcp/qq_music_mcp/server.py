"""QQ 音乐 MCP 的 stdio 入口。"""

import asyncio
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
import pywintypes
import win32cred
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from qqmusic_api import (
    ApiException,
    BaseApiException,
    Client,
    Credential,
    CredentialExpiredError,
    CredentialInvalidError,
    HTTPError,
    NetworkError,
)
from qqmusic_api.models.base import Song, SongList
from winerror import ERROR_NOT_FOUND

from .credentials import CredentialStore


PlaylistId = Annotated[int, Field(gt=0, description="歌单 ID（playlist_id），不是账号目录 ID（dirid）")]
Page = Annotated[int, Field(ge=1)]
PageSize = Annotated[int, Field(ge=1, le=30)]
Title = Annotated[str, Field(min_length=1, max_length=100)]


REPORT_CREDENTIAL = "qq-music-mcp-report"
REPORT_URL = "https://a.y.qq.com/me/report"


class WeeklySong(BaseModel):
    songMid: str
    sum: int = Field(ge=0, strict=True)


WEEKLY_SONGS = TypeAdapter(list[WeeklySong])


class TrackRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    song_id: int = Field(gt=0, strict=True, description="搜索或歌单结果的 track.song_id，不是 song_mid")
    song_type: int = Field(ge=0, strict=True, description="原样使用搜索或歌单结果的 track.song_type")


TrackBatch = Annotated[list[TrackRef], Field(min_length=1, max_length=20)]


def track_row(song: Song) -> dict[str, Any]:
    return {
        "track": {"song_id": song.id, "song_type": song.type},
        "song_mid": song.mid,
        "name": song.name,
        "artists": [artist.name for artist in song.singer],
        "album": song.album.name,
    }


def playlist_row(playlist: SongList) -> dict[str, Any]:
    return {"playlist_id": playlist.id, "title": playlist.title, "track_count": playlist.songnum}


def create_server(state_dir: Path, *, client_factory=Client) -> FastMCP:
    store = CredentialStore(state_dir)
    app = FastMCP("qq-music-mcp")
    read_only = ToolAnnotations(readOnlyHint=True, openWorldHint=True)

    @asynccontextmanager
    async def qq(credential: Credential | None = None):
        state_dir.mkdir(parents=True, exist_ok=True)
        try:
            async with asyncio.timeout(25), client_factory(
                credential=credential, device_path=str(state_dir / "device.json")
            ) as client:
                yield client
        except (CredentialExpiredError, CredentialInvalidError):
            raise ToolError("[LOGIN_INVALID] 登录态失效，请用 login 重新导入。") from None
        except (NetworkError, TimeoutError):
            raise ToolError("[QQ_NETWORK_ERROR] QQ 音乐访问失败或超时。若刚发起写操作，请先读回确认结果。") from None
        except HTTPError as exc:
            raise ToolError(f"[QQ_HTTP_ERROR] QQ 音乐返回 HTTP {exc.status_code}。") from None
        except ApiException as exc:
            raise ToolError(f"[QQ_API_ERROR] QQ 音乐拒绝请求（code={exc.code}）。") from None
        except BaseApiException:
            raise ToolError("[QQ_API_ERROR] QQ 音乐响应异常，请检查上游接口。") from None

    async def valid(credential: Credential) -> bool:
        async with qq(credential) as client:
            return not await client.login.check_expired(credential)

    @app.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def help() -> str:
        """说明如何配置本地 MCP、导入 QQ 音乐登录态、配置听歌周报和使用歌单工具。"""
        return f"""QQ 音乐 MCP（Windows，stdio）
配置 stdio：command 填 uv，args 填 ["--directory", "<项目绝对路径>", "run", "--locked", "qq-music-mcp"]。
Codex 可用：codex mcp add qq-music -- uv --directory "<项目绝对路径>" run --locked qq-music-mcp

1. 调用 login(stage="template")，在本机编辑 {store.template}。
2. 先在浏览器登录 https://y.qq.com/。F12 → 应用程序 (Application) → Cookie。
   QQ 登录取 uin，微信登录取 wxuin，去掉数字前可能存在的小写 o，填入 musicid。
   将 QQ 音乐的 qm_keyst（也可能显示为 qqmusic_key）填入 musickey。
   只在本机文件填写，不要把 Cookie 或文件内容发到对话。
3. 调用 login(stage="submit")。QQ 音乐确认登录态有效后，使用 Windows DPAPI
   加密保存到 {store.saved} 并删除临时 login.json。
4. 用 login(stage="status") 联网检查已保存的登录态；失效时重新导入。
歌单流程：search → create_playlist → add_tracks → get_playlist。
已建歌单用 list_my_playlists 定位；指定歌单内搜歌用 search_playlist_tracks。
周报：用歌单所属账号打开 https://y.qq.com/n/ryqq_v2/qqmusic_skills 生成 API Key。
在 Windows 凭据管理器 → Windows 凭据 → 添加普通凭据，地址填 {REPORT_CREDENTIAL}，
用户名填 QQMusic，密码填 API Key。不要把 Key 发到对话，也不必重新导入歌单登录态。
调用 get_playlist_weekly_top(playlist_id=...)，看歌单里哪些歌进入了个人周报榜单及播放次数。
track 对象要原样传给写入工具。
退出本工具的登录：停止服务后删除 credential.dpapi；如有未提交的 login.json，也请删除。"""

    @app.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True))
    async def login(stage: Literal["template", "submit", "status"]) -> dict[str, Any]:
        """template 生成本地 JSON；submit 校验并保存；status 联网检查。不要把密钥作为参数传入。"""
        if stage == "template":
            created = store.generate_template()
            return {"path": str(store.template), "created": created, "next": "在本机填好后调用 submit。"}
        if stage == "submit":
            credential = store.read_template()
            if not await valid(credential):
                raise ToolError("[LOGIN_REJECTED] QQ 音乐未接受这份登录态；请重新获取后填写 login.json。")
            store.save(credential)
            return {"logged_in": True, "credential_path": str(store.saved)}
        credential = store.load()
        if credential is None:
            return {"logged_in": False, "state": "not_configured"}
        logged_in = await valid(credential)
        return {"logged_in": logged_in, "state": "valid" if logged_in else "expired"}

    def required_credential() -> Credential:
        credential = store.load()
        if credential is None:
            raise ToolError("[LOGIN_REQUIRED] 先用 login 导入 QQ 音乐登录态。")
        return credential

    async def own_playlist(client: Client, credential: Credential, playlist_id: int) -> SongList:
        response = await client.user.get_created_songlist(credential.musicid)
        for playlist in response.playlists:
            if playlist.id == playlist_id and playlist.dirid > 0:
                return playlist
        raise ToolError("[PLAYLIST_NOT_OWNED] 当前账号创建列表中没有此歌单；请从 list_my_playlists 获取 ID。")

    @app.tool(annotations=read_only)
    async def search(
        query: Title, kind: Literal["song", "playlist"] = "song", page: Page = 1, page_size: PageSize = 10
    ) -> dict[str, Any]:
        """搜索单曲或公开歌单，无需登录。歌曲结果的 track 对象可直接用于歌单写入。"""
        if not (keyword := query.strip()):
            raise ToolError("[INVALID_QUERY] 搜索词不能为空。")
        async with qq() as client:
            result = await client.search.search_by_type(
                keyword, 0 if kind == "song" else 3, num=page_size, page=page, highlight=False
            )
        items = (
            [track_row(song) for song in result.song]
            if kind == "song"
            else [playlist_row(playlist) for playlist in result.songlist]
        )
        return {"items": items, "page": page, "next_page": result.nextpage if result.nextpage > page else None}

    @app.tool(annotations=read_only)
    async def list_my_playlists() -> dict[str, Any]:
        """列出当前账号创建的歌单。修改歌单请使用这里的 playlist_id。"""
        credential = required_credential()
        async with qq(credential) as client:
            result = await client.user.get_created_songlist(credential.musicid)
        return {
            "items": [playlist_row(row) for row in result.playlists],
            "total": result.total,
            "complete": result.finished,
        }

    @app.tool(annotations=read_only)
    async def get_playlist(playlist_id: PlaylistId, page: Page = 1, page_size: PageSize = 20) -> dict[str, Any]:
        """按 playlist_id 分页读取歌单及曲目；私密歌单需要拥有者登录态。"""
        async with qq(store.load()) as client:
            result = await client.songlist.get_detail(playlist_id, page=page, num=page_size)
        return {
            "playlist": playlist_row(result.info),
            "tracks": [track_row(song) for song in result.songs],
            "total": result.total,
            "page": page,
            "next_page": page + 1 if result.hasmore else None,
        }

    @app.tool(annotations=read_only)
    async def search_playlist_tracks(
        playlist_id: PlaylistId, query: Title, page: Page = 1, page_size: PageSize = 20
    ) -> dict[str, Any]:
        """在指定歌单内按歌名、歌手或专辑搜索；多个关键词须全部命中，结果按歌单顺序分页。"""
        terms = query.casefold().split()
        if not terms:
            raise ToolError("[INVALID_QUERY] 搜索词不能为空。")

        start = (page - 1) * page_size
        stop = start + page_size
        tracks = []
        match_count = 0
        async with qq(store.load()) as client:
            async for batch in client.songlist.get_detail(playlist_id, num=100).paginate():
                for song in batch.songs:
                    text = " ".join([song.name, *(artist.name for artist in song.singer), song.album.name]).casefold()
                    if all(term in text for term in terms):
                        if start <= match_count < stop:
                            tracks.append(track_row(song))
                        match_count += 1

        return {
            "playlist_id": playlist_id,
            "tracks": tracks,
            "match_count": match_count,
            "page": page,
            "next_page": page + 1 if match_count > stop else None,
        }

    @app.tool(annotations=read_only)
    async def get_playlist_weekly_top(playlist_id: PlaylistId, limit: PageSize = 10) -> dict[str, Any]:
        """按个人本周听歌报告的播放次数降序列出指定歌单中上榜的歌曲。未上榜不代表零次；次数不限于从此歌单发起的播放。"""
        try:
            entry = win32cred.CredRead(REPORT_CREDENTIAL, win32cred.CRED_TYPE_GENERIC)
        except pywintypes.error as exc:
            if exc.winerror == ERROR_NOT_FOUND:
                raise ToolError("[REPORT_KEY_REQUIRED] 请按 help 将官方 API Key 存入 Windows 凭据管理器。") from None
            raise ToolError(f"[REPORT_KEY_UNREADABLE] 读取 Windows 凭据失败（code={exc.winerror}）。") from None
        try:
            key = entry["CredentialBlob"].decode("utf-16-le").strip()
        except UnicodeError:
            raise ToolError("[REPORT_KEY_INVALID] 请在 Windows 凭据管理器重新填写官方 API Key。") from None
        if not re.fullmatch(r"qmk-[\x21-\x7e]+", key):
            raise ToolError("[REPORT_KEY_INVALID] 请在 Windows 凭据管理器填写以 qmk- 开头的官方 API Key。")

        try:
            async with asyncio.timeout(15), httpx.AsyncClient() as http:
                response = await http.post(
                    REPORT_URL,
                    headers={"Authorization": f"Bearer {key}"},
                    json={"params": {"timeKey": "w"}, "comm": {"skill_version": "0.0.3"}},
                )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (401, 403):
                raise ToolError(f"[REPORT_KEY_REJECTED] 官方听歌报告拒绝此 Key（HTTP {status}），请核对或更新凭据。") from None
            raise ToolError(f"[REPORT_HTTP_ERROR] 官方听歌报告返回 HTTP {status}。") from None
        except (httpx.RequestError, TimeoutError):
            raise ToolError("[REPORT_NETWORK_ERROR] 无法连接官方听歌报告或请求超时。") from None

        try:
            report = response.json()
            if not isinstance(report, dict):
                raise ValueError
            if any(report.get(field) not in (None, 0) for field in ("ret", "sub_ret")):
                raise ToolError("[REPORT_API_ERROR] 官方听歌报告拒绝请求，请检查 API Key 或稍后重试。")
            week = report["weekData"]
            if week is None:
                raise ToolError("[REPORT_WEEK_UNAVAILABLE] QQ 音乐没有返回本周报告。")
            items = week["songListen"]
            ranked = WEEKLY_SONGS.validate_python(items) if items is not None else []
        except (ValueError, KeyError, TypeError):
            raise ToolError("[REPORT_RESPONSE_INVALID] 官方听歌周报的响应格式异常。") from None

        counts = {song.songMid: song.sum for song in ranked if song.songMid}
        matches = {}
        async with qq(store.load()) as client:
            async for batch in client.songlist.get_detail(playlist_id, num=100).paginate():
                for song in batch.songs:
                    if song.mid in counts:
                        matches[song.mid] = {
                            "song_mid": song.mid,
                            "name": song.name,
                            "artists": [artist.name for artist in song.singer],
                            "play_count": counts[song.mid],
                        }
        tracks = sorted(matches.values(), key=lambda row: -row["play_count"])
        return {
            "playlist_id": playlist_id,
            "period": "current_week",
            "report_track_count": len(counts),
            "match_count": len(tracks),
            "tracks": tracks[:limit],
        }

    @app.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True))
    async def create_playlist(title: Title) -> dict[str, Any]:
        """在当前账号新建歌单，返回可直接用于加歌的 playlist_id。重复调用可能重复建单。"""
        if not (title := title.strip()):
            raise ToolError("[INVALID_TITLE] 歌单名不能为空。")
        async with qq(required_credential()) as client:
            result = await client.songlist.create(title)
        if result.retCode != 0 or result.id <= 0 or result.dirid <= 0:
            raise ToolError(f"[PLAYLIST_CREATE_FAILED] QQ 音乐未确认创建歌单（code={result.retCode}）。")
        return {"playlist_id": result.id, "title": result.name}

    async def change_tracks(playlist_id: int, tracks: list[TrackRef], *, add: bool) -> dict[str, Any]:
        credential = required_credential()
        async with qq(credential) as client:
            target = await own_playlist(client, credential, playlist_id)
            if target.dirid == 201:
                raise ToolError("[USE_SET_LIKED] 请用 set_liked 修改「我喜欢」。")
            action = client.songlist.add_songs if add else client.songlist.del_songs
            accepted = await action(target.dirid, [(track.song_id, track.song_type) for track in tracks], tid=target.id)
        if not accepted:
            raise ToolError("[PLAYLIST_WRITE_FAILED] QQ 音乐未确认修改；请先读回歌单再决定是否重试。")
        return {"playlist_id": playlist_id, "requested_tracks": len(tracks), "accepted": True}

    @app.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True)
    )
    async def add_tracks(playlist_id: PlaylistId, tracks: TrackBatch) -> dict[str, Any]:
        """批量加歌到自己创建的歌单；tracks 使用搜索或读歌单时返回的 track 对象，每批最多 20 首。"""
        return await change_tracks(playlist_id, tracks, add=True)

    @app.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=True)
    )
    async def remove_tracks(playlist_id: PlaylistId, tracks: TrackBatch) -> dict[str, Any]:
        """从自己创建的歌单移除指定曲目，每批最多 20 首。"""
        return await change_tracks(playlist_id, tracks, add=False)

    @app.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=True))
    async def delete_playlist(playlist_id: PlaylistId, confirm_title: Title) -> dict[str, Any]:
        """删除当前账号创建的普通歌单。confirm_title 必须与当前歌单名称完全相同。"""
        credential = required_credential()
        async with qq(credential) as client:
            target = await own_playlist(client, credential, playlist_id)
            if target.dirid == 201:
                raise ToolError("[PLAYLIST_PROTECTED] 不能删除「我喜欢」。")
            if target.title != confirm_title:
                raise ToolError("[TITLE_MISMATCH] 确认名称与当前歌单名称不一致，未删除。")
            result = await client.songlist.delete(target.dirid)
        if result.retCode != 0 or result.dirid != target.dirid:
            raise ToolError(f"[PLAYLIST_DELETE_FAILED] QQ 音乐未确认删除歌单（code={result.retCode}）。")
        return {"playlist_id": playlist_id, "deleted": True}

    @app.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=True)
    )
    async def set_liked(track: TrackRef, liked: bool) -> dict[str, Any]:
        """把一首歌加入或移出「我喜欢」。"""
        async with qq(required_credential()) as client:
            action = client.songlist.like_song if liked else client.songlist.unlike_song
            accepted = await action([(track.song_id, track.song_type)])
        if not accepted:
            raise ToolError("[LIKED_WRITE_FAILED] QQ 音乐未确认更新「我喜欢」。")
        return {"track": track.model_dump(), "liked": liked}

    return app


def main() -> None:
    create_server(Path.home() / ".qq-music-mcp").run(transport="stdio")
