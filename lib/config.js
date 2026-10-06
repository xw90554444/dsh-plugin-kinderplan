/**
 * Plugin configuration and on-disk locations.
 *
 * Everything lives under the DSH home directory rather than inside the installed
 * package, so reinstalling or upgrading the plugin never destroys a teacher's
 * plans, lexicon or settings.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { DEFAULT_HOLIDAYS, DEFAULT_MAKEUP_DAYS } from './model.js'

/** `DSH_HOME` is set by the harness; the fallback only matters outside it. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export function pluginRootDir() { return join(dshHome(), 'kinderplan') }
export function configPath() { return join(pluginRootDir(), 'config.json') }
export function plansDir() { return join(pluginRootDir(), 'plans') }
export function lexiconPath() { return join(pluginRootDir(), 'lexicon.json') }
export function exportsDir() { return join(pluginRootDir(), 'exports') }
export function importsDir() { return join(pluginRootDir(), 'imports') }
export function loadReportPath() { return join(pluginRootDir(), 'last-load.json') }

/**
 * Record how far the plugin got while loading.
 *
 * Written synchronously on every `apply()` — start, each stage, and the outcome.
 * A plugin that fails to load is otherwise invisible: the client bundle still
 * reaches the page, so the panel renders and every button silently does nothing,
 * while the host route answers 404 and nothing anywhere says why. This file is
 * the answer to "did the host half load, and if not, where did it stop?".
 *
 * It must never throw: diagnostics cannot be allowed to break loading.
 */
export function writeLoadReport(report) {
  try {
    mkdirSync(pluginRootDir(), { recursive: true })
    writeFileSync(loadReportPath(), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } catch { /* diagnostics must never break loading */ }
}

/** Read the last load report, or null when the plugin has never loaded. */
export async function readLoadReport() {
  try {
    return JSON.parse(await readFile(loadReportPath(), 'utf8'))
  } catch {
    return null
  }
}

export const DEFAULT_CONFIG = Object.freeze({
  /** Which model the drafting stages call. Null = follow the session default. */
  llm: { provider: null, model: null },
  /** Default term window used when creating a plan set. */
  semester: {
    label: '2026年秋季学期',
    year: 2026,
    termStart: '2026-09-01',
    termEnd: '2027-01-22',
    holidays: DEFAULT_HOLIDAYS.map((h) => ({ ...h })),
    makeupDays: [...DEFAULT_MAKEUP_DAYS],
  },
  /** 'condense' | 'full' — see normalisePlanSet in model.js. */
  focusMode: 'condense',
  /** Where exported .docx files are written when no path is given. */
  export: { openAfterExport: false },
  ui: { activePlanId: null, tab: 'month' },
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shallow-per-section merge that keeps unknown keys out and fills every default. */
export function mergeConfig(base, patch) {
  const out = {}
  for (const [key, value] of Object.entries(base)) {
    if (isPlainObject(value) && !Array.isArray(value)) out[key] = mergeConfig(value, isPlainObject(patch?.[key]) ? patch[key] : {})
    else if (patch && key in patch) out[key] = patch[key]
    else out[key] = value
  }
  return out
}

export function normaliseConfig(raw) {
  const merged = mergeConfig(DEFAULT_CONFIG, isPlainObject(raw) ? raw : {})
  const holidays = Array.isArray(merged.semester?.holidays) && merged.semester.holidays.length > 0
    ? merged.semester.holidays.map((h) => ({
      id: String(h?.id ?? 'h'),
      label: String(h?.label ?? ''),
      from: String(h?.from ?? ''),
      to: String(h?.to ?? ''),
      enabled: h?.enabled !== false,
    }))
    : DEFAULT_HOLIDAYS.map((h) => ({ ...h }))
  return {
    llm: {
      provider: typeof merged.llm?.provider === 'string' && merged.llm.provider.trim() ? merged.llm.provider.trim() : null,
      model: typeof merged.llm?.model === 'string' && merged.llm.model.trim() ? merged.llm.model.trim() : null,
    },
    semester: {
      label: String(merged.semester?.label ?? DEFAULT_CONFIG.semester.label),
      year: Number.isInteger(merged.semester?.year) ? merged.semester.year : DEFAULT_CONFIG.semester.year,
      termStart: String(merged.semester?.termStart ?? DEFAULT_CONFIG.semester.termStart),
      termEnd: String(merged.semester?.termEnd ?? DEFAULT_CONFIG.semester.termEnd),
      holidays,
      makeupDays: Array.isArray(merged.semester?.makeupDays)
        ? merged.semester.makeupDays.map((d) => String(d)).filter(Boolean)
        : [...DEFAULT_MAKEUP_DAYS],
    },
    focusMode: merged.focusMode === 'full' ? 'full' : 'condense',
    export: { openAfterExport: merged.export?.openAfterExport === true },
    ui: {
      activePlanId: typeof merged.ui?.activePlanId === 'string' && merged.ui.activePlanId ? merged.ui.activePlanId : null,
      tab: typeof merged.ui?.tab === 'string' ? merged.ui.tab : 'month',
    },
  }
}

export async function readConfig() {
  try {
    return normaliseConfig(JSON.parse(await readFile(configPath(), 'utf8')))
  } catch {
    return normaliseConfig(null)
  }
}

/** Write via a temp file + rename so a crash mid-write cannot truncate the config. */
export async function writeConfig(config) {
  const normalised = normaliseConfig(config)
  const target = configPath()
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(normalised, null, 2)}\n`, 'utf8')
  await rename(temp, target)
  return normalised
}

export async function patchConfig(patch) {
  return writeConfig(mergeConfig(await readConfig(), patch ?? {}))
}

export default {
  dshHome, pluginRootDir, configPath, plansDir, lexiconPath, exportsDir, importsDir,
  DEFAULT_CONFIG, normaliseConfig, readConfig, writeConfig, patchConfig, mergeConfig,
}
