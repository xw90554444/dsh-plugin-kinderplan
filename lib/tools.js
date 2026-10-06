/**
 * Agent-facing tools.
 *
 * These call the same `api` object the studio UI reaches over the web route, so
 * a plan edited by the agent and one edited in the UI are the same document with
 * the same validation.
 *
 * Long work — a semester export, an AI draft — is started as a tracked run and
 * the tool hands back the run id rather than blocking a turn on it.
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { SUBJECTS, MONTH_BLOCKS, FOCUS_ROWS, weekDateLabel } from './model.js'

const text = (value) => [{ type: 'text', text: String(value) }]

/**
 * Schema for what a tool hands back to the harness.
 *
 * Every tool returns `{ ok, ... }`: `ok` is the field the model layer reads, the
 * rest is tool-specific payload. `additionalProperties: true` keeps this
 * accurate without enumerating eight result shapes — and, more to the point,
 * without any chance of rejecting a value a tool legitimately produced. The
 * harness validates `execute`'s return against this schema, so an over-tight
 * schema turns a working tool into a hard error at call time.
 */
const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '工具是否成功完成' },
    error: {
      type: 'object',
      additionalProperties: true,
      description: '失败时的错误信息：{ code, message, problems? }',
    },
  },
  required: ['ok'],
  additionalProperties: true,
  description: '工具的原始返回对象；除 ok 外的字段随工具而异。',
}

/**
 * Move a tool's `render` under the `output` descriptor the harness requires.
 *
 * `tools.register()` rejects any definition that does not declare
 * `output: { schema, render, presentationMeta? }`; a top-level `render` — the
 * shape older plugins use — fails that check outright. The failure mode is worth
 * spelling out: registration throws, and because this plugin used to register
 * tools before the web half, one rejected definition left the whole panel loaded
 * with no backend, so every button silently did nothing.
 */
function withOutput(definition, schema = TOOL_OUTPUT_SCHEMA) {
  const { render, output, ...rest } = definition
  return { ...rest, output: output ?? { schema, render } }
}

const fail = (value) => {
  if (value && value.ok === false) return text(`错误 [${value.error?.code ?? 'unknown'}]：${value.error?.message ?? '未知失败'}`)
  return null
}

const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback)

