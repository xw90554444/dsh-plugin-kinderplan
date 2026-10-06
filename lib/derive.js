/**
 * The month -> week compiler.
 *
 * Pure functions, no I/O and no LLM: the same month column always compiles to
 * the same weekly table. This is what makes the two documents agree — the
 * weekly plan has no course field of its own to drift out of sync with.
 *
 * Verified against the uploaded set: feeding the October column for 第七周/第八周/
 * 第九周 reproduces the weekday layout of the matching weekly .docx exactly
 * (语言 → Monday, 数学/音乐/美术 → Tuesday, 科学 → Wednesday, 社会 → Thursday,
 * 安全 → Friday).
 */

import {
  SUBJECT_KEYS, SUBJECT_BY_KEY, SLOT_ORDER, WEEKDAY_LABELS, DAY_LABELS_7, FOCUS_ROWS, GAME_ROWS,
  cnNumber, findWeek, weekFullDateLabel, weekDateLabel, shortDay,
} from './model.js'

/**
 * Place a week's course titles onto weekdays.
 *
 * Every present title is consumed, in `SLOT_ORDER`; each takes its preferred
 * weekday, else the earliest free one. A sixth title cannot be dropped — it
 * lands in `overflow` so the caller can surface it instead of losing content.
 *
 * @param {Record<string, string[]>} courses month course columns
 * @param {number} index index of the week inside the month
 * @returns {{slots: Array<{key:string,title:string,activity:string}|null>, overflow: Array<{key:string,title:string,activity:string}>, filled: number}}
 */
export function assignWeekdays(courses, index) {
  /** @type {Array<{key:string,title:string,activity:string}|null>} */
  const slots = [null, null, null, null, null]
  const overflow = []
  let filled = 0

  for (const key of SLOT_ORDER) {
    const title = String(courses?.[key]?.[index] ?? '').trim()
    if (!title) continue
    const subject = SUBJECT_BY_KEY[key]
    const item = { key, title, activity: subject.activity, group: subject.group, sub: subject.sub }

    const preferred = Math.min(5, Math.max(1, subject.prefDay)) - 1
    let target = slots[preferred] === null ? preferred : slots.findIndex((s) => s === null)
    if (target < 0) {
      // Six or more titles in one week. The template has five weekday columns,
      // so the surplus is reported rather than silently dropped.
      overflow.push(item)
      continue
    }
    slots[target] = item
    filled += 1
  }

  return { slots, overflow, filled }
}

/** The month column for one week, as an ordered list of the titles it holds. */
export function columnOf(month, index) {
  const present = []
  for (const key of SUBJECT_KEYS) {
    const title = String(month?.courses?.[key]?.[index] ?? '').trim()
    if (title) present.push({ key, title, activity: SUBJECT_BY_KEY[key].activity })
  }
  return present
}

/**
 * Focus text: a per-week override wins field by field, otherwise the month's.
 *
 * 家园共育 is the exception. A month plan carries no 家园共育 工作重点 row — that
 * theme lives in its 家园共育 long-text block — so without this fallback every
 * derived week would ship an empty row and the teacher would retype it 21 times.
 */
function resolveFocus(plan, month, weekNo) {
  const override = plan.weekly?.[String(weekNo)]?.focus ?? {}
  const monthFocus = month?.focus ?? {}
  const condense = plan.focusMode !== 'full'
  const out = {}
  for (const { key } of FOCUS_ROWS) {
    const own = String(override[key] ?? '').trim()
    if (own) { out[key] = own; continue }
    const fromMonth = String(monthFocus[key] ?? '').trim()
    const fallback = key === 'family' ? String(month?.blocks?.family ?? '').trim() : ''
    const source = fromMonth || fallback
    out[key] = condense ? condenseFocus(source) : source
  }
  return out
}

/**
 * Turn a month-level 工作重点 paragraph into the one-to-two lines a weekly plan
 * actually carries.
 *
 * The uploaded weeklies are distilled, not copied: October's month text for
 * 班级常规 runs four sentences, while the matching 第八周 weekly keeps only
 * 「强化课堂学习常规，培养幼儿专注倾听、举手发言、端正坐姿、遵守课堂秩序的良好学习习惯。」
 * Copying the whole paragraph verbatim both reads wrong and pushes the weekly
 * table onto a second page — the one thing a weekly plan must not do.
 *
 * Numbered lists keep their first two points; prose keeps its first two
 * sentences. The studio exposes the full month text alongside, and a per-week
 * override always wins, so nothing is lost — only deferred.
 *
 * @param {string} text
 * @param {{maxPoints?:number, maxChars?:number}} [options]
 */
export function condenseFocus(text, { maxPoints = 2, maxChars = 96 } = {}) {
  let value = String(text ?? '').trim()
  if (!value) return ''
  // Drop the label the month table writes inline (「安全教育：...」).
  value = value.replace(/^[^：:\n]{2,14}[：:]\s*/, '').trim()

  // Normalise exotic numbering to `1. ` so points can be split reliably.
  const normalised = value
    .replace(/[（(]\s*(\d{1,2})\s*[)）]/g, '$1. ')
    .replace(/(^|\s)(\d{1,2})\s*[、．]/g, '$1$2. ')

  const numbered = normalised.split(/(?=(?:^|\s)\d{1,2}\.\s)/).map((s) => s.trim()).filter(Boolean)
  let picked
  if (numbered.length >= 2) {
    picked = numbered.slice(0, maxPoints)
  } else {
    const sentences = value.split(/(?<=[。；;！!？?])/).map((s) => s.trim()).filter(Boolean)
    picked = sentences.slice(0, maxPoints)
  }

  let out = picked.join('')
  if (out.length > maxChars) {
    // Cut on a sentence boundary when one is close enough, otherwise hard-truncate.
    const cut = out.slice(0, maxChars)
    const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf(';'))
    out = lastStop >= maxChars * 0.6 ? cut.slice(0, lastStop + 1) : `${cut.replace(/[，、,]$/, '')}…`
  }
  return out
}

