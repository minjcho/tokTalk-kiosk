import { useState } from 'react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';

export default function VideoWithControls() {
  const iframed = typeof window !== 'undefined' && window.self !== window.top;
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [scene, setScene] = useState(0);
  if (!iframed) return <VideoTemplate />;
  const keys = Object.keys(SCENE_DURATIONS);
  const btn = 'px-3 py-1 text-white/80 hover:text-white text-sm font-mono';
  return (
    <div className="relative w-full h-screen">
      <VideoTemplate paused={paused} muted={muted} onSceneChange={(k) => setScene(keys.indexOf(k.replace(/_r[12]$/, '')))} />
      <div className="absolute bottom-0 left-0 right-0 z-50 flex items-center gap-3 bg-black/50 px-4 py-2">
        <button className={btn} onClick={() => setPaused((p) => !p)}>{paused ? 'Play' : 'Pause'}</button>
        <button className={btn} onClick={() => setMuted((m) => !m)}>{muted ? 'Unmute' : 'Mute'}</button>
        <div className="flex flex-1 gap-1">{keys.map((k, i) => <div key={k} className={`h-2 flex-1 rounded-full ${i === scene ? 'bg-white' : 'bg-white/25'}`} />)}</div>
        <span className="text-white/70 text-sm font-mono">{scene + 1}/{keys.length}</span>
      </div>
    </div>
  );
}
