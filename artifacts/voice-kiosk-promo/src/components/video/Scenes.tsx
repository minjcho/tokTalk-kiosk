import { motion } from 'framer-motion';
import { useContext, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { VideoPausedContext } from '@/lib/video';

const B = import.meta.env.BASE_URL;
const img = (n: string) => `${B}images/${n}`;
const ease = [0.22, 1, 0.36, 1] as const;
const C = { acc: '#EC4613', green: '#22774F', fg: '#291F19', sur: '#FCFAF8', soft: '#F5F1EA', mut: '#6B5F57', bd: '#E4DED8' };

function Scene({ children, bg = C.soft, i = 0 }: { children: ReactNode; bg?: string; i?: number }) {
  const origins = ['50% 50%', '85% 50%', '15% 60%', '50% 90%', '50% 10%', '50% 50%'];
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      style={{ background: bg }}
      initial={{ clipPath: `circle(0% at ${origins[i]})` }}
      animate={{ clipPath: `circle(150% at ${origins[i]})` }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease }}
    >
      {children}
    </motion.div>
  );
}
const pop = (d: number, extra = {}) => ({
  initial: { opacity: 0, y: 4, scale: 0.9, ...extra },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { delay: d, type: 'spring' as const, stiffness: 260, damping: 22 },
});
const T = (s: CSSProperties): CSSProperties => ({ position: 'absolute', margin: 0, lineHeight: 1.12, letterSpacing: '-0.02em', ...s });

function Mic({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', width: `${size}vmin`, height: `${size}vmin`, ...style }}>
      {[0, 1].map((k) => (
        <motion.div key={k} style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `0.5vmin solid ${C.acc}` }}
          animate={{ scale: [1, 1.8], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: k * 0.8 }} />
      ))}
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: C.acc, display: 'grid', placeItems: 'center', boxShadow: '0 2vmin 4vmin rgba(236,70,19,.28)' }}>
        <svg viewBox="0 0 24 24" width="50%" height="50%" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </div>
    </div>
  );
}


