/**
 * AI drafting over `ctx.llm.stream`.
 *
 * The reliability problem this solves is the same one every structured-output
 * feature hits: a model asked for JSON answers with JSON *most* of the time —
 * fenced, prefixed with prose, or truncated at the token ceiling. Rather than
 * trusting it, every reply goes through extract -> validate -> retry with the
 * concrete failures fed back. Only a reply that satisfies the declared shape is
 * ever returned.
 *
 * Two rules keep this honest:
 *   1. the model writes *content*, never layout. Week columns, weekday
 *      placement and the .docx are all compiled locally, so an AI draft can be
 *      wrong about pedagogy but can never make the two documents disagree.
 *   2. generated text is offered as a draft. Nothing is written to the plan
 *      until the teacher accepts it in the studio.
 */

import { SUBJECTS, WEEKDAY_LABELS, MONTH_BLOCKS, FOCUS_ROWS, weekDateLabel } from './model.js'

export class LlmError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'LlmError'
    this.code = info.code ?? 'llm-failed'
    this.raw = info.raw
    this.problems = info.problems
  }
}

/** Find the first balanced `{...}` span, ignoring braces inside strings. */
function matchBalanced(text, start) {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Extract the first JSON value from a model reply, tolerating fences and prose. */
export function extractJson(text) {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch { /* fall through to the tolerant paths */ }
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(trimmed)
  if (fence) {
    try {
      return JSON.parse(fence[1].trim())
    } catch { /* the fence may itself wrap prose */ }
  }
  for (let start = 0; start < trimmed.length; start += 1) {
    const ch = trimmed[start]
    if (ch !== '{' && ch !== '[') continue
    const end = matchBalanced(trimmed, start)
    if (end < 0) continue
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch { /* try the next candidate */ }
  }
  return undefined
}

/**
 * Minimal declarative shape check — deliberately not a general JSON Schema
 * implementation, so the failure messages stay specific and actionable.
 * @returns {string[]} human-readable problems; empty means valid
 */
export function validateShape(value, spec, path = '$') {
  const problems = []
  if (!spec || typeof spec !== 'object') return problems
  switch (spec.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`${path}: 期望对象，实际是 ${Array.isArray(value) ? '数组' : typeof value}`)
        return problems
      }
      for (const key of spec.required ?? []) {
        if (value[key] === undefined || value[key] === null || value[key] === '') problems.push(`${path}.${key}: 必填但缺失`)
      }
      for (const [key, child] of Object.entries(spec.properties ?? {})) {
        if (value[key] !== undefined && value[key] !== null) problems.push(...validateShape(value[key], child, `${path}.${key}`))
      }
      return problems
    }
    case 'array': {
      if (!Array.isArray(value)) {
        problems.push(`${path}: 期望数组，实际是 ${typeof value}`)
        return problems
      }
      if (spec.length !== undefined && value.length !== spec.length) {
        problems.push(`${path}: 需要 ${spec.length} 项，实际 ${value.length} 项`)
      }
      if (spec.minItems !== undefined && value.length < spec.minItems) problems.push(`${path}: 至少 ${spec.minItems} 项`)
      if (spec.items) {
        let reported = 0
        for (let i = 0; i < value.length && reported < 3; i += 1) {
          const found = validateShape(value[i], spec.items, `${path}[${i}]`)
          if (found.length > 0) { problems.push(...found); reported += 1 }
        }
      }
      return problems
    }
    case 'string':
      if (typeof value !== 'string') problems.push(`${path}: 期望字符串，实际是 ${typeof value}`)
      else if (spec.minLength !== undefined && value.trim().length < spec.minLength) problems.push(`${path}: 不能为空`)
      return problems
    default:
      return problems
  }
}

/** Drain an `llm.stream()` iterable into text + usage + finish reason. */
export async function collectStream(stream, onDelta) {
  let text = ''
  let reasoning = ''
  let usage = null
  let finish = null
  for await (const chunk of stream) {
    switch (chunk?.type) {
      case 'text-delta':
        text += chunk.text ?? ''
        onDelta?.(chunk.text ?? '', text)
        break
      case 'reasoning-delta':
        reasoning += chunk.text ?? ''
        break
      case 'usage':
        usage = chunk.usage ?? null
        break
      case 'finish':
        finish = chunk.reason ?? null
        break
      case 'block-end':
        if (chunk.block?.type === 'text' && text.length === 0) text = chunk.block.text ?? ''
        break
      default:
        break
    }
  }
  return { text, reasoning, usage, finish }
}

