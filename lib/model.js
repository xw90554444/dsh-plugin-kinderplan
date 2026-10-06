/**
 * The plan data model.
 *
 * Two documents, one source of truth:
 *
 *   monthly plan  — a month table. Its week columns hold 「第N周 / 起止日期」 plus
 *                   one course title per subject per week, and the month-level
 *                   blocks (工作重点, 户外活动, 离园活动, 家园共育, 环境区角).
 *   weekly plan   — one week table. It carries NO course data of its own: every
 *                   activity it shows is read out of the owning month's column.
 *
 * That asymmetry is the whole point. The uploaded plans were maintained by hand
 * and drifted (a course landed a week early, one was labelled under the wrong
 * subject); making the monthly column the only place a course can be written
 * makes "周计划和月计划对得上" structural rather than a proofreading habit.
 *
 * Weekday placement is deterministic — see SUBJECTS[].prefDay and
 * `assignWeekdays` — so the same month column always compiles to the same week
 * layout, in this plugin and in the exported .docx alike.
 */

// --------------------------------------------------------------- subjects

/**
 * The nine 课程内容 rows of the month table, in template order.
 *
 * `group`/`sub` reproduce the template's two-level left column (艺术 → 美术,
 * 科学 → 数学). `prefDay` is the weekday the subject prefers: the mapping that
 * reproduces every uploaded weekly plan exactly.
 */
export const SUBJECTS = Object.freeze([
  { key: 'language', group: '语言', sub: null, activity: '语言活动', prefDay: 1 },
  { key: 'artManual', group: '艺术', sub: '美术', activity: '美术活动', prefDay: 2 },
  { key: 'artMusic', group: '艺术', sub: '音乐', activity: '音乐活动', prefDay: 2 },
  { key: 'health', group: '健康', sub: null, activity: '健康活动', prefDay: 4 },
  { key: 'social', group: '社会', sub: null, activity: '社会活动', prefDay: 4 },
  { key: 'science', group: '科学', sub: '科学', activity: '科学活动', prefDay: 3 },
  { key: 'math', group: '科学', sub: '数学', activity: '数学活动', prefDay: 1 },
  { key: 'safety', group: '安全', sub: null, activity: '安全活动', prefDay: 5 },
  { key: 'finger', group: '手指律动', sub: null, activity: '手指律动', prefDay: 3 },
])

export const SUBJECT_KEYS = Object.freeze(SUBJECTS.map((s) => s.key))
export const SUBJECT_BY_KEY = Object.freeze(Object.fromEntries(SUBJECTS.map((s) => [s.key, s])))

/**
 * Slot-filling order. Courses are placed weekday by weekday in this sequence;
 * the order is what makes 语言 land on Monday and 数学 fall to Tuesday once
 * Monday is taken (matching 第七周 in the uploaded set).
 */
export const SLOT_ORDER = Object.freeze(['language', 'math', 'artMusic', 'artManual', 'science', 'social', 'safety', 'health', 'finger'])

export const WEEKDAY_LABELS = Object.freeze(['星期一', '星期二', '星期三', '星期四', '星期五'])

/**
 * All seven labels.
 *
 * A teaching week can start on a Thursday (第六周) or run into a Saturday
 * (that same week, after the National Day 调休), so anything that names a
 * weekday by its real position needs the full set, not just Monday-Friday.
 */
export const DAY_LABELS_7 = Object.freeze([...WEEKDAY_LABELS, '星期六', '星期日'])

/** The four 周工作重点 rows of the weekly table. */
export const FOCUS_ROWS = Object.freeze([
  { key: 'regular', label: '常规（生活）培养', from: 'regular' },
  { key: 'moral', label: '德育教育', from: 'moral' },
  { key: 'safety', label: '安全工作', from: 'safety' },
  { key: 'family', label: '家园共育', from: 'family' },
])

