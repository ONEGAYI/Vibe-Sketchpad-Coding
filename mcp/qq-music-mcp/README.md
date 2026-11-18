# QQ 音乐 MCP

在 Windows 上从 MCP 客户端搜索 QQ 音乐、读取歌单，并用自己的账号建单、增删曲目或管理「我喜欢」。这是本地 stdio 服务。歌单管理使用 [QQMusicApi](https://l-1124.github.io/QQMusicApi/) 封装的非公开接口，平台改版或账号风控可能影响可用性；听歌周报使用 QQ 音乐官方接口。

## 接入

需要 Windows、Python 3.11–3.14 和 `uv`。在本项目目录执行以下 PowerShell 命令，把服务添加到 Codex：

```powershell
codex mcp add qq-music -- uv --directory "$((Get-Location).Path)" run --locked qq-music-mcp
```

其他 stdio 客户端设置 `command` 为 `uv`，`args` 为 `["--directory", "<本项目绝对路径>", "run", "--locked", "qq-music-mcp"]`。重新开启会话后调用 `help`，可查看本机登录文件路径。

## 导入登录态

1. 调用 `login({"stage":"template"})`，生成 `%USERPROFILE%\.qq-music-mcp\login.json`。文件已存在时不会覆盖。
2. 在浏览器登录 [QQ 音乐网页版](https://y.qq.com/)，打开 F12 → **应用程序（Application）** → **Cookie**，选择 QQ 音乐站点。在本机编辑 `login.json`：
   - `musicid`：QQ 登录取 `uin`，微信登录取 `wxuin`。去掉可能存在的前导小写 `o`，保留数字，建议填为字符串。
   - `musickey`：填 `qm_keyst` 的值；浏览器也可能以 `qqmusic_key` 显示。只填这一项的值，不粘贴整串 Cookie。
3. 保存文件后调用 `login({"stage":"submit"})`。服务先联网验证。成功后使用 Windows DPAPI 加密到同目录下的 `credential.dpapi`，并删除临时明文 `login.json`。验证失败会保留待修正的模板，也不会覆盖原凭证。

不要把登录文件、Cookie 或票据发给助手。用 `login({"stage":"status"})` 联网检查登录态；失效后重新导入。结束本工具的本地登录时，关闭服务并删除 `credential.dpapi`；有未提交的 `login.json` 时也请删除。库使用的匿名设备缓存为同目录下的 `device.json`。

## 查歌单里的本周常听歌曲

1. 用听歌和管理歌单的同一个 QQ 音乐账号，打开 [QQ 音乐官方 Key 页面](https://y.qq.com/n/ryqq_v2/qqmusic_skills)，生成 `qmk-` 开头的 API Key。
2. 在 Windows「凭据管理器 → Windows 凭据 → 添加普通凭据」中，地址填 `qq-music-mcp-report`，用户名填 `QQMusic`，密码填 API Key。不要把 Key 发到对话或写入 `login.json`。更新 Key 时编辑此凭据，停用时删除此凭据。
3. 先用 `list_my_playlists` 获取目标歌单的 ID，再调用 `get_playlist_weekly_top({"playlist_id":87654321,"limit":10})`，并把示例 ID 替换为目标歌单的 ID。工具在查询时读取 Key，更新 Key 不需要重启服务或重新导入歌单登录态。

结果按播放次数 `play_count` 从高到低排列。工具只显示同时出现在歌单和[官方个人周报](https://github.com/tencentmusic/qqmusic-skills/blob/main/qqmusic/me.md#听歌报告)里的歌曲。周报统计账号的播放次数，不区分从哪里播放；没上榜不代表没听过。`match_count` 是筛出的歌曲总数，`limit` 只限制返回几首。

## 常用操作

| 工具 | 用途 |
|---|---|
| `search` | 搜单曲或公开歌单：`kind` 为 `song`（默认）或 `playlist`。不用登录。 |
| `list_my_playlists` | 列出当前账号创建的歌单和 `playlist_id`。 |
| `get_playlist` | 按 `playlist_id` 读取歌单和曲目；用 `next_page` 翻页。 |
| `search_playlist_tracks` | 在一张歌单内按歌名、歌手或专辑搜索。私密歌单需要拥有者登录态。 |
| `get_playlist_weekly_top` | 给指定歌单里进入个人周报榜单的歌曲按播放次数排序。需要官方 API Key。 |
| `create_playlist` | 用 `title` 建单，返回新歌单的 `playlist_id`。 |
| `add_tracks` / `remove_tracks` | 向自己创建的歌单加歌或移歌。每批最多 20 首。 |
| `set_liked` | 设定一首歌是否加入「我喜欢」。 |
| `delete_playlist` | 删除自己创建的普通歌单，须提供 `playlist_id` 和当前歌单名 `confirm_title`。 |

例如，搜索「周杰伦 稻香」，挑中正确版本后，将结果的 `items[n].track` 原样放进 `add_tracks.tracks`。目标用建单结果或本人歌单列表里的 `playlist_id`，不是 `dirid`。写完用 `get_playlist` 读回确认。写操作超时也应先读回，避免重复创建歌单。

只想在某张歌单里找「周杰伦 稻香」时，先拿到该歌单的 `playlist_id`，再传给 `search_playlist_tracks`，把 `query` 设为 `周杰伦 稻香`。空格分隔的关键词都须命中，英文不区分大小写。工具扫描整张歌单，按歌单顺序返回匹配结果；`match_count` 是匹配总数，`next_page` 用来翻匹配结果。

没有真实账号前可以先试搜索和公开歌单。登录后建议在一张临时歌单走一次「建单 → 加歌 → 读回」，再整理正式歌单。

## 验证

```powershell
uv run --locked pytest -q
```

测试通过 MCP 协议调用工具，使用临时目录、真实 Windows DPAPI 和模拟 QQ 音乐响应（包括官方周报），不登录真实账号或修改歌单。
