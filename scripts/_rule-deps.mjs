/**
 * _rule-deps.mjs — 跨 domain 先修链（规则层，L3）。
 *
 * 从 build-cn-dependencies.mjs 抽取，供 build-deps-llm.mjs 复用。
 * 已同步 domain 归一化：
 *   - AI → Artificial Intelligence
 *   - Technology & Design 1 → Technology & Design（分册合并）
 *   - Properties & Applications → Chemical Inquiry（孤儿桶已不存在，归并到探究类）
 *
 * 返回的边格式与 LLM 边一致：{ topicId, prerequisiteId, strength, reason }
 */

export const DOMAIN_PREREQ_CHAINS = {
  'Mathematics': [
    ['Number & Algebra', 'Equations & Inequalities'],
    ['Equations & Inequalities', 'Functions'],
    ['Functions', 'Mathematical Modeling'],
    ['Geometry & Shapes', 'Geometry & Algebra'],
    ['Number & Algebra', 'Probability & Statistics'],
    ['Preliminaries', 'Functions'],
  ],
  'Physics': [
    ['Kinematics', 'Dynamics'],
    ['Dynamics', 'Energy'],
    ['Heat & Thermodynamics', 'Energy'],
    ['Sound & Light', 'Electricity & Magnetism'],
    ['Mechanics', 'Curvilinear Motion & Gravitation'],
    ['Motion & Interaction', 'Energy'],
  ],
  'Chemistry': [
    ['Common Substances', 'Chemical Formulas & Calculations'],
    ['Chemical Formulas & Calculations', 'Chemical Changes'],
    ['Common Substances', 'Solutions'],
    ['Chemical Inquiry', 'Chemical Changes'], // 归一化: 原 Properties & Applications
    ['Composition & Structure', 'Structure & Reactions'],
  ],
  'Biology': [
    ['Cell Biology', 'Botany'],
    ['Cell Biology', 'Human Physiology'],
    ['Cell Biology', 'Heredity & Evolution'],
    ['Botany', 'Ecology'],
    ['Human Physiology', 'Ecology'],
    ['Microbiology', 'Ecology'],
    ['Biological Structure', 'Cell Biology'],
  ],
  'History': [
    ['Ancient Chinese History', 'Modern Chinese History'],
    ['Modern Chinese History', 'Contemporary Chinese History'],
    ['Ancient World History', 'Modern World History'],
    ['Chinese History', 'Modern Chinese History'],
  ],
  'Chinese': [
    ['Literacy & Handwriting', 'Reading & Appreciation'],
    ['Reading & Appreciation', 'Literary Reading'],
    ['Classical Chinese', 'Reading & Appreciation'],
    ['Classical Poetry', 'Classical Chinese'],
    ['Reading Materials', 'Literary Reading'],
    ['Expression & Communication', 'Writing'],
    ['Language Fundamentals', 'Writing'],
  ],
  'English': [
    ['Phonetics', 'Vocabulary'],
    ['Vocabulary', 'Grammar'],
    ['Grammar', 'Language Skills'],
    ['Language Skills', 'Integrated Language Use'],
    ['Language Knowledge', 'Integrated Language Use'],
  ],
  'Information Technology': [
    ['Data', 'Data Processing'],
    ['Data Processing', 'Data & Computing'],
    ['Algorithm', 'Data & Computing'],
    ['Internet & Innovation', 'Information Systems & Society'],
    ['Internet of Things', 'Artificial Intelligence'], // 归一化: AI
    ['Artificial Intelligence', 'Data & Computing'],
  ],
  'Geography': [
    ['Earth & Maps', 'World Geography'],
    ['Earth & Maps', 'Geography of China'],
    ['World Geography', 'Physical Geography'],
    ['Geography of China', 'Human Geography'],
    ['Physical Geography', 'Human Geography'],
  ],
  'Moral & Rule of Law': [
    ['Myself', 'Others & Community'],
    ['Others & Community', 'Society'],
    ['My Country', 'National Conditions'],
    ['Rule of Law', 'Traditional Culture'],
    ['Safety Education', 'Digital Citizenship'],
  ],
  'Politics': [
    ['Socialism with Chinese Characteristics', 'Economy & Society'],
    ['Economy & Society', 'Politics & Rule of Law'],
    ['Politics & Rule of Law', 'Philosophy & Culture'],
    ['International Relations', 'Philosophy & Culture'],
  ],
  'General Technology': [
    ['Design Process', 'Structure & Design'],
    ['Design Process', 'Process & Design'],
    ['Design Process', 'System & Design'],
    ['Design Process', 'Control & Design'],
    ['Electronic Technology', 'Robotics & AI'],
    ['Structure & Design', 'Technology & Design'], // 归一化: 原 Technology & Design 1
  ],
  'Science': [
    ['Human & Environment', 'Chinese Ecosystems'],
    ['Technology & Engineering', 'Human & Environment'],
  ],
  'PE & Health': [
    ['Fundamental Movement', 'Sport Skills'],
    ['Physical Fitness', 'Sport Skills'],
    ['Health Education', 'Cross-disciplinary'],
  ],
  'Art': [
    ['Appreciation', 'Performance'],
    ['Performance', 'Creation'],
    ['Appreciation', 'Connection & Integration'],
  ],
};

