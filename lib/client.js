window.__ModuleLoader__.load({
  id: 'dsh-wechat-filehelper',
  factory(require) {
// ═════════ 10-core.js ═════════
// src/10-core.js — 常量 / RPC 客户端 / 小工具
const React = require('react')
const h = React.createElement
const { useState, useEffect, useRef, useCallback } = React

const ROUTE = '/wechat-filehelper/api'
const CLS = {
  root: 'wf-root',
  head: 'wf-head',
  dot: 'wf-dot',
  title: 'wf-title',
  sub: 'wf-sub',
  card: 'wf-card',
  row: 'wf-row',
  btn: 'wf-btn',
  btnGhost: 'wf-btn wf-btn-ghost',
  qr: 'wf-qr',
  qrWrap: 'wf-qr-wrap',
  hint: 'wf-hint',
  err: 'wf-err',
  list: 'wf-list',
  item: 'wf-item',
  itemMain: 'wf-item-main',
  itemName: 'wf-item-name',
  itemMeta: 'wf-item-meta',
  tag: 'wf-tag',
  tagOk: 'wf-tag wf-tag-ok',
  tagFail: 'wf-tag wf-tag-fail',
  empty: 'wf-empty',
}

async function api(op, payload) {
  try {
    const res = await fetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, payload: payload || {} }),
    })
    const json = await res.json()
    if (!json || typeof json !== 'object') return { ok: false, error: '接口返回异常' }
    return json
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

function fmtBytes(n) {
  const size = Number(n) || 0
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(2) + ' MB'
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const pad = (v) => String(v).padStart(2, '0')
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  )
}

// ═════════ 20-settings.js ═════════
// src/20-settings.js — 设置页分区：状态 / 二维码 / 发送历史
function SettingsSection() {
  const [state, setState] = useState(null)
  const [history, setHistory] = useState([])
  const [qr, setQr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const pollRef = useRef(null)

  const refresh = useCallback(async () => {
    const [s, h2] = await Promise.all([api('state'), api('history', { limit: 30 })])
    if (s.ok) setState(s.data)
    else setErr(s.error || '读取状态失败')
    if (h2.ok) setHistory(h2.data.history || [])
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refresh])

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPoll = () => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      const r = await api('qr_check', { waitSec: 0 })
      if (!r.ok) {
        const st = r.data && r.data.state
        if (st === 'expired' || st === 'rejected') {
          stopPoll()
          setQr(null)
          setErr(st === 'expired' ? '二维码已过期，重新点扫码登录' : '该账号暂不支持网页版登录')
        }
        return
      }
      const st = r.data && r.data.state
      if (st === 'online') {
        stopPoll()
        setQr(null)
        setNote('登录成功')
        void refresh()
      }
    }, 2000)
  }

  const startLogin = async () => {
    setBusy(true)
    setErr('')
    setNote('')
    const r = await api('qr')
    setBusy(false)
    if (!r.ok) {
      setErr(r.error || '生成二维码失败')
      return
    }
    setQr(r.data)
    startPoll()
  }

  const doLogout = async () => {
    stopPoll()
    setQr(null)
    setBusy(true)
    await api('logout')
    setBusy(false)
    setNote('已退出登录')
    void refresh()
  }

  const loggedIn = Boolean(state && state.loggedIn)
  const okCount = history.filter((item) => item.ok).length

  return h(
    'div',
    { className: CLS.root },
    h(
      'div',
      { className: CLS.head },
      h('span', { className: loggedIn ? CLS.dot + ' wf-dot-on' : CLS.dot + ' wf-dot-off' }),
      h('div', null,
        h('div', { className: CLS.title }, '微信文件传输助手'),
        h('div', { className: CLS.sub },
          loggedIn
            ? (state.nickName || state.userName || '已登录') + ' · 登录于 ' + fmtTime(state.savedAt)
            : '未登录 —— 扫一次码，之后 agent 直接把文件发到你微信'
        )
      ),
      h('div', { style: { flex: 1 } }),
      loggedIn
        ? h('button', { className: CLS.btnGhost, onClick: doLogout, disabled: busy }, '退出登录')
        : h('button', { className: CLS.btn, onClick: startLogin, disabled: busy }, busy ? '生成中…' : '扫码登录')
    ),

    qr
      ? h(
          'div',
          { className: CLS.qrWrap },
          h('img', { className: CLS.qr, src: qr.dataUrl, alt: '微信登录二维码' }),
          h('div', { className: CLS.hint }, '用微信扫一扫，手机上点「确认登录」。约 ' + qr.expiresInSec + ' 秒内有效。')
        )
      : null,

    err ? h('div', { className: CLS.err }, err) : null,
    note ? h('div', { className: CLS.hint }, note) : null,

    h(
      'div',
      { className: CLS.card },
      h('div', { className: CLS.row },
        h('span', { className: CLS.title, style: { fontSize: '13px' } }, '发送历史'),
        h('span', { className: CLS.sub }, history.length ? '共 ' + history.length + ' 条 · 成功 ' + okCount + ' 条' : ''),
        h('div', { style: { flex: 1 } }),
        h('button', { className: CLS.btnGhost, onClick: () => void refresh() }, '刷新')
      ),
      history.length === 0
        ? h('div', { className: CLS.empty }, '还没有发送记录。让 agent 说一句「把 xx 发我微信」就会出现在这里。')
        : h(
            'div',
            { className: CLS.list },
            history.map((item, index) =>
              h(
                'div',
                { className: CLS.item, key: String(item.at) + '-' + index },
                h('span', { className: item.ok ? CLS.tagOk : CLS.tagFail }, item.ok ? '成功' : '失败'),
                h('div', { className: CLS.itemMain },
                  h('div', { className: CLS.itemName }, item.fileName || '（无文件名）'),
                  h('div', { className: CLS.itemMeta },
                    fmtTime(item.at) +
                    (item.size ? ' · ' + fmtBytes(item.size) : '') +
                    (item.chunks > 1 ? ' · ' + item.chunks + ' 片' : '') +
                    (item.elapsedMs ? ' · ' + item.elapsedMs + ' ms' : '') +
                    (item.ok ? '' : ' · ' + (item.error || '未知错误'))
                  )
                )
              )
            )
          )
    )
  )
}

