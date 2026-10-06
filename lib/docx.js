/**
 * .docx generation, byte-faithful to the school's own templates.
 *
 * The strategy is deliberately not "reconstruct a similar-looking table":
 *
 *   1. an uploaded document is shipped as the *base package* (templates/*.docx).
 *      Everything Word authored — styles.xml, numbering, theme, fontTable, the
 *      letterhead image pinned in header1.xml and the green footer line — is
 *      carried through untouched.
 *   2. only `word/document.xml` is regenerated, and even there the base's own
 *      `<w:sectPr>` (page size, margins, header/footer relationships) and
 *      `<w:tblPr>` (borders, table style, floating position, cell margins) are
 *      lifted verbatim out of the base and re-emitted.
 *
 * So the page setup, the table frame, the logo and the footer are the school's,
 * and only the cells differ. The formatting constants below were read out of the
 * uploaded files with the OOXML dumps recorded in the plugin README.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rewritePackage, readPart } from './zip.js'
import {
  SUBJECTS, SUBJECT_BY_KEY, WEEKDAY_LABELS, MONTH_BLOCKS, FOCUS_ROWS, shortDay, longDay,
  weekDateLabel, weekFullDateLabel,
} from './model.js'
import { deriveWeek, deriveAll } from './derive.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const TEMPLATE_DIR = join(HERE, '..', 'templates')

export const TEMPLATE_FILES = Object.freeze({
  monthly: 'monthly-base.docx',
  weekly: 'weekly-base.docx',
  weeklyW1: 'weekly-base-w1.docx',
})

// ------------------------------------------------------------ formatting

/**
 * Run/paragraph formatting read from the uploaded documents.
 *
 * `size` is in half-points (w:sz), `spacing` in twentieths of a point (w:spacing),
 * exactly as OOXML wants them.
 */
export const STYLE = Object.freeze({
  monthly: {
    // Grid of the uploaded October plan. Columns 0..2 are the left label band;
    // the remainder is split across however many week columns the month needs,
    // so the table's total width — and therefore its look — never changes.
    lead: [559, 396, 702],
    weekPool: 9023,
    // The paragraph style the uploaded document gives its table cells. It lives
    // in the base package's styles.xml, which is carried through untouched.
    pStyle: '4',
    titleSize: 44,
    titleSpacing: 390,
    labelSize: 28,          // 工作重点 / 课程内容
    subjectSize: 24,
    rowLabelSize: 28,       // 家园共育 / 环境区角
    rowLabelSizeAlt: 24,    // 户外活动 / 离园活动
    contentSize: 24,
    weekHeaderSize: 24,
    monthLabelSize: 32,
    /** Only the narrow left-hand label cells carry paragraph spacing. */
    cellSpacing: 390,
    contentSpacing: 0,
    labelFont: '宋体',
    contentBold: true,
    vAlign: 'center',
    /**
     * Per-row `w:trHeight` minimums, in twips, read from the uploaded plan.
     *
     * These are not decoration. Without them Word auto-fits each row tightly to
     * its text and the month plan grows from two pages to three, because the
     * template's own paragraph spacing was stripped out of the content cells.
     * They are `atLeast`, so a month with more text simply makes its rows taller.
     */
    rowHeights: [305, 1564, 1423, 1379, 660, 477, 452, 491, 470, 552, 591, 571, 494, 617, 1212, 1219, 3098, 2751],
  },
  weekly: {
    // Landscape 10-row table. Grid is fixed: it is the uploaded file's own.
    grid: [726, 1261, 822, 2184, 2603, 2490, 2524, 2689],
    pStyle: null,
    titleSize: 32,
    labelSize: 28,
    focusLabelSize: 24,
    contentSize: 24,
    focusContentSize: 24,
    cellSpacing: 0,
    contentSpacing: 0,
    contentBold: false,
    contentFont: '宋体',
    rowHeights: [327, 610, 1105, 560, 532, 1280, 962, 494, 515, 901],
  },
  weeklyW1: {
    // Portrait 14-row table used by 第一周.
    grid: [727, 839, 1786, 1786, 1786, 1786, 1789],
    pStyle: null,
    titleSize: 32,
    labelSize: 21,
    contentSize: 21,
    contentBold: false,
    cellSpacing: 0,
    contentSpacing: 0,
    rowHeights: [991, 1286, 1286, 961, 1036, 800, 369, 1013, 969, 969, 900, 369, 900, 900],
  },
})

