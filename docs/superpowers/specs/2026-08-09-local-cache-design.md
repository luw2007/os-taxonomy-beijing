# 本地知识浏览器：已访问页面缓存设计

## 目标

加速 `npm start` 启动的本地知识浏览器中已访问页面的再次打开、刷新和返回；首次请求成功后，浏览器优先渲染本地缓存，同时在后台取回最新只读数据。范围只限本地浏览器，不承诺离线模式、CDN 缓存或无刷新热更新。

## 非目标

- 不为 AI 请求、评分或解析结果建立缓存。
- 不改变现有用户档案和掌握记录的 `localStorage` 归属。
- 不引入构建工具、依赖、服务端数据持久化或 CDN 配置。
- 不保证已打开且不刷新的旧标签页自动升级。

## 分区与责任

| 区域 | URL 前缀/存储 | 内容 | 缓存策略 | 失效责任 |
| --- | --- | --- | --- | --- |
| 静态区 | `/static/` | HTML 壳、JavaScript 模块、CSS 和静态资源 | Service Worker Cache First | Service Worker 缓存版本变更后激活时删除旧缓存 |
| 动态只读区 | `/api/` 的允许 GET 端点 | 汇总、目录、筛选列表、主题详情、知识脉络数据等 | Service Worker stale-while-revalidate，按完整 URL 缓存 | 后台成功响应覆盖同一请求 URL 的旧条目 |
| 动态副作用区 | `POST /api/chat`、`POST /api/assessment`、`POST /api/resolve` | AI 对话、评分与解析 | 直接透传；响应 `Cache-Control: no-store` | 不缓存 |
| 浏览器状态区 | `localStorage` | 用户档案、掌握记录、协议状态 | 不经过 HTTP 或 Service Worker 缓存 | 现有清除流程 |

入口 `/` 只提供静态应用壳，并由服务映射至 `/static/index.html`；入口不得混入数据渲染。`viewer/` 文件由服务映射为 `/static/`，从 URL 层将静态资源与 API 数据隔离。根路径 `/service-worker.js` 是唯一的浏览器注册端点：它服务同一份静态 Worker 脚本并以 `Service-Worker-Allowed: /` 显式授权控制 `/api/`；它不属于应用资源区，也不承载业务数据。

## 运行时设计

1. 页面首次加载注册 `/service-worker.js`，使用 scope `/`；服务端以 `Service-Worker-Allowed: /` 允许该 Worker 同时拦截静态区与动态只读区。
2. Worker 仅拦截同源 `GET`：
   - `/static/` 使用 Cache First：命中直接返回；未命中请求网络，成功后写入静态缓存。
   - 允许的 `/api/` GET 使用 stale-while-revalidate：若有缓存立即返回，并在后台请求网络；网络响应成功后覆盖对应完整 URL 缓存。首次访问没有缓存时等待网络响应。
   - 其他请求全部 `fetch(request)`，不读取或写入 Cache Storage。
3. Worker 使用显式缓存版本常量。例如 `bst-static-v1`、`bst-data-v1`；应用壳、路由或 API 语义改变时递增版本。激活阶段删除旧版本命名空间的缓存。
4. 服务端为可缓存的只读 GET 保留适当 HTTP 头；`/api/path-data` 继续支持 gzip 与 `Vary: Accept-Encoding`。Service Worker 不自行压缩或解压响应。
5. 副作用 API 的所有成功与失败响应都显式为 `no-store`，防止浏览器或中间缓存保留敏感输入和生成结果。

## 服务端边界

`scripts/serve.mjs` 负责：

- 把 `viewer/` 静态文件发布为 `/static/...`，并让 `/` 返回应用入口。
- 为静态文件、可缓存只读 GET 与副作用 API 设置各自的响应缓存头。
- 保持 API 的现有 JSON 契约、gzip 行为和 `POST` 处理语义。

Service Worker 负责客户端的已访问资源缓存，不承担数据计算、权限、用户状态或 API 版本兼容。

## 风险与约束

- 最新数据不是阻塞条件：某次已访问页可能短暂显示旧内容；后台更新成功后供下一次同 URL 访问使用。
- 静态资源 URL 未包含内容 hash，因此缓存版本常量是唯一的应用壳失效开关；任何影响静态壳兼容性的变更必须递增版本。
- 不将 `Cache-Control: immutable` 用于未版本化的 URL，避免服务重启后永久使用旧资源。
- 网络失败时，已缓存 GET 仍可返回；未缓存 GET 按现有失败路径处理，不伪造响应。

## 验证

自动化：

1. 为静态路径映射、静态/只读/副作用响应头增加 Node 测试。
2. 为 Service Worker 路由规则增加可独立测试的纯函数或等价契约测试：静态 Cache First、只读 GET stale-while-revalidate、POST 透传。
3. 保留并运行现有测试套件。

手工浏览器验收：

1. 首次打开 `/`，确认应用壳、列表和详情页正常加载。
2. 访问一个带查询参数的列表页和一个主题详情页后刷新；DevTools Network 确认页面先由缓存满足，同时出现后台 GET 更新。
3. 修改本地数据并重启服务，再次访问已缓存页面；确认下一次访问反映后台获取的新数据。
4. 执行 AI 解析、对话和评分；确认这些 POST 未进入 Cache Storage，响应为 `no-store`。
5. 递增 Worker 缓存版本后重新加载；确认旧静态与数据缓存被清理，应用重新取得新壳。

## 回滚

移除 Service Worker 注册与 `/static/` 映射，恢复直接静态服务即可；本地 Cache Storage 可由浏览器清除，且不包含用户档案或服务端状态。