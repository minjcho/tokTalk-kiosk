import { useEffect, useState } from 'react';
import { motion, type TargetAndTransition } from 'framer-motion';

const CORAL = '#E8501A', GREEN = '#1E6B49', INK = '#2A1810', CREAM = '#FBF4EC';
const BASE = import.meta.env.BASE_URL;
const fill = 'absolute inset-0';
const ease = [0.22, 1, 0.36, 1] as const;
const exit: TargetAndTransition = { opacity: 0 };

function useClock(times: number[]) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const ids = times.map((t, i) => setTimeout(() => setN(i + 1), t));
    return () => ids.forEach(clearTimeout);
  }, []); // eslint-disable-line
  return n;
}

export function HookScene() {
  const phrases = ['아아 두 잔 주세요', '뜨아 하나 주이소', '라떼 하나만 주이소'];
  const n = useClock([0, 1300, 2500]);
  const i = Math.max(0, n - 1);
  return (
    <motion.div className={fill} style={{ background: CORAL }} exit={exit}>
      <div className="absolute" style={{ left: '5%', top: '7%', color: CREAM, fontSize: '2.1vw', letterSpacing: '.3em', fontWeight: 600 }}>보이스 카페 · 서비스 데모</div>
      {phrases.map((p, k) => k === i && (
        <motion.div key={k} initial={{ scale: 1.25, opacity: 0, filter: 'blur(14px)' }} animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, ease }} className="absolute w-full text-center"
          style={{ top: '30%', color: CREAM, fontWeight: 700, fontSize: '9.5vw', lineHeight: 1.1, wordBreak: 'keep-all' }}>{p}</motion.div>
      ))}
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ delay: 3.2, duration: 0.5, ease }} className="absolute left-0 right-0 bottom-0 flex items-center justify-center"
        style={{ height: '24%', background: CREAM, color: INK, fontSize: "3.8vw", fontWeight: 700 }}>
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.5 }}>점원에게 말하듯, 편하게 주문하세요</motion.span>
      </motion.div>
    </motion.div>
  );
}

export function ProblemScene() {
  const n = useClock([200, 1200, 2400, 3400]);
  const tiny = ['사이즈', '샷', '시럽', '휘핑', '온도', '추가', '변경', '디카페인', '두유', '얼음', '옵션 선택', '장바구니'];
  return (
    <motion.div className={fill} style={{ background: INK }} exit={exit}>
      <div className="absolute flex flex-wrap gap-[.6vw]" style={{ left: '4%', top: '8%', width: '44%' }}>
        {tiny.concat(tiny).map((t, k) => (
          <motion.span key={k} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 0.55, scale: 1 }} transition={{ delay: k * 0.05, duration: 0.2 }}
            style={{ fontSize: '1.1vw', border: '1px solid #8a6c5c', color: '#d9c3b4', padding: '.3vw .7vw', borderRadius: 4 }}>{t}</motion.span>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: n > 0 ? 1 : 0, x: 0 }} className="absolute" style={{ left: '4%', top: '52%', color: '#d9c3b4', fontSize: '2.6vw' }}>작은 글씨, 겹겹의 메뉴 단계</motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: n > 1 ? 1 : 0 }} className="absolute" style={{ left: '4%', top: '62%', color: CREAM, fontSize: '5.4vw', fontWeight: 700, lineHeight: 1.15, wordBreak: 'keep-all' }}>
        키오스크 앞에서<br />손이 멈춥니다
      </motion.div>
      <motion.div initial={{ x: '110%' }} animate={{ x: n > 2 ? 0 : '110%' }} transition={{ duration: 0.55, ease }} className="absolute right-0 top-0 bottom-0 flex flex-col items-center justify-center"
        style={{ width: '44%', background: CORAL }}>
        <svg viewBox="0 0 24 24" style={{ width: '14vw', height: '14vw' }} fill="none" stroke={CREAM} strokeWidth="1.6" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: n > 3 ? 1 : 0, y: 0 }} style={{ color: CREAM, fontSize: '3.6vw', fontWeight: 700, marginTop: '1.5vw' }}>큰 버튼 하나, 말씀만</motion.div>
      </motion.div>
    </motion.div>
  );
}

