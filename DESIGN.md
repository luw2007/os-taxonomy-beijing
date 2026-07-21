# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-07-21
- Primary product surfaces: `viewer/index.html` 的“知识脉络”学习页；移动端优先的知识点判定与导航流程。
- Evidence reviewed: `README.md`; `viewer/index.html`; `viewer/path.js`; `viewer/path.css`; `viewer/path-navigation.js`; `viewer/mastery-state.js`; `data/manifest.json`; `package.json`。
- Observed facts: 产品将北京课程标准对齐的微主题组织为有向无环知识图谱；现有脉络页已有本地多档案、按档案隔离的掌握状态、AI 解析确认和前置/后续关系；数据与用户档案均在浏览器 `localStorage`，无服务端账户或聊天会话。
- Design inference: 新移动端应围绕单个知识点的“判定—迁移—继续学习”闭环，而不是缩小桌面三栏与目录侧栏。

## Brand
- Personality: 克制、可信、可理解的学习地图；像清晰的学习工具，不像游戏化刷题产品。
- Trust signals: 明示课程标准对齐、知识点所属学年/学科、掌握状态、前置关系及“AI 推测”边的审核状态；继续沿用本地存储与隐私说明。
- Avoid: 过度奖励、连续打卡压力、把 AI 建议伪装为教师结论、靠颜色或手势作为唯一状态/操作表达。

## Product goals
- Goals:
  - 在手机上让用户连续判断知识点：左滑标为“已掌握”，右滑标为“未掌握”。
  - 以上下手势切换到同一筛选范围内的相邻知识点，维持“知识脉络”而非随机卡片流。
  - 让用户随时查看或修改学年、学科筛选，并理解当前范围。
  - 无需登录即可在可关闭弹窗中与 AI 进行上下文对话；请求明确关联当前档案、筛选条件和当前知识点。
- Non-goals:
  - 不在本次设计中改变课程数据、依赖图审核规则或推荐算法。
  - 不把服务端认证、云端同步或持久化聊天会话视为已存在能力。
  - 不以滑动替代知识详情、搜索、档案管理或无障碍操作。
- Success signals:
  - 用户完成一次知识点判定后无需离开主屏即可看到下一节点。
  - 当前学年、学科、知识点位置和掌握结果始终可见或可一触恢复。
  - 关键判定可通过显式按钮、键盘和辅助技术完成。

## Personas and jobs
- Primary personas: 北京义务教育阶段学生的家长；在自身档案中复盘的学生；协助建档的教师/辅导者。
- User jobs:
  - 快速记录孩子已会与未会的知识点，形成可靠的个人学习脉络。
  - 顺着前置与后续关系判断下一步，而不是在学科目录中盲找。
  - 围绕当前知识点向 AI 询问解释、练习建议或判断依据。
- Key contexts of use: 竖屏手机、碎片时间、单手操作；家长与孩子共同操作；网络慢或无网络时仍应可浏览已加载数据和本地掌握记录。

## Information architecture
- Primary navigation:
  - 移动端底部导航：`脉络`（默认）、`目录`、`我的`。
  - `脉络`顶部显示两个可点选筛选器：学年、学科；右上角为登录头像或“登录”。
  - 当前知识点页是主屏；详情、筛选面板、AI 对话均采用可关闭底部抽屉/弹窗，不改变主屏上下文。
- Core routes/screens:
  - 账号入口与本地学习档案清晰区分；AI 学习伙伴无需登录，会话仍明确绑定当前学习档案。
  - 脉络卡：知识点名、学科/学年标签、在当前脉络中的位置、简短说明与前置/后续摘要。
  - 判定反馈：左侧“已掌握”、右侧“未掌握”操作区；结果即时落盘并提供短暂撤销。
  - 上下导航：上一个/下一个相邻知识点；卡片底部有当前序列位置和方向按钮。
  - 筛选抽屉：学年、学科两级选择；应用后重置到该范围的第一个适合复核的节点，并提示范围变化。
  - AI 对话弹窗：当前知识点上下文摘要、当前页面内的对话记录、文本输入和发送；无需登录，不持久化会话。
  - 目录：保留现有“学科—领域—知识点”可搜索入口，作为直接跳转和兜底导航。
  - 我的：现有多档案、已掌握清单、隐私与清除本地数据入口。
- Content hierarchy:
  1. 当前知识点与它在知识脉络的位置。
  2. 判定操作及清晰结果。
  3. 前置/后续关系与继续学习。
  4. 详情、课程标准编号、AI 帮助和档案管理。

