/**
 * Read an existing plan .docx back into the model.
 *
 * The teachers already have a semester of hand-made plans on disk. Re-typing
 * them would be the fastest way to make this plugin useless, so import is a
 * first-class path: point it at a 月计划 or 周计划 and it returns the same
 * structure the editor writes.
 *
 * The XML handling is deliberately narrow — a Word table is a flat sequence of
 * `<w:tr>` each holding flat `<w:tc>`, with no nesting anywhere the model needs,
 * so a linear scan is enough and a full XML parser (and its dependency) is not.
 */

import { readFile } from 'node:fs/promises'
import { readPart } from './zip.js'
import {
  SUBJECTS, MONTH_BLOCKS, FOCUS_ROWS, cnNumber, parseDay, formatDay,
} from './model.js'

// ------------------------------------------------------------ tiny scanner

const TAG_TR = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g
const TAG_TC = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g
const TAG_T = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g

const attr = (xml, name) => {
  const m = new RegExp(`<w:${name}\\b[^>]*\\bw:val="([^"]*)"`).exec(xml)
  return m ? m[1] : null
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/**
 * Text of one `<w:p>`, honouring `<w:br/>`/`<w:cr/>` and `<w:tab/>`.
 *
 * The uploaded documents express a multi-line cell in one of two ways: several
 * `<w:p>` elements (「趣味游戏：」/「《轮胎闯关行》」/「（锻炼下肢力量）」 are three
 * paragraphs) or `<w:br/>` inside one. Both have to come back as the same thing,
 * or a round trip silently flattens a game cell onto a single line.
 */
function paragraphText(inner) {
  const marks = []
  TAG_T.lastIndex = 0
  let m
  while ((m = TAG_T.exec(inner)) !== null) marks.push({ at: m.index, kind: 'text', text: unescapeXml(m[1]) })
  for (const b of inner.matchAll(/<w:(?:br|cr)\b[^>]*\/?>/g)) marks.push({ at: b.index, kind: 'break' })
  for (const t of inner.matchAll(/<w:tab\b[^>]*\/?>/g)) marks.push({ at: t.index, kind: 'tab' })
  marks.sort((a, b) => a.at - b.at)
  let out = ''
  for (const mark of marks) {
    if (mark.kind === 'break') out += '\n'
    else if (mark.kind === 'tab') out += '　'
    else out += mark.text
  }
  return out.replace(/\u000b/g, '\n').replace(/\u00a0/g, ' ')
}

/** Text of a `<w:tc>` body: one line per paragraph. */
function cellText(inner) {
  const paragraphs = inner.match(/<w:p\b(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
  const joined = paragraphs && paragraphs.length > 0
    ? paragraphs.map(paragraphText).join('\n')
    : paragraphText(inner)
  return joined
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim()
}

/**
 * Parse the first table of a document into a rectangular grid.
 *
 * `gridSpan` is expanded and `vMerge` continuations are dropped, so every row
 * reports only the cells it actually owns — which is what a reader expects and
 * what the model stores.
 *
 * @param {string} xml document.xml
 * @returns {{paragraphs:string[], grid:Array<Array<{text:string, span:number, merge:string|null, col:number}>>, colCount:number}}
 */
export function parseDocument(xml) {
  const bodyMatch = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)
  const body = bodyMatch ? bodyMatch[1] : xml

  const paragraphs = []
  // Paragraphs that are direct children of the body — i.e. the title lines.
  const bodyNoTables = body.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, '')
  for (const p of bodyNoTables.match(/<w:p\b(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []) {
    const text = cellText(p)
    if (text) paragraphs.push(text)
  }

  const tblMatch = /<w:tbl\b[\s\S]*?<\/w:tbl>/.exec(body)
  const grid = []
  let colCount = 0
  if (tblMatch) {
    TAG_TR.lastIndex = 0
    let trMatch
    while ((trMatch = TAG_TR.exec(tblMatch[0])) !== null) {
      const row = []
      let col = 0
      TAG_TC.lastIndex = 0
      let tcMatch
      while ((tcMatch = TAG_TC.exec(trMatch[1])) !== null) {
        // Only the cell's own properties, never a nested table's.
        const head = /<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(tcMatch[1])
        const span = Number(attr(head?.[0] ?? '', 'gridSpan') ?? 1) || 1
        const mergeVal = attr(head?.[0] ?? '', 'vMerge')
        const merge = /<w:vMerge\b/.test(head?.[0] ?? '') ? (mergeVal ?? 'continue') : null
        row.push({ text: cellText(tcMatch[1]), span, merge, col })
        col += span
      }
      colCount = Math.max(colCount, col)
      grid.push(row)
    }
  }
  return { paragraphs, grid, colCount }
}

/** Read a .docx file into the parsed shape. */
export async function parseDocxFile(path) {
  const buffer = await readFile(path)
  return parseDocument(readPart(buffer, 'word/document.xml'))
}

// ---------------------------------------------------------- text decoding

const CN_NUM = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** '第二十一周' / '21' -> 21 */
export function parseCnNumber(value) {
  const s = String(value ?? '').trim()
  if (/^\d+$/.test(s)) return Number(s)
  const m = /([零一二三四五六七八九十]+)/.exec(s)
  if (!m) return null
  const chars = m[1]
  if (chars === '十') return 10
  if (chars.startsWith('十')) return 10 + (CN_NUM[chars[1]] ?? 0)
  const tenAt = chars.indexOf('十')
  if (tenAt < 0) return CN_NUM[chars] ?? null
  const tens = CN_NUM[chars[0]] ?? 0
  const ones = chars[tenAt + 1] ? (CN_NUM[chars[tenAt + 1]] ?? 0) : 0
  return tens * 10 + ones
}

/** '10.8-10.10' -> { startMonth, startDay, endMonth, endDay } */
export function parseRange(text) {
  const m = /(\d{1,2})\s*[.．\-]\s*(\d{1,2})\s*[-—~～至]\s*(\d{1,2})\s*[.．\-]\s*(\d{1,2})/.exec(String(text ?? ''))
  if (!m) {
    const single = /(\d{1,2})\s*[.．]\s*(\d{1,2})/.exec(String(text ?? ''))
    if (!single) return null
    return { sm: Number(single[1]), sd: Number(single[2]), em: Number(single[1]), ed: Number(single[2]) }
  }
  return { sm: Number(m[1]), sd: Number(m[2]), em: Number(m[3]), ed: Number(m[4]) }
}

/** '2026年11月2日——11月6日' -> { start, end } */
export function parseLongRange(text) {
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[—\-~～至]+\s*(?:(\d{4})\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日/.exec(String(text ?? ''))
  if (!m) return null
  const year = Number(m[1])
  const start = `${year}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
  const endYear = m[4] ? Number(m[4]) : (Number(m[5] ?? m[2]) < Number(m[2]) ? year + 1 : year)
  const end = `${endYear}-${String(Number(m[5] ?? m[2])).padStart(2, '0')}-${String(Number(m[6])).padStart(2, '0')}`
  return { start, end }
}

/**
 * Infer the plan identity from a document's title lines.
 * Any field the caller supplies explicitly wins.
 */
export function inferIdentity(paragraphs, hint = {}) {
  const joined = paragraphs.join('\n')
  const out = {
    kindergarten: hint.kindergarten ?? '',
    className: hint.className ?? '',
    semesterLabel: hint.semesterLabel ?? '',
    year: hint.year ?? null,
  }
  if (!out.kindergarten) {
    const m = /^\s*([\u4e00-\u9fa5]{2,12}?(?:幼儿园|幼稚园|幼儿学校))/.exec(joined)
    if (m) out.kindergarten = m[1]
  }
  if (!out.className) {
    const m = /([小中大]?\s*[一二三四五六七八九十\d]?\s*班)/.exec(joined)
    if (m) out.className = m[1].replace(/\s+/g, '')
  }
  if (!out.semesterLabel) {
    const m = /(\d{4})\s*年\s*(春季|秋季)\s*学期/.exec(joined)
    if (m) {
      out.semesterLabel = `${m[1]}年${m[2]}学期`
      out.year = out.year ?? Number(m[1])
    }
  }
  if (!out.year) {
    const m = /(\d{4})\s*年/.exec(joined)
    if (m) out.year = Number(m[1])
  }
  return out
}

// ----------------------------------------------------------- row decoding

/** Drop the leading 「班级常规（习惯养成）：」 style prefix the template writes inline. */
function stripFocusPrefix(value) {
  return String(value ?? '').replace(/^\s*[^：:\n]{2,14}[：:]\s*/, '').trim()
}

function isMonthlyDoc(parsed) {
  const flat = parsed.grid.map((row) => row.map((c) => c.text).join('|')).join('\n')
  return /课程内容/.test(flat) && /工作重点/.test(flat)
}

function isWeeklyDoc(parsed) {
  const flat = parsed.grid.map((row) => row.map((c) => c.text).join('|')).join('\n')
  return /周工作重点/.test(flat) && !/课程内容/.test(flat)
}

/**
 * Decode a parsed month table.
 * @returns {{kind:'monthly', month:object, identity:object}}
 */
export function decodeMonthly(parsed, hint = {}) {
  const { grid, paragraphs } = parsed
  const identity = inferIdentity(paragraphs, hint)
  const year = identity.year ?? new Date().getFullYear()

  const label = grid[0]?.[0]?.text ?? ''
  const monthNo = Number(/(\d{1,2})\s*月/.exec(label)?.[1] ?? (/(\d{1,2})\s*月/.exec(paragraphs.join(' '))?.[1] ?? 9))

  const focus = { regular: '', moral: '', safety: '', family: '' }
  for (const row of grid.slice(1, 4)) {
    const values = row.filter((c) => !/^工作重点$/.test(c.text))
    const text = values.map((c) => c.text).join('\n')
    if (/班级常规|常规/.test(text)) focus.regular = stripFocusPrefix(text.replace(/^\s*班级常规（习惯养成）[：:]?/, ''))
    else if (/德育/.test(text)) focus.moral = stripFocusPrefix(text.replace(/^\s*德育教育[：:]?/, ''))
    else if (/安全/.test(text)) focus.safety = stripFocusPrefix(text.replace(/^\s*安全教育[：:]?/, ''))
  }

  // Header row: find it by the 第N周 markers rather than by index, so a plan
  // with more or fewer 工作重点 rows still decodes.
  const headerIndex = grid.findIndex((row) => row.some((c) => /第[零一二三四五六七八九十\d]+周/.test(c.text)))
  const header = headerIndex >= 0 ? grid[headerIndex] : []
  const weekCells = header.filter((c) => /第[零一二三四五六七八九十\d]+周/.test(c.text))
  const weeks = weekCells.map((cell) => {
    const no = parseCnNumber(/第([零一二三四五六七八九十\d]+)周/.exec(cell.text)?.[1])
    const range = parseRange(cell.text)
    if (!range) return { no, start: '', end: '', days: [], theme: '', layout: null, col: cell.col }
    const startYear = range.sm >= 8 ? year : year + 1
    const endYear = range.em >= 8 ? year : year + 1
    const start = `${startYear}-${String(range.sm).padStart(2, '0')}-${String(range.sd).padStart(2, '0')}`
    const end = `${endYear}-${String(range.em).padStart(2, '0')}-${String(range.ed).padStart(2, '0')}`
    const days = []
    const s = parseDay(start)
    const e = parseDay(end)
    if (s && e) for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) days.push(formatDay(d))
    return { no, start, end, days, theme: '', layout: null, col: cell.col }
  }).filter((w) => Number.isInteger(w.no))

  // Course rows follow the header.
  //
  // They are NOT identified by their first cell: the template merges the
  // 课程内容 label down the whole block, so in every course row that cell reads
  // empty. Position is what is reliable — the nine subject rows sit directly
  // under the header, in template order, and the long-text rows start at the
  // first row whose first cell is a block label.
  //
  // Values are read by *column position*, not by "the last N cells". A month
  // table can carry more week columns than named weeks — the uploaded January
  // plan has five columns and only three week headers — and slicing from the
  // right would then file 第二十周's courses under 第二十一周.
  const courses = Object.fromEntries(SUBJECTS.map((s) => [s.key, weeks.map(() => '')]))
  const tail = headerIndex >= 0 ? grid.slice(headerIndex + 1) : []
  const blockAt = tail.findIndex((row) => MONTH_BLOCKS.some((b) => b.label === (row[0]?.text ?? '')))
  const courseRows = blockAt >= 0 ? tail.slice(0, blockAt) : tail
  SUBJECTS.forEach((subject, i) => {
    const row = courseRows[i]
    if (!row) return
    const byCol = new Map(row.map((c) => [c.col, c.text]))
    courses[subject.key] = weeks.map((week) => String(byCol.get(week.col) ?? '').replace(/\s+$/g, '').trim())
  })

  // Long-text block rows. A vMerge continuation can leave the label cell empty,
  // so scan the whole grid, not just the tail.
  const blocks = { outdoor: '', dismissal: '', family: '', corner: '' }
  for (const row of grid) {
    const first = row[0]?.text ?? ''
    const block = MONTH_BLOCKS.find((b) => b.label === first)
    if (!block) continue
    const value = row.slice(1).filter((c) => c.text).map((c) => c.text).join('\n')
    blocks[block.key] = value
  }

  return {
    kind: 'monthly',
    identity,
    month: {
      id: `m${monthNo}`,
      monthNo,
      label: label || `${monthNo}月份`,
      theme: '',
      focus,
      courses,
      blocks,
      weeks,
    },
  }
}

/**
 * Decode a parsed week table.
 * @returns {{kind:'weekly', weekly:object, identity:object}}
 */
export function decodeWeekly(parsed, hint = {}) {
  const { grid, paragraphs } = parsed
  const identity = inferIdentity(paragraphs, hint)
  const weekNo = parseCnNumber(/第([零一二三四五六七八九十\d]+)周/.exec(paragraphs.join(' '))?.[1])
  const theme = /主题名称\s*[：:]\s*《([^》]*)》/.exec(paragraphs.join(' '))?.[1] ?? ''
  const range = parseLongRange(paragraphs.join(' '))

  const focus = { regular: '', moral: '', safety: '', family: '' }
  const focusMap = {
    '常规（生活）培养': 'regular', '常规(生活)培养': 'regular', '班级常规': 'regular',
    德育教育: 'moral',
    安全工作: 'safety',
    家园共育: 'family',
    生活养成教育: 'moral',
  }
  for (const row of grid.slice(0, 6)) {
    const texts = row.map((c) => c.text)
    const labelAt = texts.findIndex((t) => focusMap[t])
    if (labelAt < 0) continue
    const value = texts.slice(labelAt + 1).find((t) => t) ?? ''
    focus[focusMap[texts[labelAt]]] = value
  }

  const games = { morning: ['', '', '', '', ''], afternoon: ['', '', '', '', ''], walk: '', indoor: '', indoorTrailing: '' }
  const layout = identity.layout ?? (grid.some((row) => row.some((c) => c.text === '上午')) ? 'week1' : 'main')

  if (layout === 'week1') {
    const pick = (label) => {
      const row = grid.find((r) => r.some((c) => c.text === label))
      if (!row) return []
      const at = row.findIndex((c) => c.text === label)
      const values = row.slice(at + 1).map((c) => c.text.replace(/^[^：:\n]{2,8}[：:]/, '').trim())
      while (values.length < 5) values.push('')
      return values.slice(0, 5)
    }
    games.morning = pick('晨间活动')
    games.afternoon = pick('户外活动')
    return {
      kind: 'weekly',
      identity,
      weekly: { weekNo, theme, start: range?.start ?? '', end: range?.end ?? '', layout, focus, games },
    }
  }

  const rowOf = (label) => grid.find((r) => r.some((c) => c.text === label)) ?? null

  const morningRow = rowOf('晨间')
  if (morningRow) {
    const at = morningRow.findIndex((c) => c.text === '晨间')
    games.morning = morningRow.slice(at + 1).map((c) => c.text).concat(['', '', '', '', '']).slice(0, 5)
  }
  const walkRow = rowOf('散步')
  if (walkRow) games.walk = walkRow[walkRow.length - 1]?.text ?? ''
  const afternoonRow = rowOf('下午')
  if (afternoonRow) {
    const at = afternoonRow.findIndex((c) => c.text === '下午')
    games.afternoon = afternoonRow.slice(at + 1).map((c) => (c.text === '自评活动' ? '' : c.text))
      .concat(['', '', '', '', '']).slice(0, 5)
  }
  const indoorRow = grid.find((r) => r.some((c) => /室内自主游戏/.test(c.text)))
  if (indoorRow) {
    const at = indoorRow.findIndex((c) => /室内自主游戏/.test(c.text))
    games.indoor = indoorRow[at + 1]?.text ?? ''
  }

  // The 集体教学活动 row is the one following the 内容/时间 header.
  //
  // Weekday assignment comes from the header row's own labels, not from the
  // column index: 第六周 runs 10.8-10.10, so its first column is labelled
  // 星期四, and a column-index guess would file every lesson two days early.
  const headerIndex = grid.findIndex((row) => row.some((c) => /内容/.test(c.text) && /时间/.test(c.text)))
  const headerRow = headerIndex >= 0 ? grid[headerIndex] : []
  const columnWeekdays = headerRow.map((cell) => {
    const m = /(星期[一二三四五六日天])/.exec(cell.text)
    if (!m) return null
    const label = m[1] === '星期天' ? '星期日' : m[1]
    const at = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'].indexOf(label)
    return at >= 0 ? at + 1 : null
  })
  const lessonRow = headerIndex >= 0
    ? grid.slice(headerIndex + 1).find((row) => row.some((c) => /集体教学活动/.test(c.text)))
    : null
  const lessons = []
  if (lessonRow) {
    const at = lessonRow.findIndex((c) => /集体教学活动/.test(c.text))
    lessonRow.slice(at + 1).forEach((cell, i) => {
      const m = /^([\u4e00-\u9fa5]{2,6}活动)\s*[：:]?\s*\n?\s*(.*)$/s.exec(cell.text.replace(/\n+/g, '\n').trim())
      if (!m) return
      const subject = SUBJECTS.find((s) => s.activity === m[1])
      if (!subject) return
      const title = (m[2] ?? '').trim()
      // A cell may carry the activity label with no title — that is a hole in
      // the plan rather than a lesson, and is reported separately.
      lessons.push({
        weekday: columnWeekdays[at + 1 + i] ?? (i + 1),
        columnIndex: i + 1,
        subjectKey: subject.key,
        activity: subject.activity,
        title,
      })
    })
  }

  return {
    kind: 'weekly',
    identity,
    weekly: {
      weekNo, theme,
      start: range?.start ?? '', end: range?.end ?? '',
      layout, focus, games, lessons,
    },
  }
}

/** Classify and decode any plan document. */
export function decodeDocument(parsed, hint = {}) {
  if (isMonthlyDoc(parsed)) return decodeMonthly(parsed, hint)
  if (isWeeklyDoc(parsed)) return decodeWeekly(parsed, hint)
  // Fall back to whichever marker is present.
  const flat = parsed.grid.map((row) => row.map((c) => c.text).join(' ')).join('\n')
  if (/课程内容|工作重点/.test(flat)) return decodeMonthly(parsed, hint)
  if (/周工作重点|集体教学活动|游戏活动/.test(flat)) return decodeWeekly(parsed, hint)
  throw new Error('无法识别这个文档：既不是月计划表，也不是周计划表')
}

export default { parseDocument, parseDocxFile, decodeDocument, decodeMonthly, decodeWeekly, inferIdentity, parseCnNumber, parseRange, parseLongRange }
