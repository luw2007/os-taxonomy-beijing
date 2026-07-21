#!/usr/bin/env node
/**
 * reclassify-buckets.mjs — 清理 5 个"垃圾桶 domain"，配合 nodeKind 做精准重分类。
 *
 * 两类问题分开处理：
 *   1. concept/skill 垃圾桶（History/Chemistry/Moral）→ 按知识结构关键词重分类
 *   2. text 垃圾桶（Chinese/Reading Materials）→ 按课文文体细分
 *
 * 只改 domain 字段，不动 id/nodeKind/cnStandards/依赖。
 *   node scripts/reclassify-buckets.mjs            # 执行（写盘）
 *   node scripts/reclassify-buckets.mjs --dry-run  # 预览
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));
const domainsZh = JSON.parse(readFileSync(resolve(DATA, 'domains.zh.json'), 'utf8'));

// ========== 重分类规则 ==========
// 每个垃圾桶: { rules: [{match:[关键词], to:新domain}], fallback: 默认domain }
// match 按 name（+ description）判定，第一个命中即归类

const BUCKETS = {
  // --- concept/skill 垃圾桶 ---

  'History|Historical Thinking': {
    rules: [
      // 世界古代史
      { match: ['古埃及','古希腊','古罗马','罗马城邦','拜占庭','法兰克','中世纪','西欧','封建社会','中古','骑士','庄园','基督教','阿拉伯','日本大化','玛雅','印加','古代日本','古代非洲','古代西亚','古代埃及','古代战争'], to: 'Ancient World History' },
      // 世界近现代史
      { match: ['新航路','全球航路','文艺复兴','启蒙','资产阶级','工业革命','工业化国家','拿破仑','法国大革命','美国独立','美国内战','一战','第一次世界大战','凡尔赛','九国公约','二战','第二次世界大战','冷战','苏联','十月革命','国际共产','联合国','殖民','社会主义国家','东欧','经济全球化','多极化','信息时代','世贸','欧盟','罗斯福新政','亚非拉','俄国','资本主义国家','现代社会','和平发展合作','全球联系','现代交通运输','20世纪','现代战争','现代科技','现代食物','现代医疗','基层治理'], to: 'Modern World History' },
      // 中国近代（1840-1949）
      { match: ['鸦片','南京条约','太平天国','洋务','甲午','马关','戊戌','义和团','辛亥','中华民国','北洋','新文化','五四','中共','共产党','北伐','长征','九一八','西安','七七','抗日','抗战','解放','内战','延安','重庆谈判','井冈山','南京国民','挽救民族'], to: 'Modern Chinese History' },
      // 中国现代（1949-）
      { match: ['新中国','中华人民共和国','开国','土地改革','抗美援朝','一五计划','三大改造','大跃进','文化大革命','改革开放','经济体制','中国特色社会主义','中国梦','民族大团结','海峡两岸','一国两制','港澳','回归','外交','联合国','深圳','邓小平','市场经济','和谐社会','中国梦','一带一路','伟大的历史转折','对外开放','钢铁长城','科技文化','社会生活','社会变迁','民族政策','中国人民'], to: 'Contemporary Chinese History' },
      // 高中选修专题（文化/制度/经济史）— 跨地域的专题史
      { match: ['政治制度','文官制度','官员的选拔','法治','教化','民族关系','对外交往','货币','赋税','户籍','食物生产','食物采集','生产工具','村落','集镇','交通','疫病','文化遗产','传统文化','中华文化','世界意义','欧洲文化','南亚','东亚','人类的迁徙','文化传承'], to: 'Thematic History' },
      // 真正的"历史思维"（方法/通史/活动课）
      { match: ['活动课','感受历史','时间轴','年代','史料','通史','专题','历史地图','计算年代'], to: 'Historical Thinking' },
    ],
    fallback: 'Historical Thinking',
  },

  'Chemistry|Common Substances': {
    rules: [
      { match: ['空气','氧气','氧','氮','稀有气体'], to: 'Air & Oxygen' },
      { match: ['水','氢','净化','爱护水'], to: 'Water & Hydrogen' },
      { match: ['碳','二氧化碳','一氧化碳','金刚石','石墨','C60','化石燃料','煤','石油','天然气','硫的转化'], to: 'Carbon & Fuels' },
      { match: ['金属','合金','铁','铜','铝','锌','锈蚀','金属活动性','矿物','冶炼','金属材料','金为材料'], to: 'Metals' },
      { match: ['酸','碱','盐','中和','复分解','化肥','pH','指示剂','盐酸','硫酸','氢氧化钠','氢氧化钙','碳酸钠','碳酸氢钠'], to: 'Acids Bases & Salts' },
      { match: ['燃烧','灭火','爆炸','燃料','能源','化学能','电池','电解','环保','营养物质','有机合成材料','合成材料','塑料'], to: 'Combustion & Energy' },
      // 高中化学：物质结构/反应原理
      { match: ['原子结构','元素','元素性质','物质构成','化学键','共价键','分子间作用力','晶体','液晶','周期律','核外电子'], to: 'Composition & Structure' },
      { match: ['化学反应','反应速率','化学平衡','反应条件','工业合成氨','离子反应','氧化还原','电离'], to: 'Chemical Reactions' },
      // 高中化学：有机化学
      { match: ['有机','醇','酚','醛','酮','羧酸','酯','糖类','蛋白质','氨基酸','高分子','有机合成','有机化合物'], to: 'Organic Chemistry' },
      // 化学实验方法/绪论
      { match: ['实验','实验室','走进化学','研究物质','物理量','化学中常用'], to: 'Chemical Inquiry' },
    ],
    fallback: 'Common Substances',
  },

  'Moral & Rule of Law|Safety Education': {
    rules: [
      { match: ['青春期','发育','月经','遗精','变声','痤疮','生理'], to: 'Adolescent Health' },
      { match: ['心理','情绪','焦虑','压力','自卑','逆反','抑郁','沟通','人际','挫折','自信心'], to: 'Mental Health' },
      { match: ['网络','上网','沉迷','游戏','数字','信息','隐私','诈骗'], to: 'Digital Citizenship' },
      { match: ['安全','侵害','求助','报警','防灾','地震','火灾','溺水','交通','欺凌','拐骗','脱身','毒品','烟酒'], to: 'Safety Education' },
    ],
    fallback: 'Safety Education',
  },

  // --- text 垃圾桶（Chinese 课文文体细分）---

  'Chinese|Reading Materials': {
    textOnly: true, // 只对 nodeKind=text 的节点应用
    rules: [
      // 古诗词（词牌名 + 诗词特征）
      { match: ['沁园春','念奴娇','短歌行','梦游天姥','蜀道难','琵琶行','长恨歌','将进酒','水调歌头','声声慢','醉花阴','雨霖铃','虞美人','相见欢','浪淘沙','渔家傲','江城子','破阵子','满江红','蝶恋花','钗头凤','卜算子','诉衷情','青玉案','贺新郎','水龙吟','永遇乐','扬州慢','阁夜','登高','锦瑟','马嵬','李凭箜篌','过华清','书愤','临安','古诗','古代诗歌','诗词','律诗','绝句','曲','诗经','词','陌上桑','孔雀东南飞','蜀相','归园田','饮酒','读山海经','登幽州','春江花月夜','望岳','茅屋','石壕吏','卖炭翁','赤壁赋','木兰诗','唐诗','词四首','短诗','外国诗','望海潮','梅岭三章','我爱这土地','乡愁','你是人间的四月天','祖国啊','大堰河','海燕','周总理','我看','迷娘'], to: 'Classical Poetry' },
      // 文言文（诸子百家 + 经典篇目）
      { match: ['《论语》','《孟子》','《庄子》','《荀子》','《礼记》','《左传》','《史记》','《战国策》','《资治通鉴》','《世说新语》','《列子》','《韩非子》','《老子》','《墨子》','劝学','师说','逍遥游','秋水','寡人之于国','生于忧患','鱼我所欲也','富贵不能淫','得道多助','诫子书','出师表','陈情表','兰亭集序','桃花源记','五柳先生传','归去来兮辞','滕王阁序','陋室铭','爱莲说','岳阳楼记','醉翁亭记','卖油翁','陋室','小石潭记','石钟山记','赤壁赋','六国论','过秦论','阿房宫赋','谏太宗','谏逐客书','与朱元思书','答谢中书','三峡','送董邵南','杂说','马说','师说','祭十二郎','祭妹文','项脊轩志','促织','狼','愚公移山','曹刿论战','邹忌讽齐王纳谏','唐雎','陈涉世家','鸿门宴','廉颇蔺相如','管仲','子路曾皙','侍坐','逍遥游','孝经','大学','中庸','送东阳马生序','核舟记','周亚夫军细柳','活板','湖心亭看雪','屈原列传','苏武传','兼爱','烛之武退秦师','种树郭橐驼传','屈原'], to: 'Classical Chinese' },
      // 小说/叙事/童话/寓言/戏剧
      { match: ['从百草园到三味书屋','皇帝的新装','猫','动物笑谈','寓言','女娲','天上的街市','变色龙','我的叔叔于勒','威尼斯商人','哈姆雷特','罗密欧','窦娥','雷雨','茶馆','哈姆莱特','麦琪的礼物','最后的常春藤','荷花淀','小二黑结婚','百合花','哦香雪','项链','装在套子里','变形记','百年孤独','复活','简·爱','飘','老人与海','故乡','社戏','孔乙己','药','祝福','骆驼祥子','边城','围城','红岩','创业史','平凡的世界','白鹿原','呐喊','彷徨','城南旧事','孤独之旅','智取生辰纲','范进中举','三顾茅庐','刘姥姥','蒲柳人家','溜索','大卫·科波菲尔','阿Q正传','玩偶之家','枣儿','天下第一楼','屈原','智取','勾践','林教头','风雪山神庙'], to: 'Fiction & Narrative' },
      // 议论文/论述
      { match: ['纪念白求恩','敬业与乐业','拿来主义','反对党八股','怀疑与学问','谈骨气','想和做','应有格物致知','事物的正确答案','中国人失掉自信力','纪念刘和珍','读书','论教养','精神的三间小屋','写一遍','为自己减负','敬业','谈创造性','创造宣言','最后一次讲演','庆祝奥林匹克','我一生中的重要抉择','就英法联军','说"木叶"','无言之美','驱遣我们的想象','山水画的意境','在《人民报》','社会历史的决定性','改造我们的学习','实践是检验','修辞立其诚','人应当坚持正义','以工匠精神','说和做'], to: 'Argumentative Writing' },
      // 实用文/报告/新闻/书信/演讲
      { match: ['邓稼先','谁是最可爱的人','黄河颂','土地的誓言','回忆鲁迅','叶圣陶','驿路梨花','最苦与最乐','阿长','背影','老王','台阶','卖蟹','新闻','通讯','报告','传记','书信','演讲','倡议书','调查报告','申请书','消息二则','诺贝尔','飞天','凌空','一着惊海天','首届','人民英雄','中国石拱桥','苏州园林','梦回繁华','蝉','太空一日','带上她的眼睛','伟大的悲剧','列夫·托尔斯泰','美丽的颜色','回忆我的母亲','藤野先生','再塑生命','大自然','阿西莫夫','大雁归来','时间的脚印','安塞腰鼓','灯笼','回延安','壶口瀑布','各拉丹冬','登勃朗峰','一滴水','中国人民站起来了','长征胜利','别了','不列颠尼亚','民族复兴','青蒿素','中国建筑','喜看稻菽','大卫','自然选择的证明','天文学','包身工','说"木叶'], to: 'Practical Texts' },
      // 现代散文/抒情
      { match: ['春','济南的冬天','雨的四季','秋天的怀念','散步','散文','紫藤萝','一棵小桃树','荷叶','白杨礼赞','故都的秋','荷塘月色','绿','浆声灯影','听泉','风景谈','包身工','风景','记','忆','我的母亲','怀念','母亲','藤野先生','再塑生命','我的四季','那树','地下森林','人生','日','月','星','雪','风','雨','光','花','叶','春','夏','秋','冬','短文两篇','短文二篇','白杨','昆明','延安','腰鼓','消逝了的山村','一个消逝','立在地球边上'], to: 'Modern Prose' },
    ],
    fallback: 'Reading Materials',
  },
};

// ========== 新 domain 的中英文映射 ==========
const NEW_DOMAIN_ZH = {
  'Air & Oxygen': '空气与氧气',
  'Water & Hydrogen': '水与氢',
  'Carbon & Fuels': '碳与燃料',
  'Metals': '金属',
  'Acids Bases & Salts': '酸碱盐',
  'Combustion & Energy': '燃烧与能源',
  'Composition & Structure': '组成与结构',
  'Chemical Reactions': '化学反应原理',
  'Organic Chemistry': '有机化学',
  'Chemical Inquiry': '化学实验与探究',
  'Ancient World History': '世界古代史',
  'Modern World History': '世界近现代史',
  'Modern Chinese History': '中国近代史',
  'Contemporary Chinese History': '中国现代史',
  'Thematic History': '专题史',
  'Adolescent Health': '青春期健康',
  'Mental Health': '心理健康',
  'Digital Citizenship': '数字公民',
  'Modern Prose': '现代散文',
  'Fiction & Narrative': '小说与叙事',
  'Argumentative Writing': '议论文',
  'Practical Texts': '实用文',
};

// ========== 执行 ==========
const stats = {};
const newPairs = new Set();

for (const t of data.topics) {
  const key = `${t.subject}|${t.domain}`;
  const bucket = BUCKETS[key];
  if (!bucket) continue;

  // text 垃圾桶只处理 nodeKind=text
  if (bucket.textOnly && t.nodeKind !== 'text') continue;

  const text = t.name + ' ' + (t.description || '');
  let newDomain = bucket.fallback;
  for (const rule of bucket.rules) {
    if (rule.match.some(kw => text.includes(kw))) {
      newDomain = rule.to;
      break;
    }
  }

  t.domain = newDomain;
  stats[newDomain] = (stats[newDomain] || 0) + 1;
  newPairs.add(`${t.subject} / ${newDomain}`);
}

// 更新 domains.zh.json
for (const pair of newPairs) {
  const dom = pair.split(' / ')[1];
  if (!domainsZh.domains[pair]) {
    domainsZh.domains[pair] = NEW_DOMAIN_ZH[dom] || dom;
  }
}

// ========== 报告 ==========
console.log('=== 重分类结果 ===');
for (const [dom, c] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${dom}: ${c}`);
}
const total = Object.values(stats).reduce((a, b) => a + b, 0);
console.log(`  合计重分类: ${total} 条`);

// 验证垃圾桶是否消失
console.log('\n=== 重分类后垃圾桶检查 ===');
const bucketNames = ['Reading Materials', 'Historical Thinking', 'Common Substances'];
const remain = {};
for (const t of data.topics) {
  if (bucketNames.includes(t.domain) || (t.subject === 'History' && t.domain === 'Ancient Chinese History')) {
    const k = `${t.subject}/${t.domain}`;
    remain[k] = (remain[k] || 0) + 1;
  }
}
if (Object.keys(remain).length === 0) {
  console.log('  ✓ 垃圾桶全部清理');
} else {
  console.log('  剩余（合理保留的 fallback）:');
  for (const [k, c] of Object.entries(remain)) console.log(`    ${k}: ${c}`);
}

if (dryRun) {
  console.log('\n（--dry-run 模式，未写盘）');
} else {
  writeFileSync(resolve(DATA, 'cn-topics.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(DATA, 'domains.zh.json'), JSON.stringify(domainsZh, null, 2) + '\n', 'utf8');
  console.log('\n✓ 已写入 data/cn-topics.json + data/domains.zh.json');
}
