import { db } from '@/db'
import type { StatsRecord } from '@/types'

const emptyStats = (): StatsRecord => ({
  id: 'global',
  totalMinutes: 0,
  streakDays: 0,
  byDay: [],
  byBook: [],
})

export const statsRepo = {
  empty: emptyStats,

  async load(): Promise<StatsRecord> {
    const row = await db.stats.get('global')
    return row || emptyStats()
  },

  async save(stats: StatsRecord): Promise<void> {
    await db.stats.put(stats)
  },
}
