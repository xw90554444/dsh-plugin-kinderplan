/**
 * The phrase library (词库).
 *
 * A kindergarten plan is 80% reused sentences: the same 安全教育 phrasings, the
 * same 趣味游戏 names with their 锻炼 goal, the same room names for 下午
 * activities. The seeded entries below were harvested from the uploaded plans,
 * so "复用常用句式" starts from the school's own wording rather than a generic
 * template, and `learnFromPlan` keeps topping it up as more plans are imported.
 */

const item = (text, tags = []) => ({ text: String(text).trim(), tags })

/**
 * Categories the editor and the agent tools address by key.
 * `perDay` marks a category whose entries fill a Monday-Friday row.
 */
export const CATEGORIES = Object.freeze([
  { key: 'focus.regular', label: '常规（生活）培养', hint: '周计划「周工作重点」第 1 行', slot: 'weekly.focus.regular' },
  { key: 'focus.moral', label: '德育教育', hint: '周计划「周工作重点」第 2 行', slot: 'weekly.focus.moral' },
  { key: 'focus.safety', label: '安全工作', hint: '周计划「周工作重点」第 3 行', slot: 'weekly.focus.safety' },
  { key: 'focus.family', label: '家园共育', hint: '周计划「周工作重点」第 4 行', slot: 'weekly.focus.family' },
  { key: 'games.morning', label: '晨间趣味游戏', hint: '周计划「游戏活动 · 晨间」', slot: 'weekly.games.morning', perDay: true },
  { key: 'games.afternoon', label: '下午活动场地', hint: '周计划「游戏活动 · 下午」', slot: 'weekly.games.afternoon', perDay: true },
  { key: 'games.walk', label: '散步内容', hint: '周计划「游戏活动 · 散步」', slot: 'weekly.games.walk' },
  { key: 'games.indoor', label: '室内自主游戏 / 材料填充', hint: '周计划「游戏活动 · 室内自主游戏」', slot: 'weekly.games.indoor' },
  { key: 'month.outdoor', label: '户外活动', hint: '月计划「户外活动」', slot: 'month.blocks.outdoor' },
  { key: 'month.dismissal', label: '离园活动', hint: '月计划「离园活动」', slot: 'month.blocks.dismissal' },
  { key: 'month.family', label: '家园共育（月）', hint: '月计划「家园共育」', slot: 'month.blocks.family' },
  { key: 'month.corner', label: '环境区角', hint: '月计划「环境区角」', slot: 'month.blocks.corner' },
])

