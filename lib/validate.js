/**
 * The consistency report.
 *
 * This is the feature the whole design exists to make possible. Because a
 * weekly plan owns no course data, "月计划和周计划对得上" is not something the
 * teacher has to keep re-checking — but a plan set can still be wrong in ways
 * that matter, and an *imported* set can be wrong in ways the uploaded one
 * demonstrably was:
 *
 *   · 第六周 labeled 《该怎么办》 as 科学活动 where the month column files it
 *     under 社会 — the same lesson, the wrong subject.
 *   · 第七周 moved 美术《破碎的瓶子》 a week earlier than its month column.
 *
 * Both are real, both are in the files this plugin was built from, and both are
 * reported below with the week, the title and the exact month column to fix.
 */

import { SUBJECTS, SUBJECT_BY_KEY, MONTH_BLOCKS, FOCUS_ROWS, DAY_LABELS_7, shortDay, parseDay } from './model.js'
import { deriveAll, columnOf } from './derive.js'

const ISSUE = (level, code, fields) => ({ level, code, ...fields })

/**
 * @param {object} plan normalised plan set
 * @returns {{ok:boolean, counts:object, issues:Array<object>, weeks:Array<object>}}
 */
export function validatePlan(plan) {
  const issues = []
  const derived = deriveAll(plan)
  const weeksInCalendar = plan.weeks ?? []
  const weeksInMonths = derived.map((w) => w.weekNo)

  // ------------------------------------------------------ calendar integrity
  if (weeksInCalendar.length === 0) {
    issues.push(ISSUE('error', 'calendar-empty', { message: '学期日历是空的：请先设置开学日期与放假日期。' }))
  }
  const missing = weeksInCalendar.filter((w) => !weeksInMonths.includes(w.no))
  for (const week of missing) {
    issues.push(ISSUE('error', 'week-not-in-month', {
      weekNo: week.no,
      message: `第${week.no}周（${shortDay(week.start)}-${shortDay(week.end)}）不在任何月计划里。`,
      fix: '重算日历，或把这一周补进对应月份。',
    }))
  }
  for (let i = 0; i < weeksInCalendar.length; i += 1) {
    if (weeksInCalendar[i].no !== i + 1) {
      issues.push(ISSUE('error', 'week-numbering', {
        weekNo: weeksInCalendar[i].no,
        message: `周次不连续：第 ${i + 1} 个教学周的编号是「第${weeksInCalendar[i].no}周」。`,
        fix: '重算日历以重新编号。',
      }))
    }
  }
  for (let i = 1; i < weeksInCalendar.length; i += 1) {
    const previous = parseDay(weeksInCalendar[i - 1].end)
    const current = parseDay(weeksInCalendar[i].start)
    if (previous && current && current <= previous) {
      issues.push(ISSUE('error', 'week-overlap', {
        weekNo: weeksInCalendar[i].no,
        message: `第${weeksInCalendar[i].no}周的起始日期不晚于上一周的结束日期。`,
        fix: '检查放假日期与调休补课日。',
      }))
    }
  }

  // ------------------------------------------------------- month-level checks
  for (const month of plan.months) {
    if (month.weeks.length === 0) {
      issues.push(ISSUE('warn', 'month-no-weeks', {
        monthNo: month.monthNo,
        message: `${month.label}没有任何教学周。`,
      }))
      continue
    }
    const focusFilled = ['regular', 'moral', 'safety'].filter((k) => String(month.focus?.[k] ?? '').trim())
    if (focusFilled.length < 3) {
      const labels = { regular: '班级常规（习惯养成）', moral: '德育教育', safety: '安全教育' }
      const missingFocus = ['regular', 'moral', 'safety'].filter((k) => !focusFilled.includes(k)).map((k) => labels[k])
      issues.push(ISSUE('warn', 'month-focus-missing', {
        monthNo: month.monthNo,
        message: `${month.label}的工作重点缺少：${missingFocus.join('、')}。本周计划会因此少一行内容。`,
        fix: '在「月计划」页补齐，或直接为相关周写覆盖文字。',
      }))
    }
    for (const block of MONTH_BLOCKS) {
      if (!String(month.blocks?.[block.key] ?? '').trim()) {
        issues.push(ISSUE('warn', 'month-block-missing', {
          monthNo: month.monthNo,
          message: `${month.label}的「${block.label}」是空的。`,
        }))
      }
    }
    // Duplicate course titles inside one month, and titles reused across months.
    const seen = new Map()
    for (const subject of SUBJECTS) {
      month.courses[subject.key].forEach((title, index) => {
        if (!title) return
        const key = normaliseTitle(title)
        if (seen.has(key)) {
          const previous = seen.get(key)
          issues.push(ISSUE('warn', 'course-duplicate', {
            monthNo: month.monthNo,
            weekNo: month.weeks[index]?.no,
            message: `${month.label}里「${title}」重复出现：第${previous.weekNo}周（${previous.label}）和第${month.weeks[index]?.no}周（${subject.group}${subject.sub ? '/' + subject.sub : ''}）。`,
            fix: '确认是否真的重复；重复的话把其中一处改成别的课题。',
          }))
        } else {
          seen.set(key, { weekNo: month.weeks[index]?.no, label: `${subject.group}${subject.sub ? '/' + subject.sub : ''}` })
        }
      })
    }
  }

  // ------------------------------------------------------- week-level checks
  const globalTitles = new Map()
  const weekReports = []
  for (const week of derived) {
    const report = {
      weekNo: week.weekNo,
      monthNo: week.monthNo,
      label: `第${week.weekNo}周`,
      dates: week.dates.short,
      courseCount: week.filled,
      issues: 0,
    }
    const column = columnOf(
      plan.months.find((m) => m.monthNo === week.monthNo),
      week.indexInMonth,
    )

    if (column.length === 0) {
      issues.push(ISSUE('warn', 'week-no-courses', {
        weekNo: week.weekNo,
        message: `第${week.weekNo}周（${week.dates.short}）在月计划里没有任何课题，导出的周计划「集体教学活动」会是空的。`,
        fix: '在月计划对应周次列里填入课题。',
      }))
      report.issues += 1
    }

    if (week.overflow.length > 0) {
      issues.push(ISSUE('warn', 'course-overflow', {
        weekNo: week.weekNo,
        message: `第${week.weekNo}周有 ${column.length} 个课题，周计划只有 5 个工作日格：${week.overflow.map((o) => `${o.activity}《${o.title}》`).join('、')} 排不下。`,
        fix: '把多余课题挪到相邻周次，或把它并进同一天的格子里。',
      }))
      report.issues += 1
    }

    if (Object.values(week.focus).every((v) => !String(v).trim())) {
      issues.push(ISSUE('warn', 'week-focus-empty', {
        weekNo: week.weekNo,
        message: `第${week.weekNo}周的「周工作重点」全部为空。`,
        fix: '补上月计划工作重点，或为该周写覆盖文字。',
      }))
      report.issues += 1
    }

    if (!week.theme) {
      issues.push(ISSUE('info', 'week-theme-missing', {
        weekNo: week.weekNo,
        message: `第${week.weekNo}周没有主题名称，导出的表头会是「主题名称：《　》」。`,
        fix: '在「周计划」页为该周或该月填写主题。',
      }))
      report.issues += 1
    }

    // -------------------------------------------- drift against an imported docx
    const override = plan.weekly?.[String(week.weekNo)]
    if (override?.imported?.lessons?.length) {
      // A title can legitimately appear twice in one week under two subjects —
      // the uploaded December plan reuses 《神奇的树》 for both 语言 and 音乐.
      // Keying by title alone would then report a false subject mismatch, so the
      // candidates are kept as a list and matched on subject first.
      const expected = week.lessons.filter((l) => l.title)
      const used = new Set()
      for (const lesson of override.imported.lessons) {
        // 「语言活动：」 with no title is an unfilled cell, not a wrong lesson.
        // Reporting it as both extra and missing would bury the real drift.
        if (!lesson.title) {
          issues.push(ISSUE('warn', 'weekly-lesson-blank', {
            weekNo: week.weekNo,
            message: `导入的第${week.weekNo}周周计划里「${lesson.activity}：」没有写课题名称。`,
            fix: '按模板规则，这一格应该填月计划该周列里对应的课题。',
          }))
          report.issues += 1
          continue
        }
        const key = normaliseTitle(lesson.title)
        const candidates = expected.filter((l) => !used.has(l) && normaliseTitle(l.title) === key)
        if (candidates.length === 0) {
          const elsewhere = findInPlan(plan, lesson.title)
          issues.push(ISSUE('error', 'weekly-extra-lesson', {
            weekNo: week.weekNo,
            message: `第${week.weekNo}周周计划里有「${lesson.activity}《${lesson.title}》，但月计划第${week.weekNo}周列里没有这个课题。`
              + (elsewhere ? `它出现在${elsewhere}。` : ''),
            fix: elsewhere
              ? '把月计划里的周次列和它对齐；或把这周的课题改回月计划的那一列。'
              : '先在月计划里登记这个课题，或从周计划里删掉。',
          }))
          report.issues += 1
          continue
        }
        const match = candidates.find((l) => l.subjectKey === lesson.subjectKey) ?? candidates[0]
        used.add(match)
        if (match.subjectKey !== lesson.subjectKey) {
          issues.push(ISSUE('error', 'weekly-subject-mismatch', {
            weekNo: week.weekNo,
            message: `第${week.weekNo}周把《${lesson.title}》写成「${lesson.activity}」，但月计划把它归在「${SUBJECT_BY_KEY[match.subjectKey]?.activity ?? match.subjectKey}」。`,
            fix: `把周计划改成${SUBJECT_BY_KEY[match.subjectKey]?.activity ?? match.subjectKey}（也可以反过来改月计划）。`,
          }))
          report.issues += 1
        }
        // Both sides now speak in real days of the week, so this comparison is
        // meaningful even for a week that opens on a Thursday.
        if (lesson.weekday && match.calendarWeekday && lesson.weekday !== match.calendarWeekday) {
          issues.push(ISSUE('info', 'weekly-weekday-moved', {
            weekNo: week.weekNo,
            message: `第${week.weekNo}周把《${lesson.title}》排在${DAY_LABELS_7[lesson.weekday - 1] ?? lesson.weekday}，模板规则是${match.calendarLabel}。`,
            fix: '只是排课习惯差异，不影响课题一致性。',
          }))
        }
      }
      for (const lesson of expected) {
        if (used.has(lesson)) continue
        issues.push(ISSUE('error', 'weekly-missing-lesson', {
          weekNo: week.weekNo,
          message: `月计划第${week.weekNo}周列里有「${lesson.activity}《${lesson.title}》，但导入的周计划没有它。`,
          fix: '在周计划里补上，或从月计划该周删掉。',
        }))
        report.issues += 1
      }
    }

    // ------------------------------------------- duplicate across the semester
    for (const lesson of week.lessons) {
      if (!lesson.title) continue
      const key = normaliseTitle(lesson.title)
      if (globalTitles.has(key)) {
        const previous = globalTitles.get(key)
        if (previous.weekNo !== week.weekNo) {
          issues.push(ISSUE('info', 'course-reused', {
            weekNo: week.weekNo,
            message: `《${lesson.title}》在第${previous.weekNo}周已经出现过，第${week.weekNo}周又用了一次。`,
          }))
        }
      } else {
        globalTitles.set(key, { weekNo: week.weekNo })
      }
    }

    weekReports.push(report)
  }

  const counts = {
    error: issues.filter((i) => i.level === 'error').length,
    warn: issues.filter((i) => i.level === 'warn').length,
    info: issues.filter((i) => i.level === 'info').length,
  }
  return {
    ok: counts.error === 0,
    counts,
    total: issues.length,
    issues: sortIssues(issues),
    weeks: weekReports,
    stats: {
      months: plan.months.length,
      weeks: derived.length,
      courses: derived.reduce((n, w) => n + w.filled, 0),
      weeksWithCourses: derived.filter((w) => w.filled > 0).length,
    },
  }
}

