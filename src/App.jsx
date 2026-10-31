import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import {
  AlarmClock, ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines,
  CalendarDays,
  Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, CloudRain,
  Download, Focus, Headphones, Home, ListChecks, Maximize2, Menu,
  Moon,
  MoreHorizontal,
  Music2, Pause, Play, Plus, RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles, Square,
  Sun,
  TimerReset, Volume2,
  Waves, X, Zap
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'


const STORAGE_KEY = 'timeframe.app.v1'
const CATEGORIES = ['Deep work', 'Learning', 'Admin', 'Health', 'Personal']
const ACCENTS = ['#049DD9', '#0487D9', '#03318C', '#021F59']
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const pad = (n) => String(n).padStart(2, '0')
const localDateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const atTime = (dateKey, time) => new Date(`${dateKey}T${time}:00`).getTime()
const fmtTime = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const fmtDuration = (minutes) => minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`
const relativeLabel = (timestamp, now) => {
  const delta = timestamp - now
  if (Math.abs(delta) < 60_000) return 'Now'
  const mins = Math.round(Math.abs(delta) / 60_000)
  if (delta > 0) return mins < 60 ? `In ${mins} min` : `In ${Math.floor(mins / 60)}h ${mins % 60}m`
  return mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}
function initialData() {
  const today = localDateKey()
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (parsed?.version === 1 && Array.isArray(parsed.tasks)) {
      // Keep user-created tasks, reminders, and history; never inject demo tasks.
      return {
        ...parsed,
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        settings: {
          soundEnabled: true, startSound: 'soft-chime', endSound: 'double-bell',
          reminderSound: 'woodblock', alarmVolume: 65, musicVolume: 28, ambient: 'rain',
          strictMode: true, autoStartNext: false, accent: 'amber', theme: 'dark', notificationsEnabled: false,
          ...parsed.settings,
          musicEnabled: false,
        },
        tasks: parsed.tasks.filter(t => !String(t.id).startsWith('seed-')),
      }
    }
  } catch { /* start fresh when storage is unavailable or invalid */ }
  return {
    version: 1,
    tasks: [],
    sessions: [],
    events: [],
    reminders: [],
    dayNotes: {},
    settings: {
      startSound: 'soft-chime', endSound: 'double-bell', reminderSound: 'woodblock',
      alarmVolume: 65, musicVolume: 28, soundEnabled: true, musicEnabled: false,
      ambient: 'rain', strictMode: true, autoStartNext: false, accent: 'amber', theme: 'dark', notificationsEnabled: false,
    },
    activeSessionId: null,
  }
}

function useAudio() {
  const ctxRef = useRef(null)
  const noiseRef = useRef(null)
  const musicRef = useRef([])
  const ensureContext = useCallback(() => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) ctxRef.current = new Ctx()
    }
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])
  const tone = useCallback((frequency, start, duration, type = 'sine', gain = 0.1, endFrequency = null) => {
    const ctx = ensureContext(); if (!ctx) return
    const osc = ctx.createOscillator(); const amp = ctx.createGain()
    osc.type = type; osc.frequency.setValueAtTime(frequency, ctx.currentTime + start)
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + start + duration)
    amp.gain.setValueAtTime(0.0001, ctx.currentTime + start)
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), ctx.currentTime + start + 0.025)
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration)
    osc.connect(amp); amp.connect(ctx.destination)
    osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + duration + 0.03)
  }, [ensureContext])
  const playSound = useCallback((name = 'soft-chime', volume = 65) => {
    const v = Math.max(0, Math.min(100, volume)) / 100 * 0.22
    const sounds = {
      'soft-chime': [[660, 0, .48, 'sine', .7], [880, .13, .58, 'sine', .48]],
      'double-bell': [[740, 0, .55, 'sine', .75], [740, .32, .62, 'sine', .72], [988, .72, .9, 'sine', .52]],
      'woodblock': [[520, 0, .11, 'triangle', .8], [520, .19, .11, 'triangle', .8]],
      'digital-pulse': [[880, 0, .12, 'square', .24], [660, .17, .12, 'square', .24], [880, .34, .12, 'square', .24]],
      'long-bell': [[587, 0, 1.3, 'sine', .65], [880, .12, 1.1, 'sine', .35]],
      'gentle': [[440, 0, .55, 'sine', .5], [554, .16, .65, 'sine', .35]],
      'ascending-chime': [[523.25, 0, .42, 'sine', .55], [659.25, .18, .46, 'sine', .58], [783.99, .36, .62, 'sine', .62]],
      'soft-bell': [[783.99, 0, .72, 'sine', .46], [1046.5, .12, .82, 'sine', .34], [1318.5, .28, .9, 'sine', .22]],
    }
    ;(sounds[name] || sounds['soft-chime']).forEach(([f, s, d, t, g]) => tone(f, s, d, t, v * g))
  }, [tone])
  const stopMusic = useCallback(() => {
    const ctx = ctxRef.current
    musicRef.current.forEach(node => { try { node.stop?.(); node.disconnect?.() } catch {} })
    musicRef.current = []
    if (noiseRef.current) { try { noiseRef.current.stop(); noiseRef.current.disconnect() } catch {}; noiseRef.current = null }
    if (ctx) { /* context remains warm for quick restart */ }
  }, [])
  const startMusic = useCallback((kind = 'rain', volume = 28) => {
    stopMusic()
    const ctx = ensureContext(); if (!ctx) return
    const out = ctx.createGain(); out.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.10; out.connect(ctx.destination)
    if (kind === 'tone') {
      ;[110, 164.81, 220].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain(); const filter = ctx.createBiquadFilter()
        osc.type = 'sine'; osc.frequency.value = freq; filter.type = 'lowpass'; filter.frequency.value = 550
        gain.gain.value = [0.45, 0.24, 0.16][i]; osc.connect(filter); filter.connect(gain); gain.connect(out); osc.start()
        musicRef.current.push(osc, gain, filter)
      })
    } else {
      const bufferSize = 2 * ctx.sampleRate
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      let last = 0
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1
        if (kind === 'brown') { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5 }
        else if (kind === 'rain') { data[i] = white * (Math.random() > 0.91 ? 0.7 : 0.14) }
        else data[i] = white * 0.18
      }
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true
      const filter = ctx.createBiquadFilter(); filter.type = kind === 'rain' ? 'lowpass' : 'lowpass'; filter.frequency.value = kind === 'rain' ? 3200 : kind === 'white' ? 7000 : 900
      source.connect(filter); filter.connect(out); source.start()
      musicRef.current.push(source, filter)
    }
    musicRef.current.push(out)
  }, [ensureContext, stopMusic])
  useEffect(() => () => stopMusic(), [stopMusic])
  return { playSound, startMusic, stopMusic, enable: ensureContext }
}

const publicAsset = (name) => `${import.meta.env.BASE_URL || '/'}${name}`

function App() {
  const [data, setData] = useState(initialData)
  const [page, setPage] = useState('Today')
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => localDateKey())
  const [now, setNow] = useState(Date.now())
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [availableUpdate, setAvailableUpdate] = useState(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateReadyToRestart, setUpdateReadyToRestart] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateStatus, setUpdateStatus] = useState('idle')
  const [focusFullscreen, setFocusFullscreen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingTask, setEditingTask] = useState(null)
  const [outcomeTask, setOutcomeTask] = useState(null)
  const [newTask, setNewTask] = useState({ title: '', category: 'Deep work', date: localDateKey(), start: '13:00', duration: 60, priority: 'medium', notes: '' })
  const [musicOn, setMusicOn] = useState(Boolean(data.settings?.musicEnabled))
  const [audioReady, setAudioReady] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window === 'undefined' || !('Notification' in window) ? 'unsupported' : window.Notification.permission
  )
  const audio = useAudio()
  const toastTimer = useRef(null)
  const processedReminderIds = useRef(new Set())
  const activeSession = data.sessions.find(s => s.id === data.activeSessionId) || null
  const activeTask = activeSession ? data.tasks.find(t => t.id === activeSession.taskId) : null
  const todayKey = localDateKey(new Date(now))
  const todayTasks = useMemo(() => data.tasks.filter(t => t.date === todayKey).sort((a, b) => a.start.localeCompare(b.start)), [data.tasks, todayKey])
  const sessionsToday = data.sessions.filter(s => s.date === todayKey)
  const completedToday = todayTasks.filter(t => t.outcome === 'completed').length
  const scheduledMinutes = todayTasks.reduce((sum, t) => sum + Math.max(0, (atTime(t.date, t.end) - atTime(t.date, t.start)) / 60000), 0)
  const activeSecondsToday = sessionsToday.reduce((sum, s) => sum + (s.activeSeconds || 0), 0)
  const progressPercent = scheduledMinutes ? Math.min(100, Math.round(completedToday / Math.max(1, todayTasks.length) * 100)) : 0
  const activeRemaining = activeSession ? Math.max(0, Math.ceil((activeSession.scheduledEnd - now) / 1000)) : 0

  useEffect(() => {
    const monogramUrl = new URL(publicAsset('Tfsmalogo.png'), window.location.origin).href
    const fullLogoUrl = new URL(publicAsset('Tfbiglogo.png'), window.location.origin).href
    document.title = 'TIMEFRAME — Make Time Intentional'

    const upsertMeta = (attribute, key, content) => {
      let tag = document.head.querySelector(`meta[${attribute}="${key}"]`)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attribute, key)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }
    const upsertLink = (rel, href) => {
      let tag = document.head.querySelector(`link[rel="${rel}"]`)
      if (!tag) {
        tag = document.createElement('link')
        tag.rel = rel
        document.head.appendChild(tag)
      }
      tag.href = href
    }

    upsertLink('icon', monogramUrl)
    upsertLink('apple-touch-icon', monogramUrl)
    upsertMeta('name', 'description', 'TIMEFRAME helps you plan your day, focus on meaningful work, and make time intentional.')
    upsertMeta('name', 'theme-color', '#0D1117')
    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:site_name', 'TIMEFRAME')
    upsertMeta('property', 'og:title', 'TIMEFRAME — Make Time Intentional')
    upsertMeta('property', 'og:description', 'Plan your day, focus on meaningful work, and make time intentional.')
    upsertMeta('property', 'og:image', fullLogoUrl)
    upsertMeta('property', 'og:image:alt', 'TIMEFRAME — Make Time Intentional logo')
    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', 'TIMEFRAME — Make Time Intentional')
    upsertMeta('name', 'twitter:description', 'Plan your day, focus on meaningful work, and make time intentional.')
    upsertMeta('name', 'twitter:image', fullLogoUrl)
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => { document.documentElement.dataset.accent = data.settings?.accent || 'amber' }, [data.settings?.accent])
  useEffect(() => { document.documentElement.dataset.theme = data.settings?.theme === 'light' ? 'light' : 'dark' }, [data.settings?.theme])
  useEffect(() => { setMusicOn(Boolean(data.settings?.musicEnabled)) }, [data.settings?.musicEnabled])
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { showToast('Could not save locally. Export a backup before continuing.', 'error') }
  }, [data])
  useEffect(() => {
    if (!activeSession) return
    if (now >= activeSession.scheduledEnd) {
      setData(prev => {
        const s = prev.sessions.find(x => x.id === prev.activeSessionId)
        if (!s || s.status !== 'running') return prev
        const endAt = s.scheduledEnd
        const elapsed = Math.max(0, Math.floor((endAt - s.actualStart - (s.pausedTotalMs || 0) - (s.pausedAt ? endAt - s.pausedAt : 0)) / 1000))
        const updatedSessions = prev.sessions.map(x => x.id === s.id ? { ...x, status: 'ended', actualEnd: endAt, activeSeconds: elapsed, endedReason: 'scheduled-end' } : x)
        const updatedTasks = prev.tasks.map(t => t.id === s.taskId ? { ...t, status: 'awaiting-outcome' } : t)
        return { ...prev, sessions: updatedSessions, tasks: updatedTasks, activeSessionId: null, events: [...prev.events, { id: uid(), sessionId: s.id, type: 'ended', timestamp: endAt, detail: 'scheduled-end' }] }
      })
      if (data.settings.soundEnabled) audio.playSound(data.settings.endSound, data.settings.alarmVolume)
      showBrowserNotification('Focus block complete', `${activeTask?.title || 'Your planned work'} has reached its scheduled end. Review the outcome in TIMEFRAME.`, `timeframe-task-${activeSession.taskId}`)
      setOutcomeTask(activeTask)
      setPage('Focus')
      showToast('Focus block finished. Review your outcome.', 'success')
    }
  }, [now, activeSession?.id, activeSession?.status, activeSession?.scheduledEnd])
  useEffect(() => {
    const reminders = Array.isArray(data.reminders) ? data.reminders : []
    const due = reminders.filter(reminder => reminder.enabled !== false && !reminder.firedAt && !processedReminderIds.current.has(reminder.id) && atTime(reminder.date, reminder.time) <= now)
    if (!due.length) return

    const firedAt = Date.now()
    due.forEach(reminder => processedReminderIds.current.add(reminder.id))
    const dueIds = new Set(due.map(reminder => reminder.id))
    setData(prev => ({
      ...prev,
      reminders: (prev.reminders || []).map(reminder => {
        if (!dueIds.has(reminder.id)) return reminder
        const overdueMs = firedAt - atTime(reminder.date, reminder.time)
        return { ...reminder, firedAt, deliveryStatus: overdueMs <= 15 * 60_000 ? 'sent' : 'missed' }
      }),
    }))

    const deliverable = due.filter(reminder => firedAt - atTime(reminder.date, reminder.time) <= 15 * 60_000)
    due.filter(reminder => !deliverable.includes(reminder)).forEach(reminder => {
      console.info(`TIMEFRAME reminder missed while the app was inactive: ${reminder.title}`)
    })
    if (deliverable.length) {
      showToast(deliverable.length === 1 ? `Reminder: ${deliverable[0].title}` : `${deliverable.length} planned-work reminders are due`)
      if (data.settings.soundEnabled) audio.playSound(deliverable[0].sound || data.settings.reminderSound, data.settings.alarmVolume)
      deliverable.forEach(reminder => showBrowserNotification('TIMEFRAME work reminder', reminder.title, `timeframe-reminder-${reminder.id}`))
    }
  }, [now, data.reminders])
  useEffect(() => {
    const onFs = () => setFocusFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector('#global-search')?.focus() }
      if (e.key === 'Escape' && modal) setModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  function showToast(message, type = 'success') {
    setToast({ message, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }
  function showBrowserNotification(title, body, tag = 'timeframe-alert') {
    if (!data.settings?.notificationsEnabled || typeof window === 'undefined' || !('Notification' in window) || window.Notification.permission !== 'granted') return
    try {
      const notification = new window.Notification(title, { body, tag })
      notification.onclick = () => { window.focus(); notification.close() }
    } catch (error) {
      console.warn('TIMEFRAME could not display a browser notification:', error)
    }
  }
  async function enableBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      showToast('This browser does not support notifications. In-app alerts and sounds will still work.', 'error')
      return
    }
    audio.enable()
    setAudioReady(true)
    try {
      const permission = window.Notification.permission === 'default'
        ? await window.Notification.requestPermission()
        : window.Notification.permission
      setNotificationPermission(permission)
      updateSettings({ notificationsEnabled: permission === 'granted' })
      showToast(permission === 'granted' ? 'Browser notifications enabled.' : 'Notifications are blocked. Allow them in your browser site settings.', permission === 'granted' ? 'success' : 'error')
    } catch {
      showToast('Could not request notification permission in this browser.', 'error')
    }
  }
  function addCalendarReminder(title, date, time) {
    const cleanTitle = String(title || '').trim()
    if (!cleanTitle || !date || !time) { showToast('Enter a reminder name and time.', 'error'); return }
    const dueAt = atTime(date, time)
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) { showToast('Choose a future reminder time.', 'error'); return }
    const reminder = { id: uid(), title: cleanTitle, date, time, sound: data.settings?.reminderSound || 'woodblock', enabled: true, firedAt: null, deliveryStatus: 'scheduled', createdAt: Date.now() }
    setData(prev => ({ ...prev, reminders: [...(prev.reminders || []), reminder].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)) }))
    audio.enable()
    setAudioReady(true)
    showToast(`Reminder set for ${new Date(`${date}T${time}:00`).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
    return true
  }
  function deleteCalendarReminder(id) {
    setData(prev => ({ ...prev, reminders: (prev.reminders || []).filter(reminder => reminder.id !== id) }))
    showToast('Reminder removed')
  }
  async function checkForAppUpdates({ manual = false } = {}) {
    if (!window.__TAURI_INTERNALS__) {
      if (manual) showToast('Update checks are available in the installed desktop app.', 'error')
      return
    }
    if (isCheckingUpdate || isInstallingUpdate) return
    setIsCheckingUpdate(true)
    setUpdateStatus('checking')
    try {
      const update = await check()
      if (update) {
        setAvailableUpdate(update)
        setUpdateStatus('available')
        if (manual) showToast(`TIMEFRAME ${update.version} is available.`)
      } else {
        setAvailableUpdate(null)
        setUpdateStatus('up-to-date')
        if (manual) showToast('You’re using the latest version of TIMEFRAME.')
      }
    } catch (error) {
      console.error('TIMEFRAME update check failed:', error)
      setUpdateStatus('error')
      if (manual) showToast('Could not check for updates. Check your internet connection and try again.', 'error')
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  async function installAppUpdate() {
    if (!availableUpdate || isInstallingUpdate) return
    setIsInstallingUpdate(true)
    setUpdateProgress(0)
    setUpdateStatus('downloading')
    try {
      let contentLength = 0
      let downloaded = 0
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0
          setUpdateProgress(0)
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (contentLength > 0) setUpdateProgress(Math.min(100, Math.round(downloaded / contentLength * 100)))
        } else if (event.event === 'Finished') {
          setUpdateProgress(100)
        }
      })
      setUpdateReadyToRestart(true)
      setUpdateStatus('ready')
      showToast('Update installed. Restart TIMEFRAME when you’re ready.')
    } catch (error) {
      console.error('TIMEFRAME update installation failed:', error)
      setUpdateStatus('error')
      showToast('Update installation failed. Please try again later.', 'error')
    } finally {
      setIsInstallingUpdate(false)
    }
  }

  async function restartForUpdate() {
    if (activeSession) {
      showToast('Finish or safely end your active focus session before restarting.', 'error')
      return
    }
    try {
      await relaunch()
    } catch (error) {
      console.error('TIMEFRAME restart failed:', error)
      showToast('Could not restart automatically. Close and reopen TIMEFRAME to finish updating.', 'error')
    }
  }

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return
    const timer = window.setTimeout(() => {
      checkForAppUpdates()
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [])
  function updateSettings(patch) { setData(prev => ({ ...prev, settings: { ...prev.settings, ...patch } })) }
  function saveDayNote(date, note) { setData(prev => ({ ...prev, dayNotes: { ...(prev.dayNotes || {}), [date]: note } })) }
  function addEvent(sessionId, type, detail = '') { setData(prev => ({ ...prev, events: [...prev.events, { id: uid(), sessionId, type, timestamp: Date.now(), detail }] })) }
  function startSession(task) {
    if (!task) return
    if (data.activeSessionId) { showToast('Finish or pause the active session first.', 'error'); return }
    const startAt = Date.now()
    const scheduledEnd = atTime(task.date, task.end)
    if (scheduledEnd <= startAt) {
      setEditingTask(task); setModal('reschedule'); return
    }
    const session = {
      id: uid(), taskId: task.id, date: task.date, status: 'running', actualStart: startAt,
      scheduledStart: atTime(task.date, task.start), scheduledEnd, pausedAt: null, pausedTotalMs: 0,
      activeSeconds: 0, createdAt: startAt, events: [],
    }
    setData(prev => ({ ...prev, sessions: [...prev.sessions, session], activeSessionId: session.id, tasks: prev.tasks.map(t => t.id === task.id ? { ...t, status: 'active' } : t), events: [...prev.events, { id: uid(), sessionId: session.id, type: 'started', timestamp: startAt }] }))
    setPage('Focus')
    if (data.settings.soundEnabled) audio.playSound(data.settings.startSound, data.settings.alarmVolume)
    showToast(`Focus started · ${task.title}`)
  }
  function pauseSession() {
    if (!activeSession || activeSession.status !== 'running') return
    const t = Date.now()
    setData(prev => ({ ...prev, sessions: prev.sessions.map(s => s.id === activeSession.id ? { ...s, status: 'paused', pausedAt: t } : s), events: [...prev.events, { id: uid(), sessionId: activeSession.id, type: 'paused', timestamp: t }] }))
    showToast('Session paused')
  }
  function resumeSession() {
    if (!activeSession || activeSession.status !== 'paused') return
    const t = Date.now(); const delta = t - activeSession.pausedAt
    setData(prev => ({ ...prev, sessions: prev.sessions.map(s => s.id === activeSession.id ? { ...s, status: 'running', pausedAt: null, pausedTotalMs: (s.pausedTotalMs || 0) + delta } : s), events: [...prev.events, { id: uid(), sessionId: activeSession.id, type: 'resumed', timestamp: t }] }))
    showToast('Back to focus')
  }
  function endSession(early = false, reason = '') {
    if (!activeSession) return
    const t = Date.now()
    const endAt = Math.min(t, activeSession.scheduledEnd)
    const pausedNow = activeSession.pausedAt ? t - activeSession.pausedAt : 0
    const activeSeconds = Math.max(0, Math.floor((endAt - activeSession.actualStart - (activeSession.pausedTotalMs || 0) - pausedNow) / 1000))
    setData(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === activeSession.id ? { ...s, status: early ? 'interrupted' : 'ended', actualEnd: t, activeSeconds, endedReason: early ? 'user-ended-early' : 'user-ended', interruptionReason: early ? reason.trim() : '' } : s),
      tasks: prev.tasks.map(task => task.id === activeSession.taskId ? { ...task, status: early ? 'interrupted' : 'awaiting-outcome' } : task),
      activeSessionId: null,
      events: [...prev.events, { id: uid(), sessionId: activeSession.id, type: early ? 'interrupted' : 'ended', timestamp: t, detail: early ? reason.trim() : '' }],
    }))
    const task = data.tasks.find(tk => tk.id === activeSession.taskId)
    setOutcomeTask(task || null); setModal(null)
    if (!early) setPage('Focus')
    else showToast('Session ended early and recorded as interrupted', 'error')
  }
  function saveOutcome(outcome) {
    if (!outcomeTask) return
    setData(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === outcomeTask.id ? { ...t, outcome, status: outcome } : t) }))
    setOutcomeTask(null); showToast(`Outcome recorded: ${outcome.replace('-', ' ')}`)
  }
  function saveTask(e) {
    e.preventDefault()
    if (!newTask.title.trim()) return
    const startM = Number(newTask.start.split(':')[0]) * 60 + Number(newTask.start.split(':')[1])
    const endM = startM + Number(newTask.duration)
    if (endM > 24 * 60) { showToast('Task must end before midnight. Split it into two blocks.', 'error'); return }
    const end = `${pad(Math.floor(endM / 60))}:${pad(endM % 60)}`
    const taskDate = newTask.date || editingTask?.date || todayKey
    const task = { id: editingTask?.id || uid(), date: taskDate, start: newTask.start, end, title: newTask.title.trim(), category: newTask.category, priority: newTask.priority, notes: newTask.notes, status: editingTask?.status || 'upcoming', outcome: editingTask?.outcome || null, createdAt: editingTask?.createdAt || Date.now() }
    const conflict = data.tasks.find(t => t.date === task.date && t.id !== task.id && atTime(t.date, task.start) < atTime(t.date, t.end) && atTime(t.date, task.end) > atTime(t.date, t.start))
    setData(prev => ({ ...prev, tasks: (editingTask ? prev.tasks.map(t => t.id === task.id ? task : t) : [...prev.tasks, task]).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)) }))
    setNewTask({ title: '', category: 'Deep work', date: todayKey, start: '13:00', duration: 60, priority: 'medium', notes: '' }); setEditingTask(null); setModal(null)
    showToast(conflict ? `Task saved · overlaps with “${conflict.title}”` : editingTask ? 'Task updated' : 'Task added to your plan', conflict ? 'warning' : 'success')
  }
  function deleteTask(id) {
    if (data.activeSessionId && activeSession?.taskId === id) { showToast('End the active session before deleting this task.', 'error'); return }
    setData(prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== id) })); setModal(null); showToast('Task removed')
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => showToast('Fullscreen is not available in this browser.', 'error'))
    else document.exitFullscreen?.()
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `timeframe-backup-${todayKey}.json`; a.click(); URL.revokeObjectURL(url); showToast('Backup exported')
  }
  function importData(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => { try { const parsed = JSON.parse(String(reader.result || '')); if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.sessions)) throw new Error(); setData({ ...initialData(), ...parsed, settings: { ...initialData().settings, ...parsed.settings, musicEnabled: false }, version: 1 }); showToast('Backup restored') } catch { showToast('That backup file is not valid.', 'error') } }
    reader.readAsText(file); e.target.value = ''
  }
  const filteredTasks = todayTasks.filter(t => `${t.title} ${t.category}`.toLowerCase().includes(searchTerm.toLowerCase()))
  const currentNextTask = todayTasks.find(t => !['completed', 'partially-completed', 'not-completed', 'skipped'].includes(t.status) && atTime(t.date, t.end) > now && (!activeTask || t.id !== activeTask.id))
  const greeting = new Date(now).getHours() < 12 ? 'Good morning' : new Date(now).getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className={`app-shell ${focusFullscreen ? 'fullscreen-active' : ''} ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
      {!focusFullscreen && <Sidebar
        page={page}
        setPage={(nextPage) => {
          setPage(nextPage)
          // Only close/collapse after selecting a destination from the mobile drawer.
          // On desktop, keep the expanded sidebar open while navigating.
          if (mobileMenuOpen) {
            setMobileMenuOpen(false)
            setCollapsed(true)
          }
        }}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileMenuOpen}
        onOpenMenu={() => {
          setCollapsed(false)
          const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
          setMobileMenuOpen(isMobile)
        }}
      />}
      {!focusFullscreen && mobileMenuOpen && <button type="button" className="mobile-sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation menu" />}
      <main className="main-shell">
        {!focusFullscreen && <Topbar page={page} now={now} searchTerm={searchTerm} setSearchTerm={setSearchTerm} onMenu={() => { setCollapsed(false); setMobileMenuOpen(typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) }} onSettings={() => setPage('Settings')} onNew={() => { setEditingTask(null); setNewTask({ title: '', category: 'Deep work', date: todayKey, start: '13:00', duration: 60, priority: 'medium', notes: '' }); setModal('new-task') }} />}
        <AnimatePresence mode="wait">
          {page === 'Today' && !focusFullscreen && <PageFrame key="today"><TodayPage {...{ now, greeting, todayTasks: filteredTasks, allTasks: todayTasks, activeSession, activeTask, currentNextTask, completedToday, scheduledMinutes, activeSecondsToday, progressPercent, startSession, setPage, setModal, setEditingTask, setNewTask, setOutcomeTask, data, searchTerm }} /></PageFrame>}
          {page === 'Plan' && !focusFullscreen && <PageFrame key="plan"><PlanPage tasks={filteredTasks} now={now} setModal={setModal} setNewTask={setNewTask} setEditingTask={setEditingTask} startSession={startSession} activeSession={activeSession} deleteTask={deleteTask} /></PageFrame>}
          {page === 'Calendar' && !focusFullscreen && <PageFrame key="calendar"><CalendarPage data={data} month={calendarMonth} setMonth={setCalendarMonth} selectedDate={selectedDate} setSelectedDate={setSelectedDate} now={now} onSaveDayNote={saveDayNote} onAddReminder={addCalendarReminder} onDeleteReminder={deleteCalendarReminder} notificationPermission={notificationPermission} onEnableNotifications={enableBrowserNotifications} /></PageFrame>}
          {page === 'Focus' && <PageFrame key="focus" className={focusFullscreen ? 'focus-fullscreen-frame' : ''}><FocusPage {...{ activeSession, activeTask, activeRemaining, now, todayTasks, startSession, pauseSession, resumeSession, endSession, toggleFullscreen, focusFullscreen, data, setPage, setModal, setOutcomeTask, outcomeTask, saveOutcome, audio, musicOn, setMusicOn, audioReady, setAudioReady, updateSettings, showToast }} /></PageFrame>}
          {page === 'Insights' && !focusFullscreen && <PageFrame key="insights"><InsightsPage tasks={todayTasks} sessions={sessionsToday} allSessions={data.sessions} now={now} completedToday={completedToday} scheduledMinutes={scheduledMinutes} activeSecondsToday={activeSecondsToday} /></PageFrame>}
          {page === 'Settings' && !focusFullscreen && <PageFrame key="settings"><SettingsPage data={data} updateSettings={updateSettings} audio={audio} setAudioReady={setAudioReady} audioReady={audioReady} exportData={exportData} importData={importData} showToast={showToast} availableUpdate={availableUpdate} isCheckingUpdate={isCheckingUpdate} isInstallingUpdate={isInstallingUpdate} updateReadyToRestart={updateReadyToRestart} updateProgress={updateProgress} updateStatus={updateStatus} checkForAppUpdates={checkForAppUpdates} installAppUpdate={installAppUpdate} restartForUpdate={restartForUpdate} activeSession={activeSession} /></PageFrame>}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {modal === 'new-task' && <TaskModal key={editingTask?.id || 'new'} task={newTask} setTask={setNewTask} onClose={() => { setModal(null); setEditingTask(null) }} onSave={saveTask} editing={Boolean(editingTask)} />}
        {modal === 'end-session' && <EmergencyEndModal key="end" taskTitle={activeTask?.title || 'this task'} onClose={() => setModal(null)} onConfirm={(reason) => endSession(true, reason)} />}
        {modal === 'reschedule' && <ConfirmModal key="reschedule" title="This time block has ended" description={`“${editingTask?.title || 'This task'}” is scheduled for a time that has already passed. Edit the block to schedule it for later.`} confirm="Edit task" onClose={() => setModal(null)} onConfirm={() => { setModal('new-task'); if (editingTask) setNewTask({ title: editingTask.title, category: editingTask.category, date: editingTask.date || todayKey, start: '13:00', duration: 60, priority: editingTask.priority, notes: editingTask.notes || '' }) }} />}
        {modal === 'delete-task' && <ConfirmModal key="delete" title="Delete this task?" description="This removes the task from your plan. Existing session history is retained." confirm="Delete task" danger onClose={() => setModal(null)} onConfirm={() => editingTask && deleteTask(editingTask.id)} />}
      </AnimatePresence>
      <AnimatePresence>{toast && <motion.div className={`toast toast-${toast.type}`} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .18 }} role="status"><span className="toast-icon">{toast.type === 'error' ? <CircleHelp size={16} /> : <Check size={16} />}</span>{toast.message}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></motion.div>}</AnimatePresence>
      {outcomeTask && !activeSession && <OutcomePanel task={outcomeTask} onChoose={saveOutcome} onClose={() => setOutcomeTask(null)} />}
    </div>
  )
}

function PageFrame({ children, className = '' }) {
  return <motion.section className={`page-frame ${className}`} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .2, ease: [0.2, 0, 0, 1] }}>{children}</motion.section>
}

function Sidebar({ page, setPage, collapsed, setCollapsed, mobileOpen, onOpenMenu }) {
  const nav = [{ name: 'Today', icon: Home }, { name: 'Plan', icon: CalendarDays }, { name: 'Calendar', icon: CalendarDays }, { name: 'Focus', icon: Focus }, { name: 'Insights', icon: AudioLines }]
  return <motion.aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'mobile-sidebar-open' : ''}`} animate={{ width: collapsed ? 76 : 232 }} transition={{ duration: .22, ease: [0.2, 0, 0, 1] }}>
    <div className="brand-row">
      <img
        className={`brand-logo ${collapsed ? 'brand-logo-mark' : 'brand-logo-full'}`}
        src={publicAsset(collapsed ? 'Tfsmalogo.png' : 'Tfbiglogo.png')}
        alt="TIMEFRAME — Make time intentional"
        draggable="false"
      />
      {!collapsed && <button className="icon-button sidebar-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar"><Menu size={17} /></button>}
    </div>
    {collapsed && <button type="button" className="sidebar-rail-menu" onClick={onOpenMenu} aria-label="Open sidebar navigation" title="Open menu"><Menu size={20} /></button>}
    <nav className="side-nav" aria-label="Main navigation">{nav.map(item => { const Icon = item.icon; const active = page === item.name; return <button key={item.name} className={`nav-item ${active ? 'active' : ''}`} onClick={() => setPage(item.name)} title={collapsed ? item.name : undefined}><Icon size={18} strokeWidth={active ? 2.2 : 1.8} /><AnimatePresence>{!collapsed && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{item.name}</motion.span>}</AnimatePresence>{active && <motion.i layoutId="nav-indicator" className="nav-indicator" />}</button> })}</nav>
    {!collapsed && <div className="sidebar-bottom"><button className={`nav-item ${page === 'Settings' ? 'active' : ''}`} onClick={() => setPage('Settings')}><Settings2 size={18} /><span>Settings</span></button></div>}
    {collapsed && <button className="collapsed-settings" onClick={() => setPage('Settings')} title="Settings"><Settings2 size={18} /></button>}
  </motion.aside>
}

