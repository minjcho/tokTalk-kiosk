import { useEffect, useRef } from 'react';
import { VideoCanvas, type VideoAspectRatio, useVideoPlayer, VideoPausedContext } from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { HookScene, ProblemScene, OrderScene, ConfirmScene, CloseScene } from './Scenes';

export const SCENE_DURATIONS = { hook: 5000, problem: 5500, order: 10500, confirm: 5000, close: 5000 };
const SCENES: Record<string, React.ComponentType> = { hook: HookScene, problem: ProblemScene, order: OrderScene, confirm: ConfirmScene, close: CloseScene };
const START: Record<string, number> = (() => { const o: Record<string, number> = {}; let c = 0; for (const [k, v] of Object.entries(SCENE_DURATIONS)) { o[k] = c / 1000; c += v; } return o; })();
const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

export default function VideoTemplate({ durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange }: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean; onSceneChange?: (k: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  const base = currentSceneKey.replace(/_r[12]$/, '');
  const Scene = SCENES[base];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    a.volume = 0.5;
    if (paused) { a.pause(); return; }
    if (last.current !== currentSceneKey) {
      last.current = currentSceneKey;
      const t = START[base] ?? 0;
      if (Math.abs(a.currentTime - t) > 0.18) a.currentTime = t;
    }
    a.play().catch(() => {});
  }, [currentSceneKey, base, muted, paused]);
  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#FBF4EC' }}>
        <AnimatePresence mode="popLayout">{Scene && <Scene key={currentSceneKey} />}</AnimatePresence>
      </VideoCanvas>
      <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
    </VideoPausedContext.Provider>
  );
}