## Design principles
- 单屏只推动一个学习决策：主卡只服务于当前知识点，不同时展开完整三栏图谱。
- 脉络优先于卡片流：上下切换的顺序必须由当前筛选范围内的年龄/年级与依赖关系确定，并显示上下文，不可随机。
- 手势提升效率，显式控件保证可发现和可达：同一判定与导航必须有可见按钮。
- AI 是协作者，不是权威：对话带上当前上下文，回答应保留不确定性并可回到知识点依据。
- Tradeoffs: 为避免误触，横向滑动只在主卡内容区生效且须越过明确阈值；纵向页面滚动优先，只有在卡片处于滚动顶部/底部且纵向拖动达到阈值时才切换节点。

## Visual language
- Color: 复用现有 token：暖白背景 `--bg`、白卡 `--card-bg`、深棕正文 `--text`、蓝绿强调 `--accent`、绿色表示已掌握 `--green`、砖红仅用于破坏性/需注意的操作 `--primary`。未掌握使用中性描边与文字，不能暗示失败。
- Typography: 复用系统中文字体栈；知识点名称 22–24px/600，正文 15–16px，元信息与标签不小于 12px；行高至少 1.5。
- Spacing/layout rhythm: 4px 基础单位；主屏左右 16px，卡片内边距 20px；触控目标至少 44×44px；底部导航和主操作避开安全区。
- Shape/radius/elevation: 复用 10px 默认圆角；主知识卡 16px；静态卡片仅细边框与低阴影，抽屉/弹窗使用现有 `--shadow-lg`。
- Motion: 判定卡横向位移最多 20px 作为预览，达到阈值后 180–220ms 完成状态反馈并装载相邻节点；支持减少动态效果时禁用滑动位移，仅保留状态切换。
- Imagery/iconography: 不引入装饰插画；使用简洁线性图标并配中文文本标签。保留“🧭 知识脉络”的语义，但关键操作不得只依赖 emoji。

## Components
- Existing components to reuse:
  - `viewer/path.css` token、`.tcard`、`.me`、`.tag`、`.modal-mask`/`.modal`、`.btn`、`.mastery-action`、toast 与现有多档案状态。
  - `viewer/path-navigation.js#findNextUnmastered` 的图关系遍历原则；`viewer/mastery-state.js#toggleMastery` 的不可变状态切换。
- New/changed components:
  - `MobilePathHeader`：筛选摘要、头像/登录入口与筛选抽屉触发器。
  - `KnowledgePathCard`：当前节点、脉络位置、前后关系摘要、详情入口、手势层。
  - `MasteryDecisionBar`：`已掌握`、`未掌握`两个等权可见按钮，另有撤销。
  - `PathStepper`：上一个/下一个显式按钮和位置文本。
  - `FilterSheet`：学年与学科的单选/多选规则、应用与清除。
  - `AiChatModal`：无需登录即可发送；展示当前档案和知识点上下文，支持关闭与会话错误态。
  - `MobileBottomNav`：脉络、目录、我的。
- Variants and states:
  - 知识卡：加载、可判定、已掌握、未掌握、无相邻节点、数据/网络错误。
  - 筛选：未筛选、单学年、单学科、组合筛选、无匹配结果。
  - AI：连接中、可对话、发送中、失败、空会话、离线不可用。
  - 判定：默认、向左预览、向右预览、提交成功、已撤销；“未掌握”是中性状态而非错误。
- Token/component ownership: 样式 token 继续由 `viewer/path.css` 根变量唯一拥有；移动端组件扩展该文件或同源模块，不新建第二套 token 系统。

## Accessibility
- Target standard: WCAG 2.2 AA；滑动遵循 WCAG 2.5.1 Pointer Gestures：所有路径型手势均提供单点触发的替代控件。[W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)
- Keyboard/focus behavior: 卡片、判定按钮、上下切换、筛选器、聊天触发器均可 Tab 到达；弹窗打开后焦点移入、焦点圈定、关闭后返回触发器；`Escape` 关闭非强制弹窗。
- Contrast/readability: 所有文本与边界达到 AA；已掌握/未掌握同时有文本、图标与状态描述；不以拖动方向或颜色单独传达结果。
- Screen-reader semantics: 主卡使用文章/标题结构；判定是带明确 `aria-label` 的按钮；滑动完成后以 `aria-live="polite"` 宣告“已标记为已掌握/未掌握，已切换到…”。AI 对话遵循对话日志语义且发送结果可读。
- Reduced motion and sensory considerations: `prefers-reduced-motion: reduce` 下不做平移或自动轮播；触觉反馈仅为增强，网页环境中不可作为唯一反馈。