function Morph({ d, size, color, final = '톡톡' }: { d: number; size: number; color: string; final?: string }) {
  const w = (t: string, from: number, to: number | null) => (
    <motion.span key={t} style={{ position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap' }}
      initial={{ opacity: 0, y: size * 0.25, scale: 0.8 }}
      animate={to === null ? { opacity: 1, y: 0, scale: 1 } : { opacity: [0, 1, 1, 0], y: [size * 0.25, 0, 0, -size * 0.25], scale: [0.8, 1, 1, 1] }}
      transition={to === null ? { delay: d + from, type: 'spring', stiffness: 260, damping: 20 } : { delay: d + from, duration: to - from, times: [0, 0.2, 0.8, 1] }}>{t}</motion.span>
  );
  return (
    <div style={{ position: 'relative', height: `${size * 1.2}vmin`, width: `${size * 3}vmin`, fontSize: `${size}vmin`, fontWeight: 700, color, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
      {w('톡', 0, 0.9)}{w('talk', 0.8, 1.7)}{w(final, 1.6, null)}
    </div>
  );
}

export function S1() {
  return (
    <Scene i={0}>
      <motion.div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '58%', background: C.acc }}
        initial={{ x: '-100%' }} animate={{ x: 0 }} transition={{ duration: 0.6, ease }} />
      <motion.h1 {...pop(0.3)} style={T({ left: '6vmin', top: '16vmin', fontSize: '15vmin', fontWeight: 700, color: '#fff' })}>말하면,</motion.h1>
      <motion.h1 {...pop(0.8)} style={T({ left: '6vmin', top: '33vmin', fontSize: '12vmin', fontWeight: 700, color: C.fg })}>주문이 됩니다.</motion.h1>
      <motion.p {...pop(1.6)} style={T({ left: '6vmin', top: '60vmin', fontSize: '3.6vmin', color: '#FFF3EC', fontWeight: 400 })}>점원에게 말하듯, 편하게 주문하세요</motion.p>
      <div style={{ position: 'absolute', left: '6vmin', bottom: '6vmin' }}><Morph d={2.2} size={8} color={C.fg} /></div>
      <motion.div style={{ position: 'absolute', right: '7vmin', top: '5vmin', height: '90vmin', width: '74vmin', borderRadius: '2vmin', overflow: 'hidden', boxShadow: '0 3vmin 8vmin rgba(41,31,25,.3)', background: C.sur }}
        initial={{ y: '40vmin', rotate: 6, opacity: 0 }} animate={{ y: 0, rotate: -3, opacity: 1 }} transition={{ delay: 0.4, duration: 1, ease }}>
        <img src={img('kiosk-current.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
      </motion.div>
      <motion.div style={{ position: 'absolute', right: '4vmin', top: '4vmin', width: 0, height: 0 }} />
    </Scene>
  );
}

export function S2() {
  const items = ['작은 글씨', '여러 선택 단계'];
  return (
    <Scene i={1} bg={C.sur}>
      <motion.p {...pop(0.2)} style={T({ left: '6vmin', top: '7vmin', fontSize: '2.2vmin', fontWeight: 600, letterSpacing: '0.16em', color: C.acc })}>문제 가설</motion.p>
      {items.map((t, k) => (
        <div key={t} style={T({ left: '6vmin', top: `${16 + k * 20}vmin` })}>
          <motion.span {...pop(0.4 + k * 0.5)} style={{ display: 'inline-block', fontSize: '14vmin', fontWeight: 700, color: C.fg }}>{t}</motion.span>
          <motion.div style={{ position: 'absolute', left: 0, top: '56%', height: '1.6vmin', background: C.acc, transformOrigin: 'left', width: '100%' }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.3 + k * 0.5, duration: 0.35, ease }} />
        </div>
      ))}
      <motion.div style={{ position: 'absolute', left: '6vmin', right: '6vmin', bottom: '7vmin', height: '24vmin', borderRadius: '2vmin', background: C.green, display: 'flex', alignItems: 'center', gap: '4vmin', padding: '0 5vmin' }}
        initial={{ y: '40vmin' }} animate={{ y: 0 }} transition={{ delay: 2.4, duration: 0.7, ease }}>
        <div style={{ position: 'relative', width: '14vmin', height: '14vmin', flex: 'none' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center' }}>
            <svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" stroke={C.acc} strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8vmin', fontWeight: 700, color: '#fff' }}>큰 마이크 버튼 하나</div>
          <div style={{ fontSize: '3.4vmin', color: '#DDEFE5' }}>어려우면 언제든 터치로 전환</div>
        </div>
      </motion.div>
    </Scene>
  );
}

function Bubble({ say, res, d, y, photo }: { say: string; res: string; d: number; y: number; photo?: string }) {
  return (
    <>
      <motion.div {...pop(d, { x: -30 })} style={{ position: 'absolute', left: '6vmin', top: `${y}vmin`, background: '#fff', border: `0.4vmin solid ${C.bd}`, borderRadius: '4vmin 4vmin 4vmin 0.8vmin', padding: '3vmin 4vmin', fontSize: '6.4vmin', fontWeight: 700 }}>“{say}”</motion.div>
      <motion.div {...pop(d + 0.9, { x: 30 })} style={{ position: 'absolute', right: '6vmin', top: `${y + 8}vmin`, background: C.acc, color: '#fff', borderRadius: '4vmin 4vmin 0.8vmin 4vmin', padding: '2.4vmin 4vmin', fontSize: '5.2vmin', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2.4vmin' }}>
        {photo && <img src={img(photo)} style={{ height: '11vmin', width: '8.5vmin', objectFit: 'cover', borderRadius: '1vmin' }} />}{res}
      </motion.div>
    </>
  );
}
export function S3() {
  return (
    <Scene i={2} bg={C.soft}>
      <motion.p {...pop(0.1)} style={T({ left: '6vmin', top: '6vmin', fontSize: '2.2vmin', fontWeight: 600, letterSpacing: '0.16em', color: C.acc })}>일상 표현 그대로</motion.p>
      <Bubble say="아아 두 잔 주세요" res="아이스 아메리카노 2잔" d={0.4} y={14} photo="americano.jpg" />
      <Bubble say="뜨아 하나 주이소" res="따뜻한 아메리카노 1잔" d={2.4} y={50} />
      <motion.p {...pop(4.4)} style={T({ left: '6vmin', bottom: '4vmin', fontSize: '2.4vmin', color: C.mut })}>표준어로 바꾸는 것이 아니라, 주문 내용을 맞춥니다</motion.p>
    </Scene>
  );
}

export function S4() {
  return (
    <Scene i={3} bg={C.sur}>
      <motion.h2 {...pop(0.2)} style={T({ left: '6vmin', top: '7vmin', fontSize: '6.4vmin', fontWeight: 700 })}>“라떼 두 잔 중에 하나는 샷 추가요”</motion.h2>
      {[{ x: 8, l: '기본 1잔', p: '4,200원', d: 0.6 }, { x: 40, l: '샷 추가 1잔', p: '4,700원', d: 1.2 }].map((c) => (
        <motion.div key={c.l} {...pop(c.d, { y: 40 })} style={{ position: 'absolute', left: `${c.x}vmin`, top: '24vmin', width: '28vmin', height: '58vmin', borderRadius: '2vmin', background: C.soft, border: `0.4vmin solid ${c.x > 20 ? C.acc : C.bd}`, overflow: 'hidden' }}>
          <img src={img('cafe-latte.jpg')} style={{ width: '100%', height: '40vmin', objectFit: 'cover' }} />
          <div style={{ padding: '1.6vmin 2.4vmin', fontSize: '3.2vmin', fontWeight: 700 }}>{c.l}<div style={{ color: C.acc, fontSize: '3.6vmin' }}>{c.p}</div></div>
        </motion.div>
      ))}
      <motion.div {...pop(2.2)} style={{ position: 'absolute', right: '6vmin', top: '26vmin', width: '48vmin', background: C.fg, color: '#fff', borderRadius: '2vmin', padding: '4vmin' }}>
        <div style={{ fontSize: '2.6vmin', color: '#CFC5BC' }}>합계</div>
        <div style={{ fontSize: '10.5vmin', fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap' }}>8,900원</div>
      </motion.div>
      <motion.div {...pop(3.4)} style={{ position: 'absolute', right: '6vmin', top: '62vmin', width: '48vmin', background: '#fff', border: `0.4vmin solid ${C.acc}`, borderRadius: '2vmin', padding: '2.4vmin 3vmin' }}>
        <div style={{ fontSize: '3.4vmin', fontWeight: 700 }}>“아니 세 잔 말고 두 잔이요”</div>
        <div style={{ fontSize: '2.6vmin', color: C.mut }}>수량은 줄고, 샷 추가는 그대로</div>
      </motion.div>
    </Scene>
  );
}

export function S6() {
  return (
    <Scene i={5} bg={C.green}>
      <Mic size={30} style={{ right: '10vmin', top: '12vmin' }} />
      <motion.div {...pop(1.2)} style={{ position: 'absolute', right: '6vmin', top: '52vmin', width: '38vmin', textAlign: 'center' }}>
        <div style={{ fontSize: '15vmin', fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>톡톡</div>
        <div style={{ fontSize: '3vmin', color: '#DDEFE5', lineHeight: 1.4 }}>톡, 누르던 손끝에서<br />talk, 말하는 주문으로</div>
      </motion.div>
      <motion.p {...pop(0.2)} style={T({ left: '6vmin', top: '9vmin', fontSize: '2.4vmin', fontWeight: 600, letterSpacing: '0.16em', color: '#DDEFE5' })}>톡톡 · 말로 하는 카페 주문 아이디어</motion.p>
      <motion.h2 {...pop(0.5)} style={T({ left: '6vmin', top: '20vmin', fontSize: '13vmin', fontWeight: 700, color: '#fff' })}>말하면,<br />주문이 됩니다.</motion.h2>
      <motion.div {...pop(1.5)} style={{ position: 'absolute', left: '6vmin', bottom: '9vmin', background: '#fff', borderRadius: '10vmin', padding: '2vmin 5vmin', fontSize: '4.4vmin', fontWeight: 700, color: C.acc }}>점원에게 말하듯, 편하게 주문하세요</motion.div>
    </Scene>
  );
}

function Clip({ name, style }: { name: string; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const paused = useContext(VideoPausedContext);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => {});
  }, [paused]);
  return <video ref={ref} src={`${B}video/${name}.mp4`} muted playsInline autoPlay preload="auto"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
}
function Disclosure() {
  return <motion.div {...pop(0.5)} style={{ position: 'absolute', right: '4vmin', top: '4vmin', background: 'rgba(41,31,25,.72)', color: '#fff', borderRadius: '10vmin', padding: '1.2vmin 3vmin', fontSize: '2.8vmin', fontWeight: 600 }}>AI 생성 연출 영상 · 가상의 카페와 인물</motion.div>;
}
const lower = (d: number, t: string, sub: string): ReactNode => (
  <motion.div {...pop(d, { x: -40 })} style={{ position: 'absolute', left: '6vmin', bottom: '7vmin', background: C.sur, borderLeft: `1.2vmin solid ${C.acc}`, borderRadius: '1.2vmin', padding: '2vmin 3.6vmin', boxShadow: '0 2vmin 5vmin rgba(41,31,25,.3)' }}>
    <div style={{ fontSize: '7vmin', fontWeight: 700 }}>{t}</div><div style={{ fontSize: '3vmin', color: C.mut }}>{sub}</div>
  </motion.div>
);

export function SCafe() {
  const [showB, setShowB] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShowB(true), 3600); return () => clearTimeout(t); }, []);
  return (
    <Scene i={2} bg={C.fg}>
      <motion.div style={{ position: 'absolute', inset: 0 }} initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 4, ease: 'linear' }}><Clip name="a-approach" /></motion.div>
      {showB && <motion.div style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0, scale: 1.0 }} animate={{ opacity: 1, scale: 1.06 }} transition={{ opacity: { duration: 0.4 }, scale: { duration: 4.4, ease: 'linear' } }}><Clip name="b-speak" /></motion.div>}
      <Disclosure />
      {!showB && lower(0.8, '키오스크가 낯설어도', '큰 마이크 버튼 하나로 시작')}
      {showB && lower(0.1, '버튼을 누르고, 말하면 됩니다', '인식된 말씀은 화면에 바로 표시')}
    </Scene>
  );
}
