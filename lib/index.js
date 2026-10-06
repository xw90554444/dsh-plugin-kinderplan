/**
 * KinderPlan Studio — host half.
 *
 * Responsibilities:
 *  - own the plan store and the phrase lexicon on disk
 *  - compile monthly plans into weekly plans and validate the pair
 *  - render and write .docx files (the browser cannot write to disk)
 *  - run the AI drafting stages as tracked, cancellable runs
 *  - expose one JSON API to the studio UI over a web route
 *  - expose the same capabilities to the agent as tools
 */

import { createApi } from './api.js'
import { createToolsPlugin } from './tools.js'
import { deriveAll } from './derive.js'
import { writeLoadReport } from './config.js'

export const name = 'kinderPlan'
/** `tools` is required; the web route is optional so headless profiles still work. */
export const inject = ['tools']

const ROUTE_PREFIX = '/kinderplan-api'
const MAX_BODY_BYTES = 48 * 1024 * 1024 // a semester of .docx files, base64

async function readJson(req, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const error = new Error(`请求体超过 ${limit} 字节`)
      error.code = 'body-too-large'
      throw error
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('请求体不是合法 JSON')
    error.code = 'bad-json'
    throw error
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendDocx(res, name, buffer) {
  res.writeHead(200, {
    'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // RFC 5987 so a Chinese filename survives every browser.
    'content-disposition': `attachment; filename="plan.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  })
  res.end(buffer)
}

export function apply(ctx) {
  // Diagnostics first, and synchronously. If anything below throws, this file
  // still names the stage that failed — which is the only way to tell "the host
  // half never loaded" apart from "the page was stale" without server logs.
  const report = {
    at: new Date().toISOString(),
    plugin: 'dsh-plugin-kinderplan',
    stage: 'start',
    ok: false,
    tools: null,
    webUi: null,
    error: null,
  }
  writeLoadReport(report)

  try {
    const api = createApi(ctx)

    report.stage = 'provide'
    writeLoadReport(report)
    ctx.provide(name, api)

    // The web half is registered FIRST, and the agent tools after it.
    //
    // The studio is this plugin's primary surface; the tools are a convenience
    // on top. Registering tools first meant that one rejected tool definition
    // aborted `apply()` and took the whole panel down with it — the route
    // answered 404 and the page never received a boot token, so every button
    // silently did nothing. Ordering alone does not fix that, so `registerTools`
    // also isolates each definition; the ordering just keeps the panel ahead of
    // anything that can fail.
    //
    // The web half is a CHILD plugin that declares `webServer` as a hard
    // dependency. Querying `ctx.get('webServer')` here instead would race: `get`
    // never waits, so a carrier that had not been provided yet would leave the
    // plugin with working tools and a dead UI, and nothing in the logs to say so.
    report.stage = 'web-ui'
    writeLoadReport(report)
    ctx.plugin(webUiPlugin(api, report))

    report.stage = 'tools'
    writeLoadReport(report)
    ctx.effect(() => registerTools(ctx, api, report), 'kinderplan.tools')

    report.stage = 'runs'
    ctx.effect(() => () => api.disposeRuns(), 'kinderplan.runs')

    report.ok = true
    report.stage = 'done'
  } catch (error) {
    report.error = {
      message: String(error?.message ?? error),
      stack: String(error?.stack ?? '').split('\n').slice(0, 12).join('\n'),
    }
    report.stage = `failed-at-${report.stage}`
    throw error
  } finally {
    writeLoadReport(report)
  }
}

/**
 * Register the agent tools, isolating each definition.
 *
 * A tool the harness rejects must cost only that tool. Each registration is
 * guarded and its failure recorded — on the load report, which `GET /status`
 * surfaces and the settings page displays. Otherwise a rejected schema is
 * invisible: the tool simply does not exist and nobody can say why.
 *
 * @returns {() => void} disposer for everything that did register
 */
function registerTools(ctx, api, report) {
  const disposers = []
  const failures = []
  let registered = 0

  let definitions = []
  try {
    definitions = createToolsPlugin(api).definitions
  } catch (error) {
    failures.push({ name: '(build)', message: String(error?.message ?? error) })
  }

  for (const definition of definitions) {
    try {
      const dispose = ctx.tools.register(definition)
      if (typeof dispose === 'function') disposers.push(dispose)
      registered += 1
    } catch (error) {
      failures.push({ name: definition?.name ?? '(unnamed)', message: String(error?.message ?? error) })
    }
  }

  api.setToolFailures?.(failures)
  if (report) {
    report.tools = { registered, failures }
    writeLoadReport(report)
  }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose() } catch { /* a failed unregister must not block the rest */ }
    }
  }
}

export function webUiPlugin(api, report = null) {
  return {
    name: 'kinderPlanWebUi',
    inject: ['webServer'],
    apply(ctx) {
      const webServer = ctx.webServer
      const token = globalThis.crypto.randomUUID()

      ctx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'global', name: '__KINDERPLAN__', value: { token, prefix: ROUTE_PREFIX } })
      })

      if (report) {
        report.webUi = { tokenMinted: true, routePrefix: ROUTE_PREFIX, tapIndex: typeof webServer.tapIndex === 'function' }
      }

      ctx.effect(() => webServer.tapIndex((html) => {
        const boot = `<script>globalThis.__KINDERPLAN__=${JSON.stringify({ token, prefix: ROUTE_PREFIX })}</script>`
        if (html.includes('</head>')) return html.replace('</head>', `${boot}</head>`)
        return boot + html
      }), 'kinderplan.index-injection')

      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        async handler(req, res) {
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
          const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
          const seg = route.split('/').filter(Boolean).map(decodeURIComponent)
          const method = req.method === 'POST' ? 'POST' : 'GET'

          // A .docx download is fetched by the browser's own navigation, which
          // cannot set a header, so the token is also accepted from the query
          // for downloads only.
          const presented = req.headers['x-kinderplan-token']
            ?? (seg[0] === 'download' ? url.searchParams.get('t') : null)
          if (presented !== token) {
            sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '缺少或无效的插件令牌' } })
            return
          }

          try {
            // ------------------------------------------------------- status
            if (seg[0] === 'status' && method === 'GET') {
              return sendJson(res, 200, { ok: true, status: await api.status() })
            }
            if (seg[0] === 'config' && method === 'GET') {
              return sendJson(res, 200, { ok: true, config: await api.getConfig() })
            }
            if (seg[0] === 'config' && method === 'POST') {
              const body = await readJson(req)
              return sendJson(res, 200, { ok: true, config: await api.saveConfig(body?.patch ?? body) })
            }

            // -------------------------------------------------------- plans
            if (seg[0] === 'plans' && seg.length === 1 && method === 'GET') {
              return sendJson(res, 200, { ok: true, plans: await api.listPlans() })
            }
            if (seg[0] === 'plans' && seg.length === 1 && method === 'POST') {
              return sendJson(res, 200, { ok: true, plan: await api.createPlan(await readJson(req)) })
            }
            if (seg[0] === 'plans' && seg[1]) {
              const id = seg[1]
              if (seg[2] === 'delete' && method === 'POST') {
                const removed = await api.removePlan(id)
                return sendJson(res, removed ? 200 : 404, { ok: removed })
              }
              if (seg[2] === 'resync' && method === 'POST') {
                const plan = await api.resync(id)
                return plan
                  ? sendJson(res, 200, { ok: true, ...(await api.getPlan(id)) })
                  : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有计划 ${id}` } })
              }
              if (seg[2] === 'report' && method === 'GET') {
                const result = await api.validate(id)
                return result
                  ? sendJson(res, 200, { ok: true, ...result })
                  : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有计划 ${id}` } })
              }
              if (seg.length === 2 && method === 'GET') {
                const detail = await api.getPlan(id)
                return detail
                  ? sendJson(res, 200, { ok: true, ...detail })
                  : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有计划 ${id}` } })
              }
              if (seg.length === 2 && method === 'POST') {
                const plan = await api.updatePlan(id, await readJson(req))
                return plan
                  ? sendJson(res, 200, { ok: true, plan })
                  : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有计划 ${id}` } })
              }
            }

            // ------------------------------------------------------ lexicon
            if (seg[0] === 'lexicon' && method === 'GET') {
              if (seg[1] === 'search') {
                return sendJson(res, 200, { ok: true, items: await api.lexiconSearch(url.searchParams.get('q') ?? '', 60) })
              }
              const result = await api.lexiconList(seg[1] ?? null)
              return result
                ? sendJson(res, 200, { ok: true, ...result })
                : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有分类 ${seg[1]}` } })
            }
            if (seg[0] === 'lexicon' && method === 'POST') {
              const body = await readJson(req)
              if (seg[1] === 'add') {
                return sendJson(res, 200, { ok: true, item: await api.lexiconAdd(body.category, body.text, body.tags) })
              }
              if (seg[1] === 'remove') {
                return sendJson(res, 200, { ok: await api.lexiconRemove(body.category, body.id) })
              }
            }

            // ------------------------------------------------------- import
            if (seg[0] === 'import' && method === 'POST') {
              const body = await readJson(req)
              return sendJson(res, 200, { ok: true, ...(await api.importDocx(body)) })
            }

            // ------------------------------------------------------- drafts
            if (seg[0] === 'draft' && method === 'POST') {
              const body = await readJson(req)
              if (seg[1] === 'month') return sendJson(res, 200, { ok: true, runId: api.startDraftMonth(body) })
              if (seg[1] === 'week') return sendJson(res, 200, { ok: true, runId: api.startDraftWeek(body) })
              if (seg[1] === 'apply') {
                const plan = await api.applyDraft(body)
                return plan
                  ? sendJson(res, 200, { ok: true, plan })
                  : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有计划 ${body?.planId}` } })
              }
            }

            // --------------------------------------------------------- runs
            if (seg[0] === 'runs' && method === 'GET') {
              if (seg[1]) {
                const run = api.runStatus(seg[1])
                return run
                  ? sendJson(res, 200, { ok: true, run })
                  : sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有运行 ${seg[1]}` } })
              }
              return sendJson(res, 200, { ok: true, runs: api.runList() })
            }
            if (seg[0] === 'runs' && seg[2] === 'cancel' && method === 'POST') {
              return sendJson(res, 200, { ok: api.cancelRun(seg[1]) })
            }

            // ------------------------------------------------------ exports
            if (seg[0] === 'export' && method === 'POST') {
              const body = await readJson(req)
              return sendJson(res, 200, { ok: true, runId: api.startExportAll(body) })
            }
            if (seg[0] === 'download' && method === 'GET') {
              const rendered = await api.renderOne({
                planId: url.searchParams.get('planId'),
                kind: url.searchParams.get('kind') === 'weekly' ? 'weekly' : 'monthly',
                monthNo: url.searchParams.get('monthNo'),
                weekNo: url.searchParams.get('weekNo'),
              })
              return sendDocx(res, rendered.name, rendered.buffer)
            }
            if (seg[0] === 'preview' && method === 'GET') {
              // Compact JSON mirror of a weekly plan, for the studio's preview tab.
              const detail = await api.getPlan(url.searchParams.get('planId'))
              if (!detail) return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个计划' } })
              return sendJson(res, 200, { ok: true, weeks: detail.derived, months: detail.plan.months, plan: detail.plan })
            }
            if (seg[0] === 'all' && method === 'GET') {
              const detail = await api.getPlan(url.searchParams.get('planId'))
              if (!detail) return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个计划' } })
              return sendJson(res, 200, { ok: true, weeks: deriveAll(detail.plan).length })
            }

            return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有路由 ${route}` } })
          } catch (error) {
            return sendJson(res, 500, {
              ok: false,
              error: { code: error?.code ?? 'failed', message: String(error?.message ?? error), problems: error?.problems },
            })
          }
        },
      }), 'kinderplan.route')
    },
  }
}

export default { name, inject, apply }