/** Month-level long-text blocks. */
export const MONTH_BLOCKS = Object.freeze([
  { key: 'outdoor', label: '户外活动' },
  { key: 'dismissal', label: '离园活动' },
  { key: 'family', label: '家园共育' },
  { key: 'corner', label: '环境区角' },
])

/** Rows of the weekly 游戏活动 band. */
export const GAME_ROWS = Object.freeze([
  { key: 'morning', label: '晨间', perDay: true },
  { key: 'walk', label: '散步', perDay: false },
  { key: 'afternoon', label: '下午', perDay: true },
  { key: 'indoor', label: '室内自主游戏(材料填充）', perDay: false, trailingLabel: true },
])

/**
 * Two weekly layouts ship with the plugin because the uploaded set contains two.
 *
 *  - `main`  the landscape 10-row table used for weeks 6-20（内容/时间 → 集体教学
 *            活动 → 游戏活动 ×4）.
 *  - `week1` the portrait 14-row table used for week 1（上午/下午 bands with
 *            晨间活动 / 集体教学活动 ×2 / 户外活动 / 自主活动 / 离园活动）.
 */
export const WEEKLY_LAYOUTS = Object.freeze(['main', 'week1'])

// ------------------------------------------------------------ small utils

const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0
const str = (v, fallback = '') => (isNonEmpty(v) ? String(v).trim() : fallback)
const list = (v) => (Array.isArray(v) ? v : [])

