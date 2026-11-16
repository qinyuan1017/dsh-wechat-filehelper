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
