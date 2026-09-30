"use client";
import { useEffect, useRef } from "react";
export default function Home() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cleanup: undefined | (() => void), disposed = false;
    import("@/lib/game/app").then(({ mountGame }) => { if (!disposed && host.current) cleanup = mountGame(host.current); }).catch(err => { if (host.current) host.current.textContent = `게임을 열 수 없습니다: ${err.message}`; });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  return <main ref={host} className="game-host" aria-label="NIGHTFALL 생존 게임"><div className="boot"><span className="eyebrow">3D SURVIVAL</span><h1>NIGHTFALL</h1><p>섬을 불러오는 중…</p></div></main>;
}