const SEED = {
  'focus.regular': [
    '巩固大班一日生活常规，加强幼儿规则意识、任务意识、时间观念。',
    '强化课堂学习常规，培养幼儿专注倾听、举手发言、端正坐姿的良好学习习惯。',
    '能够独立整理衣物、餐具、学习用品，物品摆放整齐、用完归位。',
    '根据季节与气温变化，自主及时增减衣物，主动勤洗手、多喝温水。',
    '巩固良好的进餐、盥洗、午睡习惯，做到有序入厕、安静入睡。',
    '游戏结束主动整理操作材料，遵守值日生职责，改正拖拉散漫现象。',
  ],
  'focus.moral': [
    '渗透文明礼仪教育，引导幼儿主动问好、礼貌待人、团结同伴、懂得谦让分享。',
    '培养幼儿责任心与集体荣誉感，爱护公物、保持班级整洁。',
    '引导幼儿友好交往，学会协商合作，能够正确处理同伴矛盾，不争吵、不打闹。',
    '愿意大胆展示自己的本领，树立自信心，懂得欣赏同伴的长处。',
    '懂得珍惜粮食，知道秋天是丰收的季节，懂得农作物来之不易。',
    '感受季节的美景，热爱大自然，愿意观察花草树木的变化。',
  ],
  'focus.safety': [
    '加强日常活动安全，游戏时懂得避让，防止奔跑磕碰、推挤受伤。',
    '引导幼儿正确使用剪刀、铅笔等文具，杜绝拿尖锐物品嬉戏打闹。',
    '强化物品使用安全，不将细小物品塞入口鼻耳，提高自我保护意识。',
    '上下楼梯有序靠右行走，不攀爬栏杆、不追逐打闹。',
    '开展防火、防溺水安全教育，不玩火，不到危险水边玩耍。',
    '做好传染病预防安全教育，勤洗手，不捡地上的野果落叶放入口中。',
  ],
  'focus.family': [
    '请家长配合调整幼儿作息时间，坚持准时入园，不迟到、不早退。',
    '在家减少包办代替，鼓励幼儿自主整理书包、衣物、玩具，强化任务意识。',
    '坚持亲子阅读、亲子陪伴、体能练习，稳步提升幼儿专注力与自理能力。',
    '季节温差较大，请家长及时为幼儿增减衣物，多饮水、勤洗手，做好防病。',
  ],
  'games.morning': [
    '趣味游戏：\n《彩虹伞海浪跑》\n（锻炼跑动节奏）',
    '趣味游戏：\n《小球接力投篮》\n（锻炼上肢投掷）',
    '趣味游戏：\n钻山洞大冒险（锻炼身体柔韧）',
    '趣味游戏：\n《轮胎闯关行》（锻炼下肢力量）',
    '趣味游戏：\n《两人三足协作跑》\n（培养合作默契）',
    '趣味游戏：\n《沙包投掷大比拼》\n（锻炼上肢力量）',
    '趣味游戏：\n《袋鼠跳跳乐》\n（锻炼下肢爆发力）',
    '趣味游戏：\n《平衡木小勇士》\n（锻炼平衡能力）',
    '趣味游戏：\n《趣味跨栏跑》\n（可调跨栏架）',
    '趣味游戏：\n《运小球接力》\n（锻炼精细控制）',
  ],
  'games.afternoon': [
    '美术馆', '沙池', '积木墙', '涂鸦区', '绘本馆', '南瓜屋',
    '多功能厅（北）', '轮胎区', '机器人管', '机械人管', '建筑管',
    '小型滑滑梯（操场）', '内庭滑滑梯（西）', '自评活动',
  ],
  'games.walk': ['音乐/绘本/朗诵'],
  'games.indoor': [
    ' 1.茶艺区让小朋友知道怎么泡茶。2图书区锻炼孩子表达的能力。',
    ' 1.益智区投放拼图、逻辑思维类玩具。 2图书区小朋友具有讲故事的能力。',
    ' 1.美工区投放线描、剪贴材料。2.建构区补充积木与拼插材料。',
  ],
  'month.outdoor': [
    '徒手操：早操\n体能训练：整合跳、跑、钻、爬、投、平衡多项动作，全面提升幼儿综合体能与意志力，适配幼小衔接体能标准。\n户外游戏：《跳绳小达人》《超级拍球闯关》《极速障碍接力赛》《小小投弹手》《呼啦圈大闯关》《勇敢者平衡路》等等',
  ],
  'month.dismissal': [
    '整理幼儿个人卫生：清洁面部、入厕，整理幼儿个人物品。\n回忆一天的美好时光。\n1530安全活动\n4、欢送幼儿离园。',
  ],
  'month.family': [
    '科学育儿：1. 培养自律习惯：坚持规律作息，早睡早起，杜绝拖延赖床，提前适应小学作息模式，培养幼儿时间观念。\n2. 放手自主成长：在家减少包办代替，鼓励幼儿自主整理书包、衣物、玩具，独立完成力所能及的家务与小任务，强化任务意识。\n3. 重视习惯大于知识：重点培养幼儿专注倾听、坚持做事、认真细致的学习品质，为幼小衔接打下扎实的基础。\n温馨提示：1. 季节温差较大，请家长及时为幼儿增减衣物，预防感冒，多饮水、勤洗手。\n2. 坚持准时送幼儿入园，不迟到、不早退，帮助幼儿建立良好的规则意识。',
  ],
  'month.corner': [
    '环创：结合季节主题与幼小衔接重点，更新班级主题墙面、区角标识与作品展示栏。墙面增设规则图示、操作步骤图、幼儿作品、探究记录，做到环境可视化、教育化、动态化。\n区域材料投放：\n1. 阅读语言区：投放主题绘本、看图讲述卡、故事续编素材，鼓励幼儿大胆表达、自主阅读。\n2. 益智数学区：投放排序、配对、数物对应、钟表认知、简单推理材料，提升幼儿逻辑思维。\n3. 建构区：补充积木、拼插材料、建筑参考图，支持幼儿合作搭建、创意建构。\n4. 美工区：投放线描、剪贴、黏土、废旧材料，锻炼幼儿精细动作与创意创作能力。\n5. 图书区：爱护书籍，热爱看书。',
  ],
}

/** Stable id from the text, so re-importing the same phrase does not duplicate it. */
export function itemId(text) {
  let hash = 5381
  const value = String(text).trim()
  for (let i = 0; i < value.length; i += 1) hash = (((hash << 5) + hash) + value.charCodeAt(i)) >>> 0
  return `p${hash.toString(36)}`
}

