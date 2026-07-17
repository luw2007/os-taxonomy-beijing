#!/usr/bin/env node
/**
 * reclassify-domains.mjs — 将"垃圾桶 domain"下的主题按知识结构重新归类。
 *
 * 8 个垃圾桶 domain（条数>50 且 domain 名无意义）：
 *   Chinese/Reading, History/History, Chemistry/Properties & Applications,
 *   Physics/Motion & Interaction, General Tech/Technology & Design,
 *   Biology/Life Science, Moral/Life & Safety, Politics/Politics
 *
 * 每个学科定义关键词 → domain 的映射规则，按 name 自动归类。
 *   node scripts/reclassify-domains.mjs            # 执行（写盘）
 *   node scripts/reclassify-domains.mjs --dry-run  # 预览
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));

// ========== 重分类规则 ==========
// 每条: { match: [关键词数组], to: "新domain英文名" }
// 按 match 顺序判定，第一个命中即归类；都不命中走 fallback

const RULES = {
  // Chinese/Reading → 按文体
  'Chinese|Reading': {
    rules: [
      { match: ['古诗', '诗词', '曲', '古代诗歌', '律诗', '绝句'], to: 'Classical Poetry' },
      { match: ['文言', '实词', '虚词', '《论语》', '《世说', '《孟子》', '《庄子》', '《礼记》', '《诗经》', '诫子书', '卖油翁', '狼', '愚公', '孙权', '《列子》'], to: 'Classical Chinese' },
      { match: ['名著', '整本书'], to: 'Whole-book Reading' },
      { match: ['说明文', '说明', '新闻', '传记', '书信', '实用文'], to: 'Practical Reading' },
      { match: ['议论文', '论述', '论证', '观点', '说服'], to: 'Critical Reading' },
      { match: ['散文', '小说', '戏剧', '诗歌', '记叙', '抒情', '文学阅读', '人物形象', '情节', '环境描写'], to: 'Literary Reading' },
    ],
    fallback: 'Reading Materials',
  },

  // History/History → 按时段地域
  'History|History': {
    rules: [
      // 世界史优先（避免"中国"和"世界古代"冲突）
      { match: ['古埃及', '古希腊', '古罗马', '拜占庭', '法兰克', '中世纪', '西欧', '骑士', '城堡', '玛雅', '印加'], to: 'Ancient World History' },
      { match: ['工业革命', '资产阶级', '文艺复兴', '启蒙', '拿破仑', '法国大革命', '美国独立', '一战', '第一次世界大战', '二战', '第二次世界大战', '冷战', '苏联', '十月革命', '联合国', '殖民', '全球化', '多极化', '经济全球化'], to: 'Modern World History' },
      // 中国近代（1840-1949）
      { match: ['鸦片', '辛亥', '民国', '近代', '侵略', '抗日', '甲午', '戊戌', '太平天国', '义和团', '北洋', '军阀', '北伐', '长征', '解放战争', '南京条约', '马关条约', '辛丑', '五四'], to: 'Modern Chinese History' },
      // 中国现代（1949-）
      { match: ['新中国', '中华人民共和国', '改革开放', '社会主义建设', '一五计划', '土地改革', '抗美援朝', '文化大革命', '邓小平', '市场经济', '一国两制', '港澳', '回归祖国', '深圳', '特区的'], to: 'Contemporary Chinese History' },
      // 中国古代
      { match: ['先秦', '夏', '商', '周', '秦', '汉', '三国', '晋', '南北朝', '隋', '唐', '宋', '辽', '金', '元', '明', '清', '北京人', '早期人类', '丝绸之路', '运河', '科举', '变法', '分封', '郡县', '诸子', '百家', '青铜', '甲骨', '禅让', '世袭'], to: 'Ancient Chinese History' },
      // 通史/专题/方法
      { match: ['通史', '专题', '史料', '年代', '时间轴', '活动课', '感受历史', '节日'], to: 'Historical Thinking' },
    ],
    fallback: 'Historical Thinking',
  },

  // Physics/Motion & Interaction → 按板块
  'Physics|Motion & Interaction': {
    rules: [
      { match: ['电', '电路', '电流', '电压', '电阻', '磁', '电磁', '电场', '电势', '电荷', '欧姆', '安培', '洛伦兹', '感应', '发电机', '电动机'], to: 'Electricity & Magnetism' },
      { match: ['热', '温度', '内能', '比热', '热量', '熔化', '凝固', '汽化', '液化', '升华', '凝华', '物态', '沸腾', '蒸发'], to: 'Heat & Thermodynamics' },
      { match: ['声', '光', '反射', '折射', '透镜', '成像', '色散', '噪声', '眼睛', '眼镜', '显微镜', '望远镜'], to: 'Sound & Light' },
      { match: ['力', '牛顿', '摩擦', '重力', '弹力', '压强', '浮力', '杠杆', '滑轮', '功', '功率', '机械', '能', '动量', '冲量'], to: 'Dynamics' },
      { match: ['运动', '速度', '加速度', '路程', '位移', '匀速', '变速', '参照物', '质点'], to: 'Kinematics' },
    ],
    fallback: 'Motion & Interaction',
  },

  // Chemistry/Properties & Applications → 按板块
  'Chemistry|Properties & Applications': {
    rules: [
      { match: ['溶液', '溶解', '溶质', '溶剂', '稀释', '浓度', '饱和'], to: 'Solutions' },
      { match: ['化学式', '化合价', '方程式', '计算', '配平', '质量守恒', '相对分子', '摩尔'], to: 'Chemical Formulas & Calculations' },
      { match: ['空气', '氧', '碳', '水', '金属', '酸', '碱', '盐', '燃烧', '灭火', '燃料', '化肥', '有机', '乙醇', '甲烷'], to: 'Common Substances' },
    ],
    fallback: 'Common Substances',
  },

  // Biology/Life Science → 按板块
  'Biology|Life Science': {
    rules: [
      { match: ['细胞', '显微', '分裂', '分化', '组织', '器官', '系统', '膜', '细胞器', '细胞核', 'DNA', 'RNA', '蛋白质', '酶', 'ATP', '光合', '呼吸作用'], to: 'Cell Biology' },
      { match: ['植物', '光合', '根', '茎', '叶', '花', '果', '种子', '蒸腾', '吸收', '营养', '被子', '裸子', '蕨'], to: 'Botany' },
      { match: ['人体', '消化', '呼吸', '循环', '泌尿', '神经', '内分泌', '激素', '免疫', '骨骼', '肌肉', '血液', '心脏'], to: 'Human Physiology' },
      { match: ['生态', '食物链', '环境', '群落', '种群', '生物圈', '多样性', '栖息', '适应性'], to: 'Ecology' },
      { match: ['细菌', '真菌', '病毒', '微生物', '发酵'], to: 'Microbiology' },
    ],
    fallback: 'Cell Biology',
  },

  // General Tech/Technology & Design → 按模块（含已有 domain）
  'General Technology|Technology & Design': {
    rules: [
      { match: ['结构', '强度', '稳定', '承载力'], to: 'Structure & Design' },
      { match: ['流程', '工序', '优化', '工艺'], to: 'Process & Design' },
      { match: ['系统', '子系统', '整体', '要素', '层次'], to: 'System & Design' },
      { match: ['控制', '反馈', '开环', '闭环', '传感', '自动'], to: 'Control & Design' },
      { match: ['设计', '发现', '明确', '方案', '测试', '评估', '评价', '人机', '三视图', '草图', '建模', '仿真'], to: 'Design Process' },
      { match: ['电子', '电路', '晶体管', '信号', '继电器', '门电路'], to: 'Electronic Technology' },
      { match: ['机器人', '传感', '路径', '运动控制', '智能', '编程'], to: 'Robotics & AI' },
      { match: ['3D', '打印', '扫描', '切片', '建模', '快速成型', '组合模型'], to: 'Digital Fabrication' },
      { match: ['建筑', '结构', '家居', '窗帘', '木工', '金工'], to: 'Practical Technology' },
    ],
    fallback: 'Technology & Design',
  },

  // Moral/Life & Safety → 按主题
  'Moral & Rule of Law|Life & Safety': {
    rules: [
      { match: ['青春期', '生理', '发育', '月经', '遗精', '变声', '痤疮'], to: 'Adolescent Health' },
      { match: ['心理', '情绪', '焦虑', '压力', '自卑', '逆反', '抑郁', '沟通', '人际'], to: 'Mental Health' },
      { match: ['安全', '侵害', '求助', '报警', '防灾', '地震', '火灾', '溺水', '交通', '欺凌', '拐骗', '脱身'], to: 'Safety Education' },
      { match: ['网络', '上网', '信息', '诈骗', '沉迷', '隐私', '数字'], to: 'Digital Citizenship' },
    ],
    fallback: 'Safety Education',
  },

  // Politics/Politics → 按必修模块
  'Politics|Politics': {
    rules: [
      { match: ['中国特色社会主义', '社会主义', '改革开放', '新时代', '伟大复兴', '科学发展'], to: 'Socialism with Chinese Characteristics' },
      { match: ['经济', '市场', '分配', '社保', '就业', '消费', '生产', '我国的经济'], to: 'Economy & Society' },
      { match: ['法治', '权利', '合同', '侵权', '婚姻', '继承', '劳动', '公证', '诉讼', '仲裁', '人大', '政府', '法院'], to: 'Politics & Rule of Law' },
      { match: ['哲学', '唯物', '辩证', '认识', '文化', '矛盾', '规律', '价值', '真理', '实践'], to: 'Philosophy & Culture' },
      { match: ['国际', '外交', '联合国', '世贸', '主权', '和平', '发展', '共同体'], to: 'International Relations' },
    ],
    fallback: 'Politics & Rule of Law',
  },
};

// ========== 执行重分类 ==========
const stats = {};
const newDomainPairs = new Set(); // 记录新出现的 subject/domain 对

for (const t of data.topics) {
  const key = `${t.subject}|${t.domain}`;
  const ruleSet = RULES[key];
  if (!ruleSet) continue; // 不在垃圾桶里，跳过

  const text = t.name + ' ' + (t.description || '');
  let newDomain = ruleSet.fallback;
  for (const rule of ruleSet.rules) {
    if (rule.match.some(kw => text.includes(kw))) {
      newDomain = rule.to;
      break;
    }
  }

  const oldDomain = t.domain;
  t.domain = newDomain;
  stats[newDomain] = (stats[newDomain] || 0) + 1;
  newDomainPairs.add(`${t.subject} / ${newDomain}`);
}

// --- 更新 domains.zh.json ---
const domainsZh = JSON.parse(readFileSync(resolve(DATA, 'domains.zh.json'), 'utf8'));
const DOMAIN_ZH_MAP = {
  'Literary Reading': '文学阅读',
  'Reading Materials': '阅读材料',
  'Practical Reading': '实用文阅读',
  'Critical Reading': '思辨性阅读',
  'Ancient World History': '世界古代史',
  'Modern World History': '世界近现代史',
  'Modern Chinese History': '中国近代史',
  'Contemporary Chinese History': '中国现代史',
  'Historical Thinking': '历史思维',
  'Kinematics': '运动学',
  'Dynamics': '动力学',
  'Sound & Light': '声与光',
  'Heat & Thermodynamics': '热学与热力学',
  'Electricity & Magnetism': '电磁学',
  'Common Substances': '常见物质',
  'Solutions': '溶液',
  'Chemical Formulas & Calculations': '化学式与计算',
  'Cell Biology': '细胞生物学',
  'Botany': '植物学',
  'Ecology': '生态学',
  'Microbiology': '微生物学',
  'Design Process': '设计过程',
  'Electronic Technology': '电子技术',
  'Robotics & AI': '机器人与人工智能',
  'Digital Fabrication': '数字制造',
  'Practical Technology': '实践技术',
  'Adolescent Health': '青春期健康',
  'Mental Health': '心理健康',
  'Safety Education': '安全教育',
  'Digital Citizenship': '数字公民',
  'International Relations': '国际关系',
};

for (const pair of newDomainPairs) {
  const [subj, dom] = pair.split(' / ');
  if (!domainsZh.domains[pair]) {
    domainsZh.domains[pair] = DOMAIN_ZH_MAP[dom] || dom;
  }
}

// --- 报告 ---
console.log('=== domain 重分类结果 ===');
for (const [dom, c] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${dom}: ${c}`);
}
console.log(`  合计重分类: ${Object.values(stats).reduce((a, b) => a + b, 0)} 条`);

if (dryRun) {
  console.log('\n（--dry-run 模式，未写盘）');
} else {
  writeFileSync(resolve(DATA, 'cn-topics.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(DATA, 'domains.zh.json'), JSON.stringify(domainsZh, null, 2) + '\n', 'utf8');
  console.log('✓ 已写入 data/cn-topics.json + data/domains.zh.json');
}