/**
 * Generate one JSON object, retrying once with the validation failures fed back.
 */
export async function generateJson(options) {
  const {
    llm, provider, model, system, user, spec,
    maxAttempts = 2, temperature = 0.6, maxTokens = 6000, signal, onProgress,
  } = options

  if (!llm) throw new LlmError('当前组合里没有可用的模型服务', { code: 'no-llm' })
  if (!provider || !model) throw new LlmError('没有选择生成用的模型', { code: 'no-model' })

  const messages = [{ role: 'user', content: [{ type: 'text', text: user }] }]
  let lastText = ''
  let lastProblems = []

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new LlmError('生成已取消', { code: 'aborted' })
    const stream = llm.stream({ provider, model, system, messages, temperature, maxTokens, signal })
    const { text, usage, finish } = await collectStream(stream, (_delta, full) => {
      onProgress?.({ attempt, phase: 'streaming', text: full, problems: [] })
    })
    lastText = text

    if (finish?.kind === 'error') {
      throw new LlmError(`模型调用失败：${finish.failure?.message ?? '未知错误'}`, { code: finish.failure?.code ?? 'provider-error', raw: text })
    }
    if (finish?.kind === 'aborted') throw new LlmError('生成已取消', { code: 'aborted', raw: text })

    onProgress?.({ attempt, phase: 'validating', text, problems: [] })
    const parsed = extractJson(text)
    if (parsed === undefined) {
      lastProblems = ['返回内容里没有可解析的 JSON 对象']
    } else {
      lastProblems = validateShape(parsed, spec)
      if (lastProblems.length === 0) return { value: parsed, text, attempts: attempt, usage }
    }
    if (attempt === maxAttempts) break

    onProgress?.({ attempt, phase: 'retrying', text, problems: lastProblems })
    const truncated = finish?.kind === 'max-tokens'
    messages.push({
      role: 'user',
      content: [{
        type: 'text',
        text: [
          '上一次的回复被拒绝了。',
          '',
          '上一次回复：',
          '```',
          text.slice(0, 10000),
          '```',
          '',
          '问题：',
          ...lastProblems.slice(0, 12).map((p) => `- ${p}`),
          ...(truncated ? ['- 回复被输出长度上限截断了，请输出更短但完整的 JSON'] : []),
          '',
          '只回复修正后的 JSON 对象，不要解释，不要代码块。',
        ].join('\n'),
      }],
    })
  }
  throw new LlmError(
    `尝试 ${maxAttempts} 次后模型仍未给出合规内容：${lastProblems.slice(0, 4).join('；')}`,
    { code: 'invalid-shape', raw: lastText, problems: lastProblems },
  )
}

// ------------------------------------------------------------------ prompts

const STYLE_RULES = [
  '你是一位中国幼儿园大班（5-6岁）的班主任，正在写学期教学计划。',
  '语言风格必须与园内已有计划一致：书面、简练、直接写做法，不用「我们」「孩子们」之类的口语。',
  '每条内容以动宾短语开头，如「引导幼儿……」「巩固……」「投放……」，句末用句号。',
  '不出现「根据幼儿年龄特点」这类空话；要写具体可执行的动作。',
  '不要提及人工智能、模型或任何技术名词。',
  '严格只输出 JSON，不要 markdown 代码块，不要任何解释。',
].join('\n')

function lexiconHints(lexicon, keys, limit = 4) {
  const lines = []
  for (const key of keys) {
    const items = lexicon?.categories?.[key]?.items ?? []
    if (items.length === 0) continue
    lines.push(`「${lexicon.categories[key].label}」园内常用写法示例：`)
    for (const entry of items.slice(0, limit)) lines.push(`  - ${entry.text.replace(/\n/g, ' ')}`)
  }
  return lines.join('\n')
}

/**
 * Draft one month plan.
 *
 * @returns {Promise<{focus:object, courses:object, blocks:object, raw:string}>}
 */
