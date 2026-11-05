# 更新日志

## Unreleased

- 升级资源契约 2 和 Host 契约 1.1.0，包版本升至 1.0.0。

- 移除 manifest 网络宿主声明与域名白名单；任意 HTTP(S) 主机、IP、端口、URL 凭证和 fragment 均可访问。

- 网络请求默认不设期限、响应体不设适配器上限；重定向改由 Host 自动跟随，并以最终 URL 继续和返回。

- 音频探测不再按资源总大小、请求次数或累计网络字节失败；运行时只缓存一个最近响应，seek 超出缓存时重取，初始响应可大于请求长度并按实际 Content-Range 校验。Range 请求仍按 64 KiB 分块，签名输入也不再受 16 KiB 限制。

- 项目代码使用 MIT 许可证，顶层许可证文件统一命名为 License，保留三方许可原文。

- Release ZIP 根目录提供适配器 manifest 和 Component；依赖许可文件统一命名为 License。
