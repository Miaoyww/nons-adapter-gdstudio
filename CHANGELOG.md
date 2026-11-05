# 更新日志

## Unreleased

- 升级资源契约 2 和 Host 契约 1.1.0，包版本升至 1.0.0。

- 移除 manifest 网络宿主声明与域名白名单；任意 HTTP(S) 主机、IP、端口、URL 凭证和 fragment 均可访问。

- 网络请求默认不设期限、响应体不设适配器上限；重定向改由 Host 自动跟随，并以最终 URL 继续和返回。

- 项目代码使用 MIT 许可证，顶层许可证文件统一命名为 License，保留三方许可原文。

- Release ZIP 根目录提供适配器 manifest 和 Component；依赖许可文件统一命名为 License。
