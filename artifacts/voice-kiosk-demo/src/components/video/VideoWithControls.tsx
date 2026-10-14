import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const DETAILS: Record<string, { title: string; filePath: string }> = {
  hook: { title: '사투리 훅', filePath: 'src/components/video/Scenes.tsx' },
  problem: { title: '키오스크 앞의 망설임', filePath: 'src/components/video/Scenes.tsx' },
  order: { title: '말로 주문', filePath: 'src/components/video/Scenes.tsx' },
  confirm: { title: '터치 확인', filePath: 'src/components/video/Scenes.tsx' },
  close: { title: '마무리', filePath: 'src/components/video/Scenes.tsx' },
};

function Bar(p: ReturnType<typeof useSceneControls> & { muted: boolean; setMuted: (f: (m: boolean) => boolean) => void; onJump: (i: number) => void }) {
  const [el, setEl] = useState(0);
  const base = useRef(0);
  useEffect(() => { setEl(0); base.current = 0; }, [p.tick]);
  useEffect(() => {
    if (p.paused) return;
    const s = performance.now();
    const id = window.setInterval(() => setEl(base.current + performance.now() - s), 60);
    return () => { clearInterval(id); base.current += performance.now() - s; };
  }, [p.tick, p.paused]);
  const prog = Math.min(1, el / p.activeDuration);
  const t = Math.floor(Math.min(p.totalDuration, p.activeStartTime + Math.min(el, p.activeDuration)) / 1000);
  const btn = 'w-14 h-14 flex items-center justify-center text-white/70 hover:text-white rounded-lg shrink-0';
  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex items-center gap-3 bg-black/50 px-5 py-4 backdrop-blur-sm">
      <button className={btn} aria-label="play/pause" onClick={p.togglePause}>{p.paused ? <Play className="w-8 h-8" /> : <Pause className="w-8 h-8" />}</button>
      <button className={btn} aria-label="loop scene" onClick={p.toggleLock} style={{ background: p.locked ? 'rgba(255,255,255,.15)' : undefined }}><Repeat className="w-8 h-8" /></button>
      <button className={btn} aria-label="mute" onClick={() => p.setMuted((m) => !m)}>{p.muted ? <VolumeX className="w-8 h-8" /> : <Volume2 className="w-8 h-8" />}</button>
      <div className="w-px self-stretch bg-white/15" />
      <div className="flex-1 flex gap-1.5">
        {p.sceneKeys.map((k, i) => (
          <button key={k} aria-label={`scene ${i + 1}`} onClick={() => p.onJump(i)} className="flex-1 h-3 bg-white/20 rounded-full overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 bg-white/90" style={{ width: `${i === p.activeIndex ? prog * 100 : 0}%` }} />
          </button>
        ))}
      </div>
      <div className="text-xl text-white/60 font-mono">{p.activeIndex + 1}/{p.sceneKeys.length}</div>
      <div className="min-w-[11ch] text-right text-xl text-white/80 font-mono">0:{String(t).padStart(2, '0')} / 0:{String(Math.floor(p.totalDuration / 1000)).padStart(2, '0')}</div>
    </div>
  );
}

export default function VideoWithControls() {
  const iframed = typeof window !== 'undefined' && window.self !== window.top;
  const c = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const jump = useCallback((i: number) => {
    c.jumpTo(i);
    const d = DETAILS[c.sceneKeys[i]];
    if (d) window.parent.postMessage({ type: 'REPLIT_VIDEO_SCENE_SELECTED', payload: { sceneIndex: i, sceneCount: c.sceneKeys.length, sceneTitle: d.title, filePath: d.filePath, lineNumber: 1 } }, '*');
  }, [c]);
  useEffect(() => {
    if (!c.paused) return;
    const f = document.getAnimations().filter((a) => a.playState === 'running');
    f.forEach((a) => a.pause());
    return () => f.forEach((a) => a.play());
  }, [c.paused]);
  if (!iframed) return <VideoTemplate />;
  return (
    <div className="relative w-full h-screen">
      <VideoTemplate key={c.mountKey} durations={c.durations} loop paused={c.paused} muted={muted} onSceneChange={c.onSceneChange} />
      <Bar {...c} muted={muted} setMuted={setMuted} onJump={jump} />
    </div>
  );
}
