/**
 * The service both halves share.
 *
 * The web route and the agent tools call these exact methods, so a plan edited
 * in the studio and a plan edited by the agent go through one code path and can
 * never disagree about what "valid" or "exported" means.
 *
 * Nothing long-running happens inline: docx rendering and LLM drafting start a
 * tracked run and return its id, which the caller polls. A semester export is
 * ~25 files and an AI draft is a model round trip, so neither belongs inside an
 * HTTP request.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

import { readConfig, patchConfig, pluginRootDir, exportsDir, lexiconPath } from './config.js'
import * as store from './store.js'
import * as lexiconStore from './lexicon.js'
import { deriveAll, deriveWeek, summarise } from './derive.js'
import { validatePlan, reportToMarkdown } from './validate.js'
import { parseDocument, decodeDocument } from './docx-read.js'
import { readPart } from './zip.js'
import { renderMonthly, renderWeekly, exportName } from './docx.js'
import { draftMonth as runDraftMonth, draftWeek as runDraftWeek, LlmError } from './llm.js'
import { resyncCalendar, SUBJECTS, MONTH_BLOCKS } from './model.js'

// --------------------------------------------------------------- run registry

/**
 * A minimal, self-owned run registry.
 *
 * The harness job service is a restricted union type that needs a mounted
 * controller; a semester export does not fit it. Runs are cancelled on unload so
 * a shut-down plugin never leaves a promise writing files.
 */
function createRuns() {
  const runs = new Map()
  const controllers = new Map()

  const start = (label, task) => {
    const id = `run-${Math.random().toString(36).slice(2, 10)}`
    const controller = new AbortController()
    controllers.set(id, controller)
    const run = {
      id, label, status: 'running', phase: '准备', message: '', startedAt: Date.now(),
      elapsedMs: 0, progress: { done: 0, total: 0 }, result: null, error: null,
      log: [],
    }
    runs.set(id, run)
    const tick = setInterval(() => { run.elapsedMs = Date.now() - run.startedAt }, 500)
    Promise.resolve()
      .then(() => task({
        signal: controller.signal,
        phase: (phase, message = '') => { run.phase = phase; if (message) run.message = message },
        progress: (done, total) => { run.progress = { done, total } },
        note: (line) => { run.log.push(line); if (run.log.length > 60) run.log.shift() },
      }))
      .then((result) => { run.status = 'done'; run.result = result ?? null; run.phase = '完成' })
      .catch((error) => {
        if (controller.signal.aborted) { run.status = 'cancelled'; run.phase = '已取消'; return }
        run.status = 'failed'
        run.error = { code: error?.code ?? 'failed', message: String(error?.message ?? error), problems: error?.problems }
      })
      .finally(() => {
        clearInterval(tick)
        controllers.delete(id)
        run.elapsedMs = Date.now() - run.startedAt
      })
    return id
  }

  const status = (id) => {
    const run = runs.get(id)
    if (!run) return null
    return { ...run, progress: { ...run.progress }, log: [...run.log] }
  }

  const list = () => [...runs.keys()].map(status).sort((a, b) => b.startedAt - a.startedAt)

  const cancel = (id) => {
    const controller = controllers.get(id)
    if (!controller) return false
    controller.abort()
    return true
  }

  const dispose = () => { for (const controller of controllers.values()) { try { controller.abort() } catch { /* already gone */ } } }

  return { start, status, list, cancel, dispose }
}

// ------------------------------------------------------------------- helpers

const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