function Topbar({ page, now, searchTerm, setSearchTerm, onMenu, onSettings, onNew }) {
  const date = new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  return <header className="topbar"><div className="breadcrumbs"><span>TIMEFRAME</span><span className="crumb-slash">/</span><strong>{page}</strong></div><div className="topbar-right"><div className="topbar-date"><span className="date-mark" />{date}</div><button className="icon-button topbar-settings" onClick={onSettings} aria-label="Open settings" title="Settings"><Settings2 size={19} /></button></div></header>
}

function SectionTitle({ eyebrow, title, description, right }) { return <div className="section-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{right && <div className="section-title-right">{right}</div>}</div> }
function MetricCard({ icon: Icon, label, value, suffix, note, trend, accent = false }) { return <motion.div className={`metric-card ${accent ? 'metric-accent' : ''}`} whileHover={{ y: -2, transition: { duration: .16 } }}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={16} /></span></div><div className="metric-value">{value}<small>{suffix}</small></div><div className="metric-bottom">{trend && <span className={`metric-trend ${trend.startsWith('-') ? 'trend-down' : ''}`}>{trend.startsWith('-') ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{trend}</span>}<span>{note}</span></div></motion.div> }

function TodayPage({ now, greeting, todayTasks, allTasks, activeSession, activeTask, currentNextTask, completedToday, scheduledMinutes, activeSecondsToday, progressPercent, startSession, setPage, setModal, setEditingTask, setNewTask, setOutcomeTask, data, searchTerm }) {
  const todayKey = localDateKey(new Date(now))
  const nextTask = currentNextTask || allTasks.find(t => t.status === 'upcoming')
  const dateLabel = new Date(now).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
  const total = allTasks.length
  const done = allTasks.filter(t => ['completed', 'partially-completed', 'not-completed', 'skipped'].includes(t.status)).length
  const conflicts = allTasks.filter(t => allTasks.some(o => o.id !== t.id && atTime(o.date, t.start) < atTime(t.date, o.end) && atTime(o.date, t.end) > atTime(t.date, o.start))).length
  return <div className="page-content">
    <SectionTitle eyebrow={dateLabel.toUpperCase()} title={`${greeting}. Let's make it count.`} description="A little structure creates room for your best work." right={<button className="button button-primary" onClick={() => { setEditingTask(null); setNewTask({ title: '', category: 'Deep work', date: todayKey, start: '13:00', duration: 60, priority: 'medium', notes: '' }); setModal('new-task') }}><Plus size={16} /> Add task</button>} />
    <div className="metrics-grid"><MetricCard icon={ListChecks} label="Tasks planned" value={total} note={`${done} reviewed so far`} /><MetricCard icon={Clock3} label="Time blocked" value={fmtDuration(Math.round(scheduledMinutes))} note="Across today's plan" /><MetricCard icon={Zap} label="Focus time" value={`${Math.floor(activeSecondsToday / 3600)}h ${Math.floor(activeSecondsToday % 3600 / 60)}m`} note="Active timer time" accent /><MetricCard icon={CheckCheck} label="Daily progress" value={progressPercent} suffix="%" note={`${completedToday} tasks completed`} /></div>
    <div className="today-grid">
      <div className="main-column">
        <div className="panel current-panel">
          <div className="panel-heading"><div><span className="eyebrow">RIGHT NOW</span><h2>{activeTask ? 'You’re in the zone.' : 'Your next focus block'}</h2></div><span className={`live-pill ${activeTask ? 'live' : ''}`}><i />{activeTask ? 'IN SESSION' : 'UP NEXT'}</span></div>
          {activeTask ? <div className="current-task-content"><div className="current-task-copy"><div className="task-category"><span className="category-dot" style={{ background: categoryColor(activeTask.category) }} />{activeTask.category}</div><h3>{activeTask.title}</h3><p>Scheduled until {fmtTime(activeSession.scheduledEnd)}</p><button className="button button-primary" onClick={() => setPage('Focus')}>Return to focus <ArrowRight size={15} /></button></div><MiniCountdown session={activeSession} now={now} /></div> : nextTask ? <div className="current-task-content"><div className="current-task-copy"><div className="task-category"><span className="category-dot" style={{ background: categoryColor(nextTask.category) }} />{nextTask.category} <span className="inline-dot">·</span> {fmtTime(atTime(nextTask.date, nextTask.start))}</div><h3>{nextTask.title}</h3><p>{relativeLabel(atTime(nextTask.date, nextTask.start), now)} · {fmtDuration((atTime(nextTask.date, nextTask.end) - atTime(nextTask.date, nextTask.start)) / 60000)} block</p><button className="button button-primary" onClick={() => startSession(nextTask)}><Play size={14} fill="currentColor" /> Start focus</button></div><div className="next-time"><span>BLOCK ENDS</span><strong>{fmtTime(atTime(nextTask.date, nextTask.end))}</strong><span className="next-time-line" /></div></div> : <div className="empty-state"><div className="empty-icon"><CheckCheck size={21} /></div><h3>Your schedule is clear</h3><p>Add a task to give your next hour a purpose.</p><button className="button button-secondary" onClick={() => { setEditingTask(null); setNewTask({ title: '', category: 'Deep work', date: todayKey, start: '13:00', duration: 60, priority: 'medium', notes: '' }); setModal('new-task') }}><Plus size={15} /> Add a task</button></div>}
          <div className="current-panel-footer"><span><span className="status-dot" /> Your schedule stays fixed</span><button className="text-button" onClick={() => setPage('Focus')}>Open Focus <ArrowRight size={13} /></button></div>
        </div>
        <div className="panel timeline-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR DAY</span><h2>Schedule <span className="count-badge">{allTasks.length}</span></h2></div><button className="button button-quiet button-sm" onClick={() => setPage('Plan')}>View plan <ArrowRight size={14} /></button></div><div className="timeline">{todayTasks.length ? todayTasks.map(task => <TaskRow key={task.id} task={task} now={now} active={activeTask?.id === task.id} onStart={() => startSession(task)} onEdit={() => { setEditingTask(task); setNewTask({ title: task.title, category: task.category, date: task.date, start: task.start, duration: (atTime(task.date, task.end) - atTime(task.date, task.start)) / 60000, priority: task.priority, notes: task.notes || '' }); setModal('new-task') }} onOutcome={() => setOutcomeTask(task)} />) : <div className="empty-search">No tasks match “{searchTerm}”.</div>}</div><button className="timeline-add" onClick={() => { setEditingTask(null); setNewTask({ title: '', category: 'Deep work', date: todayKey, start: '13:00', duration: 60, priority: 'medium', notes: '' }); setModal('new-task') }}><Plus size={14} /> Add a time block</button></div>
      </div>
      <aside className="right-column"><div className="panel day-progress-panel"><div className="panel-heading"><div><span className="eyebrow">DAILY RHYTHM</span><h2>Progress</h2></div><MoreHorizontal size={18} className="muted-icon" /></div><div className="progress-ring-wrap"><svg viewBox="0 0 140 140" className="progress-ring"><circle cx="70" cy="70" r="58" className="ring-track" /><circle cx="70" cy="70" r="58" className="ring-progress" strokeDasharray={`${2 * Math.PI * 58}`} strokeDashoffset={`${2 * Math.PI * 58 * (1 - progressPercent / 100)}`} /></svg><div className="ring-label"><strong>{progressPercent}%</strong><span>reviewed</span></div></div><div className="progress-legend"><div><span className="legend-dot done-dot" /><span>Reviewed tasks</span><strong>{done}</strong></div><div><span className="legend-dot planned-dot" /><span>Still planned</span><strong>{Math.max(0, total - done)}</strong></div></div><div className="progress-note"><Sparkles size={14} /><span>Progress reflects task outcomes, not just timer activity.</span></div></div>
        <div className="panel next-panel"><div className="panel-heading"><div><span className="eyebrow">COMING UP</span><h2>Next block</h2></div><Clock3 size={17} className="muted-icon" /></div>{nextTask ? <><div className="next-task-time">{fmtTime(atTime(nextTask.date, nextTask.start))}<span>→</span>{fmtTime(atTime(nextTask.date, nextTask.end))}</div><h3>{nextTask.title}</h3><div className="task-category"><span className="category-dot" style={{ background: categoryColor(nextTask.category) }} />{nextTask.category}</div><button className="button button-secondary button-full" onClick={() => startSession(nextTask)}><Play size={14} /> Start this block</button></> : <p className="muted-copy">Nothing else on your schedule.</p>}</div>
        <div className="tip-card"><div className="tip-icon"><Waves size={17} /></div><div><span className="eyebrow">A SMALL REMINDER</span><p>Protect the block, not the perfect outcome. Showing up counts.</p></div></div>
      </aside>
    </div>
  </div>
}

function MiniCountdown({ session, now }) {
  const remaining = Math.max(0, Math.ceil((session.scheduledEnd - now) / 1000))
  return <div className="mini-countdown"><span>TIME LEFT</span><strong>{pad(Math.floor(remaining / 3600))}:{pad(Math.floor(remaining % 3600 / 60))}:{pad(remaining % 60)}</strong><div className="mini-countdown-bar"><i style={{ width: `${Math.min(100, Math.max(0, remaining / Math.max(1, (session.scheduledEnd - session.actualStart) / 1000) * 100))}%` }} /></div></div>
}
function categoryColor(category) { return ({ 'Deep work': '#e8a65a', Learning: '#a78bfa', Admin: '#7db9e8', Health: '#82c8a0', Personal: '#d58ba7' })[category] || '#e8a65a' }
function taskState(task, active, now) {
  if (active) return 'Active'
  if (task.outcome === 'completed' || task.status === 'completed') return 'Completed'
  if (task.outcome === 'partially-completed' || task.status === 'partially-completed') return 'Partial'
  if (task.outcome === 'not-completed' || task.status === 'not-completed') return 'Not done'
  if (task.status === 'skipped') return 'Skipped'
  if (task.status === 'interrupted') return 'Interrupted'
  if (atTime(task.date, task.end) < now) return 'Needs review'
  if (atTime(task.date, task.start) <= now) return 'Ready'
  return 'Upcoming'
}
function TaskRow({ task, now, active, onStart, onEdit, onOutcome }) {
  const state = taskState(task, active, now)
  const start = atTime(task.date, task.start); const end = atTime(task.date, task.end)
  const past = end < now && !['Completed', 'Partial', 'Not done', 'Skipped'].includes(state)
  return <motion.div className={`task-row ${active ? 'task-row-active' : ''} ${past ? 'task-row-past' : ''}`} layout transition={{ duration: .2 }}><div className="task-time-col"><strong>{task.start}</strong><span>{task.end}</span></div><div className={`timeline-rail ${active ? 'rail-active' : ''}`}><span style={{ background: active ? 'var(--accent)' : categoryColor(task.category) }} /></div><div className="task-row-main"><div className="task-row-title-line"><h3>{task.title}</h3><span className={`state-pill state-${state.toLowerCase().replace(' ', '-')}`}>{state}</span></div><div className="task-row-meta"><span className="task-category"><i className="category-dot" style={{ background: categoryColor(task.category) }} />{task.category}</span><span className="meta-separator">·</span><span>{fmtDuration(Math.max(0, (end - start) / 60000))}</span>{task.priority === 'high' && <span className="priority-tag">High priority</span>}</div></div><div className="task-row-actions">{active ? <span className="active-now"><i />Running</span> : past ? <button className="row-action" onClick={onOutcome}>Review outcome</button> : <button className="row-action" onClick={onStart} disabled={['Completed', 'Partial', 'Not done', 'Skipped'].includes(state)}>{state === 'Upcoming' ? 'Start' : 'Start late'} <ArrowRight size={13} /></button>}<button className="row-more" onClick={onEdit} aria-label={`Edit ${task.title}`}><MoreHorizontal size={16} /></button></div></motion.div>
}

function PlanPage({ tasks, now, setModal, setNewTask, setEditingTask, startSession, activeSession, deleteTask }) {
  const todayKey = localDateKey(new Date(now))
  const [view, setView] = useState('Timeline')
  const grouped = tasks.reduce((acc, task) => { (acc[task.start] ||= []).push(task); return acc }, {})
  return <div className="page-content"><SectionTitle eyebrow="PLAN YOUR TIME" title="Your plan, your pace." description="Give every block a clear start, end, and intention." right={<button className="button button-primary" onClick={() => { setNewTask({ title: '', category: 'Deep work', date: todayKey, start: '13:00', duration: 60, priority: 'medium', notes: '' }); setModal('new-task') }}><Plus size={16} /> Create block</button>} />
    <div className="plan-toolbar"><div className="segmented-control"><button className={view === 'Timeline' ? 'selected' : ''} onClick={() => setView('Timeline')}>Timeline</button><button className={view === 'List' ? 'selected' : ''} onClick={() => setView('List')}>List</button></div><div className="plan-toolbar-right"><span className="muted-copy"><CalendarDays size={14} /> {new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span><button className="icon-button" title="Schedule settings"><SlidersHorizontal size={16} /></button></div></div>
    <div className="plan-summary-strip"><div><span className="eyebrow">TODAY'S BLOCKS</span><strong>{tasks.length}</strong></div><div><span className="eyebrow">PLANNED TIME</span><strong>{fmtDuration(tasks.reduce((s, t) => s + (atTime(t.date, t.end) - atTime(t.date, t.start)) / 60000, 0))}</strong></div><div><span className="eyebrow">SCHEDULE CHECK</span><strong className="good-status"><Check size={14} /> {findConflicts(tasks).length ? `${findConflicts(tasks).length} conflicts` : 'No conflicts'}</strong></div></div>
    {findConflicts(tasks).length > 0 && <div className="conflict-banner"><CircleHelp size={17} /><div><strong>Some blocks overlap.</strong><span>Review conflicting times before starting sessions. Only one focus session can run at a time.</span></div></div>}
    <div className={`plan-list ${view === 'Timeline' ? 'plan-timeline-view' : ''}`}>{tasks.map((task, i) => <motion.div className="plan-task-card" key={task.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .025 }}><div className="plan-card-time"><span>{task.start}</span><i /> <span>{task.end}</span></div><div className="plan-card-accent" style={{ background: categoryColor(task.category) }} /><div className="plan-card-copy"><h3>{task.title}</h3><div className="task-row-meta"><span className="task-category"><i className="category-dot" style={{ background: categoryColor(task.category) }} />{task.category}</span><span>·</span><span>{fmtDuration((atTime(task.date, task.end) - atTime(task.date, task.start)) / 60000)}</span>{task.priority === 'high' && <span className="priority-tag">High priority</span>}</div>{task.notes && <p>{task.notes}</p>}</div><span className={`state-pill state-${taskState(task, activeSession?.taskId === task.id, now).toLowerCase().replace(' ', '-')}`}>{taskState(task, activeSession?.taskId === task.id, now)}</span><div className="plan-card-actions"><button className="icon-button" onClick={() => { setEditingTask(task); setNewTask({ title: task.title, category: task.category, date: task.date, start: task.start, duration: (atTime(task.date, task.end) - atTime(task.date, task.start)) / 60000, priority: task.priority, notes: task.notes || '' }); setModal('new-task') }} aria-label="Edit task"><Settings2 size={15} /></button><button className="icon-button" onClick={() => { setEditingTask(task); setModal('delete-task') }} aria-label="Delete task"><X size={15} /></button></div></motion.div>)}{!tasks.length && <div className="empty-state"><div className="empty-icon"><CalendarDays size={21} /></div><h3>Nothing planned yet</h3><p>Add your first time block to shape the day.</p></div>}</div>
    <div className="plan-footnote"><CircleHelp size={14} /><span>Scheduled end times stay fixed. Pausing a session does not push later blocks forward.</span></div>
  </div>
}
function findConflicts(tasks) { const conflicts = new Set(); tasks.forEach(a => tasks.forEach(b => { if (a.id !== b.id && atTime(a.date, a.start) < atTime(b.date, b.end) && atTime(a.date, a.end) > atTime(b.date, b.start)) { conflicts.add(a.id); conflicts.add(b.id) } })); return [...conflicts] }

function CalendarPage({ data, month, setMonth, selectedDate, setSelectedDate, now, onSaveDayNote, onAddReminder, onDeleteReminder, notificationPermission, onEnableNotifications }) {
  const [reminderTitle, setReminderTitle] = useState('')
  const [reminderTime, setReminderTime] = useState('09:00')
  const year = month.getFullYear(), monthIndex = month.getMonth()
  const firstDay = new Date(year, monthIndex, 1).getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const monthLabel = month.toLocaleDateString([], { month: 'long', year: 'numeric' })
  const keyFor = day => `${year}-${pad(monthIndex + 1)}-${pad(day)}`
  const tasks = data.tasks.filter(t => t.date === selectedDate).sort((a,b) => a.start.localeCompare(b.start))
  const reminders = (data.reminders || []).filter(reminder => reminder.date === selectedDate).sort((a,b) => a.time.localeCompare(b.time))
  const sessions = data.sessions.filter(s => s.date === selectedDate).sort((a,b) => (a.actualStart || 0) - (b.actualStart || 0))
  const events = data.events.filter(e => e.timestamp && localDateKey(new Date(e.timestamp)) === selectedDate).sort((a,b) => a.timestamp-b.timestamp)
  const activeSecs = sessions.reduce((sum,s) => sum + (s.activeSeconds || (s.status === 'running' ? Math.max(0,Math.floor((Math.min(now,s.scheduledEnd)-s.actualStart-(s.pausedTotalMs||0)-(s.pausedAt ? now-s.pausedAt : 0))/1000)) : 0)),0)
  const breakSecs = sessions.reduce((sum,s) => sum + (s.pausedTotalMs || 0)/1000 + (s.pausedAt ? Math.max(0,now-s.pausedAt)/1000 : 0),0)
  const durationLabel = secs => { const mins=Math.floor(Math.max(0,secs)/60); return `${Math.floor(mins/60)}h ${mins%60}m` }
  const taskStatus = t => t.outcome === 'completed' || t.status === 'completed' ? 'Completed' : t.outcome === 'partially-completed' || t.status === 'partially-completed' ? 'Partial' : t.outcome === 'not-completed' || t.status === 'not-completed' ? 'Not completed' : t.status === 'skipped' ? 'Skipped' : t.status === 'interrupted' ? 'Interrupted' : t.status === 'active' ? 'In progress' : 'Planned'
  const dayHasData = tasks.length || sessions.length || events.length
  return <div className="page-content calendar-page">
    <div className="section-title"><div><div className="eyebrow">YOUR WORK, BY DATE</div><h1>Calendar log</h1><p>Every day keeps its own record of tasks, focus time, and breaks.</p></div><div className="section-title-right"><button className="button button-secondary" onClick={() => {const d=new Date();setMonth(new Date(d.getFullYear(),d.getMonth(),1));setSelectedDate(localDateKey(d))}}>Today</button></div></div>
    <div className="calendar-layout">
      <section className="calendar-board">
        <div className="calendar-month-head"><button className="icon-button" aria-label="Previous month" onClick={()=>setMonth(new Date(year,monthIndex-1,1))}><ChevronLeft size={17}/></button><h2>{monthLabel}</h2><button className="icon-button" aria-label="Next month" onClick={()=>setMonth(new Date(year,monthIndex+1,1))}><ChevronRight size={17}/></button></div>
        <div className="calendar-grid calendar-weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><span key={d}>{d}</span>)}</div>
        <div className="calendar-grid calendar-days">{Array.from({length:firstDay},(_,i)=><span className="calendar-blank" key={`b${i}`}/>)}{Array.from({length:daysInMonth},(_,i)=>{const day=i+1,key=keyFor(day), dayTasks=data.tasks.filter(t=>t.date===key), daySessions=data.sessions.filter(s=>s.date===key), dayReminders=(data.reminders||[]).filter(r=>r.date===key), selected=key===selectedDate, today=key===localDateKey(new Date(now));return <button key={key} className={`calendar-day ${selected?'selected':''} ${today?'today':''} ${dayTasks.length||daySessions.length||dayReminders.length?'has-record':''} ${dayReminders.length?'has-reminder':''}`} onClick={()=>setSelectedDate(key)} aria-pressed={selected}><span>{day}</span>{(dayTasks.length||daySessions.length||dayReminders.length)>0&&<i title={`${dayTasks.length} tasks, ${daySessions.length} sessions, ${dayReminders.length} reminders`}/>}</button>})}</div>
        <div className="calendar-legend"><span><i className="legend-record"/> Saved work</span><span><i className="legend-today"/> Today</span><small>Records update as you work and persist on this device.</small></div>
      </section>
      <section className="day-report">
        <div className="day-report-head"><div><div className="eyebrow">DAY REPORT</div><h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</h2><span>{new Date(`${selectedDate}T12:00:00`).getFullYear()}</span></div><span className="report-mark"><CalendarDays size={18}/></span></div>
        <div className="report-metrics"><div><span>FOCUS TIME</span><strong>{durationLabel(activeSecs)}</strong></div><div><span>BREAK TIME</span><strong>{durationLabel(breakSecs)}</strong></div><div><span>TASKS</span><strong>{tasks.length}</strong></div></div>
        <section className="calendar-reminders">
          <div className="report-section-title calendar-reminders-heading"><div><h3>Planned-work reminders</h3><span>Set an alarm for this calendar day.</span></div><button type="button" className="button button-secondary button-sm" onClick={onEnableNotifications} disabled={notificationPermission === 'granted'}>{notificationPermission === 'granted' ? <Check size={14} /> : <AlarmClock size={14} />}{notificationPermission === 'granted' ? 'Notifications on' : notificationPermission === 'denied' ? 'Allow in browser' : notificationPermission === 'unsupported' ? 'Sound only' : 'Enable alerts'}</button></div>
          <p className="calendar-notification-status">{notificationPermission === 'granted' ? 'Browser alerts are enabled. Keep TIMEFRAME open for scheduled reminders.' : notificationPermission === 'denied' ? 'Browser notifications are blocked. Change this site’s notification permission in your browser settings.' : notificationPermission === 'unsupported' ? 'This browser does not support system notifications. In-app alerts and sounds are available while TIMEFRAME is open.' : 'Enable browser alerts to receive a notification when this reminder is due.'}</p>
          <form className="calendar-reminder-form" onSubmit={e => { e.preventDefault(); if (onAddReminder(reminderTitle, selectedDate, reminderTime)) setReminderTitle('') }}>
            <label className="form-field"><span>What should TIMEFRAME remind you about?</span><input value={reminderTitle} onChange={e => setReminderTitle(e.target.value)} placeholder="e.g. Review project notes" maxLength={100} required /></label>
            <label className="form-field reminder-time-field"><span>Alarm time</span><input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} required /></label>
            <button type="submit" className="button button-primary"><Plus size={14} /> Set reminder</button>
          </form>
          <div className="calendar-reminder-list">{reminders.length ? reminders.map(reminder => <div className="calendar-reminder-item" key={reminder.id}><span className="calendar-reminder-icon"><AlarmClock size={15} /></span><div className="calendar-reminder-copy"><strong>{reminder.title}</strong><span>{fmtTime(atTime(reminder.date, reminder.time))} · {reminder.deliveryStatus === 'sent' ? 'Alert sent' : reminder.deliveryStatus === 'missed' ? 'Missed while app was closed' : 'Scheduled'}</span></div><button type="button" className="icon-button" onClick={() => onDeleteReminder(reminder.id)} aria-label={`Remove reminder ${reminder.title}`}><X size={15} /></button></div>) : <div className="calendar-reminders-empty">No reminders set for this day.</div>}</div>
        </section>
        <section className="calendar-day-notes"><div className="report-section-title"><h3>Daily notes</h3><span>Saved on this device</span></div><textarea aria-label="Notes for this date" value={data.dayNotes?.[selectedDate] || ''} onChange={e => onSaveDayNote(selectedDate, e.target.value)} placeholder="What did you work on? Capture wins, blockers, or what to remember…" maxLength={3000} rows={4} /></section>
        <div className="report-section-title"><h3>Activity timeline</h3><span>{tasks.length + sessions.length} records</span></div>
        {!dayHasData ? <div className="calendar-empty"><CalendarDays size={24}/><strong>No saved activity</strong><p>Tasks and focus sessions for this date will appear here automatically.</p></div> : <div className="report-timeline">
          {tasks.map(t=><div className="report-row" key={`task-${t.id}`}><div className="report-time">{t.start}<span>{t.end}</span></div><i className="report-line-dot task-dot"/><div className="report-row-copy"><strong>{t.title}</strong><span>{t.category} · {taskStatus(t)}</span>{t.notes&&<p>{t.notes}</p>}</div><span className={`report-status ${taskStatus(t).toLowerCase().replaceAll(' ','-')}`}>{taskStatus(t)}</span></div>)}
          {sessions.map(s=>{const t=data.tasks.find(x=>x.id===s.taskId);const related=events.filter(e=>e.sessionId===s.id);return <div className="report-row" key={`session-${s.id}`}><div className="report-time">{fmtTime(s.actualStart)}<span>{s.actualEnd?fmtTime(s.actualEnd):s.status==='running'?'Running':fmtTime(s.scheduledEnd)}</span></div><i className="report-line-dot session-dot"/><div className="report-row-copy"><strong>{t?.title||'Focus session'}</strong><span>Focus session · {durationLabel(s.activeSeconds || 0)} active</span>{related.filter(e=>['paused','resumed','interrupted','ended'].includes(e.type)).map(e=><small key={e.id}>{fmtTime(e.timestamp)} · {e.type==='paused'?'Break started':e.type==='resumed'?'Returned to work':e.type==='interrupted'?'Session interrupted':'Session ended'}</small>)}</div><span className="report-status">{s.status}</span></div>})}
          {events.filter(e=>!sessions.some(s=>s.id===e.sessionId)).map(e=><div className="report-row" key={e.id}><div className="report-time">{fmtTime(e.timestamp)}</div><i className="report-line-dot"/><div className="report-row-copy"><strong>{e.type.replaceAll('-',' ')}</strong><span>Activity event</span></div></div>)}
        </div>}
        <div className="report-footnote">Reports are assembled from saved tasks, session timestamps, and pause/resume events. Break time is calculated from recorded pauses.</div>
      </section>
    </div>
  </div>
}

function FlipClock({ seconds, large = false }) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(safeSeconds / 3600)
  const mins = Math.floor((safeSeconds % 3600) / 60)
  const secs = safeSeconds % 60
  return (
    <div
      className={`flip-clock digital-clock ${large ? 'flip-clock-large' : ''}`}
      role="timer"
      aria-label={`${hours} hours, ${mins} minutes, ${secs} seconds remaining`}
    >
      <span>{pad(hours)}</span>
      <span className="clock-colon" aria-hidden="true">:</span>
      <span>{pad(mins)}</span>
      <span className="clock-colon" aria-hidden="true">:</span>
      <span>{pad(secs)}</span>
    </div>
  )
}
function FocusPage({ activeSession, activeTask, activeRemaining, now, todayTasks, startSession, pauseSession, resumeSession, endSession, toggleFullscreen, focusFullscreen, data, setPage, setModal, outcomeTask, setOutcomeTask, saveOutcome, audio, musicOn, setMusicOn, audioReady, setAudioReady, updateSettings, showToast }) {
  const [showSoundPanel, setShowSoundPanel] = useState(false)
  const next = todayTasks.find(t => !['completed', 'partially-completed', 'not-completed', 'skipped'].includes(t.status) && atTime(t.date, t.end) > now && t.id !== activeTask?.id)
  const isPaused = activeSession?.status === 'paused'
  const elapsed = activeSession ? Math.max(0, Math.floor((Math.min(now, activeSession.scheduledEnd) - activeSession.actualStart - (activeSession.pausedTotalMs || 0) - (activeSession.pausedAt ? now - activeSession.pausedAt : 0)) / 1000)) : 0
  const total = activeSession ? Math.max(1, Math.floor((activeSession.scheduledEnd - activeSession.actualStart) / 1000)) : 1
  async function toggleMusic() {
    if (!audioReady) { audio.enable(); setAudioReady(true) }
    if (musicOn) { audio.stopMusic(); setMusicOn(false); updateSettings({ musicEnabled: false }) }
    else { audio.startMusic(data.settings.ambient, data.settings.musicVolume); setMusicOn(true); updateSettings({ musicEnabled: true }) }
  }
  return <div className={`page-content focus-page ${focusFullscreen ? 'focus-fullscreen' : ''}`}>
    {!focusFullscreen && <SectionTitle eyebrow="FOCUS SPACE" title="One thing at a time." description="Protect this block. Let everything else wait." right={<button className="button button-secondary" onClick={toggleFullscreen}><Maximize2 size={15} /> Fullscreen</button>} />}
    {activeSession && activeTask ? <div className={`focus-active-layout ${focusFullscreen ? 'focus-active-full' : ''}`}>
      <div className="focus-main-card"><div className="focus-card-top"><div className="focus-status"><span className={`live-pill ${isPaused ? '' : 'live'}`}><i />{isPaused ? 'PAUSED' : 'FOCUS IN PROGRESS'}</span><span className="focus-session-label">SESSION {String(data.sessions.findIndex(s => s.id === activeSession.id) + 1).padStart(2, '0')}</span></div><button className="icon-button" onClick={toggleFullscreen} aria-label={focusFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{focusFullscreen ? <X size={17} /> : <Maximize2 size={17} />}</button></div>
        <div className="focus-task-heading"><div className="task-category"><span className="category-dot" style={{ background: categoryColor(activeTask.category) }} />{activeTask.category}</div><h2>{activeTask.title}</h2><p>Stay with the work in front of you.</p></div>
        <div className="focus-clock-area"><div className="clock-label">TIME REMAINING</div><FlipClock seconds={activeRemaining} large /><div className="focus-clock-progress"><span style={{ width: `${Math.min(100, elapsed / total * 100)}%` }} /></div><div className="focus-clock-meta"><span><Clock3 size={13} /> Started {fmtTime(activeSession.actualStart)}</span><span>Ends at <strong>{fmtTime(activeSession.scheduledEnd)}</strong></span></div></div>
        <div className="focus-controls"><button className="button button-primary focus-primary-control" onClick={isPaused ? resumeSession : pauseSession}>{isPaused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}{isPaused ? 'Resume focus' : 'Pause session'}</button><button className="button button-secondary" onClick={() => setShowSoundPanel(!showSoundPanel)}><Headphones size={16} /> Sound</button><button className="button button-quiet" onClick={() => setModal('end-session')}><Square size={14} /> End early</button></div>
        <AnimatePresence>{showSoundPanel && <motion.div className="focus-sound-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}><div className="sound-panel-row"><div className="sound-panel-icon"><Waves size={16} /></div><div className="sound-panel-copy"><strong>Focus ambience</strong><span>Soft background sound</span></div><select value={data.settings.ambient} onChange={e => { updateSettings({ ambient: e.target.value }); if (musicOn) audio.startMusic(e.target.value, data.settings.musicVolume) }} aria-label="Ambient sound"><option value="rain">Rain</option><option value="brown">Brown noise</option><option value="white">White noise</option><option value="tone">Ambient tones</option></select><button className={`sound-toggle ${musicOn ? 'on' : ''}`} onClick={toggleMusic} aria-label={musicOn ? 'Pause ambience' : 'Play ambience'}>{musicOn ? <Pause size={14} /> : <Play size={14} />}</button></div><div className="sound-volume"><Volume2 size={14} /><input type="range" min="0" max="100" value={data.settings.musicVolume} onChange={e => { const v = Number(e.target.value); updateSettings({ musicVolume: v }); if (musicOn) audio.startMusic(data.settings.ambient, v) }} aria-label="Music volume" /><span>{data.settings.musicVolume}%</span></div></motion.div>}</AnimatePresence>
        <div className="focus-reassurance"><span className="status-dot" /> Your scheduled end time stays fixed, even when you pause.</div>
      </div>
      {!focusFullscreen && <aside className="focus-side-column"><div className="panel focus-up-next"><span className="eyebrow">AFTER THIS BLOCK</span><h3>{next?.title || 'Take a moment to reset'}</h3><p>{next ? `${fmtTime(atTime(next.date, next.start))} – ${fmtTime(atTime(next.date, next.end))}` : 'Your next block is open. Use it intentionally.'}</p>{next && <div className="next-task-mini"><span className="category-dot" style={{ background: categoryColor(next.category) }} />{next.category}</div>}</div><div className="panel focus-guideline"><div className="guideline-icon"><Sparkles size={16} /></div><h3>Make it a single-task hour.</h3><p>Keep one intention in view. You can review the result when the block ends.</p></div><div className="panel focus-audio-card"><div className="focus-audio-top"><div className="audio-art"><Waves size={18} /></div><div><strong>Focus ambience</strong><span>{musicOn ? `${data.settings.ambient} is playing` : 'Quiet is a valid choice'}</span></div></div><div className="audio-presets">{[{ id: 'rain', label: 'Rain', icon: CloudRain }, { id: 'brown', label: 'Brown', icon: Waves }, { id: 'tone', label: 'Ambient', icon: Music2 }].map(item => { const Icon = item.icon; return <button key={item.id} className={data.settings.ambient === item.id ? 'selected' : ''} onClick={() => { updateSettings({ ambient: item.id }); if (musicOn) audio.startMusic(item.id, data.settings.musicVolume) }}><Icon size={14} />{item.label}</button> })}</div><button className="button button-secondary button-full" onClick={toggleMusic}>{musicOn ? <Pause size={14} /> : <Play size={14} />}{musicOn ? 'Pause ambience' : 'Play ambience'}</button><div className="audio-volume-line"><Volume2 size={13} /><input type="range" min="0" max="100" value={data.settings.musicVolume} onChange={e => { const v = Number(e.target.value); updateSettings({ musicVolume: v }); if (musicOn) audio.startMusic(data.settings.ambient, v) }} aria-label="Music volume" /></div></div></aside>}
    </div> : <div className={`focus-empty-wrap ${focusFullscreen ? 'focus-empty-full' : ''}`}><div className="focus-empty-card"><div className="focus-empty-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core"><Focus size={27} /></div><span className="orbit-star star-one">✳</span><span className="orbit-star star-two">✦</span></div><span className="eyebrow">YOUR FOCUS SPACE</span><h2>Ready when you are.</h2><p>Choose a block, set one intention, and give it your attention.</p>{next ? <div className="empty-next-block"><div><span className="eyebrow">NEXT BLOCK</span><strong>{next.title}</strong><span>{fmtTime(atTime(next.date, next.start))} · {fmtDuration((atTime(next.date, next.end) - atTime(next.date, next.start)) / 60000)}</span></div><button className="button button-primary" onClick={() => startSession(next)}><Play size={14} fill="currentColor" /> Start focus</button></div> : <button className="button button-primary" onClick={() => setPage('Plan')}>Plan a focus block <ArrowRight size={15} /></button>}<div className="focus-empty-footer"><span><Volume2 size={14} /> Optional sound & ambience</span><span><TimerReset size={14} /> Time-block based</span><span><Maximize2 size={14} /> Fullscreen ready</span></div></div></div>}
    {!focusFullscreen && <div className="focus-bottom-note"><Sparkles size={14} /><span>Timer records active time, not proof of attention. Your outcome is yours to report.</span></div>}
  </div>
}

function InsightsPage({ tasks, sessions, allSessions, now, completedToday, scheduledMinutes, activeSecondsToday }) {
  const totalActive = allSessions.reduce((s, x) => s + (x.activeSeconds || 0), 0)
  const outcomes = { completed: tasks.filter(t => t.outcome === 'completed').length, partial: tasks.filter(t => t.outcome === 'partially-completed').length, not: tasks.filter(t => t.outcome === 'not-completed').length, skipped: tasks.filter(t => t.outcome === 'skipped').length }
  const maxDuration = Math.max(1, ...sessions.map(s => s.activeSeconds || 0))
  const bars = [
    { day: 'Mon', planned: 4.5, actual: 3.2 }, { day: 'Tue', planned: 5.5, actual: 4.1 }, { day: 'Wed', planned: 4, actual: 3.5 }, { day: 'Thu', planned: 6, actual: 4.8 }, { day: 'Fri', planned: 5, actual: 3.7 }, { day: 'Sat', planned: 3.5, actual: 2.9 }, { day: 'Sun', planned: 4.5, actual: 0 },
  ]
  return <div className="page-content"><SectionTitle eyebrow="REFLECT & ADJUST" title="Progress you can learn from." description="A clear view of planned time, active timer time, and the outcomes you reported." right={<div className="date-select"><CalendarDays size={14} /> Today <ChevronDown size={14} /></div>} />
    <div className="metrics-grid insights-metrics"><MetricCard icon={Clock3} label="Scheduled today" value={fmtDuration(Math.round(scheduledMinutes))} note="Time reserved" /><MetricCard icon={Zap} label="Active timer time" value={`${Math.floor(activeSecondsToday / 3600)}h ${Math.floor(activeSecondsToday % 3600 / 60)}m`} note="Not a measure of attention" accent /><MetricCard icon={CheckCheck} label="Completed tasks" value={completedToday} note="Self-reported outcomes" /><MetricCard icon={TimerReset} label="Lifetime focus" value={`${Math.floor(totalActive / 3600)}h`} note={`${allSessions.length} sessions recorded`} /></div>
    <div className="insights-grid"><div className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">WEEK AT A GLANCE</span><h2>Planned vs. active time</h2></div><span className="chart-legend"><i className="legend-planned" /> Planned <i className="legend-actual" /> Active timer</span></div><div className="chart-area"><div className="chart-y-labels"><span>6h</span><span>4h</span><span>2h</span><span>0h</span></div><div className="chart-bars-area"><div className="chart-grid-lines"><i /><i /><i /><i /></div>{bars.map((bar, i) => <div className="chart-day" key={bar.day}><div className="chart-bar-pair"><motion.div className="chart-bar planned-bar" initial={{ height: 0 }} animate={{ height: `${bar.planned / 6 * 100}%` }} transition={{ duration: .45, delay: i * .035 }} title={`${bar.planned}h planned`} /><motion.div className="chart-bar actual-bar" initial={{ height: 0 }} animate={{ height: `${bar.actual / 6 * 100}%` }} transition={{ duration: .45, delay: i * .035 + .08 }} title={`${bar.actual}h active timer`} /></div><span>{bar.day}</span></div>)}</div></div><div className="chart-caption"><span><span className="status-dot" /> Today's values are based on this device's session history.</span><button className="text-button" onClick={() => window.print()}><Download size={13} /> Print report</button></div></div>
      <div className="panel outcome-panel"><div className="panel-heading"><div><span className="eyebrow">TASK OUTCOMES</span><h2>How it went</h2></div><CheckCheck size={17} className="muted-icon" /></div><div className="outcome-list">{[{ label: 'Completed', count: outcomes.completed, color: '#82c8a0' }, { label: 'Partially completed', count: outcomes.partial, color: '#e8a65a' }, { label: 'Not completed', count: outcomes.not, color: '#d58b8b' }, { label: 'Skipped', count: outcomes.skipped, color: '#777780' }].map(row => <div className="outcome-row" key={row.label}><div><span className="legend-dot" style={{ background: row.color }} />{row.label}</div><strong>{row.count}</strong><div className="outcome-track"><i style={{ width: `${tasks.length ? row.count / tasks.length * 100 : 0}%`, background: row.color }} /></div></div>)}</div><div className="outcome-footnote">Outcomes are recorded by you after a scheduled block ends.</div></div></div>
    <div className="panel session-history-panel"><div className="panel-heading"><div><span className="eyebrow">SESSION LOG</span><h2>Recent focus sessions</h2></div><span className="history-count">{sessions.length} today</span></div>{sessions.length ? <div className="session-table"><div className="session-table-head"><span>TASK</span><span>STARTED</span><span>ACTIVE TIME</span><span>STATUS</span></div>{sessions.slice().reverse().map(s => { const t = tasks.find(task => task.id === s.taskId) || { title: 'Task removed' }; return <div className="session-table-row" key={s.id}><strong>{t.title}</strong><span>{fmtTime(s.actualStart)}</span><span>{fmtDuration(Math.round((s.activeSeconds || 0) / 60))}</span><span className={`state-pill state-${s.status}`}>{s.status === 'ended' ? 'Finished' : s.status === 'interrupted' ? 'Interrupted' : s.status}</span></div> })}</div> : <div className="history-empty"><Clock3 size={19} /><span>No focus sessions recorded today. Start a block to begin building your history.</span></div>}</div>
    <p className="analytics-disclaimer"><CircleHelp size={14} /> Active timer time measures how long the timer was running. It cannot verify attention, effort, or the quality of the work.</p>
  </div>
}

function SettingsPage({ data, updateSettings, audio, setAudioReady, audioReady, exportData, importData, showToast, availableUpdate, isCheckingUpdate, isInstallingUpdate, updateReadyToRestart, updateProgress, updateStatus, checkForAppUpdates, installAppUpdate, restartForUpdate, activeSession }) {
  const s = data.settings
  const playPreview = (key) => { audio.enable(); setAudioReady(true); audio.playSound(s[key], s.alarmVolume) }
  return <div className="page-content settings-page"><SectionTitle eyebrow="MAKE IT YOURS" title="Settings" description="Shape your focus environment and keep your data under your control." />
    <div className="settings-layout"><div className="settings-nav"><span className="eyebrow">PREFERENCES</span><a className="settings-nav-active" href="#appearance-settings"><Sun size={16} /> Appearance</a><a href="#sound-settings"><Volume2 size={16} /> Sound & ambience</a><a href="#focus-settings"><Focus size={16} /> Focus behaviour</a><a href="#data-settings"><Download size={16} /> Your data</a><a href="#updates-settings"><RotateCcw size={16} /> Updates</a></div><div className="settings-content">
      <section className="settings-section" id="appearance-settings"><div className="settings-section-heading"><div className="settings-section-icon"><Sun size={18} /></div><div><h2>Appearance</h2><p>Choose the visual environment that feels comfortable for long work sessions.</p></div></div><div className="theme-options" role="group" aria-label="Color theme">
        <button type="button" className={`theme-option ${s.theme !== 'light' ? 'selected' : ''}`} aria-pressed={s.theme !== 'light'} onClick={() => updateSettings({ theme: 'dark' })}><span className="theme-preview theme-preview-dark"><i /><i /><i /></span><span className="theme-option-copy"><strong><Moon size={15} /> Dark</strong><small>Deep navy and soft contrast</small></span>{s.theme !== 'light' && <Check size={16} className="theme-check" />}</button>
        <button type="button" className={`theme-option ${s.theme === 'light' ? 'selected' : ''}`} aria-pressed={s.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })}><span className="theme-preview theme-preview-light"><i /><i /><i /></span><span className="theme-option-copy"><strong><Sun size={15} /> Warm light</strong><small>Muted ivory, no pure-white panels</small></span>{s.theme === 'light' && <Check size={16} className="theme-check" />}</button>
      </div><div className="appearance-note"><Sparkles size={15} /><span>Warm light mode avoids large pure-white surfaces to reduce glare. Screen brightness and regular breaks also matter for visual comfort.</span></div></section>
      <section className="settings-section" id="sound-settings"><div className="settings-section-heading"><div className="settings-section-icon"><AudioLines size={18} /></div><div><h2>Sound & ambience</h2><p>Audible cues when you need them. Quiet when you don't.</p></div></div><div className="setting-row"><div className="setting-copy"><strong>Session sounds</strong><span>Enable start, end, and reminder sounds.</span></div><Switch checked={s.soundEnabled} onChange={v => updateSettings({ soundEnabled: v })} /></div>{[['startSound','Session start','A gentle cue when a focus block begins'],['endSound','Session end alarm','A clear cue when your scheduled time ends'],['reminderSound','Reminder','A short cue for reminders']].map(([key, title, desc]) => <div className="setting-row setting-row-sound" key={key}><div className="setting-copy"><strong>{title}</strong><span>{desc}</span></div><div className="sound-choice"><select value={s[key]} onChange={e => updateSettings({ [key]: e.target.value })} disabled={!s.soundEnabled} aria-label={title}>{(key === 'endSound' ? [['double-bell','Double bell'],['long-bell','Long bell'],['digital-pulse','Digital pulse'],['soft-chime','Soft chime']] : key === 'reminderSound' ? [['woodblock','Woodblock'],['gentle','Gentle tone'],['digital-pulse','Digital pulse'],['ascending-chime','Ascending chime'],['soft-bell','Soft bell']] : [['soft-chime','Soft chime'],['gentle','Gentle tone'],['woodblock','Woodblock'],['digital-pulse','Digital pulse']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="preview-button" onClick={() => playPreview(key)} disabled={!s.soundEnabled}><Play size={13} /> Preview</button></div></div>)}<div className="setting-row setting-row-volume"><div className="setting-copy"><strong>Alarm volume</strong><span>Controls all notification sounds.</span></div><div className="volume-setting"><Volume2 size={15} /><input type="range" min="0" max="100" value={s.alarmVolume} onChange={e => updateSettings({ alarmVolume: Number(e.target.value) })} aria-label="Alarm volume" /><span>{s.alarmVolume}%</span></div></div><div className="settings-divider" /><div className="setting-row"><div className="setting-copy"><strong>Focus ambience</strong><span>Optional rain, brown noise, white noise, or ambient tones.</span></div><Switch checked={s.musicEnabled} onChange={v => { updateSettings({ musicEnabled: v }); audio.enable(); setAudioReady(true); if (v) audio.startMusic(s.ambient, s.musicVolume); else audio.stopMusic() }} /></div><div className="setting-row setting-row-sound"><div className="setting-copy"><strong>Ambient sound</strong><span>Generated locally in your browser; no audio files are streamed.</span></div><div className="sound-choice"><select value={s.ambient} onChange={e => { updateSettings({ ambient: e.target.value }); if (s.musicEnabled) audio.startMusic(e.target.value, s.musicVolume) }}><option value="rain">Rain texture</option><option value="brown">Brown noise</option><option value="white">White noise</option><option value="tone">Ambient tones</option></select><button className="preview-button" onClick={() => { audio.enable(); setAudioReady(true); if (s.musicEnabled) { audio.stopMusic(); updateSettings({ musicEnabled: false }) } else { audio.startMusic(s.ambient, s.musicVolume); updateSettings({ musicEnabled: true }) } }}>{s.musicEnabled ? <Pause size={13} /> : <Play size={13} />}{s.musicEnabled ? 'Stop' : 'Play'}</button></div></div><div className="setting-row setting-row-volume"><div className="setting-copy"><strong>Ambience volume</strong><span>Independent from alarm volume.</span></div><div className="volume-setting"><Volume2 size={15} /><input type="range" min="0" max="100" value={s.musicVolume} onChange={e => { const v = Number(e.target.value); updateSettings({ musicVolume: v }); if (s.musicEnabled) audio.startMusic(s.ambient, v) }} aria-label="Ambience volume" /><span>{s.musicVolume}%</span></div></div><div className="audio-note"><CircleHelp size={14} /> Your browser may require a click before it allows audio playback. Test sounds here first.</div></section>
      <section className="settings-section" id="focus-settings"><div className="settings-section-heading"><div className="settings-section-icon"><Focus size={18} /></div><div><h2>Focus behaviour</h2><p>Keep your schedule predictable.</p></div></div><div className="setting-row"><div className="setting-copy"><strong>Strict completion mode</strong><span>Only record a completed outcome after the scheduled block ends. You can always safely end early.</span></div><Switch checked={s.strictMode} onChange={v => updateSettings({ strictMode: v })} /></div><div className="setting-row"><div className="setting-copy"><strong>Automatically start the next block</strong><span>Recommended off. Review the next task before starting another session.</span></div><Switch checked={s.autoStartNext} onChange={v => updateSettings({ autoStartNext: v })} /></div><div className="setting-row"><div className="setting-copy"><strong>Accent colour</strong><span>Choose a subtle highlight for active states.</span></div><div className="accent-picker">{[{ id: 'amber', color: '#e8a65a' }, { id: 'violet', color: '#a78bfa' }, { id: 'green', color: '#82c8a0' }, { id: 'blue', color: '#7db9e8' }].map(a => <button key={a.id} className={s.accent === a.id ? 'selected' : ''} style={{ '--swatch': a.color }} onClick={() => { updateSettings({ accent: a.id }); document.documentElement.dataset.accent = a.id }} aria-label={`${a.id} accent`} />)}</div></div></section>
      <section className="settings-section" id="data-settings"><div className="settings-section-heading"><div className="settings-section-icon"><Download size={18} /></div><div><h2>Your data</h2><p>TIMEFRAME stores your plan on this device. Export a backup whenever you need.</p></div></div><div className="data-actions"><div><strong>Local backup</strong><span>Export tasks, session history, and settings as JSON.</span></div><div className="data-action-buttons"><button className="button button-secondary" onClick={exportData}><Download size={14} /> Export backup</button><label className="button button-secondary import-button"><RotateCcw size={14} /> Restore backup<input type="file" accept="application/json" onChange={importData} hidden /></label></div></div><div className="storage-footnote"><span className="status-dot" /> Local-first storage · No account or server required</div></section>
      <section className="settings-section" id="updates-settings"><div className="settings-section-heading"><div className="settings-section-icon"><RotateCcw size={18} /></div><div><h2>App updates</h2><p>Keep TIMEFRAME up to date. Your tasks and session history remain stored locally.</p></div></div><div className="data-actions"><div><strong>TIMEFRAME desktop</strong><span>{updateReadyToRestart ? 'The update is installed and ready to apply.' : availableUpdate ? `Version ${availableUpdate.version} is available.` : updateStatus === 'checking' || isCheckingUpdate ? 'Checking for updates…' : updateStatus === 'up-to-date' ? 'You’re using the latest version.' : updateStatus === 'error' ? 'The last update check failed. You can try again.' : 'Check whether a newer version is available.'}</span>{availableUpdate?.body && <span className="update-release-notes">{availableUpdate.body}</span>}{isInstallingUpdate && <span>Downloading and installing… {updateProgress}%</span>}{activeSession && <span className="update-session-warning">A focus session is active. Restarting is disabled until the session ends.</span>}</div><div className="data-action-buttons">{updateReadyToRestart ? <button className="button button-primary" onClick={restartForUpdate} disabled={Boolean(activeSession)}><RotateCcw size={14} /> Restart to update</button> : availableUpdate ? <button className="button button-primary" onClick={installAppUpdate} disabled={isInstallingUpdate || isCheckingUpdate}>{isInstallingUpdate ? `Installing ${updateProgress}%` : `Install ${availableUpdate.version}`}</button> : null}<button className="button button-secondary" onClick={() => checkForAppUpdates({ manual: true })} disabled={isCheckingUpdate || isInstallingUpdate}><RotateCcw size={14} /> {isCheckingUpdate ? 'Checking…' : 'Check for updates'}</button></div></div><div className="storage-footnote"><span className="status-dot" /> Updates are checked online; TIMEFRAME’s core features work offline.</div></section>
    </div></div>
  </div>
}