/** Poll a run for a bounded slice; a still-running run is a valid answer. */
async function waitForRun(api, runId, waitMs = 100000, pollMs = 1200) {
  const deadline = Date.now() + Math.max(0, waitMs)
  for (;;) {
    const run = api.runStatus(runId)
    if (!run) return { ok: false, error: { code: 'not-found', message: `没有这个运行 ${runId}` } }
    if (run.status !== 'running') return { ok: true, run }
    if (Date.now() >= deadline) return { ok: true, run, timedOut: true }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

function describeRun(run) {
  const head = run.status === 'done' ? '完成' : run.status === 'failed' ? '失败' : run.status === 'cancelled' ? '已取消' : '进行中'
  const lines = [`${run.label} — ${head}（${(run.elapsedMs / 1000).toFixed(1)}s）`]
  if (run.phase) lines.push(`阶段：${run.phase}`)
  if (run.message) lines.push(run.message)
  if (run.progress?.total) lines.push(`进度：${run.progress.done}/${run.progress.total}`)
  if (run.error) lines.push(`错误 [${run.error.code}]：${run.error.message}`)
  if (run.error?.problems?.length) for (const p of run.error.problems.slice(0, 6)) lines.push(`  - ${p}`)
  if (run.log?.length) for (const line of run.log.slice(-12)) lines.push(`  ${line}`)
  return lines.join('\n')
}

function planOverview(plan) {
  const lines = [
    `${plan.semesterLabel}${plan.className}计划（id=${plan.id}）`,
    `园所：${plan.kindergarten}　学期：${plan.termStart} ~ ${plan.termEnd}`,
    `教学周：${plan.weeks.length}　月份：${plan.months.length}`,
  ]
  for (const month of plan.months) {
    const weeks = month.weeks.map((w) => `第${w.no}周(${weekDateLabel(w)})`).join(' ')
    const courses = SUBJECTS.reduce((n, s) => n + month.courses[s.key].filter(Boolean).length, 0)
    lines.push(`  · ${month.label}：${weeks}　课题 ${courses} 个`)
  }
  return lines.join('\n')
}

// ------------------------------------------------------------ kinder_plan

export function planTool(api) {
  return {
    name: 'kinder_plan',
    description: [
      '幼儿园计划工作台的主工具：新建 / 列出 / 查看 / 修改 / 删除一整套学期计划（月计划 + 由它派生的周计划）。',
      '一个计划含：园所、班级、学期、开学与放假日期（据此自动排出教学周与月次归属）、每个月的课程内容与工作重点。',
      '周计划不单独存课程——它由月计划编译而来，所以改月计划就等于改周计划，二者不可能对不上。',
      '常用流程：kinder_plan create -> kinder_month set -> kinder_check -> kinder_export。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'remove', 'resync'], description: '要执行的操作。' },
        planId: { type: 'string', description: 'get/update/remove/resync 需要的计划 id。' },
        plan: {
          type: 'object',
          additionalProperties: true,
          description: 'create/update 的计划字段：kindergarten、className、semesterLabel、year、termStart、termEnd、holidays、makeupDays、focusMode。',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        if (args?.action === 'list') {
          return { ok: true, plans: await api.listPlans() }
        }
        if (args?.action === 'get') {
          const plan = await api.getPlan(args.planId)
          return plan ? { ok: true, ...plan } : { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        }
        if (args?.action === 'create') {
          const plan = await api.createPlan(args.plan ?? {})
          return { ok: true, plan }
        }
        if (args?.action === 'update') {
          const plan = await api.updatePlan(args.planId, args.plan ?? {})
          return plan ? { ok: true, plan } : { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        }
        if (args?.action === 'remove') {
          return { ok: await api.removePlan(args.planId) }
        }
        if (args?.action === 'resync') {
          const plan = await api.resync(args.planId)
          return plan ? { ok: true, plan } : { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        }
        return { ok: false, error: { code: 'bad-action', message: `不认识的操作 ${args?.action}` } }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      if (value.plans) {
        if (value.plans.length === 0) return text('还没有任何计划。用 kinder_plan 的 create 操作建一个。')
        return text(value.plans.map((p) => `${p.title}（id=${p.id}）　${p.monthCount} 个月 / ${p.weekCount} 周 / ${p.courseCount} 个课题　更新于 ${p.updatedAt}`).join('\n'))
      }
      if (value.plan) return text(planOverview(value.plan))
      if (typeof value.ok === 'boolean') return text(value.ok ? '已删除。' : '没有找到这个计划。')
      return text(JSON.stringify(value).slice(0, 2000))
    },
  }
}

// ----------------------------------------------------------- kinder_month

export function monthTool(api) {
  return {
    name: 'kinder_month',
    description: [
      '读或写某个月的月计划内容：三段工作重点（常规/德育/安全）、九个学科逐周课题、四段长文本（户外活动/离园活动/家园共育/环境区角）。',
      'courses 的每个数组按该月的教学周顺序排列，长度必须等于该月周数；空字符串表示那一周不上这个学科。',
      '学科 key：' + SUBJECTS.map((s) => `${s.key}=${s.group}${s.sub ? '/' + s.sub : ''}`).join('、'),
      '写入后周计划会自动跟着变，不需要另外操作。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'], description: 'get 读取，set 写入。' },
        planId: { type: 'string', description: '计划 id。' },
        monthNo: { type: 'number', description: '月份数字，如 10 表示 10 月。' },
        patch: {
          type: 'object',
          additionalProperties: true,
          description: '要写入的字段：focus{regular,moral,safety}、courses{学科key: [课题,...]}、blocks{outdoor,dismissal,family,corner}、theme、label。只覆盖给到的字段。',
        },
      },
      required: ['action', 'planId', 'monthNo'],
    },
    async execute(args) {
      try {
        const plan = await api.getPlan(args.planId)
        if (!plan) return { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        const month = plan.plan.months.find((m) => m.monthNo === Number(args.monthNo))
        if (!month) return { ok: false, error: { code: 'not-found', message: `这个计划里没有 ${args.monthNo} 月` } }
        if (args.action === 'get') return { ok: true, month, weeks: month.weeks }
        if (args.action !== 'set') return { ok: false, error: { code: 'bad-action', message: 'action 只能是 get 或 set' } }

        const patch = args.patch ?? {}
        const months = plan.plan.months.map((m) => {
          if (m.monthNo !== month.monthNo) return m
          const courses = { ...m.courses }
          if (patch.courses && typeof patch.courses === 'object') {
            for (const subject of SUBJECTS) {
              const incoming = patch.courses[subject.key]
              if (!Array.isArray(incoming)) continue
              const column = incoming.map((v) => String(v ?? '').trim())
              while (column.length < m.weeks.length) column.push('')
              courses[subject.key] = column.slice(0, m.weeks.length)
            }
          }
          return {
            ...m,
            label: typeof patch.label === 'string' && patch.label.trim() ? patch.label.trim() : m.label,
            theme: typeof patch.theme === 'string' ? patch.theme.trim() : m.theme,
            focus: { ...m.focus, ...Object.fromEntries(Object.entries(patch.focus ?? {}).map(([k, v]) => [k, String(v ?? '').trim()])) },
            blocks: { ...m.blocks, ...Object.fromEntries(Object.entries(patch.blocks ?? {}).map(([k, v]) => [k, String(v ?? '').trim()])) },
            courses,
          }
        })
        const saved = await api.updatePlan(args.planId, { months })
        return { ok: true, month: saved.months.find((m) => m.monthNo === month.monthNo) }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      const m = value.month
      const lines = [`${m.label}　教学周：${m.weeks.map((w) => `第${w.no}周 ${weekDateLabel(w)}`).join('　')}`]
      lines.push('', '工作重点：')
      lines.push(`  班级常规（习惯养成）：${m.focus.regular || '（空）'}`)
      lines.push(`  德育教育：${m.focus.moral || '（空）'}`)
      lines.push(`  安全教育：${m.focus.safety || '（空）'}`)
      lines.push('', '课程内容（按周）：')
      for (const subject of SUBJECTS) {
        const column = m.courses[subject.key]
        if (!column.some(Boolean)) continue
        lines.push(`  ${subject.group}${subject.sub ? '/' + subject.sub : ''}：${column.map((v) => v || '·').join(' | ')}`)
      }
      lines.push('', '长文本：')
      for (const block of MONTH_BLOCKS) lines.push(`  ${block.label}：${(m.blocks[block.key] || '（空）').slice(0, 60)}${(m.blocks[block.key] ?? '').length > 60 ? '…' : ''}`)
      return text(lines.join('\n'))
    },
  }
}

// ------------------------------------------------------------ kinder_week

export function weekTool(api) {
  return {
    name: 'kinder_week',
    description: [
      '读某一周的周计划（编译结果），或写这一周的覆盖内容。',
      'get 返回该周的：表头、主题、起止日期、四条周工作重点（已从月计划合并）、五天的集体教学活动及其来源月次列、晨间/散步/下午/室内自主游戏。',
      '集体教学活动是只读的——它由月计划第 N 周那一列编译而来。要改课题请用 kinder_month 改月计划，这样月计划与周计划永远一致。',
      'set 只能写：theme（主题）、focus（四条工作重点的覆盖文字）、games（晨间/下午每天一条、散步、室内自主游戏）。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'list'], description: 'list 列出全部周次，get 读一周，set 写覆盖。' },
        planId: { type: 'string', description: '计划 id。' },
        weekNo: { type: 'number', description: '周次数字。' },
        patch: {
          type: 'object',
          additionalProperties: true,
          description: '要写入的字段：theme、focus{regular,moral,safety,family}、games{morning[5],afternoon[5],walk,indoor}、layout（main/week1）、notes。',
        },
      },
      required: ['action', 'planId'],
    },
    async execute(args) {
      try {
        const detail = await api.getPlan(args.planId)
        if (!detail) return { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        if (args.action === 'list') {
          return {
            ok: true,
            weeks: detail.derived.map((w) => ({
              weekNo: w.weekNo, monthLabel: w.monthLabel, dates: w.dates.short, theme: w.theme,
              layout: w.layout, courses: w.column.map((c) => `${c.activity}《${c.title}》`),
              focusFilled: Object.values(w.focus).filter(Boolean).length, overflow: w.overflow.length,
            })),
          }
        }
        const weekNo = Number(args.weekNo)
        if (!Number.isInteger(weekNo)) return { ok: false, error: { code: 'bad-args', message: '需要 weekNo' } }
        const derived = detail.derived.find((w) => w.weekNo === weekNo)
        if (!derived) return { ok: false, error: { code: 'not-found', message: `这个计划里没有第 ${weekNo} 周` } }
        if (args.action === 'get') return { ok: true, week: derived }

        const patch = args.patch ?? {}
        const plan = detail.plan
        const existing = plan.weekly?.[String(weekNo)] ?? {}
        const perDay = (incoming, current) => {
          if (!Array.isArray(incoming)) return current ?? ['', '', '', '', '']
          const arr = incoming.map((v) => String(v ?? '').trim())
          while (arr.length < 5) arr.push('')
          return arr.slice(0, 5)
        }
        const weekly = {
          ...plan.weekly,
          [String(weekNo)]: {
            ...existing,
            theme: typeof patch.theme === 'string' ? patch.theme.trim() : (existing.theme ?? ''),
            layout: ['main', 'week1'].includes(patch.layout) ? patch.layout : (existing.layout ?? null),
            notes: typeof patch.notes === 'string' ? patch.notes : (existing.notes ?? ''),
            focus: { ...(existing.focus ?? {}), ...Object.fromEntries(Object.entries(patch.focus ?? {}).map(([k, v]) => [k, String(v ?? '').trim()])) },
            games: {
              ...(existing.games ?? {}),
              morning: perDay(patch.games?.morning, existing.games?.morning),
              afternoon: perDay(patch.games?.afternoon, existing.games?.afternoon),
              walk: typeof patch.games?.walk === 'string' ? patch.games.walk.trim() : (existing.games?.walk ?? ''),
              indoor: typeof patch.games?.indoor === 'string' ? patch.games.indoor.trim() : (existing.games?.indoor ?? ''),
            },
          },
        }
        const saved = await api.updatePlan(args.planId, { weekly })
        const after = (await api.getPlan(args.planId)).derived.find((w) => w.weekNo === weekNo)
        return { ok: true, week: after, savedFrom: saved.id }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      if (value.weeks) {
        return text(value.weeks.map((w) => `第${w.weekNo}周 ${w.dates} ${w.theme ? `《${w.theme}》` : ''}　${w.monthLabel}　课题 ${w.courses.length} 个　工作重点 ${w.focusFilled}/4${w.overflow ? `　⚠ 溢出 ${w.overflow}` : ''}`).join('\n'))
      }
      const w = value.week
      const lines = [`第${w.weekNo}周　${w.dates.long}　主题：《${w.theme || '（空）'}》　版式 ${w.layout}`]
      lines.push('', '周工作重点（来自月计划第 N 周列）：')
      for (const row of FOCUS_ROWS) lines.push(`  ${row.label}：${w.focus[row.key] || '（空）'}`)
      lines.push('', '集体教学活动（编译自月计划，只读）：')
      for (const lesson of w.lessons) {
        if (!lesson.activity && !lesson.title) continue
        lines.push(`  ${lesson.label}：${lesson.activity}${lesson.title ? `《${lesson.title}》` : ''}${lesson.origin ? `　← ${lesson.origin.monthNo}月第${lesson.origin.weekNo}周列` : ''}`)
      }
      if (w.overflow.length) lines.push(`  ⚠ 排不下：${w.overflow.map((o) => o.title).join('、')}`)
      lines.push('', '游戏活动：')
      lines.push(`  晨间：${w.games.morning.map((m, i) => `${['一', '二', '三', '四', '五'][i]}=${(m || '·').replace(/\n/g, '/')}`).join('　')}`)
      lines.push(`  散步：${w.games.walk || '（空）'}`)
      lines.push(`  下午：${w.games.afternoon.map((m, i) => `${['一', '二', '三', '四', '五'][i]}=${m || '·'}`).join('　')}`)
      lines.push(`  室内自主游戏：${w.games.indoor || '（空）'}`)
      return text(lines.join('\n'))
    },
  }
}

// --------------------------------------------------------- kinder_check

export function checkTool(api) {
  return {
    name: 'kinder_check',
    description: [
      '跑一遍月计划与周计划的一致性检查，返回错误/警告/提示三级清单，每条都带周次、说明和修改建议。',
      '检查包括：周次编号与日期是否连续、每周课题是否排得下 5 个工作日格、月计划工作重点是否缺失、同一课题是否重复、以及导入的旧周计划有没有和月计划错位（课题挪周、学科标错、漏排）。',
      'markdown=true 时返回可直接贴进报告的 Markdown 版本。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: '计划 id。' },
        markdown: { type: 'boolean', description: '是否返回 Markdown 版本。' },
      },
      required: ['planId'],
    },
    async execute(args) {
      try {
        const result = await api.validate(args.planId)
        if (!result) return { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        return { ok: true, ...result, wantMarkdown: bool(args.markdown) }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      if (value.wantMarkdown) return text(value.markdown)
      const r = value.report
      const lines = [`一致性检查：错误 ${r.counts.error}　警告 ${r.counts.warn}　提示 ${r.counts.info}　（${r.stats.months} 个月 / ${r.stats.weeks} 周 / ${r.stats.courses} 个课题）`]
      if (r.total === 0) lines.push('✅ 月计划与周计划完全对得上。')
      for (const issue of r.issues.slice(0, 40)) {
        const where = issue.weekNo ? `第${issue.weekNo}周　` : issue.monthNo ? `${issue.monthNo}月　` : ''
        lines.push(`[${issue.level}] ${where}${issue.message}${issue.fix ? `\n      → ${issue.fix}` : ''}`)
      }
      if (r.issues.length > 40) lines.push(`…还有 ${r.issues.length - 40} 条，用 markdown=true 看完整版。`)
      return text(lines.join('\n'))
    },
  }
}

// -------------------------------------------------------- kinder_lexicon

export function lexiconTool(api) {
  return {
    name: 'kinder_lexicon',
    description: [
      '园内常用句式词库：列出分类、搜索、新增、删除。',
      '分类 key 形如 focus.regular（常规培养）、focus.safety（安全工作）、games.morning（晨间趣味游戏）、games.afternoon（下午场地）、month.corner（环境区角）等。',
      '每次导入已有 docx 时，词库会自动把新出现的句式收进来，所以用得越久越贴近本园写法。',
      'AI 起草月计划/周计划时也会读这个词库作为风格示例。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'items', 'search', 'add', 'remove'], description: '要执行的操作。' },
        category: { type: 'string', description: '分类 key，items/add/remove 需要。' },
        text: { type: 'string', description: 'add 需要的词组文本。多行用 \\n。' },
        query: { type: 'string', description: 'search 的关键词。' },
        id: { type: 'string', description: 'remove 需要的词组 id。' },
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        if (args?.action === 'list') return { ok: true, ...(await api.lexiconList()) }
        if (args?.action === 'items') return { ok: true, ...(await api.lexiconList(args.category) ?? { error: true }) }
        if (args?.action === 'search') return { ok: true, items: await api.lexiconSearch(args.query, 40) }
        if (args?.action === 'add') return { ok: true, item: await api.lexiconAdd(args.category, args.text) }
        if (args?.action === 'remove') return { ok: await api.lexiconRemove(args.category, args.id) }
        return { ok: false, error: { code: 'bad-action', message: `不认识的操作 ${args?.action}` } }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      if (value.categories) {
        return text(value.categories.map((c) => `${c.key}　${c.label}　${c.items.length} 条　${c.perDay ? '（按天填）' : ''}`).join('\n'))
      }
      if (value.items) {
        return text(value.items.length === 0
          ? '（没有匹配的词组）'
          : value.items.map((i) => `${i.category ? i.category + '　' : ''}${i.id}　${i.text.replace(/\n/g, '⏎').slice(0, 90)}`).join('\n'))
      }
      if (value.item) return text(`已加入：${value.item.id}　${value.item.text.replace(/\n/g, '⏎')}`)
      if (typeof value.ok === 'boolean') return text(value.ok ? '已删除。' : '没有找到这个词组。')
      return text(JSON.stringify(value).slice(0, 1200))
    },
  }
}

// --------------------------------------------------------- kinder_import

export function importTool(api) {
  return {
    name: 'kinder_import',
    description: [
      '把已有的月计划/周计划 .docx 反向解析进工作台，不必重新录入。',
      '月计划会新增或覆盖对应月份；周计划会挂到对应周次，并保留原始课题用于一致性比对——这样旧周计划和月计划哪里对不上会直接被 kinder_check 指出来。',
      '可以一次传一整个学期的文件（月计划 + 各周周计划混合），会自动建立计划。',
      '导入的句式会自动进词库。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '要导入的 .docx 绝对路径列表。' },
        planId: { type: 'string', description: '导入到哪个计划；省略则新建一个。' },
        hint: {
          type: 'object',
          additionalProperties: true,
          description: '补充信息，如 { year: 2026, className: "大一班", kindergarten: "渝水区第三幼儿园", semesterLabel: "2026年秋季学期" }。',
        },
      },
      required: ['paths'],
    },
    async execute(args) {
      try {
        const paths = Array.isArray(args?.paths) ? args.paths : []
        if (paths.length === 0) return { ok: false, error: { code: 'bad-args', message: 'paths 不能为空' } }
        const files = []
        const skipped = []
        for (const path of paths) {
          try {
            const buffer = await readFile(path)
            files.push({ name: basename(String(path)), base64: buffer.toString('base64') })
          } catch (error) {
            skipped.push(`${basename(String(path))}：${error?.message ?? error}`)
          }
        }
        if (files.length === 0) return { ok: false, error: { code: 'no-files', message: `一个文件都没读到。${skipped.join('；')}` } }
        const result = await api.importDocx({ planId: args.planId, files, hint: args.hint })
        return { ok: true, ...result, skipped }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      const lines = [`已导入：${value.plan.semesterLabel}${value.plan.className}计划（id=${value.plan.id}）`]
      for (const note of value.notes) lines.push(`  · ${note}`)
      if (value.skipped?.length) for (const s of value.skipped) lines.push(`  ✗ ${s}`)
      if (value.learned?.added) lines.push(`词库新增 ${value.learned.added} 条：${value.learned.categories.join('、')}`)
      lines.push('', `导入后一致性：错误 ${value.report.counts.error}　警告 ${value.report.counts.warn}　提示 ${value.report.counts.info}`)
      for (const issue of value.report.issues.slice(0, 12)) lines.push(`  [${issue.level}] ${issue.weekNo ? `第${issue.weekNo}周 ` : ''}${issue.message}`)
      return text(lines.join('\n'))
    },
  }
}

// ---------------------------------------------------------- kinder_draft

export function draftTool(api) {
  return {
    name: 'kinder_draft',
    description: [
      '用 AI 起草或改写月计划/周计划内容，然后（可选）直接写进计划。',
      'kind=month + monthNo：生成该月三段工作重点、九个学科的逐周课题、四段长文本。',
      'kind=week + weekNo：生成该周四条工作重点和晨间/下午/散步/室内自主游戏。周计划的课题不由 AI 写——它从月计划编译，所以 AI 不可能把两者弄得不一致。',
      'apply=false（默认）只返回草稿供人工确认；apply=true 会直接写入，mode=merge 只填空、mode=replace 整段覆盖。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['draft', 'apply', 'status', 'cancel'], description: 'draft 起一次生成，apply 把草稿写进去，status/cancel 管理运行。' },
        planId: { type: 'string', description: '计划 id。' },
        kind: { type: 'string', enum: ['month', 'week'], description: '起草月计划还是周计划。' },
        monthNo: { type: 'number', description: 'kind=month 时的月份。' },
        weekNo: { type: 'number', description: 'kind=week 时的周次。' },
        instruction: { type: 'string', description: '额外要求，如「主题换成《冬天来了》，多写一点户外活动」。' },
        draft: { type: 'object', additionalProperties: true, description: 'apply 时传入 draft 的返回内容。' },
        mode: { type: 'string', enum: ['merge', 'replace'], description: 'apply 的写入方式，默认 merge。' },
        runId: { type: 'string', description: 'status/cancel 需要的运行 id。' },
        waitMs: { type: 'number', description: 'draft 时最多等多少毫秒，默认 100000。' },
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        if (args?.action === 'status') {
          if (args.runId) {
            const run = api.runStatus(args.runId)
            return run ? { ok: true, run } : { ok: false, error: { code: 'not-found', message: `没有运行 ${args.runId}` } }
          }
          return { ok: true, runs: api.runList() }
        }
        if (args?.action === 'cancel') return { ok: api.cancelRun(args.runId) }
        if (args?.action === 'apply') {
          const saved = await api.applyDraft({
            planId: args.planId, kind: args.kind, monthNo: args.monthNo, weekNo: args.weekNo,
            draft: args.draft, mode: args.mode === 'replace' ? 'replace' : 'merge',
          })
          return saved ? { ok: true, applied: true, planId: saved.id } : { ok: false, error: { code: 'not-found', message: `没有计划 ${args.planId}` } }
        }
        if (args?.action !== 'draft') return { ok: false, error: { code: 'bad-action', message: `不认识的操作 ${args?.action}` } }

        const runId = args.kind === 'week'
          ? api.startDraftWeek({ planId: args.planId, weekNo: args.weekNo, instruction: args.instruction ?? '' })
          : api.startDraftMonth({ planId: args.planId, monthNo: args.monthNo, instruction: args.instruction ?? '' })
        const waited = await waitForRun(api, runId, Number(args.waitMs) > 0 ? Number(args.waitMs) : 100000)
        return { ok: true, runId, ...waited }
      } catch (error) {
        return { ok: false, error: { code: error?.code ?? 'failed', message: String(error?.message ?? error), problems: error?.problems } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      if (value.runs) {
        return text(value.runs.length === 0 ? '（没有运行记录）' : value.runs.map((r) => `${r.id}　${r.label}　${r.status}　${r.phase}`).join('\n'))
      }
      if (value.applied) return text(`已写入计划 ${value.planId}。用 kinder_check 复查一遍。`)
      if (typeof value.ok === 'boolean' && !value.run) return text(value.ok ? '已取消。' : '取消失败。')
      if (!value.run) return text(JSON.stringify(value).slice(0, 800))
      const run = value.run
      if (run.status === 'failed') return text(`${describeRun(run)}`)
      if (run.status === 'running') return text(`${describeRun(run)}\n\n运行 id：${value.runId}　用 kinder_draft status 继续查。`)

      const draft = run.result?.draft
      if (!draft) return text(describeRun(run))
      const lines = [describeRun(run), '']
      if (run.result.kind === 'month') {
        lines.push(`主题草稿（${run.result.monthNo} 月）：`)
        lines.push(`  班级常规：${draft.focus.regular}`)
        lines.push(`  德育教育：${draft.focus.moral}`)
        lines.push(`  安全教育：${draft.focus.safety}`)
        lines.push('', '课题草稿：')
        for (const subject of SUBJECTS) {
          const column = draft.courses[subject.key]
          if (!column.some(Boolean)) continue
          lines.push(`  ${subject.group}${subject.sub ? '/' + subject.sub : ''}：${column.map((v) => v || '·').join(' | ')}`)
        }
        lines.push('', '长文本草稿：')
        for (const block of MONTH_BLOCKS) lines.push(`  ${block.label}：${(draft.blocks[block.key] ?? '').replace(/\n/g, ' ').slice(0, 90)}…`)
      } else {
        lines.push(`第 ${run.result.weekNo} 周草稿：`)
        for (const row of FOCUS_ROWS) lines.push(`  ${row.label}：${draft.focus[row.key]}`)
        lines.push('', `  晨间：${draft.games.morning.map((m) => m.replace(/\n/g, '/')).join('　')}`)
        lines.push(`  下午：${draft.games.afternoon.join('　')}`)
        lines.push(`  散步：${draft.games.walk}`)
        lines.push(`  室内自主游戏：${draft.games.indoor}`)
      }
      lines.push('', '确认后调 kinder_draft action=apply 并带上这段 draft。')
      return text(lines.join('\n'))
    },
  }
}

// --------------------------------------------------------- kinder_export

export function exportTool(api) {
  return {
    name: 'kinder_export',
    description: [
      '导出 .docx：月计划、周计划，或一键把整学期（所有月 + 所有周 + 一致性报告 + 计划数据 JSON）写到磁盘。',
      '导出的文件完全沿用园里现有模板：页边距、表框、页眉校徽、页脚「让教育回归自然」都来自模板本身，只有单元格内容不同。',
      'action=render 返回单个文件的落盘路径；action=all 起一个运行，返回 runId 和最终目录。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['render', 'all', 'status', 'cancel'], description: 'render 单个文件，all 整学期打包，status/cancel 管理运行。' },
        planId: { type: 'string', description: '计划 id。' },
        kind: { type: 'string', enum: ['monthly', 'weekly'], description: 'render 时导出月计划还是周计划。' },
        monthNo: { type: 'number', description: 'kind=monthly 的月份。' },
        weekNo: { type: 'number', description: 'kind=weekly 的周次。' },
        dir: { type: 'string', description: '输出目录；省略则用桌面上的学期文件夹。' },
        runId: { type: 'string', description: 'status/cancel 需要的运行 id。' },
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        if (args?.action === 'status') {
          if (args.runId) {
            const run = api.runStatus(args.runId)
            return run ? { ok: true, run } : { ok: false, error: { code: 'not-found', message: `没有运行 ${args.runId}` } }
          }
          return { ok: true, runs: api.runList() }
        }
        if (args?.action === 'cancel') return { ok: api.cancelRun(args.runId) }
        if (args?.action === 'all') {
          const runId = api.startExportAll({ planId: args.planId, dir: args.dir })
          const waited = await waitForRun(api, runId, 120000)
          return { ok: true, runId, ...waited }
        }
        if (args?.action === 'render') {
          const rendered = await api.renderOne({ planId: args.planId, kind: args.kind === 'weekly' ? 'weekly' : 'monthly', monthNo: args.monthNo, weekNo: args.weekNo })
          return { ok: true, name: rendered.name, bytes: rendered.buffer.length, base64: rendered.buffer.toString('base64') }
        }
        return { ok: false, error: { code: 'bad-action', message: `不认识的操作 ${args?.action}` } }
      } catch (error) {
        return { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } }
      }
    },
    render(_args, value) {
      const bad = fail(value)
      if (bad) return bad
      if (value.runs) return text(value.runs.length === 0 ? '（没有运行记录）' : value.runs.map((r) => `${r.id}　${r.label}　${r.status}　${r.phase}`).join('\n'))
      if (!value.run) {
        if (value.base64) {
          return text(`已生成 ${value.name}（${(value.bytes / 1024).toFixed(0)} KB）。内容以 base64 返回，可写入文件后打开。`)
        }
        return text(JSON.stringify(value).slice(0, 800))
      }
      const run = value.run
      if (run.status !== 'done') return text(`${describeRun(run)}\n\n运行 id：${value.runId}`)
      const result = run.result ?? {}
      const lines = [`导出完成：${result.dir}`]
      for (const file of result.files ?? []) lines.push(`  · ${file.name}${file.bytes ? `（${(file.bytes / 1024).toFixed(0)} KB）` : ''}`)
      if (result.counts) lines.push('', `一致性：错误 ${result.counts.error}　警告 ${result.counts.warn}　提示 ${result.counts.info}`)
      return text(lines.join('\n'))
    },
  }
}

/** @returns {{name:string, definitions:object[], apply(ctx:object):void}} */
export function createToolsPlugin(api) {
  const definitions = [
    planTool(api), monthTool(api), weekTool(api),
    checkTool(api), lexiconTool(api), importTool(api),
    draftTool(api), exportTool(api),
  ].map((definition) => withOutput(definition))
  return {
    name: 'kinderPlanTools',
    /** Exposed so the host can register each definition in isolation. */
    definitions,
    apply(ctx) {
      for (const definition of definitions) {
        ctx.effect(() => ctx.tools.register(definition), `kinderplan.tool.${definition.name}`)
      }
    },
  }
}

export default createToolsPlugin
