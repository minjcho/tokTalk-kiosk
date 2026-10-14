import { useEffect, useRef } from 'react';
import { VideoCanvas, type VideoAspectRatio, useVideoPlayer, VideoPausedContext } from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { S1, S2, S3, S4, S6, SCafe } from './Scenes';

export const SCENE_DURATIONS: Record<string, number> = { hook: 5000, problem: 5000, cafe: 8000, voice: 6000, option: 6000, close: 5000 };
const SCENE_COMPONENTS: Record<string, React.ComponentType> = { hook: S1, problem: S2, cafe: SCafe, voice: S3, option: S4, close: S6 };
const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

const START: Record<string, number> = (() => {
  const o: Record<string, number> = {}; let t = 0;
  for (const [k, ms] of Object.entries(SCENE_DURATIONS)) { o[k] = t / 1000; t += ms; }
  return o;
})();

export default function VideoTemplate({ durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange }: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean; onSceneChange?: (k: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  const base = currentSceneKey.replace(/_r[12]$/, '');
  const Scene = SCENE_COMPONENTS[base];
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
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#F5F1EA' }}>
        <AnimatePresence mode="popLayout">{Scene && <Scene key={currentSceneKey} />}</AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