// ═════════ 90-shell.js ═════════
// src/90-shell.js — 挂到设置页 + 样式
const STYLE_ID = 'wf-style'

const CSS = `
.wf-root { display: flex; flex-direction: column; gap: 12px; }
.wf-head { display: flex; align-items: center; gap: 10px; }
.wf-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.wf-dot-on { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.15); }
.wf-dot-off { background: #9ca3af; }
.wf-title { font-size: 14px; font-weight: 600; }
.wf-sub { font-size: 12px; opacity: .65; margin-top: 2px; }
.wf-card { border: 1px solid rgba(148,163,184,.22); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.wf-row { display: flex; align-items: center; gap: 8px; }
.wf-btn { border: 1px solid transparent; border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; background: #2563eb; color: #fff; }
.wf-btn:disabled { opacity: .6; cursor: default; }
.wf-btn-ghost { background: transparent; border-color: rgba(148,163,184,.3); color: inherit; }
.wf-qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px; border: 1px dashed rgba(148,163,184,.3); border-radius: 10px; }
.wf-qr { width: 240px; height: 240px; border-radius: 8px; background: #fff; padding: 6px; }
.wf-hint { font-size: 12px; opacity: .65; text-align: center; }
.wf-err { font-size: 12px; color: #f87171; }
.wf-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
.wf-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 8px; background: rgba(148,163,184,.06); }
.wf-item-main { min-width: 0; }
.wf-item-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-item-meta { font-size: 11px; opacity: .6; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-tag { flex: none; font-size: 11px; padding: 1px 6px; border-radius: 999px; }
.wf-tag-ok { background: rgba(34,197,94,.16); color: #4ade80; }
.wf-tag-fail { background: rgba(248,113,113,.16); color: #f87171; }
.wf-empty { font-size: 12px; opacity: .6; padding: 12px 0; text-align: center; }
`

function apply(ctx) {
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }

  const slots = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : ctx && ctx.slots
  if (!slots || typeof slots.register !== 'function') return

  const mount = () =>
    slots.register(
      { name: 'settings.section', id: 'wechat-filehelper', order: 32, label: '微信文件传输助手' },
      SettingsSection
    )

  try {
    if (typeof slots.inject === 'function') slots.inject('settings.section', mount)
    else mount()
  } catch (error) {
    console.warn('[wechat-filehelper] 挂载设置页失败', error)
  }
}

return { name: 'dsh-wechat-filehelper', inject: ['slots'], apply, _test: { SettingsSection, api, fmtBytes, fmtTime, CLS } }
  },
})
