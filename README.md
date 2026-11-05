# GD音乐台独立音源适配器

GD音乐台只用于按已有平台歌曲 ID 获取替换音源，接入自动备用取址和“歌曲来源”的同平台音源选择。由于聚合搜索会快速消耗上游请求额度，已移除搜索能力：不进入聚合搜索或“歌曲来源”的搜索渠道，不提供关键词查询，不注册完整平台业务或专用账号存储。

## 协议与平台身份

适配器使用网站接口 `https://music.gdstudio.org/api.php?types=url`。取址前读取 `/time`，使用十秒时间桶、当前主机、网站版本 `2026.09.25` 和 URI 编码的歌曲 ID 计算签名。协议摘要有一个不同于标准 MD5 的轮常数，不能直接换成普通 MD5。签名在适配器内实现，未引入 musicdl 运行时；宿主继续提供通用 HTTP、时间和随机数能力。适配器使用 Host 契约 1.1.0 和资源契约 2。网站升级可能使签名失效。

| 产品平台标识 | GD source | 平台          |
| ------------ | --------- | ------------- |
| netease      | netease   | 网易云音乐    |
| joox         | joox      | JOOX          |
| kuwo         | kuwo      | 酷我音乐      |
| tidal        | tidal     | TIDAL         |
| qobuz        | qobuz     | Qobuz         |
| applemusic   | apple     | Apple Music   |
| bilibili     | bilibili  | 哔哩哔哩      |
| ytmusic      | ytmusic   | YouTube Music |
| embeat       | embeat    | Embeat        |
| qqmusic      | tencent   | QQ音乐        |

保留十个平台的取址映射，实际可用性由上游和歌曲决定，不保证所有声明平台都能取得可播放资源。`searchPlatforms` 为空，调用 `music.search-resources` 直接返回 `unsupported`，不发起 HTTP 请求。账号、收藏、歌词、下载及所有分类搜索均未声明。

## 资源和执行预算

- 标准／高音质请求 128／320，无损／高解析度请求 999；依据实际格式与码率报告结果，并执行是否允许降级的设置。
- 复用 music-metadata 与 strtok3 解析 MP3、FLAC、AAC／ALAC MP4。每次 HTTP Range 最多 64KiB，最多 8 次、合计 256KiB，单次解析器分配最多 64KiB，总文件最大 512MiB，不下载整首歌曲。
- 时长与可信曲目时长差异不得超过 2 秒或 1%，取较大值。未知时长、过大标签／索引、损坏数据、已知试听、空地址及不支持 Range 的服务明确失败；不验证音频指纹或录音版本。
- 缺失时长时复用宿主既有曲库补齐。哔哩哔哩仅为当前选择的单个 BVID 读取公开详情校验时长，多分 P 不按总时长冒充当前音轨。
- 网络目标不限主机，接受任意 HTTP(S)、IP、端口、URL 凭证和 fragment。重定向由 Host 自动跟随；每个逻辑请求只调用一次 Host，并使用响应中的最终 URL 继续读取或返回。网站头不传到音频 CDN，不携带平台凭据；返回 URI-only 播放资源。
- 单次 Host HTTP 均使用 `timeoutMs=0`，不设期限；响应体不设适配器上限，显式正超时值可由请求辅助函数原样传给 Host。解析继续受宿主整体期限、并发和内存约束，适配器本身不拒绝并发调用。429 返回限流错误，不自动重试。临时地址不写普通缓存、队列或诊断报告。
- `/time` 是签署取址请求前必须读取的时钟端点，同样使用 Host 的无期限默认值。

## 构建与验证

```powershell
npm ci --prefix .
$env:NONS_ROOT = '<Nons 主仓路径>'
npm ci --prefix "$env:NONS_ROOT\packages\wasm-crypto" --include=dev
node scripts/build.mjs
node --test tests/*.test.mjs
# 受控 Host 验收，不访问网络；先把构建产物放到验收测试读取的位置
$package = "$env:NONS_ROOT\.local\adapters\gdstudio"
New-Item -ItemType Directory -Force "$package\dist"
Copy-Item manifest.json "$package"
Copy-Item dist\adapter.component.wasm "$package\dist"
& "$env:NONS_ROOT\scripts\native.ps1" -Task test -ExtraArgs @('--lib','--locked','gdstudio_component_resolves_under_native_host','--','--ignored','--nocapture')
# 可选实网取址：已知网易云 ID 347230，先读平台元数据，不搜索 GD
& "$env:NONS_ROOT\scripts\native.ps1" -Task test -ExtraArgs @('--lib','--locked','gdstudio_component_live_resource','--','--ignored','--nocapture')
```

构建从 `NONS_ROOT` 读取 Host WIT；若主仓 WIT 尚未携带 1.1 字段，脚本会幂等补齐 `follow-redirects` 和响应 `url`。

推送到 `main` 或提交 Pull Request 会运行 GitHub Actions；推送 `v*` 标签会在测试通过后发布可直接安装的 ZIP（包含 `adapter.component.wasm`、描述符和许可文件）及 SHA-256 校验文件。

构建更新随包 Component、manifest 和依赖许可；安装后无需 Node、Python 或独立服务进程。在设置 → 音乐适配器独立启停。

回归覆盖搜索能力为空、十个平台搜索调用零 HTTP、平台 ID 取址映射、签名、MP3／FLAC 校验、音质降级、网站头隔离、自动重定向、最终 URL、私网／IP／端口／凭证地址及非法协议。删除了原有批量搜索探测脚本。2026-10-16 移除搜索之前的实网样本中，网易云、JOOX、酷我、TIDAL、Embeat、QQ音乐曾取得通过校验的资源；其余平台仍有空资源、网络或格式／时长校验失败。该历史样本不保证后续可用性。本次验收使用受控测试，避免继续消耗上游额度；没有执行扬声器播放和跨平台原生构建。

服务署名：GD音乐台（music.gdstudio.xyz／music.gdstudio.org）。服务政策和依赖许可包含在构建产物中，不分发 GD 服务端代码。独立契约和生命周期见[资源适配器说明](../../docs/resource-providers.md)。

## 项目许可证

本项目代码采用 [MIT](License)。GD 服务政策和构建依赖的原始条款保存在产物的 `licenses/dependencies/License` 中。
