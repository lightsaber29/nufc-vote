'use client'

import { useState } from 'react'
import { User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/primitives/avatar'
import { Button } from '@/components/primitives/button'

/** 팀 엠블럼(FotMob CDN URL은 lib/predictions/week.ts의 teamLogoUrl이 만든다). 실패하면 이니셜 원형으로 폴백. */
export function TeamBadge({ logoUrl, name, size = 48 }: { logoUrl?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)

  if (failed || !logoUrl) {
    return (
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center rounded-pill bg-disabled text-label-1-normal font-black text-neutral-muted"
        style={{ width: size, height: size }}
      >
        {name.slice(0, 1)}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  )
}

/**
 * `PlayerPhoto` 폴백 전용 아이콘. **이 SVG를 직접 원으로 감싸 쓰지 마라** — 예측 화면 세 곳이
 * 각자 같은 원 클래스를 복제해 두는 바람에 폴백 톤을 바꿀 때 네 곳을 함께 고쳐야 했다.
 * "선수가 없다"는 자리에는 `<PlayerPhoto url={null} size={...} />`를 쓴다.
 */
export function Silhouette({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
    </svg>
  )
}

/**
 * 선수 사진 자리 — 사진이 없거나 **로드에 실패해도** 실루엣 원형으로 떨어진다.
 * `ui/avatar.tsx`(Radix Avatar)를 쓰므로 onError 핸들러가 필요 없다: Storage에 사진이 없는
 * 선수(막 합류해 아직 안 올린 경우)도 404를 받아 깨진 이미지 대신 실루엣이 남는다.
 * 크기는 Avatar 기본값(h-10 w-10)을 인라인 스타일로 덮어써서 임의 px를 그대로 받는다.
 */
export function PlayerPhoto({ url, size = 64 }: { url: string | null; size?: number }) {
  return (
    <Avatar className="shrink-0" style={{ width: size, height: size }}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-disabled text-neutral-subtle">
        <Silhouette />
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * 랭킹 목록의 사용자 아바타 — 사진이 없거나 **로드에 실패해도** User 아이콘 원형으로 떨어진다.
 * 구글 OAuth 아바타(lh3.googleusercontent.com)는 가입 시점 주소를 profiles.avatar_url에 저장해
 * 재사용하므로, 사용자가 프로필 사진을 바꾸거나 지우면 죽은 URL이 그대로 남는다 — 랭킹은 여러
 * 사용자를 한 화면에 나열하니 실패 처리가 없으면 목록에 깨진 이미지 아이콘이 섞인다.
 * `PlayerPhoto`와 같이 Radix Avatar를 쓰므로 onError 핸들러가 필요 없다.
 * 기본 28px = 두 랭킹 카드가 쓰던 h-7 w-7.
 */
export function UserAvatar({ url, size = 28 }: { url?: string | null; size?: number }) {
  return (
    <Avatar className="shrink-0" style={{ width: size, height: size }}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-disabled text-neutral-subtle">
        <User className="h-3.5 w-3.5" />
      </AvatarFallback>
    </Avatar>
  )
}

/** 공유하기 = 현재 주소 링크 복사(2026-08-22 결정). 퍼블리싱은 라벨만 있고 동작이 없었다. */
export function ShareButton() {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 권한이 없거나 보안 컨텍스트가 아니면 조용히 넘긴다 — 주소창에서 직접 복사할 수 있다.
    }
  }

  return (
    <Button className="w-40" onClick={copyLink}>
      {copied ? '링크 복사 완료' : '↗ 공유하기'}
    </Button>
  )
}
