import { useCallback, useMemo, useState } from 'react';
export const stripRepeatSuffix = (k: string) => k.replace(/_r[12]$/, '');
export function useSceneControls(base: Record<string, number>) {
  const keys = useMemo(() => Object.keys(base), [base]);
  const [activeIndex, setActive] = useState(0);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mountKey, setMount] = useState(0);
  const [tick, setTick] = useState(0);
  const durations = useMemo(() => {
    if (locked) { const k = keys[activeIndex]; return { [`${k}_r1`]: base[k], [`${k}_r2`]: base[k] }; }
    const r: Record<string, number> = {};
    keys.forEach((_, i) => { const k = keys[(activeIndex + i) % keys.length]; r[k] = base[k]; });
    return r;
  }, [locked, activeIndex, keys, base]);
  const totalDuration = useMemo(() => Object.values(base).reduce((a, b) => a + b, 0), [base]);
  const activeStartTime = useMemo(() => keys.slice(0, activeIndex).reduce((a, k) => a + base[k], 0), [activeIndex, keys, base]);
  const onSceneChange = useCallback((raw: string) => {
    const i = keys.indexOf(stripRepeatSuffix(raw)); if (i >= 0) setActive(i); setTick((t) => t + 1);
  }, [keys]);
  const jumpTo = useCallback((i: number) => { setActive(i); setPaused(false); setMount((k) => k + 1); setTick((t) => t + 1); }, []);
  const toggleLock = useCallback(() => { setLocked((p) => !p); setPaused(false); setMount((k) => k + 1); setTick((t) => t + 1); }, []);
  const togglePause = useCallback(() => setPaused((p) => !p), []);
  return { sceneKeys: keys, activeIndex, locked, paused, mountKey, tick, durations, activeDuration: base[keys[activeIndex]] ?? 0, activeStartTime, totalDuration, onSceneChange, jumpTo, toggleLock, togglePause };
}