function Row({ name, opt, price, img, delay, qty }: { name: string; opt?: string; price: string; img: string; delay: number; qty: number }) {
  return (
    <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.4, ease }} layout
      className="flex items-center" style={{ gap: '1.2vw', padding: '1vw 0', borderBottom: '1px solid #eadbcc' }}>
      <img src={`${BASE}menu/${img}.jpg`} style={{ width: '5.5vw', height: '5.5vw', objectFit: 'cover', borderRadius: 12 }} />
      <div className="flex-1">
        <div style={{ fontSize: '2vw', fontWeight: 700 }}>{name} × {qty}</div>
        {opt && <div style={{ fontSize: '1.4vw', color: CORAL, fontWeight: 600 }}>{opt}</div>}
      </div>
      <div style={{ fontSize: '2vw', fontWeight: 700 }}>{price}</div>
    </motion.div>
  );
}

export function OrderScene() {
  // t: 0 mic, 1 first utterance, 2 cart latte3?, 3 correction, 4 cart updated
  const n = useClock([300, 800, 4300, 5700, 6400, 7300]);
  const text1 = '라떼 세 잔 중에 하나는 샷 추가요';
  const text2 = '아니 세 잔 말고 두 잔이요';
  const shown = n >= 5 ? text2 : text1;
  const typed = n >= 5 ? 24 : n >= 2 ? 30 : 0;
  const three = n >= 4 && n < 6;
  const two = n >= 6;
  return (
    <motion.div className={fill} style={{ background: CREAM, color: INK }} exit={exit}>
      <div className="absolute flex items-center" style={{ left: '4%', top: '5%', fontSize: '2.2vw', fontWeight: 700, color: CORAL }}>보이스 카페</div>
      <div className="absolute" style={{ left: '4%', top: '14%', width: '44%' }}>
        <div style={{ fontSize: '3.4vw', fontWeight: 700 }}>무엇을 주문하시겠어요?</div>
        <div className="flex justify-center" style={{ margin: '3vw 0 2vw', position: 'relative' }}>
          {n >= 2 && n < 5 && [0, 1].map((r) => (
            <motion.div key={r} className="absolute rounded-full" style={{ width: '10vw', height: '10vw', border: `3px solid ${CORAL}` }}
              initial={{ scale: 1, opacity: 0.6 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ repeat: Infinity, duration: 1.4, delay: r * 0.7 }} />
          ))}
          <motion.div animate={{ scale: n === 1 || n === 5 ? 0.92 : 1 }} className="rounded-full flex items-center justify-center"
            style={{ width: '10vw', height: '10vw', background: CORAL, boxShadow: '0 1vw 2vw rgba(232,80,26,.3)' }}>
            <svg viewBox="0 0 24 24" style={{ width: '5vw', height: '5vw' }} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </motion.div>
        </div>
        <div style={{ border: '2px solid #eadbcc', borderRadius: 20, background: '#fff8f0', padding: '1.2vw 1.6vw', minHeight: '9vw' }}>
          <div style={{ fontSize: '1.3vw', color: '#8a6c5c' }}>인식된 말씀</div>
          <div style={{ fontSize: '2.5vw', fontWeight: 600, marginTop: '.4vw', wordBreak: 'keep-all', color: typed ? INK : '#b39b8c' }}>
            {typed ? shown.slice(0, typed) : '아직 말씀이 없어요'}
          </div>
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: n >= 5 ? 1 : 0 }} style={{ marginTop: '1.2vw', fontSize: '1.7vw', color: GREEN, fontWeight: 700 }}>
          앞서 담은 라떼 수량만 바꿨어요
        </motion.div>
      </div>
      <div className="absolute" style={{ right: '4%', top: '8%', width: '44%', bottom: '8%', background: '#fff', borderRadius: 28, padding: '2vw 2.2vw', boxShadow: '0 1.5vw 4vw rgba(42,24,16,.12)' }}>
        <div style={{ fontSize: '2.4vw', fontWeight: 700 }}>내 주문 <span style={{ color: CORAL }}>{two ? 2 : three ? 3 : 0}</span></div>
        {n < 4 && <div style={{ fontSize: '1.8vw', color: '#8a6c5c', marginTop: '4vw' }}>아직 담은 메뉴가 없어요</div>}
        {three && <Row key="a" img="cafe-latte" name="카페라떼 · 아이스" qty={3} opt="1잔 샷 추가 +500원" price="13,100원" delay={0} />}
        {two && <Row key="b" img="cafe-latte" name="카페라떼 · 아이스" qty={2} opt="1잔 샷 추가 +500원" price="8,900원" delay={0} />}
        <div className="absolute flex justify-between items-end" style={{ left: '2.2vw', right: '2.2vw', bottom: '2vw' }}>
          <div><div style={{ fontSize: '1.4vw', color: '#8a6c5c' }}>합계</div>
            <div style={{ fontSize: '3.4vw', fontWeight: 700 }}>{two ? '8,900원' : three ? '13,100원' : '0원'}</div></div>
          <div style={{ fontSize: '2vw', fontWeight: 700, background: two ? GREEN : '#a8c7b8', color: '#fff', padding: '1.1vw 2.4vw', borderRadius: 18 }}>주문 확인</div>
        </div>
      </div>
    </motion.div>
  );
}

