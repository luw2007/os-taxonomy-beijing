# 单路由 Material 3 学习工作台设计

## 决策

删除知识图谱 iframe。`viewer/index.html` 成为唯一应用文档，地址栏 hash 是唯一 UI 状态源；知识脉络与知识图谱为同一文档内的两个视图。采用 Material Design 3 的 surface-container、状态层、Navigation Rail 与 Bottom Navigation，但保留教育产品的暖灰背景、靛青主操作色、绿色掌握状态和珊瑚错误状态。

## 路由契约

```text
#/?tab=path&dim=bj-primary&subject=Mathematics&domain=Geometry&ageRange=8-8&q=分数
#/?tab=graph&dim=us&subject=Mathematics&domain=Data%20%26%20Statistics
#/mt_xxx?tab=graph&dim=us&subject=Mathematics&domain=Data%20%26%20Statistics
```

- 路径 `/` 为概览或列表，`/mt_*` 与 `/mtc_*` 为详情。
- `tab` 仅为 `path` 或 `graph`，缺省 `path`。
- `dim` 缺省为服务端默认维度。
- `subject` 可单独存在；`domain` 没有 `subject` 时必须丢弃。
- `ageRange` 与 `q` 是可选筛选。
- 主题 ID 只能在路径中出现，不得生成重复的 `?id=`。
- 路由不得承载用户档案、掌握状态、学生作答、聊天或 AI 评分。

唯一 router 公开 `parseRoute(hash)`、`buildRoute(parts, current)` 与 `navigate(parts)`。所有视图通过注入的 `navigate` 改 URL，禁止自行拼接 hash 或监听第二个 hashchange。

## 文档与模块边界

```text
index.html
├── top app bar / desktop navigation rail / mobile bottom navigation
├── path pane
└── graph pane
    ├── graph overview
    ├── graph list
    └── graph detail
```

- 主壳只初始化一次：路由、本地用户状态、Service Worker 与共享维度配置。
- path view 保留本地档案、掌握与脉络关系展示；它从统一 route 读取主题、维度与筛选上下文。
- graph view 负责概览、学科/领域/主题列表和图谱详情；它接收 route、API 读取函数和 navigate，不访问独立 location.hash。
- 图谱详情与脉络详情复用同一评估作答 UI；评分仍通过既有 `POST /api/assessment`，不自动变更掌握状态。
- 删除 iframe、`graphLoaded`、`pendingGraphTopicId`、`contentWindow`、`contentDocument`、iframe hash 监听与动态注入样式。
- 不保留 iframe 或独立 `graph.html` 兼容入口，防止第二路由器重新出现。

## 导航规则

- 脉络与图谱切换仅更新 `tab`，保留 `id/dim/subject/domain/ageRange/q`。
- 图谱学科选择设置 `subject` 并清除 `domain`；领域选择设置二者。
- 图谱主题列表到详情、详情返回必须完整保留当前筛选上下文。
- 维度切换清除不可靠的 `subject/domain/q`，保留 `tab`、年龄筛选和主题 ID；详情若在新维度不可见须明确显示，不能静默换主题。
- 浏览器前进、后退只触发主文档一次路由渲染。

## M3 视觉系统

- `surface`：暖灰主背景；`surface-container`：导航和普通分组；`surface-container-high`：当前学习/详情关键区。
- 靛青为 primary，用于主操作、焦点、选中 indicator；绿色仅表示已掌握；珊瑚只表示错误或需注意状态。
- 不以大阴影表示层级；以 surface 色阶、边界和少量 1dp 阴影表达深度。
- 容器圆角 16px，输入与按钮 12px，Filter Chip 8px。hover、pressed、focus 使用半透明状态层；焦点始终可见。
- 系统中文字体栈使用 M3 headline/title/body/label 层级，不新增字体依赖。
- 桌面为 Navigation Rail + Top App Bar；移动为 Bottom Navigation（脉络、图谱、目录、我的）。
- 评分、筛选与错误变化保留 aria-live；小字号满足 4.5:1 对比度。

## 动静区隔离

| 区域 | 内容 | 策略 |
| --- | --- | --- |
| `/static/` | 统一壳、路由、path/graph 视图、CSS、纯模块 | Service Worker Cache First |
| 允许 GET `/api/*` | 图谱/脉络/目录/详情数据 | stale-while-revalidate，完整 Request URL 为 key |
| `POST /api/chat`、`/api/assessment`、`/api/resolve` | AI 副作用 | 透传，`no-store`，不读写 Cache Storage |
| `localStorage` | 协议、档案、掌握、暂未掌握 | 与 HTTP/Worker 完全隔离 |

`/service-worker.js` 保持唯一根注册入口并返回 `Service-Worker-Allowed: /`；实际 Worker 脚本继续位于 viewer 静态资源。根 scope 提供拦截能力，不授予缓存所有请求的权限。

`tab` 不进入 API 请求，因此 path 和 graph 对同主题同维度共用 `GET /api/topic/:id?dimension=...` 缓存条目。任何主壳、模块依赖、路由契约或 M3 CSS 的兼容性变更必须递增 `viewer/service-worker.js` 的缓存版本，以清除旧静态和数据缓存命名空间。

## 保留与删除

保留：`scripts/cache-policy.mjs`、`scripts/serve.mjs`、`viewer/service-worker.js`、localStorage 用户状态、所有 API 契约和 AI 评分语义。

删除：iframe DOM/CSS/同步逻辑、独立图谱 router、双 hash 路由、跨窗口导航补丁，以及已无引用的独立图谱入口资源。

## 验证

1. 路由纯函数测试覆盖缺省 tab、主题 ID、subject/domain 不变量、序列化不重复 id、tab 切换和筛选往返。
2. 缓存策略测试持续覆盖静态区、允许只读 GET、副作用 `no-store` 和未知 API 不缓存。
3. 全量 Node 测试通过。
4. 桌面浏览器：无 iframe；`图谱列表 → 详情 → 评分 → 返回` 保留 URL 上下文；`脉络 ↔ 图谱` 仅改变 tab；前进/后退无双重跳转。
5. 移动浏览器：Bottom Navigation、目录与评分可用。
6. Worker 控制 `/` scope；Cache Storage 只有静态模块与只读 GET（含查询字符串和详情）；三类 AI POST 与 localStorage 不进入 Cache Storage。
