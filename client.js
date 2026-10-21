/**
 * dsh-whale-combo — browser half.
 *
 * One surface, contributed to the frame-wide `shell.overlay` slot:
 *   - a white, WeChat-style status bubble anchored to the left of the
 *     dsh-whale-widget whale girl, merging 余额 / 今日 / 本轮 / 缓存命中 / 峰谷
 *     from dsh-damage-pulse and dsh-whale-widget host routes;
 *   - charge danmaku (命中 · 输出 · 未命中 -0.00xx¥) rising beside the whale,
 *     replayed from the damage-pulse charge-event stream exactly like the
 *     previous patch-injected layer;
 *   - damage-pulse's own floating card stays hidden by default (Ctrl+Alt+D
 *     toggles it) so there is only one balance surface on screen.
 *
 * Integration contract with dsh-whale-widget (documented, version-pinned in
 * README): the whale character is `.dshwv-root .dshwv-img`; clicking it toggles
 * this bubble. When that element is absent the widget degrades to a small
 * launcher pill in the corner instead of disappearing.
 *
 * Hand-written ModuleLoader bundle: no build step, only the `react` the shell
 * already provides. Literal colours are deliberate artwork (the white bubble is
 * the requested look and must stay white on dark themes).
 */
window.__ModuleLoader__.load({
  id: 'dsh-whale-combo',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useRef } = React

    const NS = 'whale.combo'
    const inject = ['slots', 'locale']

    /* ───────────────────────────── copy ───────────────────────────── */
    const DICT = {
      zh: {
        'balance': '余额',
        'today': '今日',
        'turn': '本轮',
        'cache': '缓存',
        'peak': '峰',
        'valley': '谷',
        'peakTip': '北京时间高峰时段（09:00-12:00 / 14:00-18:00）',
        'valleyTip': '北京时间低谷时段',
        'launcher': '鲸鱼娘数据卡',
        'hit': '命中',
        'output': '输出',
        'miss': '未命中',
        'meta.title': '鲸鱼娘 · 合并数据卡',
        'meta.description': '在鲸鱼娘旁显示余额 / 今日 / 本轮 / 缓存命中 / 峰谷的白色状态气泡，并在计费时播放扣费弹幕。',
      },
      en: {
        'balance': 'Balance',
        'today': 'Today',
        'turn': 'Turn',
        'cache': 'Cache',
        'peak': 'Peak',
        'valley': 'Off-peak',
        'peakTip': 'Beijing peak hours (09:00–12:00 / 14:00–18:00)',
        'valleyTip': 'Beijing off-peak hours',
        'launcher': 'Whale girl card',
        'hit': 'hit',
        'output': 'output',
        'miss': 'miss',
        'meta.title': 'Whale Girl · Merged Card',
        'meta.description': 'White status bubble beside the whale girl: balance, today, this turn, cache hit rate, peak/off-peak, plus charge danmaku.',
      },
    }

    /* ─────────────────────────── tunables ─────────────────────────── */
    const CARD_REFRESH_MS = 6000
    const CHARGE_POLL_MS = 1000
    const TURN_POLL_MS = 5000
    const FLOAT_MS = 2700
    const FLOAT_QUEUE_MS = 850
    const LAYOUT_MS = 500
    const HINT_KEY = 'dsh-whale-combo:hinted-v4'
    const FONT = 'Inter, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'
    const DP_PROVIDERS = ['deepseek-account', 'deepseek-official']
    const WHALE_SELECTOR = '.dshwv-root .dshwv-img, .dshwv-img'

    /* ──────────────────────── pure helpers ────────────────────────── */
    function isNum(v) {
      return typeof v === 'number' && Number.isFinite(v)
    }
    function fmtMoney(v) {
      const n = Number(v)
      return Number.isFinite(n) ? n.toFixed(2) : '--'
    }
    // Same rounding rule as damage-pulse: below one cent show four decimals.
    function fmtCost(v) {
      const n = Number(v)
      if (!Number.isFinite(n)) return '--'
      return n < 0.01 ? n.toFixed(4) : n.toFixed(2)
    }
    function jsonFetch(url, timeoutMs) {
      return new Promise(resolve => {
        let done = false
        let ctrl = null
        try {
          ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
        } catch {
          ctrl = null
        }
        const timer = setTimeout(() => {
          if (done) return
          done = true
          try {
            if (ctrl) ctrl.abort()
          } catch {
            /* ignore */
          }
          resolve(null)
        }, timeoutMs || 8000)
        const init = { credentials: 'same-origin', cache: 'no-store' }
        if (ctrl) init.signal = ctrl.signal
        fetch(url, init)
          .then(res => (res && res.ok ? res.json() : null))
          .then(value => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve(value)
          })
          .catch(() => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve(null)
          })
      })
    }
    function beijingClock() {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          hour12: false,
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).formatToParts(new Date())
        const map = {}
        for (const part of parts) map[part.type] = part.value
        const minutes = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10)
        return { day: map.weekday, minutes: Number.isFinite(minutes) ? minutes : 600 }
      } catch {
        return { day: 'Mon', minutes: 600 }
      }
    }
    // Official pricing calendar: Beijing weekdays 09:00-12:00 and 14:00-18:00
    // are peak; weekends (and, in the host's own table, holidays) are off-peak.
    function isPeakNow() {
      const clock = beijingClock()
      if (clock.day === 'Sat' || clock.day === 'Sun') return false
      return (clock.minutes >= 540 && clock.minutes < 720) || (clock.minutes >= 840 && clock.minutes < 1080)
    }
    function whaleRect() {
      const img = document.querySelector(WHALE_SELECTOR)
      if (!img) return null
      const rect = img.getBoundingClientRect()
      if (!rect || rect.width < 10 || rect.height < 10) return null
      return rect
    }

    /* ───────────────────── minimal line icons ─────────────────────── */
    const ICONS = {
      wallet: () =>
        h(
          'svg',
          { className: 'wc2-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          h('rect', { x: 5.4, y: 5.2, width: 10.2, height: 5.6, rx: 1.7, fill: 'currentColor', opacity: 0.72 }),
          h('path', {
            d: 'M3 11a2.6 2.6 0 0 1 2.6-2.6h12.8A2.6 2.6 0 0 1 21 11v6.4a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 17.4V11Z',
            fill: 'currentColor',
            opacity: 0.96,
          }),
          h('path', { d: 'M14.4 12.2H21v4.4h-6.6a2.2 2.2 0 0 1 0-4.4Z', fill: 'rgba(14,26,48,0.6)' }),
          h('circle', { cx: 17.3, cy: 14.4, r: 1.05, fill: 'rgba(255,255,255,0.9)' }),
        ),
      bars: () =>
        h(
          'svg',
          { className: 'wc2-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          h('rect', { x: 3.6, y: 13.4, width: 3.8, height: 7.2, rx: 1.9, fill: 'currentColor', opacity: 0.7 }),
          h('rect', { x: 10.1, y: 9.2, width: 3.8, height: 11.4, rx: 1.9, fill: 'currentColor', opacity: 0.85 }),
          h('rect', { x: 16.6, y: 4.6, width: 3.8, height: 16, rx: 1.9, fill: 'currentColor' }),
        ),
      cache: () =>
        h(
          'svg',
          { className: 'wc2-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          h('ellipse', { cx: 12, cy: 6.6, rx: 7.4, ry: 3.1, fill: 'currentColor' }),
          h('path', {
            d: 'M4.6 10.4c0 1.71 3.31 3.1 7.4 3.1s7.4-1.39 7.4-3.1v2.6c0 1.71-3.31 3.1-7.4 3.1s-7.4-1.39-7.4-3.1v-2.6Z',
            fill: 'currentColor',
            opacity: 0.78,
          }),
          h('path', {
            d: 'M4.6 14.6c0 1.71 3.31 3.1 7.4 3.1s7.4-1.39 7.4-3.1v2.6c0 1.71-3.31 3.1-7.4 3.1s-7.4-1.39-7.4-3.1v-2.6Z',
            fill: 'currentColor',
            opacity: 0.55,
          }),
        ),
    }

    /* ───────────────────────── surface styles ─────────────────────── */
    const CSS = `
/* Stay out of the way of the whale's own dance: no host chrome is restyled. */
[data-token-monitor-balance]{display:none !important}
html.wc2-show-dp [data-token-monitor-balance]{display:block !important;opacity:.96 !important}
/* Whale-widget hides its ☰ trigger until pointer hover; the previous merged
   layer kept it visible and the menu is the only way to change character /
   size / sound, so keep that affordance here. */
.dshwv-menu-btn{opacity:.95 !important;box-shadow:0 2px 8px rgba(6,12,26,.28)}
.dshwv-menu-btn:hover{opacity:1 !important}

.wc2-card{position:fixed;z-index:10001;left:0;top:0;display:flex;align-items:center;gap:9px;
  padding:6px 10px;border-radius:13px;box-sizing:border-box;
  font-family:${FONT};font-size:10px;line-height:1;white-space:nowrap;color:#eef4ff;
  max-width:calc(100vw - 24px);
  background:
    radial-gradient(130% 150% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 58%),
    linear-gradient(155deg,rgba(255,255,255,.07),rgba(255,255,255,.02) 45%,rgba(120,160,235,.05)),
    rgba(24,38,62,.26);
  box-shadow:
    inset 0 0 0 1px rgba(22,36,58,.42),
    inset 0 1px 0 rgba(255,255,255,.32),
    inset 0 -1px 0 rgba(4,10,20,.24),
    inset 0 -8px 16px rgba(3,9,20,.12),
    0 14px 32px rgba(3,8,18,.40),
    0 3px 8px rgba(3,8,18,.20),
    0 0 36px rgba(70,120,220,.10);
  backdrop-filter:blur(26px) saturate(180%);
  -webkit-backdrop-filter:blur(26px) saturate(180%);
  opacity:0;transform:translateY(8px) scale(.975);pointer-events:none;
  transition:opacity .18s ease,transform .18s cubic-bezier(.2,.9,.3,1.2)}
.wc2-card::after{content:"";position:absolute;right:18px;bottom:-9px;width:18px;height:10px;
  clip-path:polygon(0 0,100% 0,50% 100%);
  background:rgba(36,52,82,.40);
  backdrop-filter:blur(26px) saturate(180%);
  -webkit-backdrop-filter:blur(26px) saturate(180%)}
.wc2-card.wc2-tail-left::after{right:auto;left:18px}
.wc2-card.wc2-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
.wc2-sec{display:flex;align-items:center;gap:5px;min-width:0}
.wc2-ico{width:14px;height:14px;flex:none;display:block;color:#a9c2f4;
  filter:drop-shadow(0 1px 1px rgba(4,10,22,.35))}
.wc2-v{font-size:13px;font-weight:750;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.wc2-v.wc2-bal{color:#67efae;text-shadow:0 0 10px rgba(96,238,172,.26)}
.wc2-v.wc2-bal.wc2-flash-red{color:#ff8fa0 !important;text-shadow:0 0 10px rgba(255,120,140,.30)}
.wc2-v.wc2-bal.wc2-flash-green{color:#67efae !important}
.wc2-v.wc2-today{color:#f2f6ff;text-shadow:0 1px 3px rgba(4,10,22,.35)}
.wc2-v.wc2-cache{color:#b6c8fb;text-shadow:0 1px 3px rgba(4,10,22,.35)}
.wc2-sep{width:1px;height:14px;flex:none;
  background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.16),rgba(255,255,255,0))}
.wc2-badge{width:24px;height:24px;flex:none;border-radius:8px;display:flex;align-items:center;justify-content:center;
  box-sizing:border-box;font-size:15px;font-weight:800;line-height:1;letter-spacing:0;
  backdrop-filter:blur(12px) saturate(160%);
  -webkit-backdrop-filter:blur(12px) saturate(160%)}
.wc2-badge.wc2-peak{color:#ffd3dd;text-shadow:0 0 8px rgba(255,120,150,.60);
  background:rgba(255,88,120,.26);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.40),inset 0 0 0 1px rgba(255,130,160,.38),0 0 16px rgba(255,80,110,.22)}
.wc2-badge.wc2-valley{color:#c8ffea;text-shadow:0 0 8px rgba(80,232,180,.60);
  background:rgba(64,214,166,.24);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.40),inset 0 0 0 1px rgba(110,235,190,.34),0 0 14px rgba(60,210,160,.20)}

.wc2-floats{position:fixed;z-index:10002;left:0;top:0;width:0;height:0;pointer-events:none;
  font-family:${FONT}}
.wc2-float{position:absolute;right:0;bottom:0;display:flex;align-items:baseline;justify-content:flex-end;gap:4px;
  width:154px;white-space:nowrap;font-weight:900;font-variant-numeric:tabular-nums;
  animation:wc2-float-rise ${FLOAT_MS}ms cubic-bezier(.2,.72,.3,1) forwards;will-change:transform,opacity}
.wc2-float-label{width:42px;text-align:right;color:#6ea2ff;font-size:13px;font-weight:900;
  text-shadow:0 1px 3px rgba(0,0,0,.70),0 0 8px rgba(60,120,255,.35)}
.wc2-float-amt{width:108px;text-align:left;color:#3f7bf0;font-size:21px;font-weight:900;
  text-shadow:0 1px 3px rgba(0,0,0,.70),0 0 12px rgba(70,140,255,.45)}
.wc2-float.wc2-miss .wc2-float-amt{font-size:25px;color:#aab4c2;
  text-shadow:0 1px 3px rgba(0,0,0,.72),0 0 10px rgba(170,180,194,.28)}
.wc2-float.wc2-miss .wc2-float-label{color:#8d97a5;text-shadow:0 1px 3px rgba(0,0,0,.72)}
.wc2-float.wc2-output .wc2-float-amt{color:#5b93ff}
@keyframes wc2-float-rise{
  0%{opacity:0;transform:translate(0,12px) scale(.55)}
  12%{opacity:1;transform:translate(0,3px) scale(1.07)}
  22%{opacity:1;transform:translate(0,-6px) scale(1)}
  62%{opacity:1;transform:translate(0,-82px);animation-timing-function:linear}
  100%{opacity:0;transform:translate(0,-118px) scale(.96)}}

.wc2-launch{position:fixed;z-index:10001;right:18px;bottom:96px;width:44px;height:44px;border-radius:999px;
  border:1px solid rgba(255,255,255,.22);cursor:pointer;padding:0;
  background:linear-gradient(160deg,#2f7bd6,#1a4f9c);color:#fff;
  font:700 17px/1 ${FONT};box-shadow:0 6px 18px rgba(17,24,39,.28)}
.wc2-launch:hover{filter:brightness(1.06)}
.wc2-launch:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}
`

    /* ──────────────────────────── component ───────────────────────── */
    function WhaleCombo(props) {
      const { t, ctx } = props
      const cardRef = useRef(null)
      const floatRef = useRef(null)
      const s = useRef({
        mounted: true,
        open: false,
        cardEl: null,
        floatEl: null,
        press: null,
        anchor: null,
        whaleSeen: null,
        lastBal: null,
        lastPeak: null,
        chargeSeq: null,
        chargeBusy: false,
        lastChargeCost: null,
        dpBalance: null,
        dpToday: null,
        dpSummary: null,
        wwBalance: null,
        wwTurn: null,
        floatSeq: 0,
        floatQueue: [],
        flashTimer: 0,
      }).current

      const [open, setOpen] = useState(false)
      const [whaleSeen, setWhaleSeen] = useState(true)
      const [flash, setFlash] = useState(null)
      const [stats, setStats] = useState({
        bal: null,
        cur: 'CNY',
        today: null,
        turn: null,
        cache: null,
        peak: null,
      })
      const [floats, setFloats] = useState([])
      const [, bumpLocale] = useState(0)

      /* ---- geometry ---- */
      function layout() {
        const card = cardRef.current
        const layer = floatRef.current
        if (!card || !layer) return
        const live = whaleRect()
        if (live) {
          // Anchor stability: the whale image bobs, so only re-anchor when she is
          // actually dragged/resized (or the window changes), never per tick.
          const a = s.anchor
          if (
            !a ||
            Math.abs(live.left - a.left) > 24 ||
            Math.abs(live.top - a.top) > 24 ||
            Math.abs(live.width - a.width) > 10
          ) {
            s.anchor = { left: live.left, top: live.top, width: live.width, height: live.height }
          }
          if (s.whaleSeen !== true) {
            s.whaleSeen = true
            setWhaleSeen(true)
          }
        } else {
          s.anchor = null
          if (s.whaleSeen !== false) {
            s.whaleSeen = false
            setWhaleSeen(false)
          }
        }
        const anchor = s.anchor
        const rect = anchor
          ? { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height, right: anchor.left + anchor.width }
          : null
        const vw = window.innerWidth
        const vh = window.innerHeight
        const cw = card.offsetWidth || 430
        const ch = card.offsetHeight || 44
        const gap = 12
        let left
        let top
        let tailLeft = false
        if (rect) {
          // Preferred: float above the whale, shifted right so the bottom tail
          // sits over her head; the danmaku column rises from the head.
          // Preferred: sit just above/right of the whale's head, tail touching it.
          if (rect.top + rect.height * 0.14 - ch >= 8) {
            left = rect.left + 80 - cw
            top = rect.top + rect.height * 0.14 - ch
          } else if (rect.left - gap - cw >= 8) {
            left = rect.left - gap - cw
            top = rect.top + rect.height * 0.38 - ch * 0.5
          } else if (vw - rect.right - gap - cw >= 8) {
            left = rect.right + gap
            top = rect.top + rect.height * 0.38 - ch * 0.5
            tailLeft = true
          } else {
            left = rect.left + rect.width * 0.5 - cw * 0.5
            top = rect.top - ch - gap
          }
        } else {
          left = vw - cw - 24
          top = vh - ch - 96
        }
        if (left < 8) left = 8
        if (left > vw - cw - 8) left = Math.max(8, vw - cw - 8)
        if (top < 8) top = 8
        if (top > vh - ch - 8) top = Math.max(8, vh - ch - 8)
        card.style.left = left + 'px'
        card.style.top = top + 'px'
        card.classList.toggle('wc2-tail-left', tailLeft)
        // Danmaku always rises from the top of the whale's head, open or not.
        layer.style.left = (rect ? rect.left + rect.width * 0.97 : vw - 90) + 'px'
        layer.style.top = (rect ? rect.top : vh - 96) + 'px'
      }

      /* ---- data rendering ---- */
      function renderStats() {
        const dpBal = s.dpBalance
        const wwBal = s.wwBalance
        const bal = dpBal && isNum(dpBal.totalBalance) ? dpBal.totalBalance : wwBal && isNum(wwBal.totalBalance) ? wwBal.totalBalance : null
        const cur = (dpBal && dpBal.currency) || (wwBal && wwBal.currency) || 'CNY'
        const today = s.dpToday && isNum(s.dpToday.cost) ? s.dpToday.cost : wwBal && isNum(wwBal.todayUsage) ? wwBal.todayUsage : null
        const turn = s.wwTurn && isNum(s.wwTurn.amount) ? s.wwTurn.amount : isNum(s.lastChargeCost) ? s.lastChargeCost : null
        const cache = s.dpSummary && isNum(s.dpSummary.cacheHitRate) ? s.dpSummary.cacheHitRate : null
        const peak = wwBal && typeof wwBal.isPeak === 'boolean' ? wwBal.isPeak : isPeakNow()
        if (bal != null && s.lastBal != null && Math.abs(bal - s.lastBal) > 1e-9) {
          flashBalance(bal < s.lastBal ? 'red' : 'green')
        }
        if (bal != null) s.lastBal = bal
        setStats({ bal, cur, today, turn, cache, peak })
      }
      function flashBalance(kind) {
        setFlash(kind)
        clearTimeout(s.flashTimer)
        s.flashTimer = setTimeout(() => {
          if (s.mounted) setFlash(null)
        }, 650)
      }
      function refreshAll() {
        fetchDpBalance().then(v => {
          if (v && s.mounted) {
            s.dpBalance = v
            renderStats()
          }
        })
        jsonFetch('/api/token-monitor/today-spend', 6000).then(v => {
          if (v && s.mounted) {
            s.dpToday = v
            renderStats()
          }
        })
        jsonFetch('/api/token-monitor/usage-summary?range=today', 6000).then(v => {
          if (v && !v.error && s.mounted) {
            s.dpSummary = v
            renderStats()
          }
        })
        jsonFetch('/dsh-whale/balance.json', 8000).then(v => {
          if (v && s.mounted) {
            s.wwBalance = v
            renderStats()
          }
        })
        jsonFetch('/dsh-whale/last-turn.json', 6000).then(v => {
          if (v && s.mounted) {
            s.wwTurn = v
            renderStats()
          }
        })
      }
      function fetchDpBalance() {
        let i = 0
        const next = () => {
          if (i >= DP_PROVIDERS.length) return Promise.resolve(null)
          const provider = DP_PROVIDERS[i]
          i += 1
          return jsonFetch('/api/token-monitor/balance?provider=' + encodeURIComponent(provider), 6000).then(v =>
            v && isNum(v.totalBalance) ? v : next(),
          )
        }
        return next()
      }

      /* ---- charge danmaku ---- */
      function spawnFloat(label, text, kind) {
        // Queue instead of painting: the parts of one charge (hit / output /
        // miss) would otherwise overlap at the same anchor. The pump emits one
        // float per tick so they ride the same path in a line.
        if (s.floatQueue.length > 80) s.floatQueue.shift()
        s.floatQueue.push({ label, text, kind })
      }
      function pumpFloats() {
        if (!s.mounted || !s.floatQueue.length) return
        const item = s.floatQueue.shift()
        s.floatSeq += 1
        const id = s.floatSeq
        setFloats(list => list.concat([{ id, label: item.label, text: item.text, kind: item.kind }]))
        setTimeout(() => {
          if (s.mounted) setFloats(list => list.filter(entry => entry.id !== id))
        }, FLOAT_MS + 250)
      }
      function handleCharge(ev) {
        if (!ev || typeof ev !== 'object') return
        const parts = []
        if (ev.breakdown && typeof ev.breakdown === 'object') {
          const rows = [
            ['cacheHit', t('hit'), 'normal'],
            ['output', t('output'), 'output'],
            ['cacheMiss', t('miss'), 'miss'],
          ]
          for (const row of rows) {
            const b = ev.breakdown[row[0]]
            if (b && isNum(b.cost) && b.cost > 0) parts.push({ label: row[1], cost: b.cost, kind: row[2] })
          }
        }
        if (!parts.length) {
          const cost = Number(ev.cost)
          if (!(cost > 0)) return
          const dk = ev.damageKind
          parts.push({
            label: dk === 'miss' ? t('miss') : dk === 'output' ? t('output') : t('hit'),
            cost,
            kind: dk === 'miss' ? 'miss' : dk === 'output' ? 'output' : 'normal',
          })
        }
        s.lastChargeCost = parts.reduce((a, p) => a + p.cost, 0)
        for (const p of parts) spawnFloat(p.label, '-' + fmtCost(p.cost) + '¥', p.kind)
        renderStats()
      }
      function pollCharges() {
        if (s.chargeBusy) return
        s.chargeBusy = true
        const since = s.chargeSeq == null ? 0 : s.chargeSeq
        jsonFetch('/api/token-monitor/charge-events?since=' + since, 6000)
          .then(batch => {
            s.chargeBusy = false
            if (!batch || !Array.isArray(batch.events)) return
            if (s.chargeSeq == null) {
              // First poll only records the cursor: history is never replayed.
              s.chargeSeq = isNum(batch.seq) ? batch.seq : 0
              return
            }
            for (const ev of batch.events) handleCharge(ev)
            if (isNum(batch.seq) && batch.seq > s.chargeSeq) s.chargeSeq = batch.seq
            if (s.open) refreshAll()
          })
          .catch(() => {
            s.chargeBusy = false
          })
      }

      /* ---- open / close ---- */
      function openCard() {
        s.open = true
        setOpen(true)
        layout()
        refreshAll()
        renderStats()
      }
      function closeCard() {
        s.open = false
        setOpen(false)
      }
      function toggleOpen() {
        if (s.open) closeCard()
        else openCard()
      }

      /* ---- lifetime ---- */
      useEffect(() => {
        s.mounted = true
        const timers = []

        const onPointerDown = e => {
          const target = e.target
          if (target && target.closest && target.closest('.dshwv-img')) {
            s.press = { x: e.clientX, y: e.clientY, t: Date.now() }
          }
        }
        const onClick = e => {
          const target = e.target
          const press = s.press
          s.press = null
          const img = target && target.closest ? target.closest('.dshwv-img') : null
          if (img) {
            if (press && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 10) return
            if (press && Date.now() - press.t > 900) return
            // Keep the whale's own bubble closed; ours owns the click.
            e.stopPropagation()
            toggleOpen()
            return
          }
          if (
            s.open &&
            !(target && target.closest && (target.closest('.wc2-card') || target.closest('.wc2-launch')))
          ) {
            closeCard()
          }
        }
        const onKeyDown = e => {
          if (e.key === 'Escape') closeCard()
          if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
            document.documentElement.classList.toggle('wc2-show-dp')
          }
        }
        const onResize = () => layout()
        const onVisibility = () => {
          if (!document.hidden) layout()
        }

        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('click', onClick, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onResize)
        document.addEventListener('visibilitychange', onVisibility)

        timers.push(setTimeout(() => refreshAll(), 1200))
        timers.push(setInterval(pollCharges, CHARGE_POLL_MS))
        timers.push(setInterval(pumpFloats, FLOAT_QUEUE_MS))
        timers.push(
          setInterval(() => {
            layout()
            if (s.open) refreshAll()
          }, CARD_REFRESH_MS),
        )
        timers.push(
          setInterval(() => {
            jsonFetch('/dsh-whale/last-turn.json', 6000).then(v => {
              if (v && s.mounted) {
                s.wwTurn = v
                renderStats()
              }
            })
          }, TURN_POLL_MS),
        )
        timers.push(setInterval(layout, LAYOUT_MS))

        // Show the bubble once, so a fresh install is immediately visible.
        try {
          if (!window.localStorage.getItem(HINT_KEY)) {
            window.localStorage.setItem(HINT_KEY, '1')
            let tries = 0
            const hintTimer = setInterval(() => {
              tries += 1
              if (whaleRect() || tries > 40) {
                clearInterval(hintTimer)
                setTimeout(() => {
                  if (!s.mounted) return
                  openCard()
                  setTimeout(() => {
                    if (s.mounted) closeCard()
                  }, 6000)
                }, 1200)
              }
            }, 500)
            timers.push(hintTimer)
          }
        } catch {
          /* private mode: no hint */
        }

        let unsubscribe = null
        try {
          if (ctx && ctx.locale && typeof ctx.locale.subscribe === 'function') {
            unsubscribe = ctx.locale.subscribe(() => bumpLocale(n => n + 1))
          }
        } catch {
          unsubscribe = null
        }

        return () => {
          s.mounted = false
          try {
            if (unsubscribe) unsubscribe()
          } catch {
            /* ignore */
          }
          clearTimeout(s.flashTimer)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('click', onClick, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onResize)
          document.removeEventListener('visibilitychange', onVisibility)
          for (const timer of timers) {
            clearTimeout(timer)
            clearInterval(timer)
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      /* ---- render ---- */
      const unit = stats.cur && stats.cur !== 'CNY' ? stats.cur + ' ' : '¥'
      const balText = stats.bal == null ? '--' : unit + stats.bal.toFixed(2)
      const todayText = stats.today == null ? '--' : unit + fmtMoney(stats.today)
      const turnText = stats.turn == null ? '--' : unit + fmtCost(stats.turn)
      const cacheText = stats.cache == null ? '--' : Math.round(stats.cache * 100) + '%'
      const tipText = [
        t('balance') + ' ' + balText,
        t('today') + ' ' + todayText,
        t('turn') + ' ' + turnText,
        t('cache') + ' ' + cacheText,
      ].join(' · ')

      function metric(key, icon, value, valueClass, tip) {
        return h('div', { className: 'wc2-sec', key, title: tip }, icon, h('span', { className: valueClass }, value))
      }

      return h(
        Fragment,
        null,
        h(
          'div',
          { className: 'wc2-floats', ref: floatRef, 'aria-hidden': 'true' },
          floats.map(item =>
            h(
              'span',
              {
                key: item.id,
                className:
                  'wc2-float' + (item.kind === 'miss' ? ' wc2-miss' : item.kind === 'output' ? ' wc2-output' : ''),
              },
              item.label ? h('span', { className: 'wc2-float-label' }, item.label) : null,
              h('span', { className: 'wc2-float-amt' }, item.text),
            ),
          ),
        ),
        h(
          'div',
          {
            ref: cardRef,
            className: 'wc2-card' + (open ? ' wc2-open' : ''),
            role: 'status',
            'aria-live': 'polite',
            title: tipText,
            onClick: e => {
              e.stopPropagation()
              refreshAll()
              renderStats()
            },
            onContextMenu: e => {
              e.preventDefault()
              closeCard()
            },
          },
          metric(
            'balance',
            h(ICONS.wallet),
            balText,
            'wc2-v wc2-bal' + (flash === 'red' ? ' wc2-flash-red' : flash === 'green' ? ' wc2-flash-green' : ''),
            t('balance') + ' ' + balText,
          ),
          h('span', { className: 'wc2-sep', key: 'sep1' }),
          metric('today', h(ICONS.bars), todayText, 'wc2-v wc2-today', t('today') + ' ' + todayText),
          h('span', { className: 'wc2-sep', key: 'sep2' }),
          metric('cache', h(ICONS.cache), cacheText, 'wc2-v wc2-cache', t('cache') + ' ' + cacheText),
          h(
            'span',
            {
              key: 'badge',
              className: 'wc2-badge ' + (stats.peak ? 'wc2-peak' : 'wc2-valley'),
              title: stats.peak ? t('peakTip') : t('valleyTip'),
              role: 'img',
              'aria-label': stats.peak ? t('peak') : t('valley'),
            },
            stats.peak ? t('peak') : t('valley'),
          ),
        ),
        whaleSeen
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'wc2-launch',
                title: t('launcher'),
                'aria-label': t('launcher'),
                onClick: e => {
                  e.stopPropagation()
                  toggleOpen()
                },
              },
              '¥',
            ),
      )
    }

    /* ───────────────────────────── apply ──────────────────────────── */
    function apply(ctx) {
      // Migration guard: versions before this plugin appended the same bubble to
      // whale-widget's own script and marked the document with
      // window.__dshWhaleCombo. If a page still runs that injected copy, leave
      // the bubble to it instead of drawing a second one; the next reload only
      // loads this plugin.
      if (typeof window.__dshWhaleCombo !== 'undefined') return

      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'whale-combo: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-whale-combo')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'whale-combo: styles')
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'whale-combo-card',
            order: 20,
            locale: NS,
          },
          props => h(WhaleCombo, { ...props, t, ctx }),
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-whale-combo'
    return module.exports
  },
})