export function ConfirmScene() {
  const n = useClock([300, 1300, 2300]);
  return (
    <motion.div className={fill} style={{ background: GREEN, color: CREAM }} exit={exit}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute" style={{ left: '6%', top: '14%', fontSize: '2.2vw', letterSpacing: '.2em' }}>화면을 눌러 직접 확인</motion.div>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5, ease }} className="absolute" style={{ left: '6%', top: '24%', fontSize: '7.6vw', fontWeight: 700, lineHeight: 1.1, wordBreak: 'keep-all' }}>
        마지막은<br />손끝으로
      </motion.div>
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: n > 0 ? 1 : 0 }} transition={{ duration: 0.5, ease }} className="absolute"
        style={{ right: '6%', top: '14%', width: '34%', background: CREAM, color: INK, borderRadius: 32, padding: '3vw', textAlign: 'center' }}>
        <div style={{ fontSize: '1.8vw', color: '#8a6c5c' }}>주문번호 (모의)</div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: n > 1 ? 1 : 0 }} style={{ fontSize: '6.4vw', fontWeight: 700, color: CORAL, letterSpacing: '.05em' }}>
          {n > 1 ? '483 217' : ''}
        </motion.div>
        <div style={{ fontSize: '1.7vw', marginTop: '.8vw' }}>카페라떼 2잔 · 8,900원</div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: n > 2 ? 1 : 0, y: 0 }} className="absolute" style={{ right: '6%', bottom: '14%', width: '34%', fontSize: '2vw', textAlign: 'center', color: '#cfe6da' }}>
        완료 후 대화 내용은 지워지고<br />다음 손님을 위한 새 화면으로
      </motion.div>
    </motion.div>
  );
}

export function CloseScene() {
  const feats = ['큰 터치 버튼', '사투리 그대로 메뉴·수량·옵션 인식', '180초 무입력 시 새 주문'];
  const n = useClock([200, 900, 1600, 2300, 3300]);
  return (
    <motion.div className={fill} style={{ background: CREAM, color: INK }} exit={exit}>
      <div className="absolute" style={{ left: '6%', top: '12%' }}>
        <div style={{ fontSize: '2vw', color: CORAL, fontWeight: 700, letterSpacing: '.2em' }}>카페 사장님께</div>
        {feats.map((f, k) => (
          <motion.div key={f} initial={{ opacity: 0, x: -40 }} animate={{ opacity: n > k ? 1 : 0, x: 0 }} transition={{ duration: 0.4, ease }}
            style={{ fontSize: '3.2vw', fontWeight: 700, marginTop: '2vw', display: 'flex', gap: '1.2vw', alignItems: 'center' }}>
            <span style={{ width: '1.2vw', height: '1.2vw', borderRadius: '50%', background: CORAL }} />{f}
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ y: '100%' }} animate={{ y: n > 3 ? 0 : '100%' }} transition={{ duration: 0.5, ease }} className="absolute left-0 right-0 bottom-0 flex flex-col items-center justify-center"
        style={{ height: '42%', background: CORAL, color: CREAM }}>
        <div style={{ fontSize: '6vw', fontWeight: 700 }}>보이스 카페</div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: n > 4 ? 1 : 0 }} style={{ fontSize: '1.5vw', marginTop: '.8vw', opacity: 0.9 }}>
          MVP 데모 · 모의 주문번호 · 결제·매장 POS 연동 없음 · 실매장 정확도 검증 전
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
