# QQ 音乐 MCP

- 这是 Vibe-Sketchpad-Coding 内的独立 Python / uv 项目，入口为 `qq_music_mcp.server:main`，只提供本地 stdio。
- 凭证不经过工具参数、结果或日志。明文 `login.json` 是人工填写的临时文件，QQ 音乐验证通过后保存当前 Windows 用户的 DPAPI 密文并删除临时文件。
- 工具对外使用 `playlist_id` 和原样传递的 `track` 对象；歌单写入时由服务核对当前账号的歌单并解析 `dirid`。
- 歌单管理使用非公开接口；官方听歌报告使用 Windows 普通凭据 `qq-music-mcp-report` 保存独立 API Key，不改变浏览器登录态。更新依赖或工具行为时，先更新协议契约测试，再改实现。使用 `uv run --locked pytest -q` 验证；真实账号写入须单独获授权。

## 文件树

- `pyproject.toml` / `uv.lock`：运行入口和锁定依赖。
- `README.md`：接入、登录和工具指南。
- `qq_music_mcp/server.py`：工具注册、QQ 音乐调用和错误映射。
- `qq_music_mcp/credentials.py`：登录模板校验和 DPAPI 存储。
- `tests/test_login.py` / `tests/test_playlists.py`：MCP 协议契约测试。
