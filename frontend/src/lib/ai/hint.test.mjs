import test from 'node:test'
import assert from 'node:assert/strict'

// .ts를 직접 import한다 — npm test가 --experimental-strip-types로 돈다(package.json).
// 예전에는 소스를 문자열로 잘라 평가했는데, hint.ts에 TS 문법이 하나 늘 때마다 깨졌다.
import { buildHintPrompt } from './hint.ts'

/** 4경기: 3-0 승, 1-2 패, 0-0 무, 2-1 승(친선) */
const FACTS = {
  matches: [
    {
      opponent: '브라이튼',
      isHome: true,
      headToHead: [{ opponent: '브라이튼', isHome: true, gf: 1, ga: 1, isFriendly: false }],
    },
  ],
  recent: [
    { opponent: '에버턴', isHome: true, gf: 3, ga: 0, isFriendly: false },
    { opponent: '아스널', isHome: false, gf: 1, ga: 2, isFriendly: false },
    { opponent: '첼시', isHome: true, gf: 0, ga: 0, isFriendly: false },
    { opponent: '발렌시아', isHome: false, gf: 2, ga: 1, isFriendly: true },
  ],
}

/** 상대 이름만 바꾼 경기 하나를 더 붙인다 — 더블 매치위크. */
const DOUBLE = {
  ...FACTS,
  matches: [FACTS.matches[0], { opponent: '토트넘', isHome: false, headToHead: [] }],
}

test('득실 통계는 코드가 계산해서 넘긴다', () => {
  const prompt = buildHintPrompt(FACTS)

  assert.match(prompt, /- 뉴캐슬 vs 브라이튼 \(홈\)/)
  // 득점 (3+1+0+2)/4 = 1.5, 실점 (0+2+0+1)/4 = 0.75 → 0.8
  assert.match(prompt, /경기당 득점 1\.5, 실점 0\.8/)
  // 무실점: 3-0, 0-0 → 2경기 / 무득점: 0-0 → 1경기 / 양 팀 득점: 1-2, 2-1 → 2경기
  assert.match(prompt, /무실점 2경기, 무득점 1경기, 양 팀 득점 2경기/)
  assert.match(prompt, /승패: 2승 1무 1패/)
})

test('화면이 스코어를 고르는 자리라 득실이 먼저다', () => {
  // 2026-08-25 확정: 승/무/패와 선수 평점은 몇 대 몇을 정하는 데 쓸모가 없다는 지적에서 나온 구성.
  const prompt = buildHintPrompt(FACTS)

  assert.match(prompt, /첫 문장은 경기당 득점·실점 수치로 시작한다/)
  assert.match(prompt, /득점과 실점에 관한 사실을 우선해서 쓴다/)
  // 선수 평점은 스코어 카드에서 뺐다 — 다시 들어오면 이 단정이 깨진다
  assert.doesNotMatch(prompt, /평점/)
})

test('친선경기가 섞이면 구성이 드러나고, 밝히라는 규칙이 붙는다', () => {
  const prompt = buildHintPrompt(FACTS)

  assert.match(prompt, /공식전 3경기 \+ 친선경기 1경기/)
  assert.match(prompt, /친선경기가 섞여 있으면 그 사실을 밝힌다/)
})

test('공식전만 있으면 친선 표기가 붙지 않는다', () => {
  const official = FACTS.recent.filter(m => !m.isFriendly)
  const prompt = buildHintPrompt({ ...FACTS, recent: official })

  assert.match(prompt, /공식전 3경기/)
  assert.doesNotMatch(prompt, /친선경기 \d경기\)/)
})

test('맞대결이 없으면 "이번 시즌 첫 맞대결"을 사실로 넘긴다', () => {
  // 섹션을 통째로 빼면 모델이 그 말을 할 수가 없어서, 없다는 것도 사실로 준다.
  const prompt = buildHintPrompt(DOUBLE)

  assert.match(prompt, /- 토트넘: 이번 시즌 아직 만난 적 없음\(이번 시즌 첫 맞대결\)/)
  // fixtures가 이번 시즌만 담으므로 "처음 상대한다"로 줄이면 거짓이 된다 — 규칙으로 막는다
  assert.match(prompt, /"이번 시즌"을 빼고 "처음 상대한다"고 쓰면 거짓이 된다/)
})

test('맞대결이 있으면 스코어를 그대로 넘긴다', () => {
  assert.match(buildHintPrompt(FACTS), /- 브라이튼 \(1경기, 공식전 1경기\): 스코어 1-1/)
})

test('더블 매치위크는 경기를 모두 담고 한 문장으로 묶으라고 지시한다', () => {
  // 카드가 주차당 한 장이라(2026-08-25 확정) 경기별로 문단이 갈리면 안 된다.
  const prompt = buildHintPrompt(DOUBLE)

  assert.match(prompt, /- 뉴캐슬 vs 브라이튼 \(홈\)/)
  assert.match(prompt, /- 뉴캐슬 vs 토트넘 \(원정\)/)
  assert.match(prompt, /상대 이름을 함께 묶어 한 문장으로 쓴다/)
})

test('스코어를 찍지 말라는 규칙이 프롬프트에 있다', () => {
  // 2026-08-25 확정: 힌트는 재료만 준다. 이 문구가 빠지면 기능 성격 자체가 바뀐다.
  const prompt = buildHintPrompt(FACTS)

  assert.match(prompt, /스코어를 예측하거나 추천하지 않는다/)
  assert.match(prompt, /주어진 사실만 쓴다/)
  // 화면에 이미 있는 정보를 반복하던 것("다음 경기는 토트넘과의 원정 경기입니다")을 막는 규칙
  assert.match(prompt, /화면에 이미 있으므로 다시 말하지 않는다/)
})

test('원정 경기는 원정으로 표기된다', () => {
  const away = { ...FACTS, matches: [{ ...FACTS.matches[0], isHome: false }] }
  assert.match(buildHintPrompt(away), /- 뉴캐슬 vs 브라이튼 \(원정\)/)
})