export async function draftMonth({ llm, provider, model, plan, month, instruction = '', lexicon, signal, onProgress }) {
  const weekLines = month.weeks.map((w) => `  第${w.no}周 ${weekDateLabel(w)}`).join('\n')
  const subjectLines = SUBJECTS.map((s) => `  ${s.key} = ${s.group}${s.sub ? '/' + s.sub : ''}（周计划里叫「${s.activity}」）`).join('\n')

  const system = STYLE_RULES
  const user = [
    `请为「${plan.semesterLabel}${plan.className}」写 ${month.label} 的月计划内容。`,
    plan.semesterLabel.includes('秋') ? '季节背景：秋季学期。' : '',
    month.theme ? `本月主题：《${month.theme}》。` : '',
    instruction ? `额外要求：${instruction}` : '',
    '',
    '本月有这些教学周：',
    weekLines,
    '',
    '课程内容按下列学科分组，每组要给出与上面周次一一对应的课题名称（缺的用空字符串）：',
    subjectLines,
    '',
    '课题名称的写法：中文书名号包起来，如《认识昨天》。健康、手指律动这两组通常留空。',
    '同一课题不要在不同周次重复。',
    '',
    '工作重点三段：班级常规（习惯养成）、德育教育、安全教育。每段 2-4 句，80-160 字。',
    '长文本四段：户外活动、离园活动、家园共育、环境区角。每段 3-6 句，注意「家园共育」要分「科学育儿」和「温馨提示」两部分。',
    '',
    lexiconHints(lexicon, ['focus.regular', 'focus.moral', 'focus.safety', 'month.family', 'month.corner']),
    '',
    '输出 JSON，结构如下：',
    JSON.stringify({
      focus: { regular: '……', moral: '……', safety: '……' },
      courses: Object.fromEntries(SUBJECTS.map((s) => [s.key, month.weeks.map((w) => `第${w.no}周课题`)])),
      blocks: { outdoor: '……', dismissal: '……', family: '……', corner: '……' },
    }, null, 1),
    '',
    `注意：courses 里每个数组必须正好 ${month.weeks.length} 项，顺序对应上面的周次。`,
  ].filter(Boolean).join('\n')

  const spec = {
    type: 'object',
    required: ['focus', 'courses', 'blocks'],
    properties: {
      focus: {
        type: 'object',
        required: ['regular', 'moral', 'safety'],
        properties: { regular: { type: 'string', minLength: 10 }, moral: { type: 'string', minLength: 10 }, safety: { type: 'string', minLength: 10 } },
      },
      courses: {
        type: 'object',
        properties: Object.fromEntries(SUBJECTS.map((s) => [s.key, { type: 'array', length: month.weeks.length, items: { type: 'string' } }])),
      },
      blocks: {
        type: 'object',
        required: ['outdoor', 'dismissal', 'family', 'corner'],
        properties: Object.fromEntries(MONTH_BLOCKS.map((b) => [b.key, { type: 'string', minLength: 10 }])),
      },
    },
  }

  const result = await generateJson({ llm, provider, model, system, user, spec, signal, onProgress })
  const value = result.value
  return {
    focus: {
      regular: String(value.focus?.regular ?? '').trim(),
      moral: String(value.focus?.moral ?? '').trim(),
      safety: String(value.focus?.safety ?? '').trim(),
      family: String(month.focus?.family ?? '').trim(),
    },
    courses: Object.fromEntries(SUBJECTS.map((s) => {
      const column = Array.isArray(value.courses?.[s.key]) ? value.courses[s.key].map((t) => String(t ?? '').trim()) : []
      while (column.length < month.weeks.length) column.push('')
      return [s.key, column.slice(0, month.weeks.length)]
    })),
    blocks: Object.fromEntries(MONTH_BLOCKS.map((b) => [b.key, String(value.blocks?.[b.key] ?? '').trim()])),
    raw: result.text,
    attempts: result.attempts,
  }
}

/**
 * Draft one week's plan: 工作重点 short lines plus the game rows.
 *
 * Course titles are NOT part of this — they are compiled from the month column,
 * which is precisely why an AI draft cannot desynchronise the two documents.
 */
