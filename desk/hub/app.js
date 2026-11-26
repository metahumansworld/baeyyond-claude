// The hub page: every session's asks, grouped by session, answered from the phone.
//
// It reads the hub every two seconds and draws again only when something changed, keeping what
// you were writing and where your focus was. An answer is sent to the hub, which hands it to the
// session; the card then says where it got to, from the hub's own word, and folds away.
// Everything the sessions wrote goes in as text, never as markup.

(() => {
  const POLL_MS = 2000
  const HIDDEN_POLL_MS = 10_000
  const FOLD_MS = 4000
  const STALE_MS = 6000
  const AGAIN_MS = 5 * 60_000

  const byId = id => document.getElementById(id)
  const hhmm = t => new Date(t).toTimeString().slice(0, 5)
  const mins = ms => Math.max(0, ms) / 60_000
  const ago = ms => {
    const m = mins(ms)
    if (m < 1) return 'just now'
    if (m < 60) return `${Math.floor(m)}m ago`
    if (m < 2880) return `${Math.floor(m / 60)}h ago`
    return `${Math.floor(m / 1440)}d ago`
  }
  const short = ms => {
    const m = mins(ms)
    if (m < 60) return `${Math.floor(m)}m`
    if (m < 2880) return `${Math.floor(m / 60)}h`
    return `${Math.floor(m / 1440)}d`
  }

  let state = null
  let skew = 0
  let okAt = 0
  let failSince = 0
  let failWhy = ''
  let filter = 'all'
  let drawn = ''
  let pressing = false
  let owed = false
  let timer = 0
  let focusAfter = ''
  const drafts = new Map()
  const writing = new Set()
  const sent = new Map()
  const foldAt = new Map()
  const openFolds = new Set()
  const now = () => Date.now() + skew

  function el(tag, props, ...kids) {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') n.className = v
      else if (k === 'text') n.textContent = v
      else n.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of kids.flat()) if (c !== undefined && c !== null && c !== false) n.append(c)
    return n
  }

  // ── how an ask stands ─────────────────────────────────────────────────────────────────────

  /** Open, or settled: what you said, and where it got to. `final` once the session has it or it is closed. */
  function standing(a, s) {
    const hub = state.answers[a.id]
    const mine = sent.get(a.id)
    if (a.state === 'replied') {
      return hub
        ? { settled: true, final: true, words: a.reply, trail: `sent ${hhmm(hub.at)}.`, took: ` taken by the session ${hhmm(a.closedAt)}.` }
        : { settled: true, final: true, words: a.reply, trail: `answered on the mac ${hhmm(a.closedAt)}.` }
    }
    if (a.state === 'done') {
      if (hub?.done) return { settled: true, final: true, closed: true, trail: `closed ${hhmm(hub.at)}. the session is not told.` }
      if (a.reply) return { settled: true, final: true, closed: true, by: a.reply, trail: `closed by the session ${hhmm(a.closedAt)}.` }
      return { settled: true, final: true, closed: true, trail: `closed ${hhmm(a.closedAt)}.` }
    }
    if (a.pending) {
      const where = s.state === 'closed' ? ' waits until the session opens.' : ' the session takes it when it next reads the desk.'
      return { settled: true, words: a.pending, trail: `sent ${hhmm(hub ? hub.at : now())}.${where}` }
    }
    if (hub && !hub.takenAt) {
      const wait = hub.waiting ? ' no session is reading the hub, so it waits there.' : ''
      if (hub.done) return { settled: true, closed: true, trail: `closing ${hhmm(hub.at)}.${wait}` }
      return { settled: true, words: hub.words, trail: `sent ${hhmm(hub.at)}.${wait}` }
    }
    if (mine && !mine.error) {
      return mine.done ? { settled: true, closed: true, trail: 'closing…' } : { settled: true, words: mine.words, trail: 'sending…' }
    }
    return { settled: false, error: mine?.error ?? '' }
  }

  // ── drawing ───────────────────────────────────────────────────────────────────────────────

  function stateLine(s, open) {
    const t = now()
    if (s.state === 'held' && open > 0) return [el('span', { class: 'mins', 'data-held': String(s.heldSince), text: short(t - s.heldSince) }), 'stopped for you']
    if (s.state === 'working') {
      const took = s.asks.some(a => a.state === 'replied' && t - a.closedAt < AGAIN_MS)
      return [took ? 'working again' : 'still working']
    }
    if (s.state === 'idle' || s.state === 'held') return ['idle']
    if (s.state === 'open') return ['open on the mac']
    return [s.closedSince ? `closed ${ago(t - s.closedSince)}` : 'closed']
  }

  function linkEl(a) {
    if (/^https?:\/\//i.test(a.link)) {
      const where = a.link.replace(/^https?:\/\//i, '')
      return el(
        'a',
        { class: 'look', href: a.link, target: '_blank', rel: 'noopener noreferrer' },
        el('span', { class: 'w', text: 'open the link' }),
        el('span', { class: 'where', text: where.length > 44 ? where.slice(0, 43) + '…' : where }),
      )
    }
    return el('p', { class: 'look-file', text: `on the mac: ${a.link}` })
  }

  function replyForm(a, label) {
    const id = `r-${a.id}`
    const ta = el('textarea', { id, rows: 2, placeholder: label.toLowerCase(), 'data-role': 'ta' })
    ta.value = drafts.get(a.id) ?? ''
    return el(
      'form',
      { class: 'reply', 'data-role': 'form' },
      el('label', { class: 'vh', for: id, text: label }),
      ta,
      el('button', { class: 'send', 'data-role': 'send', text: 'send' }),
    )
  }

  function askEl(a, s, st) {
    const t = now()
    const art = el('article', { class: 'ask' + (st.settled ? ' settled' : ''), 'data-kind': a.kind, 'data-id': a.id })
    art.append(
      el('p', { class: 'meta' }, el('span', { class: 'kind', text: a.kind }), el('span', null, 'asked ', el('span', { 'data-ago': String(a.askedAt), text: ago(t - a.askedAt) }))),
      el('h3', { text: a.title }),
    )
    if (a.detail) art.append(el('p', { class: 'detail', text: a.detail }))

    if (st.settled) {
      const said = el('p', { class: 'said' })
      if (st.words) said.append('you: ', el('q', { text: st.words }))
      else if (st.by) said.append('the session: ', el('q', { text: st.by }))
      else said.textContent = 'closed without a reply.'
      const trail = el('p', { class: 'trail', role: 'status', tabindex: -1, 'data-role': 'trail' }, st.trail)
      if (st.took) trail.append(el('span', { class: 'took', text: st.took }))
      art.append(said, trail)
      return art
    }

    if (a.link) art.append(linkEl(a))
    if (a.options.length > 0) {
      art.append(
        el(
          'div',
          { class: a.options.length === 2 ? 'answers two' : 'answers' },
          a.options.map((o, i) =>
            el(
              'button',
              { type: 'button', class: i === 0 ? 'opt pick' : 'opt', 'data-say': o, 'data-role': `opt${i}` },
              o,
              i === 0 ? el('span', { class: 'sug' }, el('span', { class: 'vh', text: ', ' }), 'suggested') : null,
            ),
          ),
        ),
      )
    }
    const direct = a.options.length === 0 || a.kind === 'review'
    const label = a.kind === 'review' ? 'Or what to change' : a.kind === 'answer' ? 'Your answer' : 'Your reply'
    if (direct) art.append(replyForm(a, label))
    if (s.state === 'closed') art.append(el('p', { class: 'waits', text: 'this session is closed. your answer is kept for it, and sent if it opens again.' }))
    if (st.error) art.append(el('p', { class: 'error', role: 'alert', tabindex: -1, 'data-role': 'error', text: `not sent: ${st.error}` }))
    const acts = el('div', { class: 'acts' })
    if (!direct) {
      const write = el('details', { class: 'write', 'data-role': 'details' }, el('summary', { 'data-role': 'write', text: 'write back' }), replyForm(a, label))
      if (writing.has(a.id)) {
        write.setAttribute('data-quiet', '')
        write.open = true
      }
      acts.append(write)
    }
    acts.append(el('button', { type: 'button', class: 'done', 'data-role': 'done', text: 'done, no reply' }))
    art.append(acts)
    return art
  }

  function sessionEl(s) {
    const t = now()
    const rows = s.asks.map(a => ({ a, st: standing(a, s) }))
    for (const { a, st } of rows) {
      // an answer sent from here stays in sight until the session has it, then folds a moment later
      if (st.final && !foldAt.has(a.id)) foldAt.set(a.id, sent.has(a.id) || focusAfter === a.id ? t + FOLD_MS : 0)
    }
    const open = rows.filter(r => !r.st.settled).length
    const loose = rows.filter(r => !r.st.final || (foldAt.get(r.a.id) ?? 0) > t)
    const folded = rows.filter(r => r.st.final && (foldAt.get(r.a.id) ?? 0) <= t)
    const cls = ['session', s.state === 'held' && open === 0 ? 'idle' : s.state].join(' ')
    const sec = el('section', { class: cls, 'data-state': s.state, 'data-sid': s.sid, 'aria-labelledby': `s-${s.sid}` })
    sec.append(
      el(
        'header',
        { class: 's-head' },
        el('div', { class: 's-name' }, el('h2', { id: `s-${s.sid}`, text: s.name }), el('span', { class: 'folder', text: s.folder })),
        el('div', { class: 's-state' }, stateLine(s, open)),
      ),
    )
    if (folded.length > 0) {
      const box = el(
        'details',
        { class: 'answered', 'data-fold': s.sid },
        el('summary', { 'data-role': 'fold', text: folded.length === 1 ? 'your answer here' : `your ${folded.length} answers here` }),
        folded.map(r => askEl(r.a, s, r.st)),
      )
      if (openFolds.has(s.sid)) {
        box.setAttribute('data-quiet', '')
        box.open = true
      }
      sec.append(box)
    }
    for (const r of loose) sec.append(askEl(r.a, s, r.st))
    if (s.sites.length > 0) {
      sec.append(
        el(
          'footer',
          { class: 'sites' },
          el('h3', { text: 'on your tailnet from this session' }),
          s.sites.map(x =>
            el('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'port', text: String(x.port) }), el('span', { class: 'what', text: x.url.replace(/^https:\/\//, '') })),
          ),
        ),
      )
    }
    return sec
  }

  function draw(force) {
    if (state === null) return
    if (pressing) {
      owed = true
      return
    }
    const t = now()
    const sig = JSON.stringify([
      state.sessions,
      state.answers,
      [...sent],
      [...foldAt].filter(([, at]) => at > t).length,
      Math.floor(t / 60_000),
    ])
    if (!force && sig === drawn) return fresh()
    drawn = sig

    const act = document.activeElement
    const keepId = act?.closest?.('[data-id]')?.getAttribute('data-id') ?? ''
    const keepFold = act?.closest?.('[data-fold]')?.getAttribute('data-fold') ?? ''
    const keepRole = act?.getAttribute?.('data-role') ?? ''
    const keepSel = act?.tagName === 'TEXTAREA' ? [act.selectionStart, act.selectionEnd] : null

    byId('sessions').replaceChildren(...state.sessions.map(sessionEl))

    if (focusAfter !== '') {
      // the card you answered keeps your focus on where your answer got to, then hands it to the fold
      const card = document.querySelector(`[data-id="${CSS.escape(focusAfter)}"]`)
      const fold = card?.closest('details.answered')
      const to = fold && !fold.open ? fold.querySelector('summary') : card?.querySelector('[data-role="trail"], [data-role="error"]')
      if (fold && !fold.open) focusAfter = ''
      if (to?.getAttribute('data-role') === 'error') focusAfter = ''
      to?.focus({ preventScroll: true })
    } else if (keepId !== '' && keepRole !== '') {
      const card = document.querySelector(`[data-id="${CSS.escape(keepId)}"]`)
      const to = card?.querySelector(`[data-role="${keepRole}"]`)
      if (to) {
        to.focus({ preventScroll: true })
        if (keepSel && to.tagName === 'TEXTAREA') to.setSelectionRange(keepSel[0], keepSel[1])
      }
    } else if (keepFold !== '') {
      document.querySelector(`[data-fold="${CSS.escape(keepFold)}"] summary`)?.focus({ preventScroll: true })
    }
    counts()
    show()
    fresh()
    const next = [...foldAt.values()].filter(at => at > t).sort((x, y) => x - y)[0]
    if (next) setTimeout(() => draw(), next - t + 50)
  }

  function counts() {
    const open = [...document.querySelectorAll('.ask:not(.settled)')]
    const sessions = new Set(open.map(a => a.closest('.session')))
    const stopped = [...document.querySelectorAll('.session.held')].filter(s => s.querySelector('.ask:not(.settled)')).length
    const h = byId('headline')
    if (open.length === 0) h.replaceChildren('nothing is waiting on you.')
    else {
      h.replaceChildren(
        el('span', { class: 'n', text: String(open.length) }),
        open.length === 1 ? ' ask in ' : ' asks in ',
        el('span', { class: 'n', text: String(sessions.size) }),
        sessions.size === 1 ? ' session' : ' sessions',
        stopped > 0 ? ' · ' : '',
        stopped > 0 ? el('span', { class: 'n', text: String(stopped) }) : '',
        stopped > 0 ? ' stopped for you' : '',
      )
    }
    h.classList.toggle('late', stopped > 0)
    for (const c of document.querySelectorAll('[data-count]')) {
      const k = c.getAttribute('data-count')
      c.textContent = String(open.filter(a => k === 'all' || a.getAttribute('data-kind') === k).length)
    }
  }

  function show() {
    let any = false
    for (const s of document.querySelectorAll('.session')) {
      let shown = 0
      for (const a of s.querySelectorAll(':scope > .ask')) {
        const on = filter === 'all' || (a.getAttribute('data-kind') === filter && !a.classList.contains('settled'))
        a.hidden = !on
        if (on) shown++
      }
      const fold = s.querySelector('.answered')
      if (fold) fold.hidden = filter !== 'all'
      const hasMore = filter === 'all' && (fold || s.querySelector('.sites'))
      s.hidden = shown === 0 && !hasMore
      if (!s.hidden) any = true
    }
    const none = byId('none')
    none.hidden = any
    none.textContent = filter === 'all' ? 'nothing is waiting on you.' : 'nothing of this kind is waiting.'
  }

  /** The line under the title: when the Mac last answered, and the note when no session reads the hub. */
  function fresh() {
    const f = byId('fresh')
    const late = failSince !== 0 && Date.now() - failSince > STALE_MS
    if (okAt === 0 && failSince !== 0) f.replaceChildren(`mac: ${failWhy || 'not answering'}`)
    else if (late) f.replaceChildren('mac: not answering since ', el('b', { text: hhmm(okAt) }))
    else if (okAt !== 0) f.replaceChildren('mac: answered ', el('b', { text: hhmm(okAt) }))
    f.classList.toggle('late', late || (okAt === 0 && failSince !== 0))
    const note = byId('note')
    if (state && !state.reading) {
      note.textContent = state.readAt
        ? `no session has read the hub since ${hhmm(state.readAt)}. answers wait here until one opens.`
        : 'no session reads the hub yet. answers wait here until one opens.'
      note.hidden = false
    } else note.hidden = true
  }

  function tick() {
    const t = now()
    for (const n of document.querySelectorAll('[data-ago]')) n.textContent = ago(t - Number(n.getAttribute('data-ago')))
    for (const n of document.querySelectorAll('[data-held]')) n.textContent = short(t - Number(n.getAttribute('data-held')))
  }

  // ── talking to the hub ────────────────────────────────────────────────────────────────────

  async function poll() {
    clearTimeout(timer)
    try {
      const r = await fetch('api/state', { cache: 'no-store', credentials: 'same-origin' })
      if (!r.ok) throw new Error(r.status === 403 ? 'this hub answers its owner only, through tailscale' : `the hub said ${r.status}`)
      const v = await r.json()
      skew = v.now - Date.now()
      state = v
      okAt = Date.now()
      failSince = 0
      for (const [id, m] of sent) if (!m.error && (v.answers[id] || !isOpen(id))) sent.delete(id)
      draw()
    } catch (err) {
      if (failSince === 0) failSince = Date.now()
      failWhy = err instanceof Error ? err.message : String(err)
      fresh()
    } finally {
      timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS)
    }
  }

  function isOpen(id) {
    return state.sessions.some(s => s.asks.some(a => a.id === id && a.state === 'open' && !a.pending))
  }

  async function post(id, what) {
    sent.set(id, { ...what, at: now() })
    focusAfter = id
    draw(true)
    try {
      const r = await fetch('api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Desk-Hub': '1' },
        body: JSON.stringify({ askId: id, ...what }),
        credentials: 'same-origin',
      })
      const said = await r.text()
      let v = {}
      try {
        v = JSON.parse(said)
      } catch {}
      if (!r.ok) throw new Error(v.error || said.trim() || `the hub said ${r.status}`)
      drafts.delete(id)
      writing.delete(id)
    } catch (err) {
      sent.set(id, { error: err instanceof Error ? err.message : String(err) })
    }
    await poll()
    draw(true)
  }

  // ── what you do ───────────────────────────────────────────────────────────────────────────

  document.addEventListener('click', e => {
    const k = e.target.closest('.kinds button')
    if (k) {
      filter = k.getAttribute('data-kind')
      for (const b of document.querySelectorAll('.kinds button')) b.setAttribute('aria-pressed', String(b === k))
      show()
      return
    }
    const card = e.target.closest('.ask:not(.settled)')
    if (!card) return
    const id = card.getAttribute('data-id')
    const opt = e.target.closest('.opt')
    if (opt) return void post(id, { words: opt.getAttribute('data-say') })
    if (e.target.closest('.done')) return void post(id, { done: true })
  })

  document.addEventListener('submit', e => {
    e.preventDefault()
    const card = e.target.closest('.ask')
    const ta = e.target.querySelector('textarea')
    const words = ta.value.trim()
    if (!words) return ta.focus()
    void post(card.getAttribute('data-id'), { words })
  })

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.tagName === 'TEXTAREA') {
      e.preventDefault()
      e.target.form?.requestSubmit()
    }
  })

  document.addEventListener('input', e => {
    if (e.target.tagName !== 'TEXTAREA') return
    const id = e.target.closest('.ask')?.getAttribute('data-id')
    if (id) drafts.set(id, e.target.value)
  })

  document.addEventListener(
    'toggle',
    e => {
      const d = e.target
      // a fold or a write-back drawn open again is not you opening it
      if (d.hasAttribute?.('data-quiet')) return void d.removeAttribute('data-quiet')
      if (d.classList?.contains('write')) {
        const id = d.closest('.ask')?.getAttribute('data-id')
        if (id) d.open ? writing.add(id) : writing.delete(id)
        if (d.open) d.querySelector('textarea')?.focus()
      } else if (d.classList?.contains('answered')) {
        const sid = d.getAttribute('data-fold')
        d.open ? openFolds.add(sid) : openFolds.delete(sid)
      }
    },
    true,
  )

  // a draw never lands under a finger that is pressing
  let pressTimer = 0
  document.addEventListener('pointerdown', e => {
    // touching anything but the card you answered lets your focus go where you put it
    if (focusAfter !== '' && !e.target.closest?.(`[data-id="${CSS.escape(focusAfter)}"]`)) focusAfter = ''
    pressing = true
    clearTimeout(pressTimer)
    pressTimer = setTimeout(release, 3000)
  })
  function release() {
    pressing = false
    if (owed) {
      owed = false
      setTimeout(() => draw(), 0)
    }
  }
  document.addEventListener('pointerup', () => setTimeout(release, 0))
  document.addEventListener('pointercancel', release)

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void poll()
  })

  setInterval(tick, 30_000)
  void poll()
})()
