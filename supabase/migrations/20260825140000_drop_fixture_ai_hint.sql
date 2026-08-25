-- 20260825130000_add_fixture_ai_hint.sql 되돌리기.
--
-- 문구를 경기별로 붙였다가 주차 한 장으로 바꾸면서(2026-08-25 확정) 이 컬럼과 단위가 어긋났다.
-- 더 중요한 건 저장 자체가 필요 없었다는 것이다 — 조회 경로에 이미 unstable_cache가 있어서
-- DB 컬럼은 같은 값을 한 번 더 들고 있는 이중 캐시였다. 캐시 키를 week_key로 주면
-- 주차 단위가 그대로 맞고, service-role 쓰기 경로도 통째로 사라진다.
--
-- 문구는 재료(fixtures + 프롬프트)에서 언제든 다시 만들 수 있으므로 여기서 잃는 데이터는 없다.
alter table public.fixtures drop column if exists ai_hint;