## Responsive behavior
- Supported breakpoints/devices: 移动优先 320–480px；大屏手机 481–767px；768px 以上可继续使用现有桌面脉络三栏，不以移动底部导航覆盖桌面信息架构。
- Layout adaptations: 移动端顶部固定筛选摘要，单列主卡，底部固定导航；筛选和 AI 使用底部抽屉。主卡最小可见高度应保证一次读懂核心标题与两个判定按钮。
- Touch/hover differences: 移动端不依赖 hover；拖动时阻止卡片内的横向页面滚动，但不劫持正文纵向阅读。桌面继续保留点击按钮，并可以支持方向键作为可选快捷键。

## Interaction states
- Loading: 首次进入展示骨架卡；筛选变更保留旧范围摘要并显示加载状态，避免页面跳闪。
- Empty: 范围没有知识点时说明当前学年/学科组合，提供“清除筛选”和“打开目录”。相邻节点耗尽时显示完成态和可回顾已判定列表。
- Error: 数据加载、保存或 AI 请求失败要明确说明发生了什么和重试操作；不得把失败静默成“未掌握”。
- Success: 判定保存后 toast + 可撤销；AI 发送成功后显示对话条目和关联知识点。
- Disabled: 发送、应用筛选、判定提交期间禁用重复触发，显示进度且不丢失输入。
- Offline/slow network, if applicable: 已加载知识数据和 `localStorage` 掌握状态可继续可用；AI 入口显示离线不可用且保留未发送草稿。

## Content voice
- Tone: 平静、具体、鼓励复盘，不给孩子贴标签。
- Terminology: 使用“已掌握”“待复习/暂未掌握”“前置知识”“后续知识”“知识脉络”；避免“失败”“落后”“闯关”。
- Microcopy rules:
  - 操作按结果命名：`已掌握`、`暂未掌握`，不写抽象的“左滑/右滑”。
  - 保留动作结果：`已标记为已掌握。撤销`。
  - AI 提示说明边界：`AI 将结合当前知识点与档案信息回答；结果仅供学习参考。`
  - AI 可用态：`围绕当前知识点向 AI 提问；无需登录，结果仅供学习参考。`

## Implementation constraints
- Framework/styling system: 原生 HTML/CSS/ES modules，零运行时依赖；服务端由 `scripts/serve.mjs` 提供数据 API。
- Design-token constraints: 复用 `viewer/path.css` 的 CSS 自定义属性；不得为移动端引入 Tailwind、组件库或新字体。
- Performance constraints: 不应一次把全学科详情渲染到 DOM；只预取当前节点相邻项与筛选范围所需索引；手势反馈应使用 transform，避免布局抖动。
- Compatibility constraints: 浏览器仍是本地运行场景；现有 localStorage 用户档案必须在引入登录 UI 后继续可读且不丢失。登录态与本地“学习档案”分层，避免把账号名误当作孩子档案。
- Test/screenshot expectations: 增加移动端 320px、375px、430px 的截图/交互覆盖；验证左/右判定、上下节点切换、筛选组合、无匹配、匿名 AI 对话、AI 失败/离线、键盘/按钮替代手势、减少动态效果。

## Open questions
- [x] AI 学习伙伴无需认证；会话仅保留在当前页面，刷新即清空；服务端不保存会话。owner：产品；resolved：2026-07-21。
- [x] AI 后端复用现有 DeepSeek 配置，回答绑定当前知识点、筛选和本地档案上下文；结果仅供学习参考。owner：产品/后端；resolved：2026-07-21。
- [ ] “学年”是教材年级（如三年级上/下）、课标学段还是按用户档案自动推断，且多学年选择规则未定义；owner：课程产品；impact：筛选数据映射与上下切换排序需要明确。
- [ ] “未掌握”是否需区分“尚未学习”“需要复习”“不会”，以及它是否影响 `findNextUnmastered` 的推荐规则尚未定义；owner：学习产品；impact：当前设计只记录中性未掌握判定，不改变图算法。
- [ ] 纵向手势与页面滚动冲突时的精确阈值需在真机可用性测试中校准；owner：前端/设计；impact：不得在未经验证前将纵向滑动作为唯一节点导航。