// ========== 学段判定（与 build-cn-dependencies.mjs 一致）==========
function getStage(ageStart) {
  if (ageStart <= 8) return 'primary';
  if (ageStart <= 10) return 'primary-mid';
  if (ageStart <= 12) return 'primary-hi';
  if (ageStart <= 15) return 'junior';
  return 'senior';
}
function stageLabel(s) {
  return { primary: '小学低段', 'primary-mid': '小学中段', 'primary-hi': '小学高段',
    junior: '初中', senior: '高中' }[s] || s;
}

/**
 * 第 1+2 层：桶内 ageRange 相邻链（同 subject|domain）。
 * 同学段相邻 → soft 渐进；跨学段相邻 → hard 进阶。
 * 这层是"教学顺序"边，与 LLM 的"语义先修"边互补：很多教学顺序（如笔画→偏旁）
 * 是真实先修，但 LLM 在跨窗口时可能漏判。
 */
export function buildAgeChainEdges(topics) {
  const groups = new Map();
  for (const t of topics) {
    const key = `${t.subject}|${t.domain}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.ageRangeStart || 0) - (b.ageRangeStart || 0)
      || (a.ageRangeEnd || 0) - (b.ageRangeEnd || 0));
  }

  const edges = [];
  const seen = new Set();
  const add = (topicId, prerequisiteId, strength, reason) => {
    if (topicId === prerequisiteId) return;
    const key = `${topicId}->${prerequisiteId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ topicId, prerequisiteId, strength, reason });
  };

  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    const [, domain] = key.split('|');
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const curr = arr[i];
      const prevStage = getStage(prev.ageRangeStart);
      const currStage = getStage(curr.ageRangeStart);
      if (prevStage === currStage) {
        add(curr.id, prev.id, 'soft', `${domain} 渐进：${prev.name} → ${curr.name}`);
      } else {
        add(curr.id, prev.id, 'hard',
          `${stageLabel(prevStage)}→${stageLabel(currStage)}：${prev.name} → ${curr.name}`);
      }
    }
  }
  return edges;
}

/**
 * 根据 DOMAIN_PREREQ_CHAINS 生成第 3 层：跨 domain 先修边。
 * @param {Array} topics - cn-topics.json 的 topics 数组
 * @returns {Array<{topicId, prerequisiteId, strength, reason}>}
 */
export function buildRuleEdges(topics) {
  // 按 subject|domain 分组，组内按 age 排序
  const groups = new Map();
  for (const t of topics) {
    const key = `${t.subject}|${t.domain}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.ageRangeStart || 0) - (b.ageRangeStart || 0));
  }

  const edges = [];
  const seen = new Set();
  const add = (topicId, prerequisiteId, strength, reason) => {
    if (topicId === prerequisiteId) return;
    const key = `${topicId}->${prerequisiteId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ topicId, prerequisiteId, strength, reason });
  };

  for (const [subject, chains] of Object.entries(DOMAIN_PREREQ_CHAINS)) {
    for (const [fromDomain, toDomain] of chains) {
      const fromTopics = groups.get(`${subject}|${fromDomain}`);
      const toTopics = groups.get(`${subject}|${toDomain}`);
      if (!fromTopics || !toTopics) continue;
      const fromBase = fromTopics[0];
      const toTarget = toTopics.find(t => t.ageRangeStart >= (fromBase.ageRangeEnd || 0))
        || toTopics[0];
      if (fromBase && toTarget && fromBase.id !== toTarget.id) {
        add(toTarget.id, fromBase.id, 'hard',
          `${fromDomain} 是 ${toDomain} 的先修：${fromBase.name} → ${toTarget.name}`);
      }
    }
  }
  return edges;
}
