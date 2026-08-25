/**
 * 스코어 예측 화면의 AI 참고 문구 생성.
 *
 * 프로바이더는 Google Gemini 무료 티어다. 호출부를 이 파일 하나로 격리해 둔 이유는
 * 프로바이더를 바꿀 때 고칠 곳을 한 군데로 묶기 위해서다 — 바깥 코드는 `generateHint(facts)`만 안다.
 *
 * 재료(HintFacts)는 우리 DB에 실제로 있는 것만이다. fixtures는 뉴캐슬 경기만 담으므로
 * (supabase/functions/sync-fixture/index.ts) 상대팀의 최근 폼·부상자·순위는 알 수 없다.
 * 프롬프트가 그걸 지어내지 않도록 아래 규칙에서 명시적으로 막는다.
 */

/** 종료된 경기 한 건 — 뉴캐슬 관점. 득점/실점은 스코어 예측의 재료라 숫자로 들고 있는다. */
export type PastMatch = {
  opponent: string
  isHome: boolean
  /** 뉴캐슬 득점 */
  gf: number
  /** 뉴캐슬 실점 */
  ga: number
  /** 친선경기 — 공식전이 모자랄 때만 채워 넣는다(collectHintFacts). */
  isFriendly: boolean
}

/** 이번 주차에 예측할 경기 하나. 더블 매치위크면 둘 이상이다. */
export type UpcomingMatch = {
  /** 상대 (한글 팀명) */
  opponent: string
  isHome: boolean
  /** 그 상대와의 과거 맞대결 (최신순). 비어 있으면 이번 시즌 첫 맞대결. */
  headToHead: PastMatch[]
}

/**
 * 프롬프트에 들어가는 재료 전부. 여기 없는 사실은 문구에 나오면 안 된다.
 * 단위는 경기가 아니라 주차다 — 카드가 주차당 한 장이기 때문(2026-08-25 확정).
 * 뉴캐슬 최근 득실은 어차피 경기별로 같아서, 경기마다 만들면 같은 문장이 반복됐다.
 */
export type HintFacts = {
  /** 이번 주차에 예측할 경기들 (킥오프 순) */
  matches: UpcomingMatch[]
  /** 뉴캐슬 직전 경기들 (최신순) */
  recent: PastMatch[]
}

/**
 * 승패 합계와 득실 평균 — 세는 일은 코드가 한다.
 * 경기 목록만 던졌더니 모델이 5경기 중 리버풀전 하나만 언급하고 끝냈다(2026-08-25 실측).
 * 숫자를 LLM에 맡길 이유가 없고, 틀려도 화면에서 알아채기 어렵다.
 *
 * 화면이 스코어를 고르는 자리라 승/무/패보다 득실이 앞선다 — 승패 합계는 몇 대 몇을 정하는 데
 * 쓸모가 없다는 지적에서 나온 구성이다(2026-08-25 확정).
 */
function goalStats(matches: PastMatch[]): string {
  const n = matches.length
  const sum = (pick: (m: PastMatch) => number) => matches.reduce((acc, m) => acc + pick(m), 0)
  const count = (test: (m: PastMatch) => boolean) => matches.filter(test).length

  const record = [
    { label: '승', n: count(m => m.gf > m.ga) },
    { label: '무', n: count(m => m.gf === m.ga) },
    { label: '패', n: count(m => m.gf < m.ga) },
  ]
    .filter(r => r.n > 0)
    .map(r => `${r.n}${r.label}`)
    .join(' ')

  return [
    `- 경기당 득점 ${(sum(m => m.gf) / n).toFixed(1)}, 실점 ${(sum(m => m.ga) / n).toFixed(1)}`,
    `- 무실점 ${count(m => m.ga === 0)}경기, 무득점 ${count(m => m.gf === 0)}경기, 양 팀 득점 ${count(m => m.gf > 0 && m.ga > 0)}경기`,
    `- 승패: ${record}`,
  ].join('\n')
}

/** '공식전 3경기 + 친선경기 2경기' — 친선이 섞였으면 문구가 그 사실을 밝혀야 한다. */
function composition(matches: PastMatch[]): string {
  const friendly = matches.filter(m => m.isFriendly).length
  const official = matches.length - friendly
  if (friendly === 0) return `공식전 ${official}경기`
  if (official === 0) return `전부 친선경기 ${friendly}경기`
  return `공식전 ${official}경기 + 친선경기 ${friendly}경기`
}

/**
 * 재료를 프롬프트로 조립한다. 순수 함수 — 네트워크를 타지 않아 테스트가 여기까지 커버한다.
 * 재료가 비어 있으면 그 섹션 자체를 빼서 "정보 없음"을 모델이 추측으로 메우지 않게 한다.
 */
