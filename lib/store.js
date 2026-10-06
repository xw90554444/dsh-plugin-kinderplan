/**
 * Plan store: one JSON document per plan set.
 *
 * Files on disk rather than a database, because a semester of plans is something
 * a teacher may want to back up, copy to another machine, or diff between two
 * years. Everything the studio produces is derived from this one document.
 */
import { readFile, writeFile, mkdir, rename, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { plansDir } from './config.js'
import { normalisePlanSet, resyncCalendar } from './model.js'
import { summarise } from './derive.js'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const isValidPlanId = (id) => typeof id === 'string' && ID_PATTERN.test(id)
export const planPath = (id) => join(plansDir(), `${id}.json`)

/**
 * Build a filesystem- and URL-safe id.
 *
 * Ids become file names and URL segments, so they stay ASCII even when the
 * class name is not. A name with no ASCII left (Chinese) gets a stable short
 * hash instead of collapsing every plan onto one shared fallback.
 */
export function slugify(input, fallback = 'plan') {
  const raw = String(input ?? '').trim()
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (slug) return slug
  let hash = 5381
  for (let i = 0; i < raw.length; i += 1) hash = (((hash << 5) + hash) + raw.charCodeAt(i)) >>> 0
  return `${fallback}-${hash.toString(36).padStart(6, '0').slice(0, 6)}`
}

export function newPlanId(label) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 8)
  return `${slugify(label, 'plan')}-${stamp}`
}

async function ensureDir() {
  await mkdir(plansDir(), { recursive: true })
}

export async function listPlans() {
  await ensureDir()
  let names = []
  try {
    names = (await readdir(plansDir())).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const plans = []
  for (const name of names) {
    try {
      const plan = normalisePlanSet(JSON.parse(await readFile(join(plansDir(), name), 'utf8')), name.replace(/\.json$/, ''))
      plans.push(plan)
    } catch { /* one corrupt file must not hide the rest */ }
  }
  return plans.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export async function listPlanSummaries() {
  return (await listPlans()).map((plan) => ({
    ...summarise(plan),
    monthLabels: plan.months.map((m) => m.label),
  }))
}

export async function getPlan(id) {
  if (!isValidPlanId(id)) return null
  try {
    return normalisePlanSet(JSON.parse(await readFile(planPath(id), 'utf8')), id)
  } catch {
    return null
  }
}

export async function savePlan(plan) {
  await ensureDir()
  const normalised = normalisePlanSet(plan, plan?.id)
  if (!isValidPlanId(normalised.id)) throw new Error(`非法计划 ID：${normalised.id}`)
  const target = planPath(normalised.id)
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(normalised, null, 2)}\n`, 'utf8')
  await rename(temp, target)
  return normalised
}

/**
 * Create a plan and lay out its semester.
 *
 * The calendar is always computed rather than taken from the caller: week
 * numbers and month membership must agree with the term window and holidays, and
 * letting a create call set them independently is how they drift.
 */
export async function createPlan(input = {}, options = {}) {
  const label = `${input.semesterLabel ?? ''}${input.className ?? ''}`.trim() || '幼儿园计划'
  let id = isValidPlanId(input.id) ? input.id : (options.id ?? newPlanId(label))
  if (!options.overwrite && (await getPlan(id))) {
    let n = 2
    while (await getPlan(`${id}-${n}`)) n += 1
    id = `${id}-${n}`
  }
  const draft = normalisePlanSet({ ...input, id, createdAt: new Date().toISOString() })
  return savePlan(resyncCalendar(draft))
}

/**
 * Merge a patch into a stored plan.
 *
 * Arrays are replaced wholesale — merging a course column element-wise would
 * silently resurrect entries the caller meant to delete. If the patch touches
 * the term window or the holidays, the calendar is re-derived afterwards so the
 * week columns can never end up disagreeing with the dates.
 */
export async function updatePlan(id, patch = {}) {
  const current = await getPlan(id)
  if (!current) return null
  const merged = { ...current, ...patch, id: current.id }
  if (patch.months) {
    // The caller supplied whole months; keep their week lists so column order
    // survives, then let resync re-align them to the calendar below.
    merged.months = patch.months
  }
  const calendarChanged = ['termStart', 'termEnd', 'holidays', 'makeupDays'].some((k) => k in patch)
  const normalised = normalisePlanSet(merged, current.id)
  return savePlan(calendarChanged || patch.resync === true ? resyncCalendar(normalised) : normalised)
}

export async function removePlan(id) {
  if (!isValidPlanId(id)) return false
  try {
    await stat(planPath(id))
  } catch {
    return false
  }
  await rm(planPath(id), { force: true })
  return true
}

export default {
  isValidPlanId, planPath, slugify, newPlanId,
  listPlans, listPlanSummaries, getPlan, savePlan, createPlan, updatePlan, removePlan,
}
