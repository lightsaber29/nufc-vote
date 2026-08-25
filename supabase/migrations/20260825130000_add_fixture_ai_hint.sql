-- 스코어 예측 화면에 띄우는 AI 참고 문구.
--
-- 별도 테이블을 만들지 않는 이유: 경기 하나당 문구 하나뿐이고, 버전 이력도 필요 없다.
-- 생성 시점은 예측 화면 첫 조회 때(lazy) — 크론을 하나 더 붙일 만큼 급한 데이터가 아니고,
-- 같은 경기에 요청이 몰려 두어 번 중복 생성돼도 무해하다(무료 티어, 결과가 같은 컬럼을 덮어쓴다).
--
-- 내용은 예측 마감 전 정보라 "우리 팀 최근 폼 + 상대전적 + 선수 평점"까지만 담는다.
-- 다른 유저의 예측 분포는 넣지 않는다(밴드왜건으로 랭킹 변별력이 죽는다).
alter table public.fixtures add column if not exists ai_hint text;

comment on column public.fixtures.ai_hint is
  '예측 화면 AI 참고 문구. null이면 아직 생성 전이거나 생성 실패 — 그 경우 화면에서 카드가 빠진다.';

-- 쓰기는 서버(service role)만 한다. 읽기는 fixtures_public_read가 이미 전 컬럼을 열어준다.