function Switch({ checked, onChange }) { return <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'switch-on' : ''}`} onClick={() => onChange(!checked)}><span /></button> }

function TaskModal({ task, setTask, onClose, onSave, editing = false }) {
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}><motion.div className="modal-card task-modal" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }} transition={{ duration: .2 }} role="dialog" aria-modal="true" aria-labelledby="task-modal-title"><div className="modal-heading"><div><span className="eyebrow">TIME BLOCK</span><h2 id="task-modal-title">{editing ? 'Edit time block' : 'Add to your plan'}</h2><p>Give the block a clear intention and a fixed end time.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></div><form onSubmit={onSave}><label className="form-field"><span>Task name</span><input autoFocus value={task.title} onChange={e => setTask({ ...task, title: e.target.value })} placeholder="What will you work on?" required maxLength={100} /></label><div className="form-grid"><label className="form-field"><span>Date</span><input type="date" value={task.date || localDateKey()} onChange={e => setTask({ ...task, date: e.target.value })} required /></label><label className="form-field"><span>Category</span><select value={task.category} onChange={e => setTask({ ...task, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label><label className="form-field"><span>Priority</span><select value={task.priority} onChange={e => setTask({ ...task, priority: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label className="form-field"><span>Start time</span><input type="time" value={task.start} onChange={e => setTask({ ...task, start: e.target.value })} required /></label><label className="form-field"><span>Duration</span><select value={task.duration} onChange={e => setTask({ ...task, duration: Number(e.target.value) })}>{[15, 25, 30, 45, 60, 75, 90, 120, 150, 180].map(n => <option key={n} value={n}>{fmtDuration(n)}</option>)}</select></label></div><label className="form-field"><span>Intention <small>Optional</small></span><textarea value={task.notes} onChange={e => setTask({ ...task, notes: e.target.value })} placeholder="What does done look like?" rows="2" maxLength={240} /></label><div className="modal-footnote"><Clock3 size={14} /> End time is calculated from start + duration. Overlaps are flagged after saving.</div><div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">{editing ? <Check size={15} /> : <Plus size={15} />}{editing ? 'Save changes' : 'Add time block'}</button></div></form></motion.div></motion.div>
}
function EmergencyEndModal({ taskTitle, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const reasons = ['Urgent interruption', 'Not feeling well', 'Task is blocked', 'Wrong task or schedule', 'Other']
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <motion.div className="modal-card emergency-modal" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} role="dialog" aria-modal="true" aria-labelledby="emergency-end-title">
      <div className="confirm-icon danger"><Square size={17} /></div>
      <span className="eyebrow">EARLY SESSION EXIT</span>
      <h2 id="emergency-end-title">Why do you need to stop?</h2>
      <p>Ending “{taskTitle}” early records an interruption in your daily report. Choose a reason so you can review it later.</p>
      <label className="form-field emergency-reason-field"><span>Reason <small>required</small></span><select value={reason} onChange={e => { setReason(e.target.value); setError('') }}><option value="">Select a reason…</option>{reasons.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
      {reason === 'Other' && <label className="form-field emergency-note"><span>What happened? <small>required</small></span><textarea value={note} placeholder="Add a brief reason…" onChange={e => { setNote(e.target.value); setError('') }} /></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Keep working</button><button className="button button-danger" onClick={() => { if (!reason || (reason === 'Other' && !note.trim())) { setError('Please select a reason and add a short note if you choose Other.'); return } onConfirm(reason === 'Other' ? `Other: ${note.trim()}` : reason) }}>End task</button></div>
    </motion.div>
  </motion.div>
}

function ConfirmModal({ title, description, confirm, onClose, onConfirm, danger = false }) { return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}><motion.div className="modal-card confirm-modal" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} role="dialog" aria-modal="true"><div className={`confirm-icon ${danger ? 'danger' : ''}`}>{danger ? <X size={19} /> : <AlarmClock size={20} />}</div><h2>{title}</h2><p>{description}</p><div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className={`button ${danger ? 'button-danger' : 'button-primary'}`} onClick={onConfirm}>{confirm}</button></div></motion.div></motion.div> }
function OutcomePanel({ task, onChoose, onClose }) { return <motion.div className="outcome-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="outcome-dialog" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} role="dialog" aria-modal="true" aria-labelledby="outcome-title"><div className="outcome-dialog-top"><div className="outcome-icon"><CheckCheck size={19} /></div><button className="icon-button" onClick={onClose} aria-label="Close outcome review"><X size={16} /></button></div><span className="eyebrow">BLOCK REVIEW</span><h2 id="outcome-title">How did it go?</h2><p className="outcome-task-name">{task?.title || 'Your focus block'}</p><p>Timer activity is only one signal. Choose the outcome that best reflects the work.</p><div className="outcome-choices"><button onClick={() => onChoose('completed')}><span className="outcome-choice-icon choice-complete"><Check size={17} /></span><span><strong>Completed</strong><small>I achieved what I planned.</small></span><ChevronRight size={16} /></button><button onClick={() => onChoose('partially-completed')}><span className="outcome-choice-icon choice-partial"><ArrowUpRight size={17} /></span><span><strong>Partially completed</strong><small>I made progress, but there's more.</small></span><ChevronRight size={16} /></button><button onClick={() => onChoose('not-completed')}><span className="outcome-choice-icon choice-not"><X size={17} /></span><span><strong>Not completed</strong><small>The intended work didn't get done.</small></span><ChevronRight size={16} /></button></div><button className="outcome-skip" onClick={() => onChoose('skipped')}>Skip outcome for now</button></motion.div></motion.div> }

export default App