/** 《看图识字》 and 看图识字 are the same lesson when comparing. */
function normaliseTitle(title) {
  return String(title ?? '')
    .replace(/[《》〈〉\s\u3000]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .trim()
}

/** Where else in the plan a title lives — used to write an actionable message. */
function findInPlan(plan, title) {
  const key = normaliseTitle(title)
  if (!key) return ''
  for (const month of plan.months) {
    for (const subject of SUBJECTS) {
      const column = month.courses[subject.key]
      const at = column.findIndex((t) => normaliseTitle(t) === key)
      if (at >= 0) {
        const week = month.weeks[at]
        return `${month.label}第${week?.no}周（${subject.group}${subject.sub ? '/' + subject.sub : ''}）`
      }
    }
  }
  return ''
}

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 }
const sortIssues = (issues) => [...issues].sort((a, b) => {
  const byLevel = (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9)
  if (byLevel !== 0) return byLevel
  return (a.weekNo ?? a.monthNo ?? 0) - (b.weekNo ?? b.monthNo ?? 0)
})

/** Markdown rendering, used by the agent tool and the export bundle. */
export function reportToMarkdown(plan, report) {
  const lines = []
  const head = `${plan.semesterLabel}${plan.className}计划一致性检查`
  lines.push(`# ${head}`, '')
  lines.push(`- 月份：${report.stats.months}　教学周：${report.stats.weeks}　课题：${report.stats.courses}`)
  lines.push(`- 错误 ${report.counts.error}　警告 ${report.counts.warn}　提示 ${report.counts.info}`)
  lines.push('')
  if (report.total === 0) {
    lines.push('✅ 月计划与周计划完全对得上。')
    return lines.join('\n')
  }
  for (const level of ['error', 'warn', 'info']) {
    const group = report.issues.filter((i) => i.level === level)
    if (group.length === 0) continue
    const title = level === 'error' ? '错误（必须修）' : level === 'warn' ? '警告（建议修）' : '提示'
    lines.push(`## ${title}（${group.length}）`, '')
    for (const issue of group) {
      const where = issue.weekNo ? `第${issue.weekNo}周　` : issue.monthNo ? `${issue.monthNo}月　` : ''
      lines.push(`- ${where}${issue.message}${issue.fix ? `\n  - 建议：${issue.fix}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export default { validatePlan, reportToMarkdown }
