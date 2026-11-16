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
