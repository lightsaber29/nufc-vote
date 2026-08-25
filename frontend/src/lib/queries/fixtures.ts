import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/server'
import { IS_MOCK } from '@/lib/config'
import type { FixtureRow, SquadPosition } from '@/types/database'
import { koreanTeamName } from '@/lib/predict/team-names'
import { toKst, weekKey } from '@/lib/predictions/week'
import { playerPhotoUrl } from '@/lib/predictions/candidates'
import { mockGetHomeMatchdayFixture } from '@/lib/mock/queries'
import { generateHint, type HintFacts, type PastMatch } from '@/lib/ai/hint'
import { NUFC_TEAM_ID } from '@/lib/predictions/week'
// 예측 목록(주차 그룹)은 승부예측 기능에서 쓰는 별개 경로다 — 같은 fixtures 테이블을 읽지만
// 컬럼·가공 방식이 달라서 FixtureRow도 서로 다른 타입이라 별칭으로 구분한다.
import {
  groupFixturesByWeek,
  type FixtureRow as WeekFixtureRow,
  type WeekGroup,
} from '@/lib/predictions/week'

/** 평점을 받은 선수 한 명의 표시용 형태. */
export type MatchdayRatedPlayer = {
  playerId: number
  name: string
  rating: number
  photoUrl: string
}

/** 포지션별 최고 평점 선수(수비수·미드필더·공격수). */
export type MatchdayPositionLeader = MatchdayRatedPlayer & {
  position: SquadPosition
}

/** 종료된 경기의 평점 요약 — DEF/MID/FWD 각 최고 평점 1명씩. 셋 중 최고가 골드로 강조된다. */
export type MatchRatings = {
  topDefender: MatchdayPositionLeader | null
  topMidfielder: MatchdayPositionLeader | null
  topForward: MatchdayPositionLeader | null
}

const EMPTY_RATINGS: MatchRatings = {
  topDefender: null,
  topMidfielder: null,
  topForward: null,
}

/** 홈 히어로(MatchdayHero)가 그대로 받는 형태 — fixtures row에서 표시용 필드만 추려 한글 팀명을 입힌다. */
export type MatchdayFixture = {
  fixtureId: number
  competitionName: string | null
  kickoffAt: string
  homeId: number
  homeName: string
  awayId: number
  awayName: string
  homeScore: number | null
  awayScore: number | null
  started: boolean
  finished: boolean
  /** "2026-35" — 승부예측 세션 URL 파라미터(/predictions/{weekKey}). lib/predictions/week.ts 참고. */
  weekKey: string
  /** 최고 평점 수비수. finished일 때만 값이 있을 수 있다 — 평점이 아직 안 들어왔으면 null. */
  topDefender: MatchdayPositionLeader | null
  /** 최고 평점 미드필더. */
  topMidfielder: MatchdayPositionLeader | null
  /** 최고 평점 공격수. */
  topForward: MatchdayPositionLeader | null
  /** FotMob 표시용 스코어 문자열. 실제 경기 결과는 이걸 그대로 보여준다(homeScore/awayScore 조합 아님). */
  scoreStr: string | null
  /**
   * "5-4" 형태. 승부차기로 끝난 경기는 FotMob 동기화가 승부차기 스코어를 home_score/away_score에
   * 넣어버려서(score_str은 정규 시간 스코어를 유지) 그 둘이 어긋난다 — 그 어긋남을 승부차기가
   * 있었다는 신호로 써서 이 필드에 옮겨 담는다. 안 어긋나면(일반 경기) null.
   */
  shootoutScore: string | null
}

// 히어로는 킥오프 24시간 전부터 뜬다 — 그 전엔 fixture를 null로 돌려줘서 HomeClient가
// 예전 방식(투표 배너)으로 대체하게 한다.
const PRE_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000