/** '2026-09-01' -> Date at local midnight (no timezone surprises from `new Date(str)`). */
export function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDay(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** 'YYYY-MM-DD' -> 'M.D' (the template writes date ranges without leading zeros). */
export function shortDay(value) {
  const d = parseDay(value)
  return d ? `${d.getMonth() + 1}.${d.getDate()}` : String(value ?? '')
}

/** '2026-09-01' -> '2026年9月1日' */
export function longDay(value) {
  const d = parseDay(value)
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : String(value ?? '')
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 21 -> '二十一'. Kindergarten week numbers stay well under 100. */
export function cnNumber(n) {
  const value = Math.max(0, Math.trunc(Number(n) || 0))
  if (value <= 10) return value === 10 ? '十' : CN_DIGITS[value]
  if (value < 20) return `十${CN_DIGITS[value - 10]}`
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${CN_DIGITS[tens]}十${ones === 0 ? '' : CN_DIGITS[ones]}`
}

// ------------------------------------------------------- semester calendar

/** Built-in PRC school holiday windows for 2026 autumn. Toggleable per plan. */
export const DEFAULT_HOLIDAYS = Object.freeze([
  { id: 'midautumn', label: '中秋节', from: '2026-09-25', to: '2026-09-25', enabled: false },
  { id: 'national', label: '国庆节', from: '2026-10-01', to: '2026-10-07', enabled: true },
  { id: 'newyear', label: '元旦', from: '2027-01-01', to: '2027-01-03', enabled: true },
])

/**
 * Weekend days that are teaching days (调休补课).
 *
 * 2026-10-10 is the reason this list exists: the uploaded 第六周 plan runs
 * 10.8-10.10 and its weekday header reads 星期四/星期五/星期六. Without the
 * makeup day the calendar would silently shorten that week to two days.
 */
export const DEFAULT_MAKEUP_DAYS = Object.freeze(['2026-10-10'])

/**
 * Split a term into teaching weeks.
 *
 * Weeks are grouped by the Monday they fall in — the same convention the
 * uploaded set follows, which is why 9.28-9.30 becomes 第五周 and 10.8-10.10
 * (after the National Day break) becomes 第六周 rather than merging into one.
 *
 * A week's span is its first and last actual school day, so a four-day opening
 * week or a week cut short by a holiday reports the days children are really in.
 *
 * @param {object} options
 * @param {string} options.termStart 'YYYY-MM-DD'
 * @param {string} options.termEnd   'YYYY-MM-DD'
 * @param {Array<{from:string,to:string,enabled?:boolean}>} [options.holidays]
 * @param {string[]} [options.makeupDays] weekend days that are teaching days
 * @returns {Array<{no:number, start:string, end:string, days:string[], monthNo:number}>}
 */
export function computeWeeks({ termStart, termEnd, holidays = [], makeupDays = [] } = {}) {
  const start = parseDay(termStart)
  const end = parseDay(termEnd)
  if (!start || !end || end < start) return []

  const windows = list(holidays)
    .filter((h) => h && h.enabled !== false)
    .map((h) => ({ from: parseDay(h.from), to: parseDay(h.to) }))
    .filter((h) => h.from && h.to)

  const makeup = new Set(list(makeupDays).map((d) => str(d)).filter(Boolean))
  const inHoliday = (day) => windows.some((w) => day >= w.from && day <= w.to)

  /** Monday of the week containing `day`, as an ISO date string. */
  const mondayKey = (day) => {
    const copy = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    const dow = copy.getDay() === 0 ? 7 : copy.getDay() // 1 = Monday
    copy.setDate(copy.getDate() - (dow - 1))
    return formatDay(copy)
  }

  const buckets = new Map()
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = formatDay(d)
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    const isWeekend = dow >= 6
    const schoolDay = (isWeekend ? makeup.has(iso) : true) && !inHoliday(d)
    if (!schoolDay) continue
    const key = mondayKey(d)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(iso)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, days]) => ({
      no: 0,
      start: days[0],
      end: days[days.length - 1],
      days,
      monthNo: monthOfWeek(days),
    }))
    .map((week, index) => ({ ...week, no: index + 1 }))
}

/**
 * Which month a week belongs to.
 *
 * By majority of teaching days, not by the start date: 第十四周 (11.30-12.4) is
 * four December days against one November day and belongs to the December plan,
 * exactly as the uploaded documents file it.
 */
export function monthOfWeek(days) {
  const tally = new Map()
  for (const iso of days) {
    const d = parseDay(iso)
    if (d) tally.set(d.getMonth() + 1, (tally.get(d.getMonth() + 1) ?? 0) + 1)
  }
  let best = null
  let bestCount = -1
  for (const [month, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (count >= bestCount) { best = month; bestCount = count }
  }
  return best
}

// -------------------------------------------------------------- normalising

function normaliseFocus(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    regular: str(source.regular),
    moral: str(source.moral),
    safety: str(source.safety),
    family: str(source.family),
  }
}

/** Course columns: nine subjects × the month's week slots, blanks allowed. */
function normaliseCourses(raw, weekCount) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of SUBJECT_KEYS) {
    const column = list(source[key]).map((v) => str(v))
    while (column.length < weekCount) column.push('')
    out[key] = column.slice(0, Math.max(weekCount, 0))
  }
  return out
}

function normaliseBlocks(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const { key } of MONTH_BLOCKS) out[key] = str(source[key])
  return out
}

function normaliseWeekRow(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const days = list(source.days).map((d) => str(d)).filter(Boolean)
  return {
    no: Number.isInteger(source.no) && source.no > 0 ? source.no : index + 1,
    start: str(source.start),
    end: str(source.end),
    days,
    monthNo: Number.isInteger(source.monthNo) ? source.monthNo : (days.length ? monthOfWeek(days) : null),
    theme: str(source.theme),
    layout: WEEKLY_LAYOUTS.includes(source.layout) ? source.layout : null,
  }
}

function normaliseMonth(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const monthNo = Number.isInteger(source.monthNo) && source.monthNo >= 1 && source.monthNo <= 12
    ? source.monthNo
    : index + 9 <= 12 ? index + 9 : index - 3
  const weeks = list(source.weeks).map(normaliseWeekRow)
  return {
    id: str(source.id, `m${monthNo}`),
    monthNo,
    label: str(source.label, `${monthNo}月份`),
    theme: str(source.theme),
    focus: normaliseFocus(source.focus),
    courses: normaliseCourses(source.courses, weeks.length),
    blocks: normaliseBlocks(source.blocks),
    weeks,
  }
}

/** Weekly-only overrides: things a week needs beyond what the month column implies. */
function normaliseWeekOverride(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const perDay = (v) => {
    const arr = list(v).map((x) => str(x))
    while (arr.length < 5) arr.push('')
    return arr.slice(0, 5)
  }
  // Lessons read out of a pre-existing weekly .docx. Kept so the consistency
  // report can point at exactly where a hand-made plan drifted from the month.
  const imported = source.imported && typeof source.imported === 'object'
    ? {
      source: str(source.imported.source),
      lessons: list(source.imported.lessons).map((l) => ({
        weekday: Number.isInteger(l?.weekday) ? l.weekday : null,
        subjectKey: str(l?.subjectKey),
        activity: str(l?.activity),
        title: str(l?.title),
      })).filter((l) => l.title || l.activity),
      focus: normaliseFocus(source.imported.focus),
      theme: str(source.imported.theme),
    }
    : null
  return {
    theme: str(source.theme),
    focus: normaliseFocus(source.focus),
    games: {
      morning: perDay(source.games?.morning),
      afternoon: perDay(source.games?.afternoon),
      walk: str(source.games?.walk),
      indoor: str(source.games?.indoor),
      indoorTrailing: str(source.games?.indoorTrailing),
    },
    /** Extra 集体教学活动 lines per weekday, when a week carries more than five. */
    extraLessons: perDay(source.extraLessons),
    layout: WEEKLY_LAYOUTS.includes(source.layout) ? source.layout : null,
    /** week1-layout rows. */
    week1: source.week1 && typeof source.week1 === 'object' ? source.week1 : null,
    imported,
    notes: str(source.notes),
  }
}

/**
 * Coerce anything into a usable plan set. A hand-edited or partially imported
 * JSON must never brick the studio, so every field falls back rather than throws.
 */
export function normalisePlanSet(raw, idHint) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const weeks = list(source.weeks).map(normaliseWeekRow)
  const months = list(source.months).map(normaliseMonth)
  const weeklyRaw = source.weekly && typeof source.weekly === 'object' ? source.weekly : {}
  const weekly = {}
  for (const [key, value] of Object.entries(weeklyRaw)) {
    const no = Number(key)
    if (Number.isInteger(no) && no > 0) weekly[String(no)] = normaliseWeekOverride(value)
  }
  return {
    id: str(source.id, idHint ?? 'plan'),
    kindergarten: str(source.kindergarten, '渝水区第三幼儿园'),
    className: str(source.className, '大一班'),
    semesterLabel: str(source.semesterLabel, '2026年秋季学期'),
    year: Number.isInteger(source.year) ? source.year : 2026,
    termStart: str(source.termStart, '2026-09-01'),
    termEnd: str(source.termEnd, '2027-01-22'),
    holidays: list(source.holidays).length
      ? list(source.holidays).map((h) => ({
        id: str(h?.id, 'h'),
        label: str(h?.label),
        from: str(h?.from),
        to: str(h?.to),
        enabled: h?.enabled !== false,
      }))
      : DEFAULT_HOLIDAYS.map((h) => ({ ...h })),
    makeupDays: Array.isArray(source.makeupDays)
      ? source.makeupDays.map((d) => str(d)).filter(Boolean)
      : [...DEFAULT_MAKEUP_DAYS],
    weeks,
    months,
    weekly,
    defaultWeeklyLayout: WEEKLY_LAYOUTS.includes(source.defaultWeeklyLayout) ? source.defaultWeeklyLayout : 'main',
    /**
     * How a week's 工作重点 is taken from its month.
     *  - 'condense' (default) the first two points / sentences, which is what the
     *    hand-written weeklies contain and what keeps the table on one page.
     *  - 'full' the month paragraph verbatim.
     */
    focusMode: source.focusMode === 'full' ? 'full' : 'condense',
    notes: str(source.notes),
    createdAt: str(source.createdAt, new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Re-derive the week list from the term + holidays and keep every month's week
 * columns aligned with it. Called after any calendar edit; week numbers and
 * month membership are owned by the calendar, never hand-maintained.
 */
export function resyncCalendar(plan) {
  const fresh = computeWeeks({
    termStart: plan.termStart,
    termEnd: plan.termEnd,
    holidays: plan.holidays,
    makeupDays: plan.makeupDays,
  })
  const previous = new Map(plan.weeks.map((w) => [w.start, w]))
  const weeks = fresh.map((w) => {
    const old = previous.get(w.start)
    return { ...w, theme: old?.theme ?? '', layout: old?.layout ?? null }
  })

  const months = []
  // Month order follows the calendar, not the calendar year: a 秋季学期 runs
  // 9,10,11,12,1 and sorting by month number would file January first.
  const monthOrder = []
  for (const week of weeks) if (!monthOrder.includes(week.monthNo)) monthOrder.push(week.monthNo)
  for (const monthNo of monthOrder) {
    const monthWeeks = weeks.filter((w) => w.monthNo === monthNo)
    const existing = plan.months.find((m) => m.monthNo === monthNo)
    const courses = {}
    for (const key of SUBJECT_KEYS) {
      const oldColumn = existing?.courses?.[key] ?? []
      // Carry titles across by week start date, so re-syncing the calendar
      // never silently discards entered course content.
      courses[key] = monthWeeks.map((w) => {
        const oldIndex = existing?.weeks?.findIndex((ow) => ow.start === w.start) ?? -1
        return oldIndex >= 0 ? str(oldColumn[oldIndex]) : ''
      })
    }
    months.push({
      id: existing?.id ?? `m${monthNo}`,
      monthNo,
      label: existing?.label ?? `${monthNo}月份`,
      theme: existing?.theme ?? '',
      focus: existing?.focus ?? { regular: '', moral: '', safety: '', family: '' },
      courses,
      blocks: existing?.blocks ?? { outdoor: '', dismissal: '', family: '', corner: '' },
      weeks: monthWeeks.map((w) => ({ ...w })),
    })
  }

  return { ...plan, weeks, months }
}

// ------------------------------------------------------------------ lookup

export function findMonth(plan, weekNo) {
  return plan.months.find((m) => m.weeks.some((w) => w.no === weekNo)) ?? null
}

export function findWeek(plan, weekNo) {
  for (const month of plan.months) {
    const week = month.weeks.find((w) => w.no === weekNo)
    if (week) return { month, week, index: month.weeks.indexOf(week) }
  }
  const week = plan.weeks.find((w) => w.no === weekNo)
  return week ? { month: null, week, index: -1 } : null
}

export function allWeeks(plan) {
  const rows = []
  for (const month of plan.months) {
    month.weeks.forEach((week, index) => rows.push({ month, week, index }))
  }
  return rows.sort((a, b) => a.week.no - b.week.no)
}

export function weekDateLabel(week) {
  if (!week?.start || !week?.end) return ''
  return week.start === week.end ? shortDay(week.start) : `${shortDay(week.start)}-${shortDay(week.end)}`
}

export function weekFullDateLabel(week) {
  if (!week?.start || !week?.end) return ''
  return `${longDay(week.start)}——${shortDay(week.end).replace('.', '月').replace('.', '日')}`
}

export default {
  SUBJECTS, SUBJECT_KEYS, SUBJECT_BY_KEY, SLOT_ORDER, WEEKDAY_LABELS, FOCUS_ROWS,
  MONTH_BLOCKS, GAME_ROWS, WEEKLY_LAYOUTS, DEFAULT_HOLIDAYS, DEFAULT_MAKEUP_DAYS,
  parseDay, formatDay, shortDay, longDay, cnNumber,
  computeWeeks, monthOfWeek, normalisePlanSet, resyncCalendar,
  findMonth, findWeek, allWeeks, weekDateLabel, weekFullDateLabel,
}