export async function draftWeek({ llm, provider, model, plan, weekNo, instruction = '', lexicon, signal, onProgress }) {
  const month = plan.months.find((m) => m.weeks.some((w) => w.no === weekNo))
  const week = month?.weeks.find((w) => w.no === weekNo)
  if (!week) throw new LlmError(`计划里没有第${weekNo}周`, { code: 'no-week' })

  const already = SUBJECTS
    .map((s) => String(month.courses?.[s.key]?.[month.weeks.indexOf(week)] ?? '').trim())
    .filter(Boolean)

  const system = STYLE_RULES
  const user = [
    `请为「${plan.semesterLabel}${plan.className}」第${weekNo}周（${weekDateLabel(week)}）写周计划内容。`,
    month.theme ? `本月主题：《${month.theme}》。` : '',
    instruction ? `额外要求：${instruction}` : '',
    '',
    month.focus?.regular ? `本月常规工作重点：${month.focus.regular}` : '',
    month.focus?.moral ? `本月德育工作重点：${month.focus.moral}` : '',
    month.focus?.safety ? `本月安全工作重点：${month.focus.safety}` : '',
    month.blocks?.family ? `本月家园共育：${month.blocks.family}` : '',
    '',
    already.length > 0 ? `本周已有的集体教学课题：${already.join('、')}。这些不用你写，但德育和安全可以呼应它们。` : '',
    '',
    '需要产出：',
    '1. focus.regular 常规（生活）培养：1-2 句，40-70 字',
    '2. focus.moral 德育教育：1 句，20-50 字',
    '3. focus.safety 安全工作：1-2 句，40-80 字',
    '4. focus.family 家园共育：1 句，20-50 字',
    '5. games.morning 晨间趣味游戏：5 条，周一到周五各一条，格式固定为两行——',
    '   第一行「趣味游戏：」或者「趣味游戏：」后接游戏名，第二行括号里写锻炼目标，例如：',
    '   趣味游戏：\\n《轮胎闯关行》\\n（锻炼下肢力量）',
    '   注意：5 条游戏不要重复；锻炼目标要覆盖跑动、投掷、平衡、柔韧、合作等不同方面。',
    '6. games.afternoon 下午活动场地：5 条，写园内场地名称，如 沙池、积木墙、涂鸦区、绘本馆、南瓜屋、轮胎区、美术馆。',
    '7. games.walk 散步内容：通常就是「音乐/绘本/朗诵」。',
    '8. games.indoor 室内自主游戏材料填充：1-2 句，写成「1.××区…… 2.××区……」的形式。',
    '',
    lexiconHints(lexicon, ['games.morning', 'games.afternoon', 'games.indoor']),
    '',
    '输出 JSON，结构如下：',
    JSON.stringify({
      focus: { regular: '……', moral: '……', safety: '……', family: '……' },
      games: { morning: ['', '', '', '', ''], afternoon: ['', '', '', '', ''], walk: '音乐/绘本/朗诵', indoor: '……' },
    }, null, 1),
  ].filter(Boolean).join('\n')

  const day5 = { type: 'array', length: 5, items: { type: 'string', minLength: 1 } }
  const spec = {
    type: 'object',
    required: ['focus', 'games'],
    properties: {
      focus: {
        type: 'object',
        required: ['regular', 'moral', 'safety', 'family'],
        properties: Object.fromEntries(FOCUS_ROWS.map((r) => [r.key, { type: 'string', minLength: 8 }])),
      },
      games: {
        type: 'object',
        required: ['morning', 'afternoon'],
        properties: { morning: day5, afternoon: day5, walk: { type: 'string' }, indoor: { type: 'string', minLength: 6 } },
      },
    },
  }

  const result = await generateJson({ llm, provider, model, system, user, spec, signal, onProgress })
  const value = result.value
  const perDay = (v) => {
    const arr = Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : []
    while (arr.length < 5) arr.push('')
    return arr.slice(0, 5)
  }
  return {
    focus: Object.fromEntries(FOCUS_ROWS.map((r) => [r.key, String(value.focus?.[r.key] ?? '').trim()])),
    games: {
      morning: perDay(value.games?.morning),
      afternoon: perDay(value.games?.afternoon),
      walk: String(value.games?.walk ?? '').trim() || '音乐/绘本/朗诵',
      indoor: String(value.games?.indoor ?? '').trim(),
    },
    raw: result.text,
    attempts: result.attempts,
  }
}

export const WEEKDAY_HINT = WEEKDAY_LABELS
export default { LlmError, extractJson, validateShape, collectStream, generateJson, draftMonth, draftWeek }