// FotMob 동기화 배치가 늦거나 멈추면 이미 끝난 경기가 finished=false로 계속 남을 수 있다.
// kickoff로부터 이 시간이 지나도 안 끝난 걸로 남아있으면 "다음 경기" 후보에서 건너뛴다 —
// 이미 지난 경기를 카운트다운 0으로 계속 보여주는 사고를 막기 위한 안전장치.
const STALE_GRACE_MS = 3 * 60 * 60 * 1000

/**
 * score_str에서 "N-N"을 뽑아 home_score/away_score와 비교한다. 둘이 다르면(=score_str이
 * 파싱조차 안 되면 비교 불가 취급, 다른 걸로 안 본다) home_score/away_score를 승부차기
 * 스코어로 판단해서 "N-N" 문자열로 돌려준다. 일치하거나 비교 불가면 null.
 */
function detectShootoutScore(row: FixtureRow): string | null {
  if (!row.score_str || row.home_score === null || row.away_score === null) return null

  const match = row.score_str.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (!match) return null

  const [, strHome, strAway] = match
  if (Number(strHome) === row.home_score && Number(strAway) === row.away_score) return null

  return `${row.home_score}-${row.away_score}`
}

function toMatchdayFixture(row: FixtureRow, ratings: MatchRatings): MatchdayFixture {
  const kickoffAt = row.kickoff_at ?? new Date().toISOString()
  return {
    fixtureId: row.fixture_id,
    competitionName: row.competition_name,
    kickoffAt,
    homeId: row.home_id,
    homeName: koreanTeamName(row.home_id, row.home_name),
    awayId: row.away_id,
    awayName: koreanTeamName(row.away_id, row.away_name),
    homeScore: row.home_score,
    awayScore: row.away_score,
    started: row.started,
    finished: row.finished,
    weekKey: weekKey(toKst(kickoffAt)),
    topDefender: ratings.topDefender,
    topMidfielder: ratings.topMidfielder,
    topForward: ratings.topForward,
    scoreStr: row.score_str,
    shootoutScore: detectShootoutScore(row),
  }
}

/**
 * 종료된 경기의 평점 요약 — DEF/MID/FWD 각 최고 평점 1명.
 * fixture_player_ratings에는 뉴캐슬 선수만 들어있고, 포지션은 season_squads에서 붙인다.
 * GK는 포지션 카드가 없어 여기 포함하지 않는다(요구상 수비수·미드필더·공격수 3종만).
 */
async function getMatchRatings(
  supabase: ReturnType<typeof createPublicClient>,
  fixtureId: number,
): Promise<MatchRatings> {
  const { data: ratings, error: ratingsError } = await supabase
    .from('fixture_player_ratings')
    .select('player_id, rating')
    .eq('fixture_id', fixtureId)
    .order('rating', { ascending: false })

  if (ratingsError) {
    console.error('getMatchRatings (ratings) error:', ratingsError)
    return EMPTY_RATINGS
  }
  if (!ratings || ratings.length === 0) return EMPTY_RATINGS

  const rows = ratings as { player_id: number; rating: number }[]

  // season_squads가 (season_id, fotmob_player_id) 복합키라 시즌을 모르면 여러 행이 걸릴 수 있다.
  const { data: season } = (await supabase
    .from('seasons')
    .select('id')
    .eq('is_current', true)
    .maybeSingle()) as { data: { id: string } | null }

  if (!season) return EMPTY_RATINGS

  const { data: squads, error: squadError } = (await supabase
    .from('season_squads')
    .select('fotmob_player_id, name, name_ko, position')
    .eq('season_id', season.id)
    .in(
      'fotmob_player_id',
      rows.map((r) => r.player_id),
    )) as {
    data: { fotmob_player_id: number; name: string; name_ko: string | null; position: SquadPosition }[] | null
    error: unknown
  }

  if (squadError) {
    console.error('getMatchRatings (squad) error:', squadError)
    return EMPTY_RATINGS
  }

  const squadById = new Map((squads ?? []).map((s) => [s.fotmob_player_id, s]))

  // ratings가 평점 내림차순이므로 이 배열도 내림차순을 유지한다 —
  // 아래 find()가 각 포지션의 "첫 번째" = 최고 평점을 집어낸다.
  const rated: MatchdayPositionLeader[] = []
  for (const r of rows) {
    const squad = squadById.get(r.player_id)
    if (!squad) continue
    rated.push({
      playerId: r.player_id,
      name: squad.name_ko?.trim() || squad.name,
      rating: r.rating,
      photoUrl: playerPhotoUrl(r.player_id),
      position: squad.position,
    })
  }
  if (rated.length === 0) return EMPTY_RATINGS

  const topOf = (position: SquadPosition) => rated.find((p) => p.position === position) ?? null

  return {
    topDefender: topOf('DEF'),
    topMidfielder: topOf('MID'),
    topForward: topOf('FWD'),
  }
}

/**
 * 홈 화면 히어로에 띄울 경기 하나를 고른다: 킥오프 24시간 전 ~ 진행중이면 그 경기,
 * 아니면(24시간 이상 남았거나 아직 다음 경기가 없으면) 가장 최근 종료된 경기(+최우수 선수).
 * 취소된 경기는 제외한다.
 */
async function getHomeMatchdayFixtureUncached(): Promise<MatchdayFixture | null> {
  if (IS_MOCK) return mockGetHomeMatchdayFixture()

  const supabase = createPublicClient()
  const now = Date.now()
  const staleCutoff = new Date(now - STALE_GRACE_MS).toISOString()
  const preMatchCutoff = new Date(now + PRE_MATCH_WINDOW_MS).toISOString()

  const { data: upcoming, error: upcomingError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('finished', false)
    .eq('cancelled', false)
    .gte('kickoff_at', staleCutoff)
    .lte('kickoff_at', preMatchCutoff)
    .order('kickoff_at', { ascending: true })
    .limit(1)

  if (upcomingError) {
    console.error('getHomeMatchdayFixture (upcoming) error:', upcomingError)
  } else if (upcoming && upcoming.length > 0) {
    return toMatchdayFixture(upcoming[0] as FixtureRow, EMPTY_RATINGS)
  }

  const { data: recent, error: recentError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('finished', true)
    .eq('cancelled', false)
    .order('kickoff_at', { ascending: false })
    .limit(1)

  if (recentError) {
    console.error('getHomeMatchdayFixture (recent) error:', recentError)
    return null
  }
  if (!recent || recent.length === 0) return null

  const row = recent[0] as FixtureRow
  const ratings = await getMatchRatings(supabase, row.fixture_id)
  return toMatchdayFixture(row, ratings)
}

export const getHomeMatchdayFixture = unstable_cache(getHomeMatchdayFixtureUncached, ['home-matchday-fixture'], {
  revalidate: 30,
})

export type { WeekGroup }

const WEEK_FIXTURE_COLUMNS =
  'fixture_id, competition_name, kickoff_at, home_id, home_name, home_score, away_id, away_name, away_score, started, finished, cancelled'

async function getFixtureWeeksUncached(): Promise<WeekGroup[]> {
  const now = Date.now()

  if (IS_MOCK) {
    const { MOCK_FIXTURES } = await import('@/lib/mock/data')
    return groupFixturesByWeek(MOCK_FIXTURES, now)
  }

  const supabase = createPublicClient()
  const { data, error } = await supabase
    .from('fixtures')
    .select(WEEK_FIXTURE_COLUMNS)
    .order('kickoff_at', { ascending: true })

  if (error) {
    console.error('getFixtureWeeks error:', error)
    return []
  }

  return groupFixturesByWeek((data ?? []) as unknown as WeekFixtureRow[], now)
}

export const getFixtureWeeks = unstable_cache(getFixtureWeeksUncached, ['fixture-weeks'], {
  revalidate: 300,
  // 관리자 동기화 버튼(lib/actions/sync-fixtures.ts)이 이 태그로 캐시를 즉시 비운다.
  tags: ['fixture-weeks'],
})

// ============================================================
// 예측 화면 AI 참고 문구
// ============================================================

/** 목 모드는 Gemini를 부르지 않는다 — 화면 확인용 고정 문구. */
const MOCK_WEEK_HINT =
  '뉴캐슬은 최근 5경기에서 경기당 1.4골을 넣고 1.8골을 실점했어요. ' +
  '무실점 경기는 없었고 다섯 경기 모두 양 팀이 득점했어요. ' +
  '아스널, 브렌트포드 모두 이번 시즌 첫 맞대결이에요.'

/** 문구 재료로 쓸 지난 경기 수. 늘리면 프롬프트만 길어지고 문장은 그대로라 5로 둔다. */
const HINT_RECENT_LIMIT = 5
/** 상대전적으로 보여줄 맞대결 수. */
const HINT_H2H_LIMIT = 3
/**
 * 공식전을 우선 채우려면 최근 N경기만 봐서는 안 된다 — 프리시즌엔 상위 5경기가 전부 친선일 수
 * 있다. 넉넉히 읽어 코드에서 고른다. fixtures는 한 시즌 50경기 남짓이라 이 정도는 부담이 없다.
 */
const HINT_SCAN_LIMIT = 30

/**
 * 친선경기 판정 — FotMob이 competition_name에 내려주는 값이다(2026-08-25 실측: 'Club Friendlies').
 * 다른 표기가 발견되면 여기에 추가한다.
 */
const FRIENDLY_COMPETITIONS = ['Club Friendlies']

const HINT_FIXTURE_COLUMNS =
  'fixture_id, kickoff_at, home_id, home_name, home_score, away_id, away_name, away_score, competition_name'

type HintFixtureRow = {
  fixture_id: number
  kickoff_at: string | null
  home_id: number
  home_name: string
  home_score: number | null
  away_id: number
  away_name: string
  away_score: number | null
  competition_name: string | null
}

/**
 * 종료된 fixtures row를 뉴캐슬 관점의 PastMatch로 바꾼다.
 * 스코어가 없으면 득실을 셀 수 없으므로 여기서 걸러낸다.
 */
function toPastMatch(row: HintFixtureRow): PastMatch | null {
  if (row.home_score === null || row.away_score === null) return null

  const isHome = row.home_id === NUFC_TEAM_ID
  const [gf, ga] = isHome ? [row.home_score, row.away_score] : [row.away_score, row.home_score]

  return {
    opponent: isHome ? koreanTeamName(row.away_id, row.away_name) : koreanTeamName(row.home_id, row.home_name),
    isHome,
    gf,
    ga,
    isFriendly: FRIENDLY_COMPETITIONS.includes(row.competition_name ?? ''),
  }
}

/**
 * 공식전을 먼저 채우고, 모자란 만큼만 친선경기로 보충한다(2026-08-25 확정).
 * 프리시즌엔 최근 5경기가 거의 친선이라 그대로 쓰면 친선 성적을 공식 기록처럼 보여주게 되고,
 * 친선을 아예 빼면 시즌 초에 재료가 비어 카드가 안 뜬다. 양쪽을 다 피하는 절충이다.
 * 친선이 섞였다는 사실은 PastMatch.isFriendly로 프롬프트까지 전달된다.
 */
function pickRecent(matches: PastMatch[], limit: number): PastMatch[] {
  const official = matches.filter(m => !m.isFriendly)
  if (official.length >= limit) return official.slice(0, limit)

  const friendly = matches.filter(m => m.isFriendly)
  return [...official, ...friendly.slice(0, limit - official.length)]
}

/**
 * 프롬프트 재료를 모은다. 주차 단위다 — 카드가 주차당 한 장이라 그 주 경기를 전부 받는다.
 * 예측할 경기가 없으면 null.
 */
async function collectHintFacts(
  supabase: ReturnType<typeof createPublicClient>,
  fixtureIds: number[],
): Promise<HintFacts | null> {
  if (fixtureIds.length === 0) return null

  const { data: targets } = (await supabase
    .from('fixtures')
    .select(HINT_FIXTURE_COLUMNS)
    .in('fixture_id', fixtureIds)
    .order('kickoff_at', { ascending: true })) as { data: HintFixtureRow[] | null }
  if (!targets || targets.length === 0) return null

  const toMatches = (rows: unknown) =>
    ((rows ?? []) as HintFixtureRow[])
      .map(toPastMatch)
      .filter((match): match is PastMatch => match !== null)

  const opponentIdOf = (row: HintFixtureRow) =>
    row.home_id === NUFC_TEAM_ID ? row.away_id : row.home_id

  const [recentResult, ...h2hResults] = await Promise.all([
    supabase
      .from('fixtures')
      .select(HINT_FIXTURE_COLUMNS)
      .eq('finished', true)
      .eq('cancelled', false)
      .order('kickoff_at', { ascending: false })
      .limit(HINT_SCAN_LIMIT),
    // 예측 대상 경기 자신은 finished가 아니라 여기 걸리지 않는다.
    ...targets.map(row =>
      supabase
        .from('fixtures')
        .select(HINT_FIXTURE_COLUMNS)
        .eq('finished', true)
        .eq('cancelled', false)
        .or(`home_id.eq.${opponentIdOf(row)},away_id.eq.${opponentIdOf(row)}`)
        .order('kickoff_at', { ascending: false })
        .limit(HINT_H2H_LIMIT),
    ),
  ])

  return {
    matches: targets.map((row, i) => {
      const isHome = row.home_id === NUFC_TEAM_ID
      return {
        opponent: koreanTeamName(
          opponentIdOf(row),
          isHome ? row.away_name : row.home_name,
        ),
        isHome,
        headToHead: toMatches(h2hResults[i]?.data),
      }
    }),
    recent: pickRecent(toMatches(recentResult.data), HINT_RECENT_LIMIT),
  }
}

/**
 * 예측 화면에 띄울 AI 참고 문구 — 주차당 한 장.
 *
 * 결과를 DB에 저장하지 않는다. 조회 경로가 이미 unstable_cache 뒤에 있어서 컬럼에 넣어봐야
 * 같은 값을 한 번 더 들고 있는 이중 캐시였다(2026-08-25에 fixtures.ai_hint를 도로 걷어냈다).
 * 캐시가 만료된 첫 요청만 Gemini를 한 번 부른다.
 *
 * 어떤 실패도 던지지 않고 null을 준다 — 문구가 없으면 카드만 빠지고 예측 제출은 그대로 된다.
 */
async function getWeekHintUncached(fixtureIds: number[]): Promise<string | null> {
  if (IS_MOCK) return MOCK_WEEK_HINT

  const facts = await collectHintFacts(createPublicClient(), fixtureIds)
  if (!facts) return null

  return generateHint(facts)
}

/**
 * 캐시 키는 경기 id 목록이다 — 주차가 진행되면서 남은 경기가 줄면(첫 경기 킥오프) 키가 바뀌어
 * 새 문구가 만들어진다. weekKey로 잡으면 이미 끝난 경기의 상대가 문구에 계속 남는다.
 */
export const getWeekHint = unstable_cache(getWeekHintUncached, ['week-ai-hint'], {
  // 재료는 경기가 끝날 때만 바뀌고 동기화 크론은 하루 한 번이다. 실패(null)가 이 시간만큼
  // 물려 있는 게 이 캐시의 유일한 비용이라 한 시간으로 잡는다.
  revalidate: 3600,
})
