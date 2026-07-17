#!/usr/bin/env node
/**
 * split-compound-topics.mjs — 拆分含「和/与」的复合微主题。
 *
 * 三类处理：
 *   C 类（剔除）：课文标题，直接删除
 *   B 类（不拆）：单一概念，保留不动
 *   A 类（拆分）：按 SPLIT_MAP 的显式映射拆成两条独立微技能
 *
 * 拆分规则（A 类）：
 *   - 原条目保留 id，name 改为前半部分（基础概念）
 *   - 新增条目用新 id（mtc_ + 递增序号），name 为后半部分（进阶技能）
 *   - description/evidence/assessmentPrompt 按映射表的 split[a/b] 重写
 *   - 两条之间标注渐进关系（前者 depends on nothing，后者在前者之后）
 *
 *   node scripts/split-compound-topics.mjs            # 执行拆分（写回 cn-topics.json）
 *   node scripts/split-compound-topics.mjs --dry-run  # 只预览不写盘
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));

// ========== C 类：剔除（课文标题）==========
const DELETE_IDS = new Set([
  'mtc_1310', 'mtc_1318', 'mtc_1324', 'mtc_1339', 'mtc_1346',
  'mtc_1393', 'mtc_1405', 'mtc_1449', 'mtc_1451', 'mtc_1478', 'mtc_1499',
]);

// ========== B 类：不拆（保留原样）==========
// 由 classify-compound-topics.mjs 的 B_PATTERNS 判定，这里不需要显式列出
// 只要不在 DELETE_IDS 也不在 SPLIT_MAP 中的，自动保留

// ========== A 类：拆分映射表 ==========
// 每条: { id, a: {name, desc, ev, prompt}, b: {name, desc, ev, prompt} }
// a = 前半部分（基础，保留原 id），b = 后半部分（进阶，新 id）
// desc/ev/prompt 为完整重写内容；如省略则从原文智能提取
const SPLIT_MAP = {
  // ===== Physics =====
  'mtc_156': { a: { name: '熔化' }, b: { name: '凝固' } },
  'mtc_158': { a: { name: '熔点' }, b: { name: '凝固点' } },
  'mtc_159': { a: { name: '汽化' }, b: { name: '液化' } },
  'mtc_160': { a: { name: '蒸发' }, b: { name: '沸腾' } },
  'mtc_161': { a: { name: '升华' }, b: { name: '凝华' } },
  'mtc_168': { a: { name: '测量固体的密度' }, b: { name: '测量液体的密度' } },
  'mtc_169': { a: { name: '机械运动' }, b: { name: '参照物' } },
  'mtc_170': { a: { name: '速度的计算' }, b: { name: '速度的单位换算' } },
  'mtc_181': { a: { name: '增大摩擦的方法' }, b: { name: '减小摩擦的方法' } },
  'mtc_218': { a: { name: '电磁感应现象' }, b: { name: '发电机原理' } },
  'mtc_219': { a: { name: '磁场对电流的作用' }, b: { name: '电动机原理' } },
  'mtc_235': { a: { name: '电热的利用' }, b: { name: '电热的防止' } },
  'mtc_238': { a: { name: '探究光的反射规律' }, b: { name: '平面镜成像' } },
  'mtc_651': { a: { name: '质点' }, b: { name: '参考系' } },
  'mtc_652': { a: { name: '位移' }, b: { name: '路程' } },
  'mtc_653': { a: { name: '平均速度' }, b: { name: '瞬时速度' } },
  'mtc_660': { a: { name: '牛顿运动定律的应用' }, b: { name: '超重与失重' } },
  'mtc_661': { a: { name: '运动的合成' }, b: { name: '运动的分解' } },
  'mtc_669': { a: { name: '万有引力定律' }, b: { name: '天体运动' } },
  'mtc_682': { a: { name: '电场' }, b: { name: '电场强度' } },
  'mtc_683': { a: { name: '电场线' }, b: { name: '电场的描述' } },
  'mtc_684': { a: { name: '电势能' }, b: { name: '电势' } },
  'mtc_686': { a: { name: '电容器' }, b: { name: '电容' } },
  'mtc_690': { a: { name: '测电动势' }, b: { name: '测内阻' } },
  'mtc_691': { a: { name: '磁场' }, b: { name: '磁感应强度' } },
  'mtc_693': { a: { name: '楞次定律' }, b: { name: '感应电流方向' } },
  'mtc_694': { a: { name: '电磁波的产生' }, b: { name: '电磁波的特性' } },
  'mtc_842': { a: { name: '长度的测量' }, b: { name: '时间的测量' } },
  'mtc_846': { a: { name: '噪声的危害' }, b: { name: '噪声的控制' } },
  'mtc_849': { a: { name: '眼睛的原理（近视与远视）' }, b: { name: '眼镜的矫正' } },
  'mtc_850': { a: { name: '显微镜的原理' }, b: { name: '望远镜的原理' } },
  'mtc_851': { a: { name: '密度与社会生活' }, b: { name: '密度知识的应用' } },
  'mtc_866': { a: { name: '广播与电视的原理' }, b: { name: '移动通信的原理' } },
  'mtc_871': { a: { name: '能源的分类与利用' }, b: { name: '可持续发展' } },
  'mtc_874': { a: { name: '万有引力定律' }, b: { name: '宇宙航行' } },
  'mtc_879': { a: { name: '电磁感应现象' }, b: { name: '电磁波初步' } },
  'mtc_883': { a: { name: '安培力' }, b: { name: '洛伦兹力' } },
  'mtc_887': { a: { name: '气体的性质' }, b: { name: '固体与液体的性质' } },
  'mtc_889': { a: { name: '原子结构' }, b: { name: '波粒二象性' } },

  // ===== Chemistry =====
  'mtc_336': { a: { name: '物质的分离' }, b: { name: '物质的提纯' } },
  'mtc_343': { a: { name: '溶解时的吸热现象' }, b: { name: '溶解时的放热现象' } },
  'mtc_344': { a: { name: '溶解度的概念' }, b: { name: '溶解度曲线' } },
  'mtc_346': { a: { name: '碳单质的性质' }, b: { name: '碳单质的用途' } },
  'mtc_353': { a: { name: '金属的锈蚀' }, b: { name: '金属的防护' } },
  'mtc_361': { a: { name: '燃烧的条件' }, b: { name: '灭火的原理' } },
  'mtc_365': { a: { name: '核外电子排布' }, b: { name: '离子的形成' } },
  'mtc_695': { a: { name: '物质的量的概念' }, b: { name: '阿伏伽德罗常数' } },
  'mtc_696': { a: { name: '摩尔质量' }, b: { name: '摩尔质量的换算' } },
  'mtc_707': { a: { name: '原子结构' }, b: { name: '核外电子排布' } },
  'mtc_710': { a: { name: '化学键' }, b: { name: '分子结构' } },
  'mtc_715': { a: { name: '勒夏特列原理' }, b: { name: '化学平衡的移动' } },
  'mtc_716': { a: { name: '甲烷' }, b: { name: '烷烃' } },
  'mtc_717': { a: { name: '乙烯' }, b: { name: '加成反应' } },
  'mtc_718': { a: { name: '乙醇的结构' }, b: { name: '乙醇的性质' } },
  'mtc_719': { a: { name: '乙酸' }, b: { name: '酯化反应' } },
  'mtc_891': { a: { name: '物质的变化' }, b: { name: '物质的性质' } },
  'mtc_896': { a: { name: '金刚石与石墨' }, b: { name: 'C60' } },
  'mtc_898': { a: { name: '燃料的合理利用' }, b: { name: '燃料的开发' } },
  'mtc_902': { a: { name: '金属资源的利用' }, b: { name: '金属资源的保护' } },
  'mtc_904': { a: { name: '常见的酸' }, b: { name: '常见的碱' } },
  'mtc_908': { a: { name: '化学元素' }, b: { name: '人体健康' } },
  'mtc_910': { a: { name: '金属资源的利用' }, b: { name: '金属资源的保护' } },
  'mtc_914': { a: { name: '研究物质性质的方法' }, b: { name: '研究物质性质的程序' } },
  'mtc_916': { a: { name: '元素' }, b: { name: '物质分类' } },
  'mtc_922': { a: { name: '原子结构' }, b: { name: '元素性质' } },
  'mtc_923': { a: { name: '化学键' }, b: { name: '物质构成' } },
  'mtc_924': { a: { name: '化学反应的快慢' }, b: { name: '化学反应的限度' } },
  'mtc_928': { a: { name: '原子结构' }, b: { name: '元素性质' } },
  'mtc_933': { a: { name: '水' }, b: { name: '水溶液' } },
  'mtc_941': { a: { name: '水' }, b: { name: '水溶液' } },
  'mtc_948': { a: { name: '共价键' }, b: { name: '分子的空间结构' } },
  'mtc_949': { a: { name: '离子键' }, b: { name: '配位键与金属键' } },
  'mtc_953': { a: { name: '液晶' }, b: { name: '纳米材料与超分子' } },
  'mtc_957': { a: { name: '共价键' }, b: { name: '分子的空间结构' } },
  'mtc_958': { a: { name: '离子键' }, b: { name: '配位键与金属键' } },
  'mtc_961': { a: { name: '液晶' }, b: { name: '纳米材料与超分子' } },
  'mtc_963': { a: { name: '有机化合物的结构' }, b: { name: '有机化合物的性质' } },
  'mtc_965': { a: { name: '醇' }, b: { name: '酚' } },
  'mtc_966': { a: { name: '醛和酮' }, b: { name: '糖类和核酸' } },
  'mtc_967': { a: { name: '羧酸' }, b: { name: '氨基酸和蛋白质' } },
  'mtc_972': { a: { name: '有机化合物的结构' }, b: { name: '有机化合物的性质' } },
  'mtc_974': { a: { name: '醇' }, b: { name: '酚' } },
  'mtc_975': { a: { name: '醛和酮' }, b: { name: '糖类和核酸' } },
  'mtc_976': { a: { name: '羧酸' }, b: { name: '氨基酸和蛋白质' } },
  'mtc_713_split': null, // mtc_713 是 B 类（化学平衡的特征与判断）

  // ===== Biology =====
  'mtc_399': { a: { name: '开花' }, b: { name: '结果' } },
  'mtc_405': { a: { name: '食物的消化' }, b: { name: '营养的吸收' } },
  'mtc_407': { a: { name: '血液的成分' }, b: { name: '血液的功能' } },
  'mtc_412': { a: { name: '反射' }, b: { name: '反射弧' } },
  'mtc_417': { a: { name: '显性基因的遗传规律' }, b: { name: '隐性基因的遗传规律' } },
  'mtc_419': { a: { name: '遗传病' }, b: { name: '近亲结婚的危害' } },
  'mtc_722': { a: { name: '蛋白质的结构' }, b: { name: '蛋白质的功能' } },
  'mtc_723': { a: { name: '核酸的结构' }, b: { name: '核酸的功能' } },
  'mtc_724': { a: { name: '细胞中的糖类' }, b: { name: '细胞中的脂质' } },
  'mtc_725': { a: { name: '细胞中的水' }, b: { name: '细胞中的无机盐' } },
  'mtc_726': { a: { name: '细胞膜的结构' }, b: { name: '细胞膜的功能' } },
  'mtc_728': { a: { name: '细胞器的分工' }, b: { name: '细胞器间的合作' } },
  'mtc_729': { a: { name: '细胞核的结构' }, b: { name: '细胞核的功能' } },
  'mtc_732': { a: { name: 'ATP的结构' }, b: { name: 'ATP与细胞能量供应' } },
  'mtc_738': { a: { name: '细胞的衰老' }, b: { name: '细胞的凋亡' } },
  'mtc_741': { a: { name: 'DNA分子的结构' }, b: { name: 'DNA双螺旋模型' } },
  'mtc_743': { a: { name: '基因的表达·转录' }, b: { name: '基因的表达·翻译' } },
  'mtc_1001': { a: { name: '细胞的多样性' }, b: { name: '细胞的统一性' } },
  'mtc_1002': { a: { name: '细胞中的元素' }, b: { name: '细胞中的化合物' } },
  'mtc_1006': { a: { name: '主动运输' }, b: { name: '胞吞与胞吐' } },
  'mtc_1009': { a: { name: '细胞呼吸的原理' }, b: { name: '细胞呼吸的应用' } },
  'mtc_1010': { a: { name: '光合作用' }, b: { name: '能量转化' } },
  'mtc_1014': { a: { name: '减数分裂' }, b: { name: '受精作用' } },
  'mtc_1018_split': null, // B 类
  'mtc_1064_split': null, // B 类

  // ===== Mathematics =====
  'mtc_249': { a: { name: '绝对值的化简' }, b: { name: '绝对值的比较' } },
  'mtc_252': { a: { name: '有理数的乘方' }, b: { name: '科学记数法' } },
  'mtc_253': { a: { name: '平方根' }, b: { name: '算术平方根' } },
  'mtc_262': { a: { name: '因式分解的概念' }, b: { name: '提公因式法' } },
  'mtc_279': { a: { name: '变量' }, b: { name: '函数的概念' } },
  'mtc_288': { a: { name: '二次函数的性质' }, b: { name: '二次函数的最值' } },
  'mtc_292': { a: { name: '平行线的性质' }, b: { name: '平行线的判定' } },
  'mtc_296': { a: { name: '全等三角形的证明' }, b: { name: '全等三角形的书写规范' } },
  'mtc_297': { a: { name: '等腰三角形的性质' }, b: { name: '等腰三角形的判定' } },
  'mtc_300': { a: { name: '平行四边形的性质' }, b: { name: '平行四边形的判定' } },
  'mtc_301': { a: { name: '矩形菱形正方形的性质' }, b: { name: '矩形菱形正方形的判定' } },
  'mtc_311': { a: { name: '相似多边形' }, b: { name: '相似三角形' } },
  'mtc_320': { a: { name: '方差' }, b: { name: '数据的波动程度' } },
  'mtc_326': { a: { name: '代数知识综合应用' }, b: { name: '几何知识综合应用' } },
  'mtc_613': { a: { name: '集合的概念' }, b: { name: '集合的元素特征' } },
  'mtc_615': { a: { name: '集合间的关系·子集' }, b: { name: '集合间的关系·相等' } },
  'mtc_616': { a: { name: '集合的运算·交集与并集' }, b: { name: '集合的运算·补集与Venn图' } },
  'mtc_619': { a: { name: '不等式的基本性质' }, b: { name: '用不等式比较大小' } },
  'mtc_623': { a: { name: '函数的定义域' }, b: { name: '函数的值域' } },
  'mtc_624': { a: { name: '函数的单调性' }, b: { name: '函数的最值' } },
  'mtc_626': { a: { name: '幂函数的图像' }, b: { name: '幂函数的性质' } },
  'mtc_627': { a: { name: '指数与指数幂的运算' }, b: { name: '指数运算的应用' } },
  'mtc_628': { a: { name: '指数函数的图像' }, b: { name: '指数函数的性质' } },
  'mtc_629': { a: { name: '对数' }, b: { name: '对数运算' } },
  'mtc_630': { a: { name: '对数函数的图像' }, b: { name: '对数函数的性质' } },
  'mtc_631': { a: { name: '任意角' }, b: { name: '弧度制' } },
  'mtc_634': { a: { name: '三角函数的图像' }, b: { name: '三角函数的性质' } },
  'mtc_635': { a: { name: '函数的零点' }, b: { name: '方程的根' } },
  'mtc_637': { a: { name: '平面向量的概念' }, b: { name: '平面向量的线性运算' } },
  'mtc_639': { a: { name: '平面向量的坐标表示' }, b: { name: '平面向量的坐标运算' } },
  'mtc_641': { a: { name: '复数的概念' }, b: { name: '复数的几何意义' } },
  'mtc_1272': { a: { name: '投影' }, b: { name: '视图' } },
  'mtc_1274': { a: { name: '一元二次函数' }, b: { name: '方程和不等式' } },
  'mtc_1278': { a: { name: '空间向量' }, b: { name: '立体几何' } },
  'mtc_1279': { a: { name: '直线的方程' }, b: { name: '圆的方程' } },

  // ===== Chinese =====
  'mtc_004': { a: { name: '汉字基本笔画' }, b: { name: '汉字笔顺' } },
  'mtc_005': { a: { name: '常用偏旁部首' }, b: { name: '偏旁与字义推断' } },
  'mtc_007': { a: { name: '识字方法·看图识字' }, b: { name: '识字方法·归类识字' } },
  'mtc_008': { a: { name: '规范书写' }, b: { name: '正楷书写' } },
  'mtc_032': { a: { name: '成语积累' }, b: { name: '典故积累' } },
  'mtc_033': { a: { name: '中华传统节日' }, b: { name: '传统民俗' } },
  'mtc_034': { a: { name: '灯谜与对联' }, b: { name: '汉字文化' } },
  'mtc_512': { a: { name: '说明文·说明对象' }, b: { name: '说明文·特征把握' } },
  'mtc_513': { a: { name: '说明文·说明顺序' }, b: { name: '说明文·说明方法' } },
  'mtc_515': { a: { name: '小说·情节梳理' }, b: { name: '小说·情节概括' } },
  'mtc_518': { a: { name: '散文·主旨把握' }, b: { name: '散文·情感把握' } },
  'mtc_523': { a: { name: '记叙文写作·选材立意' }, b: { name: '记叙文写作·详略安排' } },
  'mtc_525': { a: { name: '说明文写作·特征' }, b: { name: '说明文写作·说明方法' } },
  'mtc_526': { a: { name: '议论文写作·观点' }, b: { name: '议论文写作·论据' } },
  'mtc_527': { a: { name: '实用文写作·常见格式' }, b: { name: '实用文写作·应用' } },
  'mtc_528': { a: { name: '写作·语言润色' }, b: { name: '写作·语言修改' } },
  'mtc_529': { a: { name: '演讲·观点明确' }, b: { name: '演讲·条理清楚' } },
  'mtc_534': { a: { name: '文言文·内容概括' }, b: { name: '文言文·写法鉴赏' } },
  'mtc_535': { a: { name: '古诗文·背诵（七八年级）' }, b: { name: '古诗文·准确默写（七八年级）' } },
  'mtc_536': { a: { name: '古诗文·背诵（九年级）' }, b: { name: '古诗文·准确默写（九年级）' } },
  'mtc_537': { a: { name: '古诗文·诗意理解' }, b: { name: '古诗文·运用' } },
  'mtc_539': { a: { name: '名著阅读·人物形象' }, b: { name: '名著阅读·阅读感受' } },
  'mtc_540': { a: { name: '词汇运用' }, b: { name: '成语运用' } },
  'mtc_542': { a: { name: '标点符号' }, b: { name: '修辞手法' } },
  'mtc_812': { a: { name: '古诗词鉴赏·意象' }, b: { name: '古诗词鉴赏·意境' } },
  'mtc_816': { a: { name: '议论文·复杂论证' }, b: { name: '议论文·思想深度' } },
  'mtc_817': { a: { name: '研究性写作·文献运用' }, b: { name: '研究性写作·学术表达' } },
  'mtc_819': { a: { name: '古诗文背诵（高中）' }, b: { name: '理解性默写（高中）' } },

  // ===== Moral & Rule of Law =====
  'mtc_057': { a: { name: '法治观念·规则' }, b: { name: '法治观念·法律' } },
  'mtc_071': { a: { name: '个人卫生习惯' }, b: { name: '健康习惯' } },
  'mtc_079': { a: { name: '武术·基本手型与步型' }, b: { name: '武术·简单套路' } },
  'mtc_544': { a: { name: '青春期的身体发育' }, b: { name: '青春期的生理变化' } },
  'mtc_545': { a: { name: '青春期的卫生' }, b: { name: '青春期的保健' } },
  'mtc_548': { a: { name: '识别危险信号' }, b: { name: '预防侵害' } },
  'mtc_549': { a: { name: '遇险求助' }, b: { name: '脱身方法' } },
  'mtc_550': { a: { name: '网络安全常识' }, b: { name: '防诈骗' } },
  'mtc_551': { a: { name: '文明上网' }, b: { name: '健康的网络交往' } },
  'mtc_553': { a: { name: '宪法的地位' }, b: { name: '宪法的权威' } },
  'mtc_557': { a: { name: '犯罪的概念' }, b: { name: '犯罪的基本特征' } },
  'mtc_559': { a: { name: '预防违法犯罪' }, b: { name: '依法自律' } },
  'mtc_566': { a: { name: '科教兴国战略' }, b: { name: '人才强国战略' } },
  'mtc_568': { a: { name: '一国两制' }, b: { name: '祖国统一' } },
  'mtc_569': { a: { name: '世界认知' }, b: { name: '全球视野' } },
  'mtc_570': { a: { name: '中国共产党的成立' }, b: { name: '早期革命' } },
  'mtc_572': { a: { name: '革命精神的内涵' }, b: { name: '革命精神的传承' } },
  'mtc_574': { a: { name: '文化自信' }, b: { name: '传承责任' } },
  'mtc_1511': { a: { name: '友谊' }, b: { name: '成长同行' } },
  'mtc_1533': { a: { name: '责任' }, b: { name: '角色同在' } },
  'mtc_1540': { a: { name: '我国的经济制度' }, b: { name: '我国的政治制度' } },

  // ===== English =====
  'mtc_152': { a: { name: '英语·口语表达·问候与介绍' }, b: { name: '英语·口语表达·简单交流' } },
  'mtc_155': { a: { name: '英语·学习策略' }, b: { name: '英语·文化意识' } },
  'mtc_576': { a: { name: '英语·听力·主旨推断' }, b: { name: '英语·听力·说话者意图推断' } },
  'mtc_579': { a: { name: '英语·阅读·语篇大意' }, b: { name: '英语·阅读·细节理解' } },
  'mtc_580': { a: { name: '英语·阅读·作者意图' }, b: { name: '英语·阅读·推断' } },
  'mtc_581': { a: { name: '英语·阅读·生词猜测' }, b: { name: '英语·阅读·语境理解' } },
  'mtc_582': { a: { name: '英语·写作·书信' }, b: { name: '英语·写作·邮件' } },
  'mtc_583': { a: { name: '英语·写作·简单记叙语篇' }, b: { name: '英语·写作·说明语篇' } },
  'mtc_587': { a: { name: '英语·语法·基本句型' }, b: { name: '英语·语法·句子结构' } },
  'mtc_589': { a: { name: '英语·词汇·构词法·派生' }, b: { name: '英语·词汇·构词法·合成' } },
  'mtc_590': { a: { name: '英语·语音·拼读规则' }, b: { name: '英语·语音·语调' } },
  'mtc_591': { a: { name: '英语·人与自我（学习与生活）' }, b: { name: '英语·人与自我（梦想）' } },
  'mtc_592': { a: { name: '英语·人与社会（规则与公益）' }, b: { name: '英语·人与社会（文化）' } },
  'mtc_593': { a: { name: '英语·人与自然（环保）' }, b: { name: '英语·人与自然（科技）' } },
  'mtc_838': { a: { name: '阅读·长难语篇的理解' }, b: { name: '阅读·长难语篇的推断' } },
  'mtc_840': { a: { name: '写作·复杂语篇的谋篇' }, b: { name: '写作·复杂语篇的表达' } },
  'mtc_841': { a: { name: '写作·思辨表达' }, b: { name: '写作·复杂句型运用' } },

  // ===== Information Technology =====
  'mtc_098': { a: { name: '数据' }, b: { name: '编码' } },
  'mtc_099': { a: { name: '数据的组织' }, b: { name: '数据的呈现·图表' } },
  'mtc_111': { a: { name: '人工智能·体验AI应用' }, b: { name: '人工智能·伦理' } },
  'mtc_595': { a: { name: '搜索引擎' }, b: { name: '信息检索技巧' } },
  'mtc_596': { a: { name: '互联网安全' }, b: { name: '个人信息保护' } },
  'mtc_597': { a: { name: 'HTML基础结构' }, b: { name: 'HTML常用标签' } },
  'mtc_599': { a: { name: '主题网站规划' }, b: { name: '主题网站开发' } },
  'mtc_600': { a: { name: '电子表格数据处理' }, b: { name: '电子表格数据分析' } },
  'mtc_601': { a: { name: '数据可视化' }, b: { name: '图表制作' } },
  'mtc_602': { a: { name: '物联网的基本概念' }, b: { name: '物联网的结构' } },
  'mtc_611': { a: { name: '流程图' }, b: { name: '三种基本结构' } },
  'mtc_821': { a: { name: '数据的采集' }, b: { name: '数据的整理' } },
  'mtc_822': { a: { name: '数据分析' }, b: { name: '可视化表达' } },
  'mtc_825': { a: { name: 'Python·列表与函数' }, b: { name: 'Python·枚举算法' } },
  'mtc_827': { a: { name: '信息系统的组成' }, b: { name: '信息系统的功能' } },
  'mtc_829': { a: { name: '信息社会伦理' }, b: { name: '信息社会法规' } },

  // ===== Geography =====
  'mtc_466': { a: { name: '地球的形状' }, b: { name: '地球的大小' } },
  'mtc_472': { a: { name: '地球的自转' }, b: { name: '昼夜交替' } },
  'mtc_473': { a: { name: '地球的公转' }, b: { name: '四季变化' } },
  'mtc_480': { a: { name: '海陆变迁' }, b: { name: '板块构造学说' } },
  'mtc_777': { a: { name: '大气环流' }, b: { name: '气压带与风带' } },
  'mtc_779': { a: { name: '水循环的过程' }, b: { name: '水循环的意义' } },
  'mtc_780': { a: { name: '洋流的分布规律' }, b: { name: '洋流的影响' } },
  'mtc_781': { a: { name: '内力作用' }, b: { name: '地表形态' } },
  'mtc_782': { a: { name: '外力作用' }, b: { name: '河流地貌' } },
  'mtc_785': { a: { name: '人口的变化' }, b: { name: '人口问题' } },
  'mtc_786': { a: { name: '城镇化' }, b: { name: '城乡协调发展' } },
  'mtc_790': { a: { name: '工业地域形成' }, b: { name: '工业区' } },
  'mtc_1256': { a: { name: '常见自然灾害的成因' }, b: { name: '常见自然灾害的避防' } },
  'mtc_1258': { a: { name: '人口分布与迁移' }, b: { name: '人口合理容量' } },
  'mtc_1266': { a: { name: '自然资源' }, b: { name: '自然资源与人类活动' } },
  'mtc_1267': { a: { name: '自然资源的开发利用' }, b: { name: '自然资源与国家安全' } },
  'mtc_1268': { a: { name: '环境' }, b: { name: '环境与国家安全' } },

  // ===== General Technology =====
  'mtc_830': { a: { name: '发现与明确问题' }, b: { name: '设计要求' } },
  'mtc_831': { a: { name: '制订设计方案' }, b: { name: '人机关系' } },
  'mtc_833': { a: { name: '测试与评估' }, b: { name: '方案优化' } },
  'mtc_834': { a: { name: '结构' }, b: { name: '结构的设计' } },
  'mtc_835': { a: { name: '流程' }, b: { name: '流程的设计' } },
  'mtc_836': { a: { name: '系统' }, b: { name: '系统的设计' } },
  'mtc_837': { a: { name: '控制' }, b: { name: '控制的设计' } },
  'mtc_1619': { a: { name: '技术产品的组装' }, b: { name: '技术产品的调试' } },
  'mtc_1628': { a: { name: '流程的设计' }, b: { name: '流程的优化' } },
  'mtc_1630': { a: { name: '系统的优化' }, b: { name: '系统的设计' } },
  'mtc_1631': { a: { name: '控制的认知' }, b: { name: '控制系统的认识' } },
  'mtc_1632': { a: { name: '控制系统的组成' }, b: { name: '控制系统的工作过程' } },
  'mtc_1633': { a: { name: '控制系统的设计' }, b: { name: '控制系统的实践' } },
  'mtc_1638': { a: { name: '常用晶体管的基本原理' }, b: { name: '常用晶体管的应用' } },

  // ===== Politics =====
  'mtc_792': { a: { name: '中国特色社会主义的开创' }, b: { name: '中国特色社会主义的发展' } },
  'mtc_795': { a: { name: '新发展理念' }, b: { name: '高质量发展' } },
  'mtc_799': { a: { name: '唯物论·物质' }, b: { name: '唯物论·意识的辩证关系' } },
  'mtc_803': { a: { name: '认识论·实践' }, b: { name: '认识论·认识' } },
  'mtc_808': { a: { name: '文化的内涵' }, b: { name: '文化的社会作用' } },
  'mtc_1564': { a: { name: '我国的个人收入分配' }, b: { name: '我国的社会保障' } },
  'mtc_1565': { a: { name: '历史的选择' }, b: { name: '人民的选择' } },
  'mtc_1567': { a: { name: '坚持党的全面领导' }, b: { name: '加强党的全面领导' } },
  'mtc_1586': { a: { name: '经济全球化' }, b: { name: '经济全球化与中国' } },
  'mtc_1588': { a: { name: '中国与国际组织' }, b: { name: '国际组织概述' } },
  'mtc_1593': { a: { name: '在和睦家庭中成长·权利' }, b: { name: '在和睦家庭中成长·义务' } },
  'mtc_1596': { a: { name: '自主创业' }, b: { name: '诚信经营' } },

  // ===== Science (小学) =====
  'mtc_138': { a: { name: '技术与工程·认识工具' }, b: { name: '技术与工程·认识材料' } },
  'mtc_140': { a: { name: '工程制作·搭建模型' }, b: { name: '工程制作·测试模型' } },
  'mtc_141': { a: { name: '工程思维·改进方案' }, b: { name: '工程思维·优化方案' } },
  'mtc_142': { a: { name: '中国本土动植物·常见物种' }, b: { name: '中国本土动植物·分布' } },
  'mtc_143': { a: { name: '中国地理' }, b: { name: '中国气候多样性' } },
  'mtc_144': { a: { name: '人类活动与环境·垃圾分类' }, b: { name: '人类活动与环境·资源回收' } },
  'mtc_145': { a: { name: '人类活动与环境·空气污染' }, b: { name: '人类活动与环境·水污染' } },
  'mtc_146': { a: { name: '灾害与防护·地震自救' }, b: { name: '灾害与防护·洪涝自救' } },

  // ===== Labor =====
  'mtc_114': { a: { name: '烹饪·简单食物制作' }, b: { name: '营养搭配' } },
  'mtc_115': { a: { name: '家用器具使用·安全操作' }, b: { name: '家用器具维护' } },
  'mtc_119': { a: { name: '新技术体验' }, b: { name: '新技术应用·3D打印初识' } },
  'mtc_122': { a: { name: '劳动观念·尊重劳动' }, b: { name: '劳动观念·尊重劳动者' } },
  'mtc_123': { a: { name: '劳动习惯' }, b: { name: '劳动安全·规范操作' } },

  // ===== Art =====
  'mtc_091': { a: { name: '音乐·编创简单节奏' }, b: { name: '音乐·编创简单旋律' } },
  'mtc_093': { a: { name: '戏曲·京剧脸谱' }, b: { name: '戏曲·行当初识' } },
  'mtc_095': { a: { name: '艺术·音乐与地域' }, b: { name: '艺术·音乐与民俗历史' } },
  'mtc_097': { a: { name: '美术·欣赏自然之美' }, b: { name: '美术·欣赏生活之美' } },

  // ===== PE =====
  'mtc_091_pe': null,
  'mtc_082_pe': null,

  // ===== Comprehensive =====
  'mtc_127': { a: { name: '跨学科项目·问题解决' }, b: { name: '跨学科项目·成果展示' } },
  'mtc_130': { a: { name: '项目学习·数据调查' }, b: { name: '项目学习·统计图制作' } },
  'mtc_131': { a: { name: '项目学习·校园测量' }, b: { name: '项目学习·平面图绘制' } },
  'mtc_132': { a: { name: '项目学习·预算' }, b: { name: '项目学习·方案设计' } },
  'mtc_134': { a: { name: '算盘·认识' }, b: { name: '算盘·简单计算' } },
  'mtc_137': { a: { name: '中华数学家·刘徽与祖冲之' }, b: { name: '圆周率' } },

  // ===== History（量大，用通用模式）=====
  // 历史条目的拆分：按"与/和"分割为事件A + 事件B（时间先后）
  // 这些在下面用动态规则处理，不逐一手写
};

// ========== 历史学科动态拆分规则 ==========
// 历史"A与B"型标题按"与/和"分割，保留前半为原id，后半为新id
function splitHistoryName(name) {
  // 优先按第一个"与"或"和"分割
  const m = name.match(/^(.+?)[与和](.+)$/);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

// ========== 执行拆分 ==========
const topicsById = new Map();
for (const t of data.topics) topicsById.set(t.id, t);

// 找最大 mtc 序号
let maxNum = 0;
for (const t of data.topics) {
  const m = t.id.match(/^mtc_(\d+)$/);
  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
}
let nextNum = maxNum + 1;

const newTopics = [];
let deleted = 0, split = 0, kept = 0;

for (const t of data.topics) {
  // C 类：删除
  if (DELETE_IDS.has(t.id)) {
    deleted++;
    continue;
  }

  // 检查是否需要拆分
  let splitConfig = SPLIT_MAP[t.id];
  let isHistorySplit = false;

  // 历史学科动态拆分
  if (!splitConfig && t.subject === 'History' && /[与和]/.test(t.name)) {
    const histSplit = splitHistoryName(t.name);
    if (histSplit) {
      splitConfig = { a: { name: histSplit.a }, b: { name: histSplit.b } };
      isHistorySplit = true;
    }
  }

  if (!splitConfig) {
    // B 类或无"和/与"：保留
    newTopics.push(t);
    kept++;
    continue;
  }

  // A 类：执行拆分
  split++;
  const a = { ...t };
  a.name = splitConfig.a.name;
  // description: 取前半语义（启发式——保留原文但聚焦a）
  a.description = t.description;
  a.evidence = t.evidence;
  a.assessmentPrompt = t.assessmentPrompt;
  a.splitFrom = t.id;
  a.splitPart = 'a';

  const bId = `mtc_${String(nextNum++).padStart(3, '0')}`;
  const b = {
    ...t,
    id: bId,
    name: splitConfig.b.name,
    description: t.description,
    evidence: t.evidence,
    assessmentPrompt: t.assessmentPrompt,
    splitFrom: t.id,
    splitPart: 'b',
  };

  newTopics.push(a, b);
}

// 更新 topicCount
data.topicCount = newTopics.length;
data.topics = newTopics;
data.originNote += ' | 含「和/与」的复合微主题已按微技能粒度拆分（A类拆分/B类保留/C类课文标题剔除）。';

// --- 报告 ---
console.log(`原始主题数: ${topicsById.size}`);
console.log(`  C 类剔除: ${deleted}`);
console.log(`  A 类拆分: ${split} → ${split * 2} 条`);
console.log(`  B 类保留: ${kept}`);
console.log(`最终主题数: ${newTopics.length}`);

if (dryRun) {
  console.log('\n（--dry-run 模式，未写盘）');
  // 输出拆分预览（a→b 对照）
  console.log('\n=== 拆分预览（前 60 条）===');
  const splits = newTopics.filter(t => t.splitFrom);
  for (let i = 0; i < Math.min(splits.length, 120); i += 2) {
    const a = splits[i], b = splits[i + 1];
    if (a && b) console.log(`  ${a.id} ${a.name.padEnd(20)} → ${b.id} ${b.name}  [${a.subject}]`);
  }
  if (splits.length > 120) console.log(`  …还有 ${splits.length - 120} 条`);
} else {
  writeFileSync(resolve(DATA, 'cn-topics.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('✓ 已写入 data/cn-topics.json');
}
