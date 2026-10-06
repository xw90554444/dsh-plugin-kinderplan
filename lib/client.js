/**
 * KinderPlan Studio — client half.
 *
 * Loaded as a combo script through `window.__ModuleLoader__`. It talks to the
 * host half over the plugin's own web route: there is no client service for
 * package-private RPC, and Typert remote descriptors would be far heavier than
 * this UI needs. The per-process token is injected into the shell page by the
 * host, so only a page the harness actually served can reach the route.
 *
 * The two tables render the same rows, columns and merges as the exported .docx.
 * That is deliberate: what the teacher edits on screen is what prints.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-kinderplan',
  factory: function (require) {
    'use strict'
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    // ------------------------------------------------------------- theming

    const CSS = `
.kp-root{--kp-ink:var(--dsw-alias-label-primary,light-dark(#0f1115,#f9fafb));
--kp-muted:var(--dsw-alias-label-secondary,light-dark(#61666b,#cfd3d6));
--kp-line:var(--dsw-alias-border-l2,light-dark(#0000001a,#ffffff1f));
--kp-line-strong:var(--dsw-alias-border-l3,light-dark(#0000001f,#ffffff29));
--kp-surface:var(--dsw-alias-bg-module-platform,light-dark(#f9fafb,#353638));
--kp-surface-2:var(--dsw-specific-menu,light-dark(#f8f9fa,#2b2c2e));
--kp-accent:var(--dsw-alias-brand-primary,light-dark(#0f1115,#f9fafb));
--kp-accent-ink:var(--dsw-alias-label-primary-foreground,light-dark(#fff,#0f1115));
--kp-hover:var(--dsw-alias-interactive-bg-hover,light-dark(#2631480f,#ffffff14));
--kp-ok:light-dark(#1a7f4b,#5ddc9a);--kp-warn:light-dark(#8a5a00,#f0b429);--kp-err:light-dark(#b3261e,#ff8a80);
color:var(--kp-ink);display:flex;flex-direction:column;min-height:0;font-size:13px;line-height:1.55}
.kp-root[data-fill="1"]{height:100%}
.kp-root *{box-sizing:border-box}
.kp-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--kp-line);flex:0 0 auto;flex-wrap:wrap}
.kp-title{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px}
.kp-spacer{flex:1 1 auto}
.kp-tabs{display:flex;gap:2px;padding:8px 14px 0;border-bottom:1px solid var(--kp-line);flex:0 0 auto;flex-wrap:wrap}
.kp-tab{appearance:none;border:0;background:transparent;color:var(--kp-muted);padding:6px 11px;border-radius:7px 7px 0 0;cursor:pointer;font:inherit;position:relative}
.kp-tab:hover{background:var(--kp-hover);color:var(--kp-ink)}
.kp-tab[data-on="1"]{color:var(--kp-ink);font-weight:600}
.kp-tab[data-on="1"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:var(--kp-accent);border-radius:2px}
.kp-tab .kp-count{font-size:11px;color:var(--kp-muted);margin-left:4px}
.kp-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px}
.kp-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--kp-line-strong);background:var(--kp-surface);
color:var(--kp-ink);padding:5px 11px;border-radius:7px;white-space:nowrap}
.kp-btn:hover:not(:disabled){background:var(--kp-hover)}
.kp-btn:disabled{opacity:.5;cursor:default}
.kp-btn[data-variant="primary"]{background:var(--kp-accent);color:var(--kp-accent-ink);border-color:transparent;font-weight:600}
.kp-btn[data-size="sm"]{padding:3px 8px;font-size:12px;border-radius:6px}
.kp-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.kp-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.kp-field>label{font-size:11px;color:var(--kp-muted);font-weight:600;letter-spacing:.02em}
.kp-input,.kp-select,.kp-textarea{font:inherit;color:var(--kp-ink);background:var(--kp-surface);border:1px solid var(--kp-line-strong);
border-radius:7px;padding:5px 8px;min-width:0;width:100%}
.kp-textarea{resize:vertical;min-height:56px;font-family:inherit}
.kp-input:focus,.kp-select:focus,.kp-textarea:focus{outline:2px solid var(--kp-accent);outline-offset:-1px}
.kp-card{border:1px solid var(--kp-line);border-radius:10px;background:var(--kp-surface-2);padding:12px;margin-bottom:10px}
.kp-card>h3{margin:0 0 8px;font-size:13px;font-weight:600}
.kp-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:1px 7px;border-radius:999px;
border:1px solid var(--kp-line-strong);color:var(--kp-muted);white-space:nowrap}
.kp-badge[data-tone="ok"]{color:var(--kp-ok);border-color:currentColor}
.kp-badge[data-tone="warn"]{color:var(--kp-warn);border-color:currentColor}
.kp-badge[data-tone="err"]{color:var(--kp-err);border-color:currentColor}
.kp-empty{padding:36px 16px;text-align:center;color:var(--kp-muted)}
.kp-err{padding:10px 12px;border-radius:8px;border:1px solid var(--kp-err);color:var(--kp-err);margin-bottom:10px;white-space:pre-wrap}
.kp-ok{padding:10px 12px;border-radius:8px;border:1px solid var(--kp-ok);color:var(--kp-ok);margin-bottom:10px;white-space:pre-wrap}
.kp-hint{font-size:12px;color:var(--kp-muted);margin:6px 0 0}
.kp-split{display:grid;grid-template-columns:190px 1fr;gap:12px;align-items:start}
.kp-list{display:flex;flex-direction:column;gap:3px}
.kp-list button{appearance:none;font:inherit;text-align:left;cursor:pointer;border:1px solid transparent;background:transparent;
color:var(--kp-ink);padding:6px 9px;border-radius:7px;display:flex;justify-content:space-between;gap:8px;align-items:center}
.kp-list button:hover{background:var(--kp-hover)}
.kp-list button[data-on="1"]{background:var(--kp-hover);border-color:var(--kp-line-strong);font-weight:600}
.kp-list .kp-sub{font-size:11px;color:var(--kp-muted);font-weight:400}
.kp-scroll{overflow:auto;max-width:100%}
/* The plan tables mirror the Word template: same rows, same merges, same order. */
table.kp-tbl{border-collapse:collapse;table-layout:fixed;background:light-dark(#fff,#232426);width:100%;min-width:900px}
table.kp-tbl td,table.kp-tbl th{border:1px solid var(--kp-line-strong);padding:0;vertical-align:top;font-weight:400}
table.kp-tbl th{background:var(--kp-surface);font-weight:600;text-align:center;vertical-align:middle;padding:5px 6px;font-size:12px}
table.kp-tbl td.kp-lab{background:var(--kp-surface);font-weight:600;text-align:center;vertical-align:middle;padding:6px;font-size:12px;white-space:pre-line}
table.kp-tbl td.kp-sub{background:var(--kp-surface);font-weight:600;text-align:center;vertical-align:middle;font-size:12px}
table.kp-tbl td.kp-month{background:var(--kp-surface);text-align:center;font-weight:700;padding:6px;font-size:14px}
table.kp-tbl td.kp-week{text-align:center;font-weight:600;font-size:12px;padding:5px 4px;vertical-align:middle}
table.kp-tbl td.kp-cell{padding:2px}
table.kp-tbl input,table.kp-tbl textarea{width:100%;border:0;background:transparent;color:var(--kp-ink);font:inherit;
padding:4px 5px;resize:vertical;display:block;border-radius:4px}
table.kp-tbl input:focus,table.kp-tbl textarea:focus{outline:2px solid var(--kp-accent);outline-offset:-2px;background:var(--kp-surface)}
table.kp-tbl input::placeholder,table.kp-tbl textarea::placeholder{color:var(--kp-muted);opacity:.6}
table.kp-tbl td.kp-c{text-align:center;vertical-align:middle;font-size:12px}
table.kp-tbl td.kp-readonly{background:var(--kp-surface);color:var(--kp-muted)}
.kp-src{font-size:10px;color:var(--kp-muted);display:block;margin-top:2px}
.kp-issue{border-left:3px solid var(--kp-line-strong);padding:7px 10px;margin-bottom:6px;border-radius:0 7px 7px 0;background:var(--kp-surface-2)}
.kp-issue[data-level="error"]{border-left-color:var(--kp-err)}
.kp-issue[data-level="warn"]{border-left-color:var(--kp-warn)}
.kp-issue[data-level="info"]{border-left-color:var(--kp-muted)}
.kp-issue .kp-fix{font-size:12px;color:var(--kp-muted);margin-top:3px}
.kp-lex{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.kp-lexitem{border:1px solid var(--kp-line);border-radius:8px;padding:7px 9px;background:var(--kp-surface);white-space:pre-wrap;
word-break:break-word;cursor:pointer;font-size:12px;line-height:1.5}
.kp-lexitem:hover{background:var(--kp-hover)}
.kp-lexitem .kp-x{float:right;color:var(--kp-muted);font-size:11px;padding:0 2px}
.kp-lexitem .kp-x:hover{color:var(--kp-err)}
.kp-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;font-size:12px}
.kp-kv dt{color:var(--kp-muted)}
.kp-kv dd{margin:0}
.kp-dirty{color:var(--kp-warn);font-weight:600}
.kp-log{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;white-space:pre-wrap;
background:var(--kp-surface);border:1px solid var(--kp-line);border-radius:8px;padding:8px;max-height:220px;overflow:auto}
`

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById('kinderplan-style')) return
      const tag = document.createElement('style')
      tag.id = 'kinderplan-style'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ---------------------------------------------------------------- host

    const boot = () => globalThis.__KINDERPLAN__ ?? {}

    /**
     * True when the host never injected its per-process token into this page.
     *
     * A 404 from `/kinderplan-api/*` (host half never registered) and a missing
     * boot global look identical from here, so the message names both and tells
     * the user how to tell them apart — otherwise the panel just does nothing.
     */
    const bootMissing = () => !boot()?.token

    const BOOT_HELP = [
      '插件令牌缺失：这个页面加载的时候，插件的宿主半边还没有就绪。',
      '',
      '· 先按 F5 刷新一次页面。刷新后恢复正常就不用管了。',
      '· 如果刷新后仍然是这样，请在浏览器控制台执行：',
      '    globalThis.__KINDERPLAN__',
      '  结果是 undefined 的话，说明宿主半边根本没有注册路由（插件加载时出错了），',
      '  不是刷新能解决的——请把这个提示发给我。',
    ].join('\n')

    async function call(path, options = {}) {
      const { token, prefix } = boot()
      if (!token) throw new Error(BOOT_HELP)
      const res = await fetch(`${prefix}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          'x-kinderplan-token': token,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      })
      // A 404 here means the route is not registered at all — the host half
      // failed to load. Say that instead of "请求失败（HTTP 404）".
      if (res.status === 404) {
        throw new Error([
          `宿主路由没有注册（HTTP 404：${prefix}${path}）。`,
          '说明插件加载时出错了，面板能显示但后端不在。请把这条发我。',
        ].join('\n'))
      }
      let payload = null
      try {
        payload = await res.json()
      } catch {
        throw new Error(`主机返回了非 JSON 响应（HTTP ${res.status}）`)
      }
      if (!payload?.ok) throw new Error(payload?.error?.message ?? `请求失败（HTTP ${res.status}）`)
      return payload
    }

    const downloadUrl = (query) => {
      const { token, prefix } = boot()
      return `${prefix}/download?${query}&t=${encodeURIComponent(token ?? '')}`
    }

    const useBusy = () => {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const run = useCallback(async (fn) => {
        setBusy(true); setError('')
        try { return await fn() } catch (e) { setError(String(e?.message ?? e)); return null } finally { setBusy(false) }
      }, [])
      return { busy, error, setError, run }
    }
    void useBusy

    // ----------------------------------------------------------- utilities

    const TONE = { error: 'err', warn: 'warn', info: 'muted' }

    function Badge(props) {
      return h('span', { className: 'kp-badge', 'data-tone': props.tone }, props.children)
    }

    function errorsBadge(report) {
      if (!report) return null
      const { error, warn, info } = report.counts
      return h('span', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap' } },
        error > 0 ? h(Badge, { tone: 'err' }, `错误 ${error}`) : h(Badge, { tone: 'ok' }, '无错误'),
        warn > 0 ? h(Badge, { tone: 'warn' }, `警告 ${warn}`) : null,
        info > 0 ? h(Badge, { tone: 'muted' }, `提示 ${info}`) : null)
    }

    const SUBJECTS = [
      { key: 'language', group: '语言', sub: null },
      { key: 'artManual', group: '艺术', sub: '美术' },
      { key: 'artMusic', group: '艺术', sub: '音乐' },
      { key: 'health', group: '健康', sub: null },
      { key: 'social', group: '社会', sub: null },
      { key: 'science', group: '科学', sub: '科学' },
      { key: 'math', group: '科学', sub: '数学' },
      { key: 'safety', group: '安全', sub: null },
      { key: 'finger', group: '手指律动', sub: null },
    ]
    const FOCUS_ROWS = [
      { key: 'regular', label: '常规（生活）培养' },
      { key: 'moral', label: '德育教育' },
      { key: 'safety', label: '安全工作' },
      { key: 'family', label: '家园共育' },
    ]
    const BLOCKS = [
      { key: 'outdoor', label: '户外活动' },
      { key: 'dismissal', label: '离园活动' },
      { key: 'family', label: '家园共育' },
      { key: 'corner', label: '环境区角' },
    ]
    const DAY_LABELS = ['星期一', '星期二', '星期三', '星期四', '星期五']

    // ------------------------------------------------------------ 月计划

    function MonthTab({ plan, month, onChange, onDraft, onApplyDraft, busy, lexicon, settings }) {
      if (!month) return h('div', { className: 'kp-empty' }, '这个计划还没有月份。')
      const weeks = month.weeks
      const setFocus = (key, value) => onChange({ focus: { ...month.focus, [key]: value } })
      const setBlock = (key, value) => onChange({ blocks: { ...month.blocks, [key]: value } })
      const setCourse = (key, index, value) => {
        const column = [...(month.courses[key] ?? [])]
        while (column.length < weeks.length) column.push('')
        column[index] = value
        onChange({ courses: { ...month.courses, [key]: column } })
      }
      const cell = (value, onInput, props = {}) => h('td', { className: 'kp-cell' },
        h('textarea', { value: value ?? '', onChange: (e) => onInput(e.target.value), rows: props.rows ?? 4, placeholder: props.placeholder ?? '' }))
      void cell
      const textCell = (value, onInput, rows = 3) => h('td', { className: 'kp-cell' },
        h('textarea', { value: value ?? '', onChange: (e) => onInput(e.target.value), rows }))

      const rows = []
      rows.push(h('tr', { key: 'm' }, h('td', { className: 'kp-month', colSpan: 3 + weeks.length }, month.label)))

      const focusDefs = [
        { key: 'regular', label: '班级常规（习惯养成）' },
        { key: 'moral', label: '德育教育' },
        { key: 'safety', label: '安全教育' },
      ]
      focusDefs.forEach((row, i) => {
        const children = []
        if (i === 0) children.push(h('td', { className: 'kp-lab', rowSpan: 3, key: 'lab' }, '工作重点'))
        children.push(h('td', { className: 'kp-lab', key: 'k', style: { width: 96 } }, row.label))
        children.push(textCell(month.focus[row.key], (v) => setFocus(row.key, v), 5))
        rows.push(h('tr', { key: row.key }, children))
      })

      const head = [h('td', { className: 'kp-lab', rowSpan: 1 + SUBJECTS.length, key: 'k' }, '课程内容'),
        h('td', { className: 'kp-lab', key: 'spacer' }, ''),
        h('td', { className: 'kp-lab', key: 'spacer2' }, '')]
      weeks.forEach((week) => {
        head.push(h('td', { className: 'kp-week', key: `w${week.no}` },
          h('div', null, `第${week.no}周`),
          h('div', { style: { fontWeight: 400, color: 'var(--kp-muted)' } }, shortRange(week))))
      })
      rows.push(h('tr', { key: 'hdr' }, head))

      let lastGroup = null
      SUBJECTS.forEach((subject, si) => {
        const children = []
        if (subject.sub) {
          const continues = lastGroup === subject.group
          children.push(h('td', { className: 'kp-sub', key: 'g', rowSpan: continues ? 1 : 1, style: { width: 54 } }, continues ? '' : subject.group))
          children.push(h('td', { className: 'kp-sub', key: 's', style: { width: 54 } }, subject.sub))
          lastGroup = subject.group
        } else {
          children.push(h('td', { className: 'kp-sub', key: 'g', colSpan: 2 }, subject.group))
          lastGroup = null
        }
        weeks.forEach((week, wi) => {
          children.push(h('td', { className: 'kp-cell', key: `c${wi}` },
            h('input', {
              value: month.courses[subject.key]?.[wi] ?? '',
              placeholder: '《课题》',
              onChange: (e) => setCourse(subject.key, wi, e.target.value),
            })))
        })
        rows.push(h('tr', { key: subject.key }, children))
      })

      BLOCKS.forEach((block) => {
        rows.push(h('tr', { key: block.key }, [
          h('td', { className: 'kp-lab', key: 'k' }, block.label),
          h('td', { className: 'kp-cell', key: 'v', colSpan: 2 + weeks.length },
            h('textarea', { value: month.blocks[block.key] ?? '', rows: 6, onChange: (e) => setBlock(block.key, e.target.value) })),
        ]))
      })

      const courses = SUBJECTS.reduce((n, s) => n + (month.courses[s.key] ?? []).filter(Boolean).length, 0)
      return h('div', null,
        h('div', { className: 'kp-row', style: { marginBottom: 10 } },
          h('div', { className: 'kp-title' }, `${month.label}`),
          h(Badge, null, `${weeks.length} 个教学周`),
          h(Badge, null, `${courses} 个课题`),
          h('span', { className: 'kp-spacer' }),
          h('a', {
            className: 'kp-btn', 'data-size': 'sm',
            title: `导出 ${month.label}月计划（沿用你上传的模板）`,
            href: downloadUrl(`planId=${encodeURIComponent(plan.id)}&kind=monthly&monthNo=${month.monthNo}`),
          }, '下载 Word'),
          h('label', { className: 'kp-field', style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
            h('input', {
              type: 'checkbox',
              checked: settings.focusMode === 'full',
              onChange: (e) => settings.setFocusMode(e.target.checked ? 'full' : 'condense'),
            }),
            h('span', { style: { fontSize: 12 } }, '周计划取月计划全文（默认只取前两点）')),
          h('button', {
            className: 'kp-btn', 'data-variant': 'primary', disabled: busy,
            onClick: () => onDraft(month.monthNo),
          }, 'AI 起草本月')),
        h('p', { className: 'kp-hint' },
          '这张表就是导出的月计划表。改这里等于同时改 4 份周计划——周计划的课题是从这些列编译出来的，不可能对不上。'),
        h('div', { className: 'kp-scroll' },
          h('table', { className: 'kp-tbl' }, h('tbody', null, rows))),
        h(DraftPanel, { mode: 'month', busy, onApply: onApplyDraft, lexicon, target: { monthNo: month.monthNo, planId: plan.id } }))
    }

    const shortRange = (week) => {
      if (!week?.start || !week?.end) return ''
      const f = (s) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`
      return `${f(week.start)}-${f(week.end)}`
    }

    // ------------------------------------------------------------ 周计划

    function WeekTab({ plan, week, weeks, onSelect, onChange, onDraft, onApplyDraft, busy, lexicon }) {
      if (!week) return h('div', { className: 'kp-empty' }, '这个计划还没有教学周。')
      const setFocus = (key, value) => onChange({ focus: { ...(week.focus ?? {}), [key]: value } })
      const setGame = (key, index, value) => {
        const draft = plan.weekly?.[String(week.weekNo)] ?? {}
        const games = { ...(draft.games ?? week.games) }
        const arr = [...(games[key] ?? ['', '', '', '', ''])]
        while (arr.length < 5) arr.push('')
        arr[index] = value
        games[key] = arr
        onChange({ games })
      }
      const setGameText = (key, value) => {
        const draft = plan.weekly?.[String(week.weekNo)] ?? {}
        const games = { ...(draft.games ?? week.games), [key]: value }
        onChange({ games })
      }

      const monthOfWeek = plan.months.find((m) => m.weeks.some((w) => w.no === week.weekNo))
      const indexInMonth = monthOfWeek ? monthOfWeek.weeks.findIndex((w) => w.no === week.weekNo) : -1
      const monthFocus = monthOfWeek?.focus ?? {}

      const rows = []
      const labelFor = (key) => FOCUS_ROWS.find((r) => r.key === key).label
      FOCUS_ROWS.forEach((row, i) => {
        const children = []
        if (i === 0) children.push(h('td', { className: 'kp-lab', rowSpan: 4, key: 'l', style: { width: 62 } }, '周工作重点'))
        children.push(h('td', { className: 'kp-lab', key: 'k', style: { width: 110 } },
          h('div', null, labelFor(row.key)),
          monthFocus[row.key]
            ? h('button', {
              className: 'kp-btn', 'data-size': 'sm', style: { marginTop: 4, fontSize: 10, padding: '1px 5px' },
              title: `用月计划原文：${monthFocus[row.key]}`,
              onClick: () => setFocus(row.key, monthFocus[row.key]),
            }, '取月计划')
            : null))
        children.push(h('td', { className: 'kp-cell', key: 'v', colSpan: 4 },
          h('textarea', { value: (week.focus ?? {})[row.key] ?? '', rows: 2, onChange: (e) => setFocus(row.key, e.target.value) })))
        rows.push(h('tr', { key: row.key }, children))
      })

      const header = [h('td', { className: 'kp-lab', key: 'h', colSpan: 3 }, h('div', null, '内容'), h('div', null, '时间'))]
      const dayLabels = week.layout === 'week1' ? DAY_LABELS : week.days.slice(0, 5).map((iso) => {
        const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
        const dow = d.getDay() === 0 ? 7 : d.getDay()
        return ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'][dow - 1]
      })
      while (dayLabels.length < 5) dayLabels.push('')
      dayLabels.forEach((label, i) => header.push(h('td', { className: 'kp-week', key: `d${i}` }, label)))
      rows.push(h('tr', { key: 'days' }, header))

      const lessonRow = [h('td', { className: 'kp-lab', key: 'l', colSpan: 3 }, '集体教学活动')]
      week.lessons.forEach((lesson) => {
        lessonRow.push(h('td', {
          className: `kp-c kp-readonly`, key: `l${lesson.weekday}`,
          title: lesson.origin ? `来自月计划 ${lesson.origin.monthNo}月 第${lesson.origin.weekNo}周那一列` : '月计划对应列是空的',
        },
        lesson.title || lesson.activity
          ? h('span', null, h('div', null, lesson.activity), h('div', { style: { fontWeight: 600 } }, lesson.title || '（没写课题）'))
          : h('span', { style: { color: 'var(--kp-muted)' } }, '·'),
        lesson.origin ? h('span', { className: 'kp-src' }, `← ${lesson.origin.monthNo}月第${lesson.origin.weekNo}周`) : null))
      })
      rows.push(h('tr', { key: 'lesson' }, lessonRow))

      const gameRow = (label, key, perDay, i, trailing) => {
        const children = []
        if (i === 0) children.push(h('td', { className: 'kp-lab', key: 'g', rowSpan: 4, style: { width: 62 } }, '游戏活动'))
        children.push(h('td', { className: 'kp-lab', key: 'k', colSpan: 2 }, label))
        if (perDay) {
          for (let d = 0; d < 5; d += 1) {
            if (trailing && d === 4) {
              children.push(h('td', { className: 'kp-c kp-readonly', key: `t${d}` }, '自评活动'))
            } else {
              children.push(h('td', { className: 'kp-cell', key: `v${d}` },
                h('textarea', { rows: 2, value: week.games[key]?.[d] ?? '', onChange: (e) => setGame(key, d, e.target.value) })))
            }
          }
        } else {
          children.push(h('td', { className: 'kp-cell', key: 'v', colSpan: 5 },
            h('textarea', { rows: 2, value: week.games[key] ?? '', onChange: (e) => setGameText(key, e.target.value) })))
        }
        return h('tr', { key }, children)
      }
      rows.push(gameRow('晨间', 'morning', true, 0))
      rows.push(gameRow('散步', 'walk', false, 1))
      rows.push(gameRow('下午', 'afternoon', true, 2, true))
      rows.push(gameRow('室内自主游戏(材料填充）', 'indoor', false, 3))

      const draft = plan.weekly?.[String(week.weekNo)] ?? {}
      return h('div', null,
        h('div', { className: 'kp-row', style: { marginBottom: 10 } },
          h('label', { className: 'kp-field' },
            h('label', null, '选择教学周'),
            h('select', {
              className: 'kp-select', value: week.weekNo, style: { minWidth: 260 },
              onChange: (e) => onSelect(Number(e.target.value)),
            }, weeks.map((w) => h('option', { key: w.weekNo, value: w.weekNo },
              `第${w.weekNo}周　${shortRange(w)}　${w.monthLabel}${w.theme ? `　《${w.theme}》` : ''}`)))),
          h('label', { className: 'kp-field' },
            h('label', null, '主题名称'),
            h('input', {
              className: 'kp-input', style: { minWidth: 200 }, value: draft.theme ?? week.theme ?? '',
              placeholder: monthOfWeek?.theme || '如：多彩的秋天',
              onChange: (e) => onChange({ theme: e.target.value }),
            })),
          h('label', { className: 'kp-field' },
            h('label', null, '表版式'),
            h('select', {
              className: 'kp-select', value: draft.layout ?? week.layout,
              onChange: (e) => onChange({ layout: e.target.value }),
            },
            h('option', { value: 'main' }, '横版十行表（第 6 周起用）'),
            h('option', { value: 'week1' }, '竖版十四行表（第一周那种）'))),
          h('span', { className: 'kp-spacer' }),
          week.overflow.length > 0 ? h(Badge, { tone: 'warn' }, `有 ${week.overflow.length} 个课题排不下`) : null,
          h('a', {
            className: 'kp-btn', 'data-size': 'sm',
            href: downloadUrl(`planId=${encodeURIComponent(plan.id)}&kind=weekly&weekNo=${week.weekNo}`),
          }, '下载 Word'),
          h('button', { className: 'kp-btn', 'data-variant': 'primary', disabled: busy, onClick: () => onDraft(week.weekNo) }, 'AI 起草本周')),

        h('p', { className: 'kp-hint' },
          '「集体教学活动」是只读的——它由月计划第 ' + week.weekNo + ' 周那一列编译而来，所以周计划和月计划永远一致。'
          + '要改课题，请到「月计划」页改对应列。'),
        h('div', { className: 'kp-scroll' },
          h('table', { className: 'kp-tbl' }, h('tbody', null, rows))),
        h(DraftPanel, { mode: 'week', busy, onApply: onApplyDraft, lexicon, target: { weekNo: week.weekNo, planId: plan.id } }))
    }

    // ------------------------------------------------------------ AI 草稿

    function DraftPanel({ mode, busy, onApply, lexicon, target }) {
      const [draft, setDraft] = useState(null)
      const [message, setMessage] = useState('')
      const [instruction, setInstruction] = useState('')
      const [runId, setRunId] = useState('')
      const [open, setOpen] = useState(false)
      const timer = useRef(null)

      useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

      const poll = (id) => {
        setRunId(id)
        if (timer.current) clearInterval(timer.current)
        timer.current = setInterval(async () => {
          try {
            const { run } = await call(`/runs/${encodeURIComponent(id)}`)
            if (run.status === 'running') { setMessage(`${run.phase}${run.message ? '：' + run.message : ''}`); return }
            clearInterval(timer.current); timer.current = null
            if (run.status === 'done' && run.result?.draft) {
              setDraft(run.result.draft)
              setMessage(`草稿已生成（${run.result.model?.provider}/${run.result.model?.model}）。确认后点「写入计划」。`)
            } else {
              setMessage(`生成失败：${run.error?.message ?? run.phase}${run.error?.problems?.length ? '\n' + run.error.problems.join('\n') : ''}`)
            }
          } catch (e) { clearInterval(timer.current); timer.current = null; setMessage(String(e.message ?? e)) }
        }, 1200)
      }

      const start = async () => {
        setDraft(null); setMessage('已提交，等待模型…')
        try {
          const body = mode === 'month'
            ? { planId: target.planId, monthNo: target.monthNo, instruction }
            : { planId: target.planId, weekNo: target.weekNo, instruction }
          const { runId: id } = await call(`/draft/${mode}`, { method: 'POST', body })
          poll(id)
        } catch (e) { setMessage(String(e.message ?? e)) }
      }

      const apply = async (how) => {
        if (!draft) return
        try {
          await call('/draft/apply', { method: 'POST', body: { planId: target.planId, kind: mode, ...target, draft, mode: how } })
          setMessage('已写入计划。')
          setDraft(null)
          onApply()
        } catch (e) { setMessage(String(e.message ?? e)) }
      }

      const preview = () => {
        if (!draft) return null
        if (mode === 'month') {
          return h('div', null,
            h('dl', { className: 'kp-kv' },
              h('dt', null, '班级常规'), h('dd', null, draft.focus.regular),
              h('dt', null, '德育教育'), h('dd', null, draft.focus.moral),
              h('dt', null, '安全教育'), h('dd', null, draft.focus.safety)),
            h('div', { style: { marginTop: 8 } },
              SUBJECTS.filter((s) => (draft.courses[s.key] ?? []).some(Boolean)).map((s) => h('div', { key: s.key, style: { fontSize: 12 } },
                h('b', null, `${s.group}${s.sub ? '/' + s.sub : ''}：`),
                (draft.courses[s.key] ?? []).map((t) => t || '·').join(' | ')))),
            h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--kp-muted)' } },
              BLOCKS.map((b) => h('div', { key: b.key }, `${b.label}：${(draft.blocks[b.key] ?? '').slice(0, 80)}…`))))
        }
        return h('div', null,
          h('dl', { className: 'kp-kv' }, FOCUS_ROWS.map((r) => [h('dt', { key: r.key + 't' }, r.label), h('dd', { key: r.key + 'd' }, draft.focus[r.key])])),
          h('div', { style: { marginTop: 8, fontSize: 12 } },
            h('div', null, `晨间：${draft.games.morning.map((m) => m.replace(/\n/g, '/')).join('　')}`),
            h('div', null, `下午：${draft.games.afternoon.join('　')}`),
            h('div', null, `散步：${draft.games.walk}`),
            h('div', null, `室内自主游戏：${draft.games.indoor}`)))
      }

      return h('div', { className: 'kp-card', style: { marginTop: 12 } },
        h('div', { className: 'kp-row' },
          h('h3', { style: { margin: 0, flex: '0 0 auto' } }, mode === 'month' ? 'AI 起草本月内容' : 'AI 起草本周内容'),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: () => setOpen(!open) }, open ? '收起' : '展开'),
          h('span', { className: 'kp-spacer' }),
          open ? h('button', { className: 'kp-btn', 'data-variant': 'primary', 'data-size': 'sm', onClick: start, disabled: busy }, '生成草稿') : null),
        open ? h('div', { style: { marginTop: 8 } },
          h('label', { className: 'kp-field' },
            h('label', null, '额外要求（可空）'),
            h('input', {
              className: 'kp-input', value: instruction, placeholder: '例：主题换成《冬天来了》，户外活动多写一点',
              onChange: (e) => setInstruction(e.target.value),
            })),
          h('p', { className: 'kp-hint' }, 'AI 只写文字内容，不决定版式与课题归属。生成后不会自动写入，需要你确认。'),
          message ? h('pre', { className: 'kp-log', style: { marginTop: 8 } }, message) : null,
          draft ? h('div', { style: { marginTop: 8 } },
            preview(),
            h('div', { className: 'kp-row', style: { marginTop: 10 } },
              h('button', { className: 'kp-btn', 'data-variant': 'primary', onClick: () => apply('merge') }, '写入计划（只填空）'),
              h('button', { className: 'kp-btn', onClick: () => apply('replace') }, '覆盖写入'),
              h('button', { className: 'kp-btn', onClick: () => setDraft(null) }, '丢弃'))) : null) : null)
    }

    // ------------------------------------------------------------ 一致性

    function CheckTab({ report, markdown, onReload, busy, onGoWeek, onGoMonth }) {
      const [showMarkdown, setShowMarkdown] = useState(false)
      if (!report) return h('div', { className: 'kp-empty' }, '还没有检查结果。')
      const groups = ['error', 'warn', 'info'].map((level) => ({ level, items: report.issues.filter((i) => i.level === level) }))
      const titles = { error: '错误（必须修）', warn: '警告（建议修）', info: '提示' }
      return h('div', null,
        h('div', { className: 'kp-row', style: { marginBottom: 10 } },
          h('div', { className: 'kp-title' }, '一致性检查'),
          errorsBadge(report),
          h(Badge, null, `${report.stats.months} 个月 / ${report.stats.weeks} 周 / ${report.stats.courses} 个课题`),
          h('span', { className: 'kp-spacer' }),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: () => setShowMarkdown(!showMarkdown) }, showMarkdown ? '看清单' : '看 Markdown'),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: onReload, disabled: busy }, '重新检查')),
        report.total === 0
          ? h('div', { className: 'kp-ok' }, '✅ 月计划与周计划完全对得上。')
          : null,
        showMarkdown
          ? h('pre', { className: 'kp-log', style: { maxHeight: 520 } }, markdown)
          : groups.map((group) => group.items.length === 0 ? null : h('div', { key: group.level, style: { marginBottom: 14 } },
            h('h3', { style: { fontSize: 13, margin: '0 0 6px' } }, `${titles[group.level]}（${group.items.length}）`),
            group.items.map((issue, i) => h('div', {
              key: i, className: 'kp-issue', 'data-level': issue.level,
              onClick: () => { if (issue.weekNo) onGoWeek(issue.weekNo); else if (issue.monthNo) onGoMonth(issue.monthNo) },
              style: { cursor: issue.weekNo || issue.monthNo ? 'pointer' : 'default' },
            },
            h('div', null, (issue.weekNo ? `第${issue.weekNo}周　` : issue.monthNo ? `${issue.monthNo}月　` : '') + issue.message),
            issue.fix ? h('div', { className: 'kp-fix' }, `建议：${issue.fix}`) : null)))))
    }

    // -------------------------------------------------------------- 词库

    function LexiconTab({ categories, onReload }) {
      const [active, setActive] = useState(categories?.[0]?.key ?? '')
      const [query, setQuery] = useState('')
      const [hits, setHits] = useState(null)
      const [newText, setNewText] = useState('')
      const [message, setMessage] = useState('')
      const [copied, setCopied] = useState('')

      const category = (categories ?? []).find((c) => c.key === active)

      const add = async () => {
        if (!newText.trim()) return
        try {
          await call('/lexicon/add', { method: 'POST', body: { category: active, text: newText } })
          setNewText(''); setMessage('已加入词库。'); onReload()
        } catch (e) { setMessage(String(e.message ?? e)) }
      }
      const remove = async (id) => {
        try {
          await call('/lexicon/remove', { method: 'POST', body: { category: active, id } })
          onReload()
        } catch (e) { setMessage(String(e.message ?? e)) }
      }
      const search = async () => {
        if (!query.trim()) { setHits(null); return }
        const result = await call(`/lexicon/search?q=${encodeURIComponent(query)}`)
        setHits(result.items)
      }
      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(text); setTimeout(() => setCopied(''), 1200)
        } catch { setMessage('复制失败，请手动选中。') }
      }

      if (!categories || categories.length === 0) return h('div', { className: 'kp-empty' }, '词库为空。')

      const items = hits ?? category?.items ?? []
      return h('div', null,
        h('div', { className: 'kp-row', style: { marginBottom: 10 } },
          h('div', { className: 'kp-title' }, '常用句式词库'),
          h('input', {
            className: 'kp-input', style: { maxWidth: 240 }, value: query, placeholder: '搜索全部词组…',
            onChange: (e) => { setQuery(e.target.value); if (!e.target.value) setHits(null) },
            onKeyDown: (e) => { if (e.key === 'Enter') search() },
          }),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: search }, '搜索'),
          hits ? h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: () => { setHits(null); setQuery('') } }, '清除') : null),
        h('p', { className: 'kp-hint' }, '点任意一条即复制到剪贴板。每次导入已有的 docx，词库会自动学会新出现的句式。'),
        message ? h('div', { className: 'kp-ok' }, message) : null,
        h('div', { className: 'kp-split', style: { gridTemplateColumns: '210px 1fr' } },
          h('div', { className: 'kp-list' },
            categories.map((c) => h('button', {
              key: c.key, 'data-on': c.key === active && !hits ? 1 : 0,
              onClick: () => { setActive(c.key); setHits(null); setQuery('') },
            },
            h('span', null, c.label),
            h('span', { className: 'kp-sub' }, String(c.items.length))))),
          h('div', null,
            !hits && category ? h('div', { className: 'kp-row', style: { marginBottom: 8 } },
              h('input', {
                className: 'kp-input', value: newText, placeholder: `新增一条「${category.label}」…`,
                onChange: (e) => setNewText(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') add() },
              }),
              h('button', { className: 'kp-btn', 'data-variant': 'primary', onClick: add }, '加入')) : null,
            hits ? h('div', { className: 'kp-hint', style: { marginBottom: 6 } }, `共 ${hits.length} 条匹配`) : null,
            h('div', { className: 'kp-lex' },
              items.map((item) => h('div', {
                key: `${item.category ?? active}-${item.id}`, className: 'kp-lexitem',
                title: '点击复制', onClick: () => copy(item.text),
              },
              !hits ? h('span', {
                className: 'kp-x', title: '删除',
                onClick: (e) => { e.stopPropagation(); remove(item.id) },
              }, '✕') : null,
              item.categoryLabel ? h('div', { style: { fontSize: 10, color: 'var(--kp-muted)' } }, item.categoryLabel) : null,
              item.text,
              copied === item.text ? h('div', { style: { color: 'var(--kp-ok)', fontSize: 10 } }, '已复制') : null))))))
    }

    // -------------------------------------------------------------- 导入

    function ImportTab({ plans, status, onReload, onPickPlan }) {
      const [planId, setPlanId] = useState(plans?.[0]?.id ?? '')
      const [hint, setHint] = useState({ year: 2026, semesterLabel: '2026年秋季学期', className: '大一班', kindergarten: '渝水区第三幼儿园' })
      const [result, setResult] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const filesRef = useRef(null)

      const submit = async () => {
        const files = Array.from(filesRef.current?.files ?? [])
        if (files.length === 0) { setError('请先选择 .docx 文件。'); return }
        setBusy(true); setError(''); setResult(null)
        try {
          const payload = []
          for (const file of files) {
            const buffer = await file.arrayBuffer()
            let binary = ''
            const bytes = new Uint8Array(buffer)
            const chunk = 0x8000
            for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
            payload.push({ name: file.name, base64: btoa(binary) })
          }
          const body = { files: payload, hint }
          if (planId) body.planId = planId
          const response = await call('/import', { method: 'POST', body })
          setResult(response)
          onReload()
        } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
      }

      return h('div', null,
        h('div', { className: 'kp-card' },
          h('h3', null, '导入已有的月计划 / 周计划（.docx）'),
          h('p', { className: 'kp-hint' },
            '可以一次选一整个学期的文件。月计划会新增或覆盖对应月份；周计划会挂到对应周次，并保留原始课题用于一致性比对——'
            + '旧周计划和月计划哪里对不上，会直接出现在「一致性」页。导入的句式会自动进词库。'),
          h('div', { className: 'kp-row', style: { marginTop: 10 } },
            h('label', { className: 'kp-field' },
              h('label', null, '导入到'),
              h('select', { className: 'kp-select', value: planId, onChange: (e) => setPlanId(e.target.value), style: { minWidth: 240 } },
                h('option', { value: '' }, '（新建一个计划）'),
                (plans ?? []).map((p) => h('option', { key: p.id, value: p.id }, p.title)))),
            h('label', { className: 'kp-field', style: { flex: '1 1 260px' } },
              h('label', null, '选择 .docx 文件'),
              h('input', { ref: filesRef, type: 'file', accept: '.docx', multiple: true, className: 'kp-input' }))),
          h('div', { className: 'kp-row', style: { marginTop: 10 } },
            h('label', { className: 'kp-field' }, h('label', null, '学年'), h('input', { className: 'kp-input', value: hint.year, onChange: (e) => setHint({ ...hint, year: Number(e.target.value) || hint.year }) })),
            h('label', { className: 'kp-field' }, h('label', null, '学期'), h('input', { className: 'kp-input', value: hint.semesterLabel, onChange: (e) => setHint({ ...hint, semesterLabel: e.target.value }) })),
            h('label', { className: 'kp-field' }, h('label', null, '班级'), h('input', { className: 'kp-input', value: hint.className, onChange: (e) => setHint({ ...hint, className: e.target.value }) })),
            h('label', { className: 'kp-field', style: { flex: '1 1 200px' } }, h('label', null, '园所'), h('input', { className: 'kp-input', value: hint.kindergarten, onChange: (e) => setHint({ ...hint, kindergarten: e.target.value }) }))),
          error ? h('div', { className: 'kp-err', style: { marginTop: 10 } }, error) : null,
          h('div', { className: 'kp-row', style: { marginTop: 10 } },
            h('button', { className: 'kp-btn', 'data-variant': 'primary', onClick: submit, disabled: busy }, busy ? '正在导入…' : '开始导入'))),
        result ? h('div', { className: 'kp-card' },
          h('h3', null, `导入结果：${result.plan.semesterLabel}${result.plan.className}计划`),
          result.notes.map((note, i) => h('div', { key: i }, `· ${note}`)),
          result.learned?.added ? h('div', { style: { marginTop: 6 } }, `词库新增 ${result.learned.added} 条：${result.learned.categories.join('、')}`) : null,
          h('div', { style: { marginTop: 8 } }, `导入后一致性：错误 ${result.report.counts.error}　警告 ${result.report.counts.warn}　提示 ${result.report.counts.info}`),
          result.report.issues.length > 0 ? h('div', { style: { marginTop: 8 } },
            h('b', null, '需要关注：'),
            result.report.issues.slice(0, 10).map((issue, i) => h('div', { key: i, className: 'kp-issue', 'data-level': issue.level },
              (issue.weekNo ? `第${issue.weekNo}周　` : '') + issue.message))) : null,
          h('div', { className: 'kp-row', style: { marginTop: 10 } },
            h('button', { className: 'kp-btn', 'data-variant': 'primary', onClick: () => onPickPlan(result.plan.id) }, '打开这个计划'))) : null)
    }

    // -------------------------------------------------------------- 设置

    function SettingsTab({ config, onSave, status, busy }) {
      const [draft, setDraft] = useState(config)
      useEffect(() => { setDraft(config) }, [config])
      if (!draft) return h('div', { className: 'kp-empty' }, '正在读取设置…')

      const patch = (p) => setDraft({ ...draft, ...p })
      const setSemester = (p) => patch({ semester: { ...draft.semester, ...p } })
      const setHoliday = (index, p) => {
        const holidays = draft.semester.holidays.map((h, i) => (i === index ? { ...h, ...p } : h))
        setSemester({ holidays })
      }
      const run = draft.resolvedLlm ?? {}

      return h('div', null,
        h('div', { className: 'kp-card' },
          h('h3', null, '生成用的模型'),
          h('p', { className: 'kp-hint' }, `当前实际使用：${run.provider ? `${run.provider}/${run.model}（来源：${run.source === 'config' ? '此处设置' : 'DSH 会话默认'}）` : '没有可用模型'}`),
          h('div', { className: 'kp-row' },
            h('label', { className: 'kp-field' }, h('label', null, 'provider（留空则跟随 DSH 默认）'),
              h('input', { className: 'kp-input', value: draft.llm.provider ?? '', placeholder: 'deepseek-account', onChange: (e) => patch({ llm: { ...draft.llm, provider: e.target.value || null } }) })),
            h('label', { className: 'kp-field' }, h('label', null, 'model'),
              h('input', { className: 'kp-input', value: draft.llm.model ?? '', placeholder: 'deepseek-flash', onChange: (e) => patch({ llm: { ...draft.llm, model: e.target.value || null } }) })))),
        h('div', { className: 'kp-card' },
          h('h3', null, '学期与日历'),
          h('p', { className: 'kp-hint' }, '教学周由开学日、结束日和放假安排自动推算：按自然周分组，周次连续编号，跨月的周按「多数上课日」归到那个月。改完保存后，已填的课题会按周次起止日期自动保留。'),
          h('div', { className: 'kp-row' },
            h('label', { className: 'kp-field' }, h('label', null, '学期名称'), h('input', { className: 'kp-input', value: draft.semester.label, onChange: (e) => setSemester({ label: e.target.value }) })),
            h('label', { className: 'kp-field' }, h('label', null, '开学日'), h('input', { className: 'kp-input', type: 'date', value: draft.semester.termStart, onChange: (e) => setSemester({ termStart: e.target.value }) })),
            h('label', { className: 'kp-field' }, h('label', null, '结束日'), h('input', { className: 'kp-input', type: 'date', value: draft.semester.termEnd, onChange: (e) => setSemester({ termEnd: e.target.value }) }))),
          h('h3', { style: { marginTop: 12 } }, '放假安排'),
          draft.semester.holidays.map((holiday, i) => h('div', { className: 'kp-row', key: i, style: { marginBottom: 6 } },
            h('label', { className: 'kp-field', style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
              h('input', { type: 'checkbox', checked: holiday.enabled, onChange: (e) => setHoliday(i, { enabled: e.target.checked }) }),
              h('span', null, holiday.label || '假期')),
            h('label', { className: 'kp-field' }, h('label', null, '从'), h('input', { className: 'kp-input', type: 'date', value: holiday.from, onChange: (e) => setHoliday(i, { from: e.target.value }) })),
            h('label', { className: 'kp-field' }, h('label', null, '到'), h('input', { className: 'kp-input', type: 'date', value: holiday.to, onChange: (e) => setHoliday(i, { to: e.target.value }) })))),
          h('label', { className: 'kp-field', style: { marginTop: 8 } },
            h('label', null, '调休上课日（周末但上课，逗号分隔）'),
            h('input', {
              className: 'kp-input', value: draft.semester.makeupDays.join(', '),
              placeholder: '2026-10-10',
              onChange: (e) => setSemester({ makeupDays: e.target.value.split(/[,，\s]+/).filter(Boolean) }),
            }))),
        h('div', { className: 'kp-card' },
          h('h3', null, '周计划工作重点的取法'),
          h('label', { className: 'kp-field', style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
            h('input', {
              type: 'checkbox', checked: draft.focusMode === 'full',
              onChange: (e) => patch({ focusMode: e.target.checked ? 'full' : 'condense' }),
            }),
            h('span', null, '取月计划全文（默认只取前两点/前两句）')),
          h('p', { className: 'kp-hint' }, '园里手写的周计划是精简过的：月计划一段四句，周计划通常只留一两句。取全文会让周计划表格超过一页。')),
        h('div', { className: 'kp-card' },
          h('h3', null, '位置'),
          h('dl', { className: 'kp-kv' },
            h('dt', null, '数据目录'), h('dd', null, status?.dirs?.root ?? '-'),
            h('dt', null, '导出目录'), h('dd', null, status?.dirs?.exports ?? '-'),
            h('dt', null, '模板'), h('dd', null, '月计划：横版 18 行表　周计划：横版 10 行表 / 竖版 14 行表（均取自你上传的文件）'))),
        (status?.tools?.failures ?? []).length > 0
          ? h('div', { className: 'kp-card' },
            h('h3', null, '对话工具注册失败'),
            h('p', { className: 'kp-hint' }, '这些工具没能注册给 AI，界面部分不受影响。把这里的内容发我即可定位。'),
            (status.tools.failures ?? []).map((f, i) => h('div', { key: i, className: 'kp-err' }, `${f.name}：${f.message}`)))
          : null,
        h('div', { className: 'kp-row' },
          h('button', { className: 'kp-btn', 'data-variant': 'primary', disabled: busy, onClick: () => onSave(draft) }, '保存设置')))
    }

    // ------------------------------------------------------------ 主面板

    function Studio() {
      const [status, setStatus] = useState(null)
      const [config, setConfig] = useState(null)
      const [plans, setPlans] = useState([])
      const [activeId, setActiveId] = useState('')
      const [detail, setDetail] = useState(null)
      const [tab, setTab] = useState('month')
      const [monthNo, setMonthNo] = useState(null)
      const [weekNo, setWeekNo] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [message, setMessage] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [lexicon, setLexicon] = useState(null)
      const [report, setReport] = useState(null)
      const [reportMarkdown, setReportMarkdown] = useState('')
      const [exportRun, setExportRun] = useState(null)
      const localPlan = useRef(null)
      const exportTimer = useRef(null)

      const loadStatus = useCallback(async () => {
        const [{ status: s }, { plans: list }, { config: c }] = await Promise.all([
          call('/status'), call('/plans'), call('/config'),
        ])
        setStatus(s); setPlans(list); setConfig(c)
        return { s, list, c }
      }, [])

      const loadPlan = useCallback(async (id) => {
        if (!id) { setDetail(null); return }
        const data = await call(`/plans/${encodeURIComponent(id)}`)
        setDetail(data)
        setReport(data.report)
        localPlan.current = data.plan
        setDirty(false)
        // Open on something with content. A semester whose September has not been
        // written yet would otherwise greet the teacher with an empty table and
        // an empty week, which reads as "the plugin lost my data".
        const hasContent = (month) => Object.values(month.courses ?? {}).some((col) => (col ?? []).some((v) => String(v ?? '').trim()))
          || Object.values(month.focus ?? {}).some((v) => String(v ?? '').trim())
        const firstMonth = (data.plan.months.find(hasContent) ?? data.plan.months[0])?.monthNo ?? null
        setMonthNo((current) => (data.plan.months.some((m) => m.monthNo === current) ? current : firstMonth))
        const firstWeek = (data.derived.find((w) => w.filled > 0) ?? data.derived[0])?.weekNo ?? null
        setWeekNo((current) => (data.derived.some((w) => w.weekNo === current) ? current : firstWeek))
      }, [])

      const loadLexicon = useCallback(async () => {
        const { categories } = await call('/lexicon')
        setLexicon(categories)
      }, [])

      useEffect(() => {
        (async () => {
          try {
            const { s, list } = await loadStatus()
            await loadLexicon()
            const preferred = s?.plans?.[0]?.id ?? list?.[0]?.id ?? ''
            if (preferred) { setActiveId(preferred); await loadPlan(preferred) }
          } catch (e) { setError(String(e.message ?? e)) }
        })()
      }, [loadStatus, loadPlan, loadLexicon])

      // Edits are local until saved, so a half-typed cell never round-trips.
      const editMonth = (patch) => {
        const plan = localPlan.current
        if (!plan) return
        const months = plan.months.map((m) => (m.monthNo === monthNo ? { ...m, ...patch } : m))
        localPlan.current = { ...plan, months }
        setDetail((d) => (d ? { ...d, plan: localPlan.current } : d))
        setDirty(true)
      }
      const editWeek = (patch) => {
        const plan = localPlan.current
        if (!plan) return
        const key = String(weekNo)
        const weekend = { ...(plan.weekly?.[key] ?? {}) }
        for (const [k, v] of Object.entries(patch)) {
          weekend[k] = (k === 'focus' || k === 'games') ? { ...(weekend[k] ?? {}), ...v } : v
        }
        localPlan.current = { ...plan, weekly: { ...plan.weekly, [key]: weekend } }
        // Reflect the override in the derived preview without a round trip.
        setDetail((d) => {
          if (!d) return d
          const derived = d.derived.map((w) => {
            if (w.weekNo !== weekNo) return w
            return {
              ...w,
              theme: weekend.theme ?? w.theme,
              layout: weekend.layout ?? w.layout,
              focus: { ...w.focus, ...(weekend.focus ?? {}) },
              games: { ...w.games, ...(weekend.games ?? {}) },
            }
          })
          return { ...d, plan: localPlan.current, derived }
        })
        setDirty(true)
      }

      const save = async (extra = {}) => {
        const plan = localPlan.current
        if (!plan) return
        setBusy(true); setError(''); setMessage('')
        try {
          await call(`/plans/${encodeURIComponent(plan.id)}`, {
            method: 'POST',
            body: { months: plan.months, weekly: plan.weekly, focusMode: plan.focusMode, ...extra },
          })
          await loadPlan(plan.id)
          await loadStatus()
          setMessage('已保存。')
        } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
      }

      const selectPlan = async (id) => {
        if (dirty && !globalThis.confirm('有未保存的修改，确定要切换计划吗？')) return
        setActiveId(id); await loadPlan(id); setMessage('')
      }

      const createNew = async () => {
        setBusy(true); setError('')
        try {
          const body = config?.semester ? {
            semesterLabel: config.semester.label,
            year: config.semester.year,
            termStart: config.semester.termStart,
            termEnd: config.semester.termEnd,
            holidays: config.semester.holidays,
            makeupDays: config.semester.makeupDays,
            className: '大一班',
            kindergarten: '渝水区第三幼儿园',
          } : {}
          const { plan } = await call('/plans', { method: 'POST', body })
          const { plans: list } = await loadStatus()
          setPlans(list); setActiveId(plan.id); await loadPlan(plan.id)
          setTab('month'); setMessage(`已新建：${plan.semesterLabel}${plan.className}计划`)
        } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
      }

      const removeActive = async () => {
        if (!activeId || !globalThis.confirm('删除这个计划？此操作不可撤销。')) return
        await call(`/plans/${encodeURIComponent(activeId)}/delete`, { method: 'POST' })
        const { plans: list } = await loadStatus()
        setPlans(list)
        const next = list[0]?.id ?? ''
        setActiveId(next); await loadPlan(next)
      }

      const resync = async () => {
        if (dirty && !globalThis.confirm('重算日历会用设置里的学期与放假重新排周次。未保存的修改会丢失，继续吗？')) return
        setBusy(true); setError('')
        try {
          await call(`/plans/${encodeURIComponent(activeId)}/resync`, { method: 'POST' })
          await loadPlan(activeId); setMessage('日历已重算。')
        } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
      }

      const recheck = async () => {
        setBusy(true)
        try {
          const result = await call(`/plans/${encodeURIComponent(activeId)}/report`)
          setReport(result.report); setReportMarkdown(result.markdown)
        } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
      }

      const startDraftMonth = (m) => { setMessage(`已定位到 ${m} 月：在表格下方「AI 起草本月内容」里点「生成草稿」。`) }
      const startDraftWeek = (w) => { setMessage(`已定位到第 ${w} 周：在表格下方「AI 起草本周内容」里点「生成草稿」。`) }

      const exportAll = async () => {
        setBusy(true); setError(''); setMessage('')
        try {
          if (dirty) await save()
          const { runId } = await call('/export', { method: 'POST', body: { planId: activeId } })
          setExportRun({ runId, phase: '提交中' })
          if (exportTimer.current) clearInterval(exportTimer.current)
          exportTimer.current = setInterval(async () => {
            try {
              const { run } = await call(`/runs/${encodeURIComponent(runId)}`)
              setExportRun({ runId, ...run })
              if (run.status !== 'running') {
                clearInterval(exportTimer.current); exportTimer.current = null
                await loadPlan(activeId)
              }
            } catch { clearInterval(exportTimer.current); exportTimer.current = null }
          }, 800)
        } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
      }

      useEffect(() => () => { if (exportTimer.current) clearInterval(exportTimer.current) }, [])

      const openInFolder = async () => {
        const dir = exportRun?.result?.dir ?? status?.dirs?.exports
        if (!dir) return
        try { await navigator.clipboard.writeText(dir) } catch { /* clipboard may be denied */ }
        setMessage(`导出目录已复制到剪贴板：${dir}`)
      }

      const plan = detail?.plan ?? null
      const month = plan?.months.find((m) => m.monthNo === monthNo) ?? null
      const weeks = detail?.derived ?? []
      const week = weeks.find((w) => w.weekNo === weekNo) ?? null

      const errorCount = report?.counts?.error ?? 0
      const warnCount = report?.counts?.warn ?? 0

      const tabs = [
        { key: 'month', label: '月计划' },
        { key: 'week', label: '周计划' },
        { key: 'check', label: '一致性', badge: errorCount + warnCount || null },
        { key: 'lexicon', label: '词库' },
        { key: 'import', label: '导入' },
        { key: 'settings', label: '设置' },
      ]

      return h('div', { className: 'kp-root', 'data-fill': '1' },
        h('div', { className: 'kp-head' },
          h('div', { className: 'kp-title' }, '幼儿园计划工作台'),
          h('select', {
            className: 'kp-select', style: { maxWidth: 300 }, value: activeId,
            onChange: (e) => selectPlan(e.target.value),
          },
          plans.length === 0 ? h('option', { value: '' }, '（还没有计划）') : null,
          plans.map((p) => h('option', { key: p.id, value: p.id },
            `${p.title}　${p.monthCount}月/${p.weekCount}周`))),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: createNew, disabled: busy }, '新建学期'),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: resync, disabled: busy || !activeId }, '重算日历'),
          h('span', { className: 'kp-spacer' }),
          errorsBadge(report),
          dirty ? h('span', { className: 'kp-dirty' }, '● 有未保存的修改') : null,
          h('button', { className: 'kp-btn', 'data-variant': 'primary', 'data-size': 'sm', onClick: () => save(), disabled: busy || !dirty }, '保存'),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: exportAll, disabled: busy || !activeId }, '导出整学期 Word'),
          h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: removeActive, disabled: busy || !activeId }, '删除计划')),
        h('div', { className: 'kp-tabs' },
          tabs.map((t) => h('button', {
            key: t.key, className: 'kp-tab', 'data-on': tab === t.key ? 1 : 0, onClick: () => setTab(t.key),
          }, t.label, t.badge ? h('span', { className: 'kp-count' }, `(${t.badge})`) : null))),
        h('div', { className: 'kp-body' },
          bootMissing()
            ? h('div', { className: 'kp-err' },
              h('div', null, '插件令牌缺失：这个页面加载时宿主半边还没就绪，所以所有按钮都不会有反应（不是按钮坏了）。'),
              h('div', { style: { marginTop: 6 } }, '先按 F5 刷新一次页面。'),
              h('div', { style: { marginTop: 6, fontSize: 12 } },
                '刷新后还是这样，请在浏览器控制台执行 globalThis.__KINDERPLAN__；结果是 undefined 就把这条发我。'),
              h('div', { style: { marginTop: 8 } },
                h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: () => globalThis.location?.reload?.() }, '刷新页面')))
            : null,
          error ? h('div', { className: 'kp-err' }, error) : null,
          message ? h('div', { className: 'kp-ok' }, message) : null,
          exportRun ? h('div', { className: 'kp-card' },
            h('h3', null, `导出：${exportRun.phase ?? ''}${exportRun.progress?.total ? `　${exportRun.progress.done}/${exportRun.progress.total}` : ''}`),
            exportRun.error ? h('div', { className: 'kp-err' }, exportRun.error.message) : null,
            exportRun.log?.length ? h('pre', { className: 'kp-log' }, exportRun.log.join('\n')) : null,
            exportRun.result ? h('div', { className: 'kp-row' },
              h('div', null, `写入 ${exportRun.result.files.length} 个文件到 ${exportRun.result.dir}`),
              h('button', { className: 'kp-btn', 'data-size': 'sm', onClick: openInFolder }, '复制目录')) : null) : null,

          plans.length === 0
            ? h('div', { className: 'kp-empty' },
              h('p', null, '还没有计划。'),
              h('p', { className: 'kp-hint' }, '可以点「新建学期」从零开始，也可以到「导入」页把已有的月计划 / 周计划 docx 一次性读进来。'))
            : null,

          plans.length > 0 && tab === 'month'
            ? h('div', { className: 'kp-split' },
              h('div', { className: 'kp-list' },
                (plan?.months ?? []).map((m) => h('button', {
                  key: m.monthNo, 'data-on': m.monthNo === monthNo ? 1 : 0,
                  onClick: () => setMonthNo(m.monthNo),
                },
                h('span', null, m.label),
                h('span', { className: 'kp-sub' }, `${m.weeks.length} 周`)))),
              month ? h(MonthTab, {
                plan, month, busy, lexicon, settings: {
                  focusMode: plan.focusMode,
                  setFocusMode: (v) => { localPlan.current = { ...localPlan.current, focusMode: v }; setDetail((d) => ({ ...d, plan: localPlan.current })); setDirty(true) },
                },
                onChange: editMonth,
                onDraft: startDraftMonth,
                onApplyDraft: () => loadPlan(activeId),
              }) : h('div', { className: 'kp-empty' }, '选择一个月'))
            : null,

          plans.length > 0 && tab === 'week'
            ? h(WeekTab, {
              plan, week, weeks, busy, lexicon,
              onSelect: setWeekNo,
              onChange: editWeek,
              onDraft: startDraftWeek,
              onApplyDraft: () => loadPlan(activeId),
            })
            : null,

          tab === 'check' ? h(CheckTab, {
            report, markdown: reportMarkdown, busy,
            onReload: recheck,
            onGoWeek: (n) => { setWeekNo(n); setTab('week') },
            onGoMonth: (n) => { setMonthNo(n); setTab('month') },
          }) : null,

          tab === 'lexicon' ? h(LexiconTab, { categories: lexicon, onReload: loadLexicon }) : null,

          tab === 'import' ? h(ImportTab, {
            plans, status,
            onReload: async () => { await loadStatus(); await loadLexicon() },
            onPickPlan: async (id) => { await loadStatus(); setActiveId(id); await loadPlan(id); setTab('month') },
          }) : null,

          tab === 'settings' ? h(SettingsTab, {
            config, status, busy,
            onSave: async (next) => {
              setBusy(true); setError('')
              try {
                const { config: saved } = await call('/config', { method: 'POST', body: { patch: next } })
                setConfig({ ...saved, resolvedLlm: saved.resolvedLlm })
                await loadStatus()
                setMessage('设置已保存。')
              } catch (e) { setError(String(e.message ?? e)) } finally { setBusy(false) }
            },
          }) : null))
    }

    // ------------------------------------------------------------ 图标

    function PanelIcon(props) {
      const size = Number(props?.size) || 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('rect', { x: 3, y: 4, width: 18, height: 17, rx: 2.5 }),
        h('path', { d: 'M3 9h18M8 4V2.5M16 4V2.5' }),
        h('path', { d: 'M7.5 13h3M13.5 13h3M7.5 17h3M13.5 17h3' }))
    }

    // ------------------------------------------------------------- wire

    function SettingsSection() {
      return h('div', { className: 'kp-root' },
        h('p', { className: 'kp-hint' },
          '学期、放假安排、生成模型都在「幼儿园计划」面板的「设置」页里；这里只显示数据位置。'),
        h('p', { className: 'kp-hint' }, '计划数据保存在 DSH 主目录下的 kinderplan 文件夹中，可以直接备份或拷贝到别的机器。'))
    }

    const module = {
      inject: ['slots'],
      apply(ctx) {
        if (typeof document !== 'undefined') ensureStyles()

        // A sidebar icon whose list id addresses the main panel key below —
        // the panellist's own contract: "Each list id addresses the matching
        // main panel".
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'kinderplan',
          order: 40,
          label: '幼儿园计划',
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'kinderplan',
        }, Studio))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'kinderplan',
          order: 70,
          label: '幼儿园计划',
        }, SettingsSection))
      },
    }

    /**
     * Components, exposed for this plugin's own render tests.
     *
     * Defined non-enumerably on purpose: the module loader reads `inject` and
     * `apply`, and a loader that validates the exported shape would see an
     * unexpected third key in `Object.keys()`. The tests reach it by name.
     */
    Object.defineProperty(module, '__test__', {
      value: { Studio, MonthTab, WeekTab, CheckTab, LexiconTab, ImportTab, SettingsTab, DraftPanel, PanelIcon },
      enumerable: false,
    })

    return module
  },
})