/** Where exports land: the user's Desktop when there is one, else the plugin dir. */
export function resolveExportDir(config, plan) {
  const configured = str(config?.export?.dir)
  if (configured) return configured
  const desktop = join(homedir(), 'Desktop')
  const stem = `${plan?.semesterLabel ?? ''}${plan?.className ?? ''}计划`.replace(/[\\/:*?"<>|]/g, '')
  if (existsSync(desktop)) return join(desktop, stem || '幼儿园计划')
  return exportsDir()
}

/** A filesystem-safe filename. */
const safeName = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_')

export function createApi(ctx) {
  const runs = createRuns()
  const llm = () => ctx.get('llm')

  let lexiconCache = null

  /**
   * Agent tools the harness refused to register.
   *
   * Carried on the service so `GET /status` can report them: a rejected tool
   * schema is otherwise completely silent — the tool simply does not exist, and
   * nothing anywhere says why.
   * @type {Array<{name:string,message:string}>}
   */
  let toolFailures = []

  async function getLexicon() {
    if (lexiconCache) return lexiconCache
    try {
      lexiconCache = lexiconStore.normaliseLexicon(JSON.parse(await readFile(lexiconPath(), 'utf8')))
    } catch {
      lexiconCache = lexiconStore.defaultLexicon()
    }
    return lexiconCache
  }

  async function saveLexicon(lexicon) {
    lexiconCache = lexicon
    const target = lexiconPath()
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify({ version: 1, categories: lexicon.categories, updatedAt: lexicon.updatedAt }, null, 2)}\n`, 'utf8')
    return lexicon
  }

  /** Which model the drafting stages call: explicit config wins, else the session default. */
  async function llmSelection() {
    const cfg = await readConfig()
    if (cfg.llm?.provider && cfg.llm?.model) return { provider: cfg.llm.provider, model: cfg.llm.model, source: 'config' }
    const service = ctx.get('agentDefaultModel')
    const current = service?.get?.() ?? service?.current?.() ?? null
    if (current?.provider && current?.model) return { provider: current.provider, model: current.model, source: 'agent-default' }
    return { provider: null, model: null, source: 'none' }
  }

  // ---------------------------------------------------------------- config

  async function getConfig() {
    const cfg = await readConfig()
    const selection = await llmSelection()
    return { ...cfg, resolvedLlm: selection, rootDir: pluginRootDir(), exportDir: resolveExportDir(cfg, null) }
  }

  async function saveConfig(patch) {
    const next = await patchConfig(patch ?? {})
    const selection = await llmSelection()
    return { ...next, resolvedLlm: selection }
  }

  async function status() {
    const cfg = await readConfig()
    const selection = await llmSelection()
    const plans = await store.listPlanSummaries()
    const lexicon = await getLexicon()
    return {
      llm: { selection, available: Boolean(llm()) },
      plans,
      lexicon: {
        categories: Object.values(lexicon.categories).map((c) => ({ key: c.key, label: c.label, hint: c.hint, slot: c.slot, perDay: Boolean(c.perDay), count: c.items.length })),
        total: Object.values(lexicon.categories).reduce((n, c) => n + c.items.length, 0),
      },
      dirs: { root: pluginRootDir(), exports: resolveExportDir(cfg, null) },
      subjects: SUBJECTS.map((s) => ({ key: s.key, group: s.group, sub: s.sub, activity: s.activity, prefDay: s.prefDay })),
      monthBlocks: MONTH_BLOCKS,
      tools: { failures: toolFailures },
    }
  }

  // ------------------------------------------------------------------ plans

  const listPlans = () => store.listPlanSummaries()

  async function getPlan(id) {
    const plan = await store.getPlan(id)
    if (!plan) return null
    return { plan, derived: deriveAll(plan), report: validatePlan(plan) }
  }

  const createPlan = (input) => store.createPlan(input ?? {})
  const updatePlan = (id, patch) => store.updatePlan(id, patch)
  const removePlan = (id) => store.removePlan(id)

  /** Re-derive weeks and month membership from the term window + holidays. */
  async function resync(id) {
    const plan = await store.getPlan(id)
    if (!plan) return null
    return store.savePlan(resyncCalendar(plan))
  }

  const validate = async (id) => {
    const plan = await store.getPlan(id)
    if (!plan) return null
    const report = validatePlan(plan)
    return { report, markdown: reportToMarkdown(plan, report) }
  }

  // ---------------------------------------------------------------- lexicon

  async function lexiconList(categoryKey) {
    const lexicon = await getLexicon()
    if (categoryKey) {
      const category = lexicon.categories[categoryKey]
      if (!category) return null
      return { key: category.key, label: category.label, hint: category.hint, perDay: Boolean(category.perDay), items: category.items }
    }
    return {
      categories: Object.values(lexicon.categories).map((c) => ({
        key: c.key, label: c.label, hint: c.hint, slot: c.slot, perDay: Boolean(c.perDay), items: c.items,
      })),
    }
  }

  async function lexiconAdd(categoryKey, text, tags) {
    const lexicon = await getLexicon()
    const item = lexiconStore.addItem(lexicon, categoryKey, text, tags ?? [])
    await saveLexicon(lexicon)
    return item
  }

  async function lexiconRemove(categoryKey, id) {
    const lexicon = await getLexicon()
    const removed = lexiconStore.removeItem(lexicon, categoryKey, id)
    if (removed) await saveLexicon(lexicon)
    return removed
  }

  async function lexiconSearch(query, limit) {
    return lexiconStore.searchItems(await getLexicon(), query, limit)
  }

  // ---------------------------------------------------------------- import

  /**
   * Import one or more existing plan .docx files into a plan set.
   *
   * A monthly plan creates or replaces a month; a weekly plan is attached as
   * that week's override *and* kept as `imported`, which is what lets the
   * consistency report name the exact line where a hand-made weekly drifted
   * from its month.
   *
   * @param {{planId?:string, files:Array<{name:string, base64:string}>, hint?:object, createIfMissing?:boolean}} input
   */
  async function importDocx(input) {
    const files = Array.isArray(input?.files) ? input.files : []
    if (files.length === 0) throw new Error('请至少选择一个 .docx 文件')
    const hint = input?.hint && typeof input.hint === 'object' ? input.hint : {}
    const cfg = await readConfig()

    let plan = input?.planId ? await store.getPlan(input.planId) : null
    if (!plan && input?.createIfMissing === false) throw new Error('没有找到目标计划')

    const decoded = []
    for (const file of files) {
      const buffer = Buffer.from(String(file.base64 ?? ''), 'base64')
      if (buffer.length === 0) continue
      const parsed = parseDocument(readPart(buffer, 'word/document.xml'))
      const doc = decodeDocument(parsed, hint)
      decoded.push({ name: str(file.name, 'document.docx'), doc })
    }
    if (decoded.length === 0) throw new Error('这些文件里没有可识别的计划表')

    if (!plan) {
      const first = decoded[0]
      const identity = first.doc.identity
      plan = await store.createPlan({
        ...identity,
        semesterLabel: identity.semesterLabel || cfg.semester.label,
        year: identity.year ?? cfg.semester.year,
        termStart: cfg.semester.termStart,
        termEnd: cfg.semester.termEnd,
        holidays: cfg.semester.holidays,
        makeupDays: cfg.semester.makeupDays,
        className: identity.className || '大一班',
      })
    }

    const months = plan.months.map((m) => ({ ...m, weeks: m.weeks.map((w) => ({ ...w })), courses: Object.fromEntries(Object.entries(m.courses).map(([k, v]) => [k, [...v]])) }))
    const weekly = { ...plan.weekly }
    const notes = []

    for (const { name, doc } of decoded) {
      if (doc.kind === 'monthly') {
        const incoming = doc.month
        const at = months.findIndex((m) => m.monthNo === incoming.monthNo)
        if (at >= 0) { months[at] = { ...incoming, id: months[at].id }; notes.push(`已覆盖 ${incoming.label}（来自 ${name}）`) }
        else { months.push(incoming); notes.push(`已新增 ${incoming.label}（来自 ${name}）`) }
      } else {
        const weekNo = doc.weekly.weekNo
        if (!Number.isInteger(weekNo)) { notes.push(`跳过 ${name}：识别不出周次`); continue }
        const existing = weekly[String(weekNo)] ?? {}
        weekly[String(weekNo)] = {
          ...existing,
          theme: doc.weekly.theme || existing.theme || '',
          layout: doc.weekly.layout || existing.layout || null,
          focus: { ...(existing.focus ?? {}), ...Object.fromEntries(Object.entries(doc.weekly.focus ?? {}).filter(([, v]) => String(v ?? '').trim())) },
          games: {
            ...(existing.games ?? {}),
            ...Object.fromEntries(Object.entries(doc.weekly.games ?? {}).filter(([, v]) => (Array.isArray(v) ? v.some(Boolean) : String(v ?? '').trim()))),
          },
          imported: {
            source: name,
            lessons: doc.weekly.lessons ?? [],
            focus: doc.weekly.focus ?? {},
            theme: doc.weekly.theme ?? '',
          },
        }
        notes.push(`已导入第${weekNo}周（来自 ${name}）`)
      }
    }

    const next = await store.savePlan({
      ...plan,
      months: months.sort((a, b) => a.monthNo - b.monthNo),
      weekly,
      focusMode: plan.focusMode,
    })

    // Newly imported wording becomes reusable in the phrase library.
    const lexicon = await getLexicon()
    const learned = lexiconStore.learnFromPlan(lexicon, next)
    if (learned.added > 0) await saveLexicon(lexicon)

    const report = validatePlan(next)
    return { plan: next, notes, learned, report: { counts: report.counts, total: report.total, issues: report.issues.slice(0, 40) } }
  }

  // ---------------------------------------------------------------- drafts

  function resolveModel() {
    return llmSelection().then((selection) => {
      if (!selection.provider || !selection.model) {
        const error = new LlmError('没有可用的生成模型。请在插件设置里指定，或在 DSH 里选一个默认模型。', { code: 'no-model' })
        throw error
      }
      return selection
    })
  }

  /** Start an AI draft of one month. Returns a run id. */
  function startDraftMonth({ planId, monthNo, instruction = '' } = {}) {
    return runs.start(`生成 ${monthNo} 月计划`, async (job) => {
      const plan = await store.getPlan(planId)
      if (!plan) throw new Error(`没有找到计划 ${planId}`)
      const month = plan.months.find((m) => m.monthNo === Number(monthNo))
      if (!month) throw new Error(`这个计划里没有 ${monthNo} 月`)
      job.phase('选择模型')
      const selection = await resolveModel()
      job.phase('生成内容', `调用 ${selection.provider}/${selection.model}`)
      const draft = await runDraftMonth({
        llm: llm(), provider: selection.provider, model: selection.model,
        plan, month, instruction, lexicon: await getLexicon(), signal: job.signal,
        onProgress: (info) => job.phase(info.phase === 'streaming' ? '生成中' : info.phase === 'retrying' ? '校验失败，重试中' : '校验中', info.problems?.join('；') ?? ''),
      })
      job.phase('完成')
      return { kind: 'month', monthNo: month.monthNo, draft, model: selection }
    })
  }

  /** Start an AI draft of one week. Returns a run id. */
  function startDraftWeek({ planId, weekNo, instruction = '' } = {}) {
    return runs.start(`生成第 ${weekNo} 周计划`, async (job) => {
      const plan = await store.getPlan(planId)
      if (!plan) throw new Error(`没有找到计划 ${planId}`)
      job.phase('选择模型')
      const selection = await resolveModel()
      job.phase('生成内容', `调用 ${selection.provider}/${selection.model}`)
      const draft = await runDraftWeek({
        llm: llm(), provider: selection.provider, model: selection.model,
        plan, weekNo: Number(weekNo), instruction, lexicon: await getLexicon(), signal: job.signal,
        onProgress: (info) => job.phase(info.phase === 'streaming' ? '生成中' : info.phase === 'retrying' ? '校验失败，重试中' : '校验中', info.problems?.join('；') ?? ''),
      })
      job.phase('完成')
      return { kind: 'week', weekNo: Number(weekNo), draft, model: selection }
    })
  }

  /**
   * Take a finished AI draft onto the plan.
   *
   * Kept separate from the draft run on purpose: generating is a model call that
   * can fail, and the teacher should be able to read what it produced before any
   * of it lands in the semester.
   */
  async function applyDraft({ planId, kind, monthNo, weekNo, draft, mode = 'merge' } = {}) {
    const plan = await store.getPlan(planId)
    if (!plan) return null
    if (kind === 'month') {
      const months = plan.months.map((m) => {
        if (m.monthNo !== Number(monthNo)) return m
        const courses = {}
        for (const subject of SUBJECTS) {
          // 'merge' keeps an already-written title unless the draft has one too.
          courses[subject.key] = m.weeks.map((_, i) => {
            const incoming = String(draft?.courses?.[subject.key]?.[i] ?? '').trim()
            const existing = String(m.courses?.[subject.key]?.[i] ?? '').trim()
            return mode === 'replace' ? incoming : (incoming || existing)
          })
        }
        return {
          ...m,
          focus: mode === 'replace' ? { ...m.focus, ...draft.focus } : {
            regular: String(draft?.focus?.regular ?? '').trim() || m.focus.regular,
            moral: String(draft?.focus?.moral ?? '').trim() || m.focus.moral,
            safety: String(draft?.focus?.safety ?? '').trim() || m.focus.safety,
            family: m.focus.family,
          },
          courses,
          blocks: mode === 'replace'
            ? { ...m.blocks, ...draft.blocks }
            : Object.fromEntries(MONTH_BLOCKS.map((b) => [b.key, String(draft?.blocks?.[b.key] ?? '').trim() || m.blocks[b.key]])),
        }
      })
      return store.savePlan({ ...plan, months })
    }

    const key = String(weekNo)
    const existing = plan.weekly?.[key] ?? {}
    const merge5 = (incoming, current) => Array.from({ length: 5 }, (_, i) => {
      const next = String(incoming?.[i] ?? '').trim()
      return mode === 'replace' ? next : (next || String(current?.[i] ?? ''))
    })
    const weekly = {
      ...plan.weekly,
      [key]: {
        ...existing,
        theme: existing.theme ?? '',
        focus: mode === 'replace'
          ? { ...existing.focus, ...draft.focus }
          : Object.fromEntries(Object.entries(draft?.focus ?? {}).map(([k, v]) => [k, String(v ?? '').trim() || String(existing.focus?.[k] ?? '')])),
        games: {
          morning: merge5(draft?.games?.morning, existing.games?.morning),
          afternoon: merge5(draft?.games?.afternoon, existing.games?.afternoon),
          walk: String(draft?.games?.walk ?? '').trim() || String(existing.games?.walk ?? ''),
          indoor: String(draft?.games?.indoor ?? '').trim() || String(existing.games?.indoor ?? ''),
          indoorTrailing: existing.games?.indoorTrailing ?? '',
        },
      },
    }
    return store.savePlan({ ...plan, weekly })
  }

  // ---------------------------------------------------------------- exports

  async function renderOne({ planId, kind, monthNo, weekNo }) {
    const plan = await store.getPlan(planId)
    if (!plan) throw new Error(`没有找到计划 ${planId}`)
    if (kind === 'monthly') {
      const month = plan.months.find((m) => m.monthNo === Number(monthNo))
      if (!month) throw new Error(`这个计划里没有 ${monthNo} 月`)
      const rendered = await renderMonthly(plan, month)
      return { buffer: rendered.buffer, name: safeName(exportName(plan, 'monthly', month)) }
    }
    const derived = deriveWeek(plan, Number(weekNo))
    if (!derived) throw new Error(`这个计划里没有第 ${weekNo} 周`)
    const rendered = await renderWeekly(plan, Number(weekNo))
    return { buffer: rendered.buffer, name: safeName(exportName(plan, 'weekly', derived)) }
  }

  /**
   * Write the whole semester to disk: every month, every week and the report.
   * Returns a run id; poll with `runStatus`.
   */
  function startExportAll({ planId, dir } = {}) {
    return runs.start(`导出整学期计划`, async (job) => {
      const cfg = await readConfig()
      const plan = await store.getPlan(planId)
      if (!plan) throw new Error(`没有找到计划 ${planId}`)
      const target = str(dir) || resolveExportDir(cfg, plan)
      await mkdir(target, { recursive: true })

      const written = []
      const total = plan.months.length + deriveAll(plan).length + 2
      let done = 0

      job.phase('导出月计划')
      for (const month of plan.months) {
        const rendered = await renderMonthly(plan, month)
        const name = safeName(exportName(plan, 'monthly', month))
        await writeFile(join(target, name), rendered.buffer)
        written.push({ kind: 'monthly', monthNo: month.monthNo, name, bytes: rendered.buffer.length })
        job.progress(++done, total); job.note(`✓ ${name}`)
      }

      job.phase('导出周计划')
      for (const derived of deriveAll(plan)) {
        const rendered = await renderWeekly(plan, derived.weekNo)
        const name = safeName(exportName(plan, 'weekly', derived))
        await writeFile(join(target, name), rendered.buffer)
        written.push({ kind: 'weekly', weekNo: derived.weekNo, name, bytes: rendered.buffer.length })
        job.progress(++done, total); job.note(`✓ ${name}`)
      }

      job.phase('导出检查报告')
      const report = validatePlan(plan)
      const markdown = reportToMarkdown(plan, report)
      await writeFile(join(target, '一致性检查报告.md'), markdown, 'utf8')
      written.push({ kind: 'report', name: '一致性检查报告.md', bytes: Buffer.byteLength(markdown) })
      job.progress(++done, total)

      const jsonName = '计划数据.json'
      await writeFile(join(target, jsonName), `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
      written.push({ kind: 'json', name: jsonName })
      job.progress(++done, total)

      return { dir: target, files: written, counts: report.counts }
    })
  }

  const runStatus = (id) => runs.status(id)
  const runList = () => runs.list()
  const cancelRun = (id) => runs.cancel(id)

  /** Called by the host half after registering the agent tools. */
  const setToolFailures = (failures) => { toolFailures = Array.isArray(failures) ? failures : [] }

  return {
    // config / status
    getConfig, saveConfig, status, llmSelection, setToolFailures,
    // plans
    listPlans, getPlan, createPlan, updatePlan, removePlan, resync, validate,
    summarise,
    // lexicon
    lexiconList, lexiconAdd, lexiconRemove, lexiconSearch,
    // import
    importDocx,
    // drafts
    startDraftMonth, startDraftWeek, applyDraft,
    // exports
    renderOne, startExportAll, resolveExportDir,
    // runs
    runStatus, runList, cancelRun, disposeRuns: () => runs.dispose(),
    // re-exports the route layer needs
    reportToMarkdown,
  }
}

export default createApi
