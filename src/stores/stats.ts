import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { StatsRecord } from '@/types'

function today() {
  return new Date().toISOString().slice(0, 10)
}

const emptyStats = (): StatsRecord => ({
  id: 'global',
  totalMinutes: 0,
  streakDays: 0,
  byDay: [],
  byBook: [],
})

export const useStatsStore = defineStore('stats', () => {
  const stats = ref<StatsRecord>(emptyStats())
  let sessionStart = 0
  let sessionBookId: string | null = null

  async function load() {
    const row = await db.stats.get('global')
    stats.value = row || emptyStats()
  }

  async function reset() {
    const s = emptyStats()
    stats.value = s
    await db.stats.put(s)
  }

  function startSession(bookId: string) {
    sessionStart = Date.now()
    sessionBookId = bookId
  }

  async function endSession() {
    if (!sessionStart || !sessionBookId) return
    const minutes = Math.max(0.1, (Date.now() - sessionStart) / 60000)
    sessionStart = 0
    const bookId = sessionBookId
    sessionBookId = null

    const s = { ...stats.value }
    const d = today()
    s.totalMinutes += minutes
    const day = s.byDay.find((x) => x.date === d)
    if (day) day.minutes += minutes
    else s.byDay.push({ date: d, minutes })
    s.byDay = s.byDay.slice(-60)

    const bb = s.byBook.find((x) => x.bookId === bookId)
    if (bb) bb.minutes += minutes
    else s.byBook.push({ bookId, minutes })

    if (s.lastActiveDate) {
      const prev = new Date(s.lastActiveDate)
      const now = new Date(d)
      const diff = Math.round((now.getTime() - prev.getTime()) / 86400000)
      if (diff === 1) s.streakDays += 1
      else if (diff > 1) s.streakDays = 1
    } else {
      s.streakDays = 1
    }
    s.lastActiveDate = d
    stats.value = s
    await db.stats.put(s)
  }

  return { stats, load, reset, startSession, endSession }
})