/** The header lines above the weekly table. */
export function weeklyHeader(plan, week, layout) {
  const noCn = cnNumber(week.no)
  const title = layout === 'week1'
    ? `${plan.kindergarten} ${plan.className} 第${noCn}周 活动安排计划表`
    : `${plan.kindergarten}${plan.className}第${noCn}周活动下排计划表`
  return { title, weekNoCn: noCn }
}

export function weeklySubtitle(plan, week, theme) {
  return `主题名称：《${theme || '　'}》　　时间：${weekFullDateLabel(week)}`
}

/**
 * Compile one week of the plan into the exact cell contents the .docx writer and
 * the UI both render.
 *
 * Every activity carries `origin`, naming the month column it was read from —
 * that provenance is what the consistency report and the UI's "来源" tooltip show.
 *
 * @param {object} plan normalised plan set
 * @param {number} weekNo
 * @returns {object|null}
 */
export function deriveWeek(plan, weekNo) {
  const found = findWeek(plan, weekNo)
  if (!found) return null
  const { month, week, index } = found
  const override = plan.weekly?.[String(weekNo)] ?? {}
  const layout = override.layout || week.layout || month?.weeks?.[index]?.layout || plan.defaultWeeklyLayout || 'main'

  const { slots, overflow, filled } = assignWeekdays(month?.courses ?? {}, index)
  const theme = String(override.theme || week.theme || month?.theme || '').trim()
  const focus = resolveFocus(plan, month, weekNo)

  const lessons = slots.map((slot, i) => {
    // `weekday` is the slot index — the Monday-first column of the table.
    // `calendarWeekday` is the real day of the week that column falls on, which
    // is what a reader of the .docx sees: 第六周 runs Thursday-Saturday, so its
    // first column is 星期四, not 星期一. The reader decodes the header labels,
    // so validation has to compare on this field, not on the slot index.
    const iso = week.days?.[i] ?? null
    const calendarWeekday = iso
      ? (() => {
        const day = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()
        return day === 0 ? 7 : day
      })()
      : i + 1
    return {
      weekday: i + 1,
      calendarWeekday,
      calendarLabel: DAY_LABELS_7[calendarWeekday - 1],
      label: WEEKDAY_LABELS[i],
      activity: slot?.activity ?? '',
      title: slot?.title ?? '',
      subjectKey: slot?.key ?? null,
      origin: slot ? { monthNo: month?.monthNo ?? null, weekIndex: index, weekNo: week.no, subjectKey: slot.key } : null,
    }
  })

  const games = {
    morning: (override.games?.morning ?? []).slice(0, 5),
    afternoon: (override.games?.afternoon ?? []).slice(0, 5),
    walk: String(override.games?.walk ?? '').trim(),
    indoor: String(override.games?.indoor ?? '').trim(),
    indoorTrailing: String(override.games?.indoorTrailing ?? '').trim(),
  }
  while (games.morning.length < 5) games.morning.push('')
  while (games.afternoon.length < 5) games.afternoon.push('')

  return {
    weekNo: week.no,
    weekNoCn: cnNumber(week.no),
    monthNo: month?.monthNo ?? null,
    monthLabel: month?.label ?? '',
    monthId: month?.id ?? null,
    indexInMonth: index,
    layout,
    header: weeklyHeader(plan, week, layout),
    subtitle: weeklySubtitle(plan, week, theme),
    theme,
    dates: { start: week.start, end: week.end, short: weekDateLabel(week), long: weekFullDateLabel(week) },
    days: week.days,
    focus,
    lessons,
    overflow,
    filled,
    games,
    column: columnOf(month, index),
    monthBlocks: { ...(month?.blocks ?? {}) },
    notes: String(override.notes ?? '').trim(),
  }
}

/**
 * Every week in the plan, compiled. The `.docx` export, the UI and the
 * consistency report all read this one array.
 */
export function deriveAll(plan) {
  const rows = []
  for (const month of plan.months) {
    month.weeks.forEach((week) => {
      const derived = deriveWeek(plan, week.no)
      if (derived) rows.push(derived)
    })
  }
  return rows.sort((a, b) => a.weekNo - b.weekNo)
}

/** Compact summary used by list views and the agent tools. */
export function summarise(plan) {
  const weeks = deriveAll(plan)
  const withCourses = weeks.filter((w) => w.filled > 0)
  return {
    id: plan.id,
    title: `${plan.semesterLabel}${plan.className}计划`,
    kindergarten: plan.kindergarten,
    className: plan.className,
    semesterLabel: plan.semesterLabel,
    termStart: plan.termStart,
    termEnd: plan.termEnd,
    monthCount: plan.months.length,
    weekCount: weeks.length,
    weeksWithCourses: withCourses.length,
    weeksWithFocus: weeks.filter((w) => Object.values(w.focus).some((v) => v)).length,
    courseCount: weeks.reduce((n, w) => n + w.filled, 0),
    overflowWeeks: weeks.filter((w) => w.overflow.length > 0).map((w) => w.weekNo),
    updatedAt: plan.updatedAt,
  }
}

export default { assignWeekdays, columnOf, deriveWeek, deriveAll, summarise, weeklyHeader, weeklySubtitle, condenseFocus }