export function buildHintPrompt(facts: HintFacts): string {
  const sections: string[] = [
    `이번 주 예측할 경기:\n${facts.matches
      .map(m => `- 뉴캐슬 vs ${m.opponent} (${m.isHome ? '홈' : '원정'})`)
      .join('\n')}`,
  ]

  if (facts.recent.length > 0) {
    sections.push(
      `뉴캐슬 최근 ${facts.recent.length}경기 (${composition(facts.recent)})\n${goalStats(facts.recent)}`,
    )
  }

  // 맞대결이 없는 것도 사실이다 — 섹션을 빼면 모델이 "첫 맞대결"이라는 말을 할 수가 없다.
  // fixtures는 이번 시즌만 담으므로(sync-fixture가 현재 시즌만 가져온다) "이번 시즌"으로 한정한다.
  // 그냥 "처음 상대한다"고 하면 지난 시즌 맞대결까지 부정하는 거짓말이 된다.
  sections.push(
    `상대별 맞대결:\n${facts.matches
      .map(m =>
        m.headToHead.length > 0
          ? `- ${m.opponent} (${m.headToHead.length}경기, ${composition(m.headToHead)}): ` +
            `스코어 ${m.headToHead.map(h => `${h.gf}-${h.ga}`).join(', ')}`
          : `- ${m.opponent}: 이번 시즌 아직 만난 적 없음(이번 시즌 첫 맞대결)`,
      )
      .join('\n')}`,
  )

  return [
    '너는 뉴캐슬 유나이티드 팬 투표 앱에서, 사용자가 이번 주 경기 스코어를 예측하기 전에 참고할 정보를 정리해 주는 역할이다.',
    '',
    sections.join('\n\n'),
    '',
    '규칙:',
    '- 위에 주어진 사실만 쓴다. 상대팀의 최근 성적, 부상자, 리그 순위, 이적 소식은 주어지지 않았으므로 절대 언급하지 않는다.',
    '- 스코어를 예측하거나 추천하지 않는다. 누가 이길지도 말하지 않는다. 판단은 사용자가 한다.',
    '- 사용자는 지금 몇 대 몇을 넣을지 고르는 중이다. 득점과 실점에 관한 사실을 우선해서 쓴다.',
    '- 첫 문장은 경기당 득점·실점 수치로 시작한다. 한 경기만 집어서 말하지 않는다.',
    '- 재료에 친선경기가 섞여 있으면 그 사실을 밝힌다. 공식전 기록인 것처럼 쓰지 않는다.',
    '- 경기 날짜와 홈/원정은 화면에 이미 있으므로 다시 말하지 않는다.',
    '- 맞대결 기록이 없으면 "이번 시즌 첫 맞대결"이라고 쓴다. "이번 시즌"을 빼고 "처음 상대한다"고 쓰면 거짓이 된다.',
    '- 이번 주 경기가 둘 이상이면 상대 이름을 함께 묶어 한 문장으로 쓴다. 경기마다 문단을 나누지 않는다.',
    '- 사실만 쓰고 끝낸다. "참고하세요", "예측해 보세요" 같은 권유나 맺음말을 붙이지 않는다.',
    '- 한국어 2~3문장, 각 문장은 짧게. 모든 문장을 존댓말(~예요/~해요)로 끝낸다.',
    '- 마크다운, 목록, 제목 없이 문장만 출력한다.',
  ].join('\n')
}

// 2026-08-25 실측으로 이 키에서 호출되는 것을 확인한 모델. 별칭(gemini-flash-latest)이 아니라
// 고정 버전을 쓴다 — 별칭은 뒤에서 모델이 갈리면 문구 톤이 소리 없이 바뀐다.
// 바꾸려면 코드가 아니라 GEMINI_MODEL 환경변수로 덮는다.
const DEFAULT_MODEL = 'gemini-2.5-flash'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Gemini를 호출해 문구 한 덩어리를 받는다. 실패하면 null —
 * 이 기능은 없어도 예측 제출에 지장이 없으므로 어떤 실패도 위로 던지지 않는다.
 */
export async function generateHint(facts: HintFacts): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  // 종료된 경기가 하나도 없으면 득실을 셀 게 없다 — 시즌 첫 경기.
  // 맞대결 없음은 그 자체가 재료라서(첫 맞대결) 여기 조건에 넣지 않는다.
  if (facts.recent.length === 0) return null

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL

  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildHintPrompt(facts) }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.4,
          // gemini-2.5-flash는 thinking 모델이라 이걸 끄지 않으면 사고 토큰이 maxOutputTokens를
          // 다 먹고 문장이 중간에 잘려 나온다(2026-08-25 실측: "뉴캐슬은 최근 홈 경기에서 리버풀과").
          // 3문장 요약에 사고가 필요하지도 않다.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      cache: 'no-store',
      // 문구 하나 때문에 예측 화면 렌더가 오래 잡혀 있으면 안 된다 — 늦으면 그냥 포기한다.
      signal: AbortSignal.timeout(8_000),
    })

    if (!response.ok) {
      console.error('generateHint error:', response.status, await response.text().catch(() => ''))
      return null
    }

    const body = (await response.json()) as {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
    }
    const candidate = body.candidates?.[0]

    // STOP이 아니면 문장이 중간에 끊긴 것(MAX_TOKENS)이거나 안전 필터에 걸린 것이다.
    // 잘린 문구를 저장하면 그 경기는 마감까지 반토막 문장을 달고 있게 된다 — 차라리 카드를 뺀다.
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      console.error('generateHint: unexpected finishReason', candidate.finishReason)
      return null
    }

    const text = candidate?.content?.parts?.map(part => part.text ?? '').join('').trim()

    return text ? text : null
  } catch (error) {
    console.error('generateHint error:', error)
    return null
  }
}
