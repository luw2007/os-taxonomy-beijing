# 本地访问缓存实现记录

- 静态资源迁移到 `/static/`；`/` 仍返回同一应用壳。
- Service Worker 注册端点必须位于 `/service-worker.js` 并声明 `Service-Worker-Allowed: /`，否则 `/static/service-worker.js` 的默认 scope 无法控制 `/api/`。
- 静态区采用 Cache First；只读 API 按完整请求 URL stale-while-revalidate；AI POST 和 localStorage 不进 Cache Storage。
- 静态 URL 未做构建 hash，故以 `viewer/service-worker.js` 的 `VERSION` 作为应用壳缓存失效开关。