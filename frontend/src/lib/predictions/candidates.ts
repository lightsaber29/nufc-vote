/**
 * 선수 픽의 포지션 정의와 표시용 헬퍼.
 * 후보 목록/배당은 DB(season_squads)에서 오고 조회는 lib/queries/squads.ts가 담당한다.
 */

export const POSITIONS = ['DEF', 'MID', 'FWD'] as const
export type Position = (typeof POSITIONS)[number]

export const POSITION_LABEL: Record<Position, string> = {
  DEF: '수비수',
  MID: '미드필더',
  FWD: '공격수',
}

export type Candidate = {
  /** season_squads.fotmob_player_id — predictions.{def,mid,fwd}_player_id에 그대로 들어간다 */
  id: number
  name: string
  position: Position
  /** 제출 시 서버가 DB 값을 다시 읽어 스냅샷한다 — 화면 표시용으로만 믿는다 */
  multiplier: number
  squadNumber: number | null
  nationality: string | null
  age: number | null
  photoUrl: string | null
}

/**
 * 선수 사진. FotMob 선수 ID당 불변이라 CDN에 매달리지 않고 Storage에 복사해뒀다
 * (`player-photos/players/{id}.png`) — 팀 크레스트(`week.ts`의 `teamLogoUrl`)와 같은 방식이다.
 * 이적·영입으로 스쿼드가 바뀌면 그 자리에 파일만 올리면 된다. 없는 선수는 404라
 * `PlayerPhoto`(Radix Avatar)의 실루엣 폴백에 맡긴다.
 * mock 모드는 Supabase URL이 없으므로 원본 CDN으로 떨어진다 — lib/config의 IS_MOCK과 같은
 * 조건이지만, 이 모듈을 값 import 없이 두려고 week.ts와 마찬가지로 인라인이다.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const PHOTO_BASE = SUPABASE_URL.startsWith('http')
  ? `${SUPABASE_URL}/storage/v1/object/public/player-photos/players`
  : 'https://images.fotmob.com/image_resources/playerimages'

export function playerPhotoUrl(fotmobPlayerId: number): string {
  return `${PHOTO_BASE}/${fotmobPlayerId}.png`
}

export function isPickPosition(position: string): position is Position {
  return (POSITIONS as readonly string[]).includes(position)
}

/** date_of_birth → 만 나이. 없으면 null. */
export function ageFrom(dateOfBirth: string | null, now: number): number | null {
  if (!dateOfBirth) return null
  const birth = new Date(dateOfBirth)
  if (Number.isNaN(birth.getTime())) return null
  const years = (now - birth.getTime()) / (365.2425 * 86_400_000)
  return years < 0 ? null : Math.floor(years)
}
