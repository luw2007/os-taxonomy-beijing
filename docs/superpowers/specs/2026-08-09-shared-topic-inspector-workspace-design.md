# 共享 Topic Inspector + 双 Canvas 学习工作台设计

## 目标

将“知识脉络”和“知识图谱”呈现为同一学习工作台中的两种观察方式，而不是两套页面：

- 知识脉络回答“下一步学什么”；
- 知识图谱回答“这个知识点在体系的哪里”；
- 两者共享导航、筛选上下文、当前学习者、主题详情、掌握状态和 AI 作答评分。

用户在 `tab=path` 与 `tab=graph` 间切换时，应感到在观察同一个主题的不同画布，不应感到进入另一个产品。

## 范围

- 用一个统一工作台外壳承载路径 Canvas、图谱 Canvas 和共享 Topic Inspector。
- 保留现有单文档、单 hash 路由；不新增 iframe、第二 document 或第二 router。
- 统一桌面 Navigation Rail、移动 Bottom Navigation、上下文筛选栏、主题选中态、详情与评分呈现。
- 将图谱的目录/筛选从“第二套导航”收敛为工作台级 Context Bar 和 Catalog Drawer。
- 复用已有 `POST /api/assessment`、服务器评分 prompt、瞬时失败重试与“不自动标记掌握”语义。

## 非范围

- 不新增力导向关系图、节点连线画布或新的数据可视化引擎。
- 不更改公开 API 契约、知识数据、评分标准、AI 模型、限流或本地档案 schema。
- 不把学生作答、AI 结果、掌握状态或学习者资料写入 URL、Cache Storage 或 API。
- 不引入字体、组件库、构建工具或第三方依赖。

## 单一路由不变量

现有主文档 hash 是唯一状态源：

```text
#/mt_xxx?tab=path&dim=us&subject=Mathematics&domain=Data%20%26%20Statistics
#/mt_xxx?tab=graph&dim=us&subject=Mathematics&domain=Data%20%26%20Statistics
```

- `tab` 只决定 Canvas，不决定主题详情组件、评分协议或用户状态。
- `id` 表示 Inspector 当前选中主题；没有 `id` 时 Inspector 关闭。
- `dim / subject / domain / ageRange / q` 是共享浏览上下文。
- Inspector 关闭时只移除 `id`，保留 `tab` 与全部筛选上下文。
- 主题详情、路径与图谱之间不再各自拼接或维护 hash。

## 信息架构

### 桌面

```text
Top App Bar
├── 品牌与当前学习者
├── 全局搜索 / 辅助操作
└── 工作台状态

Navigation Rail
├── 学习路径
├── 知识图谱
├── 目录
└── 我的

Workspace
├── Context Bar：学科、领域、年龄、搜索、筛选状态
├── Canvas：路径或图谱
└── Topic Inspector：当前主题详情
```

- Navigation Rail 是工作台级目的地，不是当前旧 tabs 的纵向化版本。
- `目录` 打开 drawer，不切换到第二页面；drawer 选择会更新共享 route。
- `我的` 打开现有学习者档案/本地记忆表面，不破坏 Canvas 与 route。
- Context Bar 在两种 Canvas 中位置、控件顺序和选中状态一致；图谱独有的主题树不再占据独立永久侧栏。

### 移动

```text
Bottom Navigation
├── 脉络
├── 图谱
├── 目录
└── 我的

内容区
├── Context Bar（紧凑、可展开）
├── 当前 Canvas
└── Topic Inspector（全高 Sheet）
```

- `tab=path` 与 `tab=graph` 必须驱动 Bottom Navigation 的当前状态。
- 目录是全高 drawer；Topic Inspector 是全高 Sheet；两者不得同时争夺主内容区。
- 关闭 Inspector 返回原 Canvas 与原筛选上下文。

## 双 Canvas

### 学习路径 Canvas

保留前置 → 当前 → 后续关系和“接下来可以学”推荐。它不再自带另一种主题详情样式；选择主题只更新 route 的 `id` 并打开共享 Inspector。

### 知识图谱 Canvas

保留学科、领域、主题列表、课本目录对比和筛选能力。它不再渲染全页主题详情；选择主题只更新 route 的 `id` 并打开共享 Inspector。课本目录对比继续使用 `#/textbook-gaps?tab=graph&...`，且必须完整保留 `gap_type / grade / q`。

## 共享 Topic Inspector

唯一主题详情结构：

```text
主题标题 + 学科 / 领域 / 年龄 + 掌握操作
├── 学习说明
├── 掌握证据
├── 评估话术
│   └── 文本输入（兼容系统语音输入）→ AI 评分
├── 前置知识
└── 后续知识
```

### 交互契约

- 主题标题、标签、描述、证据、依赖和评分在 path/graph 中由同一渲染器输出。
- 详情选择不能销毁当前 Canvas；路径关系或图谱列表应保留可见的选中状态。
- 掌握操作只写既有 per-user localStorage 命名空间并触发已有状态刷新。
- 评分仅更新 Inspector 内 `aria-live` 结果区；失败保留文本；不得自动改变掌握状态。
- Inspector 中的前置/后续主题导航更新 `id`，不丢失 `tab / dim / subject / domain / ageRange / q`。

## Material 3 视觉系统

- `surface`：暖灰全局背景；`surface-container`：Context Bar、drawer、普通分组；`surface-container-high`：Inspector 与当前学习区域。
- 靛青只表达 primary action、选中目的地与键盘焦点；绿色只表达已掌握；珊瑚只表达错误或需注意状态。
- Desktop Rail active indicator、筛选 chips、列表选中态和路径当前主题共享同一 M3 状态层，而不是各自使用不同背景色。
- 容器 16px、输入与按钮 12px、chips 8px；层级以 surface 色阶和 1dp 阴影表达，不采用大面积悬浮阴影。
- Canvas 切换使用 180–220ms 的淡入/淡出；Inspector 从右侧进入。`prefers-reduced-motion` 时取消这些动画。
- 保留系统中文字体栈，使用一致的 headline/title/body/label 角色；不新增外部字体。

## 动静区隔离

展示收敛不得破坏既有区隔：

| 区域 | 策略 |
| --- | --- |
| `/static/*` | Service Worker Cache First；统一工作台模块和 CSS 进入静态区 |
| 允许的 `GET /api/*` | stale-while-revalidate，完整 Request URL 为 cache key |
| `POST /api/chat`、`POST /api/assessment`、`POST /api/resolve` | 透传、`no-store`、不进入 Cache Storage |
| `localStorage` | 学习者档案、掌握、暂未掌握和协议状态，完全隔离 |

- `tab` 仅为 UI 路由字段，不进入 API 请求；两个 Canvas 对同一主题/维度共用只读详情缓存。
- 修改静态模块图、壳或 CSS 时递增 Service Worker 缓存版本。
- Worker 根入口维持 `/service-worker.js` 与 `Service-Worker-Allowed: /`。

## 实施边界

预计影响超过 8 个前端文件：应用壳、路由、path/graph Canvas、共享 Inspector、评估 UI、桌面与移动 CSS、路由和视觉测试。实现必须分为可独立使用的提交：

1. **共享 Inspector**：path/graph 两种 Canvas 使用同一主题详情与评分 UI；已有路由、缓存和本地状态不变。
2. **统一工作台骨架**：Context Bar、Catalog Drawer、Desktop Rail 和移动导航收敛；两种 Canvas 继续可用。
3. **Canvas 收敛**：移除图谱独有全页详情和路径独有中央详情，统一为 Inspector；保留课本对比 route。
4. **视觉完成**：M3 surface、状态层、响应式 sheet/drawer 和减弱动画；不改变数据与副作用边界。

任何一步合入后都保持路径、图谱、详情和评分可用。

## 验收

自动化：

- route 测试覆盖 path/graph 切换、Inspector open/close、主题导航、课本对比 filters 与没有重复 `id`。
- 共享 Inspector 测试覆盖安全转义、评分结果、失败保留、掌握状态隔离。
- 缓存策略测试继续确认静态/只读/AI/localStorage 边界。
- 全量 `npm test` 通过。

浏览器：

1. 桌面：路径与图谱从同一 Context Bar 进入；切换 Canvas 后同一主题仍在 Inspector 中；没有 iframe。
2. 桌面：图谱列表 → Inspector → 前置/后续主题 → 关闭 Inspector，路由始终保留上下文。
3. 移动：Bottom Navigation 在 path/graph 之间正确同步；目录 drawer 与 Inspector Sheet 正确关闭和恢复 Canvas。
4. 评分：两种 Canvas 内的同一 Inspector 可提交；AI POST 为 `no-store`，评分不改变掌握状态。
5. 缓存：静态模块和只读 GET 分区缓存；AI POST 与 localStorage 不进入 Cache Storage。