const SZ_CSS = { 21: '10.5pt', 24: '12pt', 28: '14pt', 32: '16pt', 56: '28pt' }

// ---------------------------------------------------------------- xml bits

/** Escape text for XML content. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are illegal in XML 1.0 and abort a Word open; strip
    // them rather than producing a file Word refuses to load.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function rPr({ size, bold, font }) {
  return [
    `<w:rFonts w:hint="eastAsia"${font ? ` w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"` : ''}/>`,
    bold ? '<w:b/><w:bCs/>' : null,
    `<w:color w:val="333333"/>`,
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    '<w:vertAlign w:val="baseline"/>',
    '<w:lang w:val="en-US" w:eastAsia="zh-CN"/>',
  ].filter(Boolean).join('')
}

/**
 * One paragraph.
 *
 * The `pPr` skeleton mirrors the template's own, including `pStyle`, because
 * Word resolves several of those flags against the base package's styles.xml.
 */
function para(text, { size = 24, bold = false, font = null, jc = 'center', spacing = null, pStyle = null } = {}) {
  const runs = String(text ?? '').split('\n').map((line) => {
    if (line === '') return ''
    return `<w:r><w:rPr>${rPr({ size, bold, font })}</w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
  }).join('')
  const spacingXml = spacing === null
    ? '<w:spacing w:line="240" w:lineRule="auto"/>'
    : `<w:spacing w:before="${spacing}" w:beforeAutospacing="0" w:after="${spacing}" w:afterAutospacing="0" w:line="240" w:lineRule="auto"/>`
  const pPrXml = [
    pStyle ? `<w:pStyle w:val="${esc(pStyle)}"/>` : '',
    '<w:widowControl/><w:kinsoku/><w:wordWrap/><w:overflowPunct/><w:topLinePunct w:val="0"/>',
    '<w:autoSpaceDE/><w:autoSpaceDN/><w:bidi w:val="0"/><w:adjustRightInd/>',
    '<w:snapToGrid w:val="0"/>',
    spacingXml,
    `<w:jc w:val="${jc}"/>`,
    '<w:textAlignment w:val="auto"/>',
    `<w:rPr>${rPr({ size, bold, font })}</w:rPr>`,
  ].filter(Boolean).join('')
  return `<w:p><w:pPr>${pPrXml}</w:pPr>${runs}</w:p>`
}

/**
 * A cell body: one paragraph per line, which is how the uploaded documents
 * express multi-line cells. Emitting `<w:br/>` instead renders the same but
 * round-trips differently — read back, the reader sees one paragraph and the
 * line structure is gone.
 */
/**
 * A cell body: one paragraph per line, which is how the uploaded documents
 * express multi-line cells. Emitting `<w:br/>` instead renders the same but
 * round-trips differently — read back, the reader sees one paragraph and the
 * line structure is gone.
 */
function cellBody(text, options) {
  const lines = String(text ?? '').split('\n')
  // An empty cell still needs one paragraph; Word will not keep an empty `w:tc`.
  if (lines.length <= 1) return para(lines[0] ?? '', options)
  return lines.map((line) => para(line, options)).join('')
}

const pct = (w, total) => Math.max(1, Math.round((w / total) * 5000))

/**
 * One table cell.
 *
 * @param {{span?:number, width:number, total:number, vAlign?:string, vMerge?:'restart'|'continue',
 *          text?:string, paras?:string[], size?:number, bold?:boolean, font?:string,
 *          jc?:string, spacing?:number|null}} spec
 */
function tc(spec) {
  const {
    span = 1, width, total, vAlign = 'center', vMerge = null,
    text = '', paras = null, size = 24, bold = false, font = null,
    jc = 'center', spacing = null, pStyle = null,
  } = spec
  const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''
  const merge = vMerge ? `<w:vMerge w:val="${vMerge}"/>` : ''
  const body = paras && paras.length > 0
    ? paras.join('')
    : cellBody(text, { size, bold, font, jc, spacing, pStyle })
  return `<w:tc><w:tcPr><w:tcW w:w="${pct(width, total)}" w:type="pct"/>${gridSpan}${merge}<w:vAlign w:val="${vAlign}"/></w:tcPr>${body}</w:tc>`
}

/**
 * One table row.
 *
 * `height` becomes a `w:trHeight` minimum. Passing the template's own values is
 * what keeps pagination identical to the uploaded document.
 */
function tr(cells, { align = 'center', height = null } = {}) {
  const heightXml = height ? `<w:trHeight w:val="${height}" w:hRule="atLeast"/>` : ''
  return `<w:tr><w:trPr>${heightXml}<w:jc w:val="${align}"/></w:trPr>${cells.join('')}</w:tr>`
}

function tbl(gridWidths, tblPr, rows) {
  const total = gridWidths.reduce((a, b) => a + b, 0)
  const grid = gridWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`
}

// ------------------------------------------------------- base-package reuse

/** Pull the last `<w:sectPr>` and the first `<w:tblPr>` out of a base document. */
export function harvestBase(baseXml) {
  const sectMatches = baseXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) ?? []
  const tblPr = /<w:tblPr\b[\s\S]*?<\/w:tblPr>/.exec(baseXml)
  return {
    sectPr: sectMatches.length > 0 ? sectMatches[sectMatches.length - 1] : '<w:sectPr/>',
    tblPr: tblPr ? tblPr[0] : '',
  }
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const DOC_OPEN = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" mc:Ignorable="w14 w15 wp14" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"><w:body>'

function documentXml(bodyXml, sectPr) {
  return `${XML_DECL}${DOC_OPEN}${bodyXml}${sectPr}</w:body></w:document>`
}

// --------------------------------------------------------- monthly builder

/**
 * Split the month's week columns, keeping the table's total width constant no
 * matter how many weeks a month has (3 to 5 in practice, 4 in the uploaded set).
 */
function monthlyGrid(style, weekCount) {
  const n = Math.max(1, weekCount)
  const each = Math.floor(style.weekPool / n)
  const weeks = Array.from({ length: n }, (_, i) => (i === n - 1 ? style.weekPool - each * (n - 1) : each))
  return { grid: [...style.lead, ...weeks], leadTotal: style.lead.reduce((a, b) => a + b, 0) }
}

/**
 * Build the body XML of a month plan table.
 *
 * Layout is the uploaded 18-row template: title, month label, three 工作重点 rows,
 * the 课程内容 block (one row per subject, one column per week), then the four
 * long-text rows.
 */
export function buildMonthlyBody({ plan, month, base }) {
  const style = STYLE.monthly
  const weeks = month.weeks
  const { grid } = monthlyGrid(style, weeks.length)
  const total = grid.reduce((a, b) => a + b, 0)
  const lead = style.lead
  const rows = []
  const H = style.rowHeights
  const P = style.pStyle

  // --- month label
  rows.push(tr([tc({
    span: grid.length, width: total, total, text: month.label,
    size: style.monthLabelSize, bold: true, spacing: style.contentSpacing, pStyle: P,
  })], { height: H[0] }))

  // --- 工作重点 (three rows, first column merged)
  const focusRows = [
    { label: '班级常规（习惯养成）', value: month.focus.regular },
    { label: '德育教育', value: month.focus.moral },
    { label: '安全教育', value: month.focus.safety },
  ]
  focusRows.forEach((row, i) => {
    const cells = [
      tc({
        width: lead[0], total, vMerge: i === 0 ? 'restart' : 'continue',
        text: i === 0 ? '工作重点' : '', size: style.labelSize, bold: true,
        font: style.labelFont, spacing: style.cellSpacing, pStyle: P,
      }),
      tc({
        span: 2 + weeks.length, width: total - lead[0], total, vAlign: 'top',
        text: row.value ? `${row.label}：${row.value}` : '',
        size: style.contentSize, bold: style.contentBold, jc: 'both',
        spacing: style.contentSpacing, pStyle: P,
      }),
    ]
    rows.push(tr(cells, { height: H[1 + i] }))
  })

  // --- header row: 课程内容 | blank | 第N周 + date range
  {
    const cells = [
      tc({
        width: lead[0], total, vMerge: 'restart',
        text: '课程内容', size: style.labelSize, bold: true, font: style.labelFont,
        spacing: style.cellSpacing, pStyle: P,
      }),
      tc({ span: 2, width: lead[1] + lead[2], total, vAlign: 'top', text: '', spacing: style.contentSpacing, pStyle: P }),
    ]
    weeks.forEach((week, i) => {
      cells.push(tc({
        width: grid[3 + i], total,
        text: `第${week.no}周\n${weekDateLabel(week)}`,
        size: style.weekHeaderSize, bold: true, spacing: style.contentSpacing, pStyle: P,
      }))
    })
    rows.push(tr(cells, { height: H[4] }))
  }

  // --- 课程内容 rows
  const subjectRowStart = rows.length
  SUBJECTS.forEach((subject, si) => {
    const cells = [
      tc({
        width: lead[0], total, vMerge: subjectRowStart === rows.length ? 'restart' : 'continue',
        text: '', size: style.labelSize, font: style.labelFont,
        spacing: style.cellSpacing, pStyle: P,
      }),
    ]
    if (subject.sub) {
      // Two-level left column: 艺术 spans the 美术/音乐 pair via vMerge.
      const sameGroupAsPrevious = SUBJECTS[si - 1]?.group === subject.group
      cells.push(tc({
        width: lead[1], total,
        vMerge: sameGroupAsPrevious ? 'continue' : 'restart',
        text: sameGroupAsPrevious ? '' : subject.group,
        size: style.subjectSize, bold: true, spacing: style.contentSpacing, pStyle: P,
      }))
      cells.push(tc({
        width: lead[2], total, text: subject.sub,
        size: style.subjectSize, bold: true, spacing: style.contentSpacing, pStyle: P,
      }))
    } else {
      cells.push(tc({
        span: 2, width: lead[1] + lead[2], total, text: subject.group,
        size: style.subjectSize, bold: true, spacing: style.contentSpacing, pStyle: P,
      }))
    }
    weeks.forEach((week, i) => {
      cells.push(tc({
        width: grid[3 + i], total,
        text: String(month.courses?.[subject.key]?.[i] ?? '').trim(),
        size: style.contentSize, bold: style.contentBold, font: style.labelFont,
        spacing: style.contentSpacing, pStyle: P,
      }))
    })
    rows.push(tr(cells, { height: H[5 + si] }))
  })

  // --- the four long-text rows
  MONTH_BLOCKS.forEach((block, bi) => {
    const size = block.key === 'family' || block.key === 'corner' ? style.rowLabelSize : style.rowLabelSizeAlt
    rows.push(tr([
      tc({ width: lead[0], total, text: block.label, size, bold: true, spacing: style.cellSpacing, pStyle: P }),
      tc({
        span: 2 + weeks.length, width: total - lead[0], total, vAlign: 'top',
        text: month.blocks?.[block.key] ?? '',
        size: style.contentSize, bold: style.contentBold, font: style.labelFont,
        jc: 'both', spacing: style.contentSpacing, pStyle: P,
      }),
    ], { height: H[14 + bi] }))
  })

  const title = `${plan.semesterLabel}${plan.className}教学计划`
  const body = [
    para(title, { size: style.titleSize, bold: true, jc: 'center', spacing: style.titleSpacing, pStyle: P }),
    para('', { size: 24 }),
    tbl(grid, base.tblPr, rows),
    para('', { size: 24 }),
  ].join('')

  return { bodyXml: body, grid }
}

// ---------------------------------------------------------- weekly builder

/** Main landscape layout — the one used by weeks 6-20. */
function weeklyMainRows({ plan, derived, style }) {
  const grid = style.grid
  const total = grid.reduce((a, b) => a + b, 0)
  const rows = []

  // 周工作重点 band
  FOCUS_ROWS.forEach((row, i) => {
    rows.push(tr([
      tc({
        span: 2, width: grid[0] + grid[1], total, vMerge: i === 0 ? 'restart' : 'continue',
        text: i === 0 ? '周工作重点' : '', size: 32, bold: true,
      }),
      tc({ span: 2, width: grid[2] + grid[3], total, text: row.label, size: style.focusLabelSize, bold: true }),
      tc({
        span: 4, width: grid.slice(4).reduce((a, b) => a + b, 0), total,
        text: derived.focus[row.key] ?? '', size: style.focusContentSize,
        bold: false, font: style.contentFont, jc: 'both', spacing: style.contentSpacing,
      }),
    ], { height: style.rowHeights[i] }))
  })

  // Weekday header. Day labels follow the days children actually attend, so a
  // week that starts on Thursday reads 星期四/星期五/星期六, matching the
  // uploaded 第六周 plan.
  {
    const labels = weeklyDayLabels(derived)
    const cells = [tc({ span: 3, width: grid[0] + grid[1] + grid[2], total, paras: [para('内容', { size: style.labelSize, bold: true }), para(' 时间', { size: style.labelSize, bold: false })] })]
    labels.forEach((label, i) => {
      cells.push(tc({ width: grid[3 + i], total, text: label, size: style.labelSize, bold: true }))
    })
    rows.push(tr(cells, { height: style.rowHeights[4] }))
  }

  // 集体教学活动
  {
    const cells = [tc({ span: 3, width: grid[0] + grid[1] + grid[2], total, text: '集体教学活动', size: style.labelSize, bold: true })]
    derived.lessons.forEach((lesson) => {
      cells.push(tc({
        width: grid[3 + lesson.weekday - 1], total,
        text: lesson.title ? `${lesson.activity}：\n${lesson.title}` : lesson.activity,
        size: style.contentSize, bold: false, font: style.contentFont, jc: 'center',
      }))
    })
    rows.push(tr(cells, { height: style.rowHeights[5] }))
  }

  // 游戏活动 band: 晨间 / 散步 / 下午 / 室内自主游戏
  const fullWeek = derived.days.length >= 5
  const gameRows = [
    { key: 'morning', label: GAME_ROW_LABELS.morning, perDay: true },
    { key: 'walk', label: GAME_ROW_LABELS.walk, perDay: false },
    { key: 'afternoon', label: GAME_ROW_LABELS.afternoon, perDay: true },
    { key: 'indoor', label: GAME_ROW_LABELS.indoor, perDay: false },
  ]
  gameRows.forEach((row, i) => {
    const cells = [
      tc({
        width: grid[0], total, vMerge: i === 0 ? 'restart' : 'continue',
        text: i === 0 ? '游戏活动' : '', size: style.labelSize, bold: true,
      }),
      tc({ span: 2, width: grid[1] + grid[2], total, text: row.label, size: style.labelSize, bold: true }),
    ]

    if (row.perDay) {
      const values = (derived.games[row.key] ?? []).slice(0, 5)
      while (values.length < 5) values.push('')
      if (row.key === 'afternoon' && fullWeek) values[4] = '自评活动'
      values.forEach((value, dayIndex) => {
        const isSelfEval = row.key === 'afternoon' && fullWeek && dayIndex === 4
        cells.push(tc({
          width: grid[3 + dayIndex], total,
          vMerge: isSelfEval ? 'restart' : null,
          text: value,
          size: style.contentSize, bold: false, font: style.contentFont,
        }))
      })
      rows.push(tr(cells, { height: style.rowHeights[row.key === 'afternoon' ? 8 : 6] }))
      return
    }

    if (row.key === 'walk') {
      cells.push(tc({
        span: 5, width: grid.slice(3).reduce((a, b) => a + b, 0), total,
        text: derived.games.walk, size: style.labelSize, bold: false,
      }))
      rows.push(tr(cells, { height: style.rowHeights[7] }))
      return
    }

    // 室内自主游戏: Mon-Thu holds the material note; Friday is the 自评活动 cell
    // merged up from the 下午 row, exactly as the template does it.
    if (fullWeek) {
      cells.push(tc({
        span: 4, width: grid.slice(3, 7).reduce((a, b) => a + b, 0), total,
        text: derived.games.indoor, size: style.labelSize, bold: false,
      }))
      cells.push(tc({
        width: grid[7], total, vMerge: 'continue', text: '',
        size: style.contentSize, bold: false, font: style.contentFont,
      }))
    } else {
      cells.push(tc({
        span: 5, width: grid.slice(3).reduce((a, b) => a + b, 0), total,
        text: derived.games.indoor, size: style.labelSize, bold: false,
      }))
    }
    rows.push(tr(cells, { height: style.rowHeights[9] }))
  })

  return rows
}

const GAME_ROW_LABELS = Object.freeze({
  morning: '晨间',
  walk: '散步',
  afternoon: '下午',
  indoor: '室内自主游戏\n(材料填充）',
})

/**
 * Weekday header labels.
 *
 * Main layout: the days the week actually runs, left-aligned (第六周 opens on a
 * Thursday and the uploaded file labels the first column 星期四). Week1 layout:
 * fixed 星期一…星期五, as that template does.
 */
const DAY_LABELS_7 = Object.freeze(['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'])

function weeklyDayLabels(derived) {
  if (derived.layout === 'week1') return [...WEEKDAY_LABELS]
  const labels = []
  for (const iso of derived.days.slice(0, 5)) {
    const day = Number(iso.slice(8, 10))
    const month = Number(iso.slice(5, 7))
    const year = Number(iso.slice(0, 4))
    // Local construction, so a Saturday never slides into Friday through a UTC shift.
    const dow = new Date(year, month - 1, day).getDay()
    labels.push(DAY_LABELS_7[(dow === 0 ? 7 : dow) - 1])
  }
  while (labels.length < 5) labels.push('')
  return labels
}

/** Portrait 14-row layout, used by the uploaded 第一周 plan. */
function weeklyW1Rows({ derived, style }) {
  const grid = style.grid
  const total = grid.reduce((a, b) => a + b, 0)
  const rows = []
  const focusRows = [
    { label: '班级常规', value: derived.focus.regular },
    { label: '安全工作', value: derived.focus.safety },
    { label: '生活养成教育', value: derived.focus.moral },
    { label: '环境创设与材料投放', value: derived.monthBlocks?.corner ?? '' },
    { label: '家园共育', value: derived.focus.family },
  ]
  focusRows.forEach((row, i) => {
    rows.push(tr([
      tc({
        width: grid[0], total, vMerge: i === 0 ? 'restart' : 'continue',
        text: i === 0 ? '周工作重点' : '', size: style.labelSize, bold: true,
      }),
      tc({ span: 2, width: grid[1] + grid[2], total, text: row.label, size: style.labelSize, bold: true }),
      tc({
        span: 4, width: grid.slice(3).reduce((a, b) => a + b, 0), total,
        text: row.value, size: style.contentSize, font: style.contentFont, jc: 'both',
      }),
    ]))
  })

  const labels = [...WEEKDAY_LABELS]
  rows.push(tr([
    tc({ span: 2, width: grid[0] + grid[1], total, paras: [para('内容', { size: style.labelSize, bold: true }), para(' 时间', { size: style.labelSize, bold: true })] }),
    ...labels.map((l, i) => tc({ width: grid[2 + i], total, text: l, size: style.labelSize, bold: true })),
  ]))

  const bands = [
    { band: '上午' },
    { label: '晨间活动', values: derived.games.morning },
    // Two lesson rows, merged into one tall label cell exactly as the uploaded
    // 第一周 table does it (its row 8 is vMerge=restart, row 9 continues it).
    { label: '集体教学活动', values: derived.lessons.map((l) => (l.title ? `${l.activity}：\n${l.title}` : l.activity)), vMerge: 'restart' },
    // The second row is not decoration: ten slots instead of five is what lets a
    // week carrying more than five courses fit this portrait layout at all.
    { label: '', values: w1OverflowRow(derived), vMerge: 'continue' },
    { label: '户外活动', values: derived.games.afternoon },
    { band: '下午' },
    { label: '自主活动', values: derived.games.afternoon },
    { label: '离园活动', values: [] },
  ]

  bands.forEach((row) => {
    if (row.band) {
      rows.push(tr([tc({ span: 7, width: total, total, text: row.band, size: style.labelSize, bold: true })]))
      return
    }
    const cells = [tc({
      span: 2, width: grid[0] + grid[1], total, text: row.label,
      vMerge: row.vMerge ?? null,
      size: style.labelSize, bold: true,
    })]
    const values = (row.values ?? []).slice(0, 5)
    while (values.length < 5) values.push('')
    values.forEach((value, i) => {
      cells.push(tc({ width: grid[2 + i], total, text: value, size: style.contentSize, font: style.contentFont }))
    })
    rows.push(tr(cells))
  })

  return rows
}

/**
 * Second 集体教学活动 row for the portrait layout: the week's overflow.
 *
 * `assignWeekdays` fills five slots and reports the rest rather than dropping
 * them. Here there is somewhere to put them, so each takes its subject's
 * preferred weekday (or the first free one) instead of being lost.
 */
function w1OverflowRow(derived) {
  const row = ['', '', '', '', '']
  const taken = new Set(derived.lessons.map((l, i) => (l.title ? i : -1)).filter((i) => i >= 0))
  for (const item of derived.overflow ?? []) {
    const subject = SUBJECT_BY_KEY[item.key]
    const preferred = Math.min(5, Math.max(1, subject?.prefDay ?? 1)) - 1
    let at = taken.has(preferred) ? row.findIndex((v, i) => !taken.has(i) && v === '') : preferred
    if (at < 0) at = row.findIndex((v, i) => !taken.has(i) && v === '')
    if (at < 0) continue
    taken.add(at)
    row[at] = `${item.activity}：\n${item.title}`
  }
  return row
}

export function buildWeeklyBody({ plan, derived, base }) {
  const style = derived.layout === 'week1' ? STYLE.weeklyW1 : STYLE.weekly
  const grid = style.grid
  const rows = derived.layout === 'week1'
    ? weeklyW1Rows({ derived, style })
    : weeklyMainRows({ plan, derived, style })

  const header = para(derived.header.title, { size: style.titleSize, bold: true, jc: 'center' })
  const subtitle = para(derived.subtitle, { size: style.titleSize >= 32 ? 28 : 24, bold: true, jc: 'both' })
  const body = [header, subtitle, para('', { size: 21 }), tbl(grid, base.tblPr, rows), para('', { size: 21 })].join('')
  return { bodyXml: body, grid }
}

// --------------------------------------------------------------- rendering

async function readBase(kind) {
  const buffer = await readFile(join(TEMPLATE_DIR, TEMPLATE_FILES[kind]))
  const xml = readPart(buffer, 'word/document.xml')
  return { buffer, xml, ...harvestBase(xml) }
}

/** Rewrite docProps/core.xml so the file's title matches its contents. */
function coreXml(existing, { title, author, created }) {
  const stamp = (created ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z')
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><cp:lastModifiedBy>${esc(author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`
}

/** Render one month plan. @returns {Promise<{buffer:Buffer, title:string, grid:number[]}>} */
export async function renderMonthly(plan, month, options = {}) {
  const base = await readBase(options.template ?? 'monthly')
  const { bodyXml, grid } = buildMonthlyBody({ plan, month, base })
  const title = `${plan.semesterLabel}${plan.className}${month.label}教学计划`
  const buffer = rewritePackage(base.buffer, {
    'word/document.xml': documentXml(bodyXml, base.sectPr),
    'docProps/core.xml': coreXml(null, { title, author: plan.kindergarten || plan.className }),
  })
  return { buffer, title, grid }
}

/** Render one weekly plan. @returns {Promise<{buffer:Buffer, title:string, derived:object}>} */
export async function renderWeekly(plan, weekNo, options = {}) {
  const derived = deriveWeek(plan, weekNo)
  if (!derived) throw new Error(`week ${weekNo} is not in this plan`)
  const explicit = options.template
    ?? (derived.layout === 'week1' ? 'weeklyW1' : 'weekly')
  const base = await readBase(explicit)
  const { bodyXml } = buildWeeklyBody({ plan, derived, base })
  const title = `${plan.className}第${derived.weekNoCn}周活动计划（${derived.dates.short}）`
  const buffer = rewritePackage(base.buffer, {
    'word/document.xml': documentXml(bodyXml, base.sectPr),
    'docProps/core.xml': coreXml(null, { title, author: plan.kindergarten || plan.className }),
  })
  return { buffer, title, derived }
}

/** Render every weekly plan of the plan set. */
export async function renderAllWeekly(plan, options = {}) {
  const out = []
  for (const derived of deriveAll(plan)) {
    const rendered = await renderWeekly(plan, derived.weekNo, options)
    out.push({ weekNo: derived.weekNo, title: rendered.title, buffer: rendered.buffer })
  }
  return out
}

/** Safe-ish filename for an exported document. */
export function exportName(plan, kind, monthOrWeek) {
  const stem = `${plan.kindergarten}${plan.className}`.replace(/[\\/:*?"<>|]/g, '')
  if (kind === 'monthly') return `${stem}${monthOrWeek.label}月计划.docx`
  const derived = typeof monthOrWeek === 'number' ? { weekNo: monthOrWeek } : monthOrWeek
  const noCn = deriveWeek(plan, derived.weekNo)?.weekNoCn ?? derived.weekNo
  return `${stem}第${noCn}周周计划.docx`
}

export default { renderMonthly, renderWeekly, renderAllWeekly, buildMonthlyBody, buildWeeklyBody, harvestBase, exportName, STYLE, TEMPLATE_DIR }
