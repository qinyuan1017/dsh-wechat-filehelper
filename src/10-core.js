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