const normaliseItems = (items, origin) => {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(items) ? items : []) {
    const text = String(raw?.text ?? raw ?? '').trim()
    if (!text) continue
    const id = itemId(text)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, text, tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [], origin: raw?.origin ?? origin, uses: Number(raw?.uses) || 0 })
  }
  return out
}

/** Build the default library: seeded phrases first, then anything the user added. */
export function defaultLexicon() {
  const categories = {}
  for (const category of CATEGORIES) {
    const seeded = normaliseItems(SEED[category.key] ?? [], 'seed')
    categories[category.key] = { ...category, items: seeded }
  }
  return { version: 1, categories, updatedAt: new Date().toISOString() }
}

/** Coerce anything read from disk into a complete library (seeds always present). */
export function normaliseLexicon(raw) {
  const base = defaultLexicon()
  const stored = raw && typeof raw === 'object' && raw.categories ? raw.categories : {}
  for (const category of CATEGORIES) {
    const mine = normaliseItems(stored[category.key]?.items ?? [], 'user')
    const have = new Set(base.categories[category.key].items.map((i) => i.id))
    // A user entry with the same text as a seed keeps the user's tags and the
    // seed's position; either way the phrase appears exactly once.
    for (const entry of mine) {
      if (have.has(entry.id)) {
        const existing = base.categories[category.key].items.find((i) => i.id === entry.id)
        if (existing) { existing.uses = entry.uses; existing.origin = 'both' }
      } else {
        base.categories[category.key].items.push(entry)
      }
    }
  }
  base.updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  return base
}

/** Add a phrase. Returns the item, or the existing one when the text is a repeat. */
export function addItem(lexicon, categoryKey, text, tags = []) {
  const category = lexicon.categories[categoryKey]
  if (!category) throw new Error(`未知词库分类：${categoryKey}`)
  const clean = String(text ?? '').trim()
  if (!clean) throw new Error('词组不能为空')
  const id = itemId(clean)
  const existing = category.items.find((i) => i.id === id)
  if (existing) return existing
  const created = { id, text: clean, tags: tags.map(String), origin: 'user', uses: 0 }
  category.items.unshift(created)
  lexicon.updatedAt = new Date().toISOString()
  return created
}

export function removeItem(lexicon, categoryKey, id) {
  const category = lexicon.categories[categoryKey]
  if (!category) return false
  const before = category.items.length
  // Seeded phrases are the baseline spelling of the school's own wording, so a
  // removal is honoured for this session but the seed returns on the next read.
  // Recording it as a hidden marker would be more state than the feature earns.
  category.items = category.items.filter((i) => i.id !== id)
  lexicon.updatedAt = new Date().toISOString()
  return category.items.length !== before
}

export function searchItems(lexicon, query, limit = 40) {
  const q = String(query ?? '').trim()
  const out = []
  for (const category of Object.values(lexicon.categories)) {
    for (const entry of category.items) {
      if (!q || entry.text.includes(q) || entry.tags.some((t) => t.includes(q))) {
        out.push({ ...entry, category: category.key, categoryLabel: category.label })
      }
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Harvest reusable phrases out of an imported plan.
 *
 * Called on every docx import, so the library grows toward however this school
 * actually writes rather than toward a generic kindergarten template.
 *
 * @returns {{added:number, categories:string[]}}
 */
export function learnFromPlan(lexicon, plan) {
  const added = []
  const push = (key, text) => {
    const value = String(text ?? '').trim()
    if (value.length < 4 || value.length > 600) return
    const already = lexicon.categories[key].items.some((i) => i.text === value)
    if (already) return
    addItem(lexicon, key, value)
    added.push(key)
  }

  for (const month of plan.months ?? []) {
    push('focus.regular', month.focus?.regular)
    push('focus.moral', month.focus?.moral)
    push('focus.safety', month.focus?.safety)
    push('month.outdoor', month.blocks?.outdoor)
    push('month.dismissal', month.blocks?.dismissal)
    push('month.family', month.blocks?.family)
    push('month.corner', month.blocks?.corner)
  }
  for (const week of Object.values(plan.weekly ?? {})) {
    push('focus.regular', week.focus?.regular)
    push('focus.moral', week.focus?.moral)
    push('focus.safety', week.focus?.safety)
    push('focus.family', week.focus?.family)
    for (const value of week.games?.morning ?? []) push('games.morning', value)
    for (const value of week.games?.afternoon ?? []) push('games.afternoon', value)
    push('games.walk', week.games?.walk)
    push('games.indoor', week.games?.indoor)
  }
  return { added: added.length, categories: [...new Set(added)] }
}

export default {
  CATEGORIES, defaultLexicon, normaliseLexicon, addItem, removeItem, searchItems, learnFromPlan, itemId,
}
