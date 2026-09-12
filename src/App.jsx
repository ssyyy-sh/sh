import { useEffect, useRef, useState } from "react";
import "./App.css";

/**
 * App — a gift-wrapped intro that opens into a self-drawing heart made of a
 * repeating phrase, with slow falling petals behind it and a quiet
 * generative ambient pad that starts the moment the gift is opened.
 *
 * All visual styling lives in App.css — this file is animation + logic only.
 */
export default function App({
  phrase = "I love you, Shahina ",
  caption = "for you, Shahina, always",
}) {
  const canvasRef = useRef(null);
  const petalsRef = useRef(null);
  const wrapRef = useRef(null);
  const outerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [typed, setTyped] = useState("");
  const [musicOn, setMusicOn] = useState(false);
  const [opened, setOpened] = useState(false);
  const pointer = useRef({ x: 0, y: 0, active: false, tiltX: 0, tiltY: 0 });
  const bursts = useRef([]);
  const audio = useRef(null);

  const isSmall = typeof window !== "undefined" && window.innerWidth < 560;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ---------------- quiet generative pad (Web Audio, no audio files) ----------------
  function buildAudio() {
    if (audio.current) return audio.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    const irLen = ctx.sampleRate * 2.5;
    const impulse = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5);
      }
    }
    convolver.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.4; // a bit more wash, feels softer/further away
    convolver.connect(wet);
    wet.connect(master);

    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    dry.connect(master);

    // Cmaj6/9 voicing (C E G A D) — warmer and more consonant than a major 7th
    const notes = [261.63, 329.63, 392.0, 440.0, 587.33];
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.12;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 850; // darker/gentler tone
    filter.Q.value = 0.3;

    const voices = notes.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      // gentler detune so voices barely shimmer instead of beating
      osc.detune.value = (i % 2 === 0 ? -1 : 1) * (2 + i * 0.5);
      const g = ctx.createGain();
      g.gain.value = 1 / notes.length;
      osc.connect(g);
      g.connect(filter);
      return { osc, g };
    });

    filter.connect(oscGain);
    oscGain.connect(dry);
    oscGain.connect(convolver);

    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = 0.03; // slower filter sweep
    const lfo1Gain = ctx.createGain();
    lfo1Gain.gain.value = 200;
    lfo1.connect(lfo1Gain);
    lfo1Gain.connect(filter.frequency);

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.05; // slower, subtler breathing
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.03;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(oscGain.gain);

    voices.forEach(({ osc }) => osc.start());
    lfo1.start();
    lfo2.start();

    audio.current = { ctx, master };
    return audio.current;
  }

  function startMusic() {
    const a = buildAudio();
    if (!a) return;
    if (a.ctx.state === "suspended") a.ctx.resume();
    const now = a.ctx.currentTime;
    a.master.gain.cancelScheduledValues(now);
    a.master.gain.linearRampToValueAtTime(0.32, now + 4); // slower fade-in, lower peak
    setMusicOn(true);
  }
  function stopMusic() {
    const a = audio.current;
    if (!a) return;
    const now = a.ctx.currentTime;
    a.master.gain.cancelScheduledValues(now);
    a.master.gain.linearRampToValueAtTime(0, now + 1.8);
    setMusicOn(false);
  }
  function toggleMusic() {
    if (musicOn) stopMusic();
    else startMusic();
  }

  useEffect(() => {
    return () => {
      if (audio.current) audio.current.ctx.close();
    };
  }, []);

  // ---------------- gift open ----------------
  function openGift() {
    if (opened) return;
    setOpened(true);
    startMusic();
    if (navigator.vibrate) navigator.vibrate(30);
  }

  // typewriter caption, starts once the heart is mostly drawn
  useEffect(() => {
    if (!opened) return;
    let i = 0;
    let t;
    const delay = reducedMotion ? 300 : 2200;
    const kickoff = setTimeout(() => {
      t = setInterval(() => {
        i++;
        setTyped(caption.slice(0, i));
        if (i >= caption.length) clearInterval(t);
      }, 55);
    }, delay);
    return () => {
      clearTimeout(kickoff);
      clearInterval(t);
    };
  }, [caption, reducedMotion, opened]);

  // ---------------- falling petals (own canvas, runs continuously) ----------------
  useEffect(() => {
    const canvas = petalsRef.current;
    const ctx = canvas.getContext("2d");
    let raf;
    let width, height, dpr;

    const COUNT = isSmall ? 12 : 20;
    const petals = Array.from({ length: COUNT }).map(() => ({
      x: Math.random(),
      y: Math.random(),
      size: 8 + Math.random() * 10,
      speed: 0.05 + Math.random() * 0.06, // slow fall
      sway: 0.4 + Math.random() * 0.8,
      swayPhase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.01,
      hue: 335 + Math.random() * 25,
      alpha: 0.25 + Math.random() * 0.35,
    }));

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawPetal(p, x, y) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(p.size * 0.6, -p.size * 0.3, p.size * 0.6, p.size * 0.6, 0, p.size);
      ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.6, -p.size * 0.6, -p.size * 0.3, 0, 0);
      ctx.fillStyle = `hsla(${p.hue}, 80%, 78%, ${p.alpha})`;
      ctx.fill();
      ctx.restore();
    }

    function frame(now) {
      ctx.clearRect(0, 0, width, height);
      const speedMul = reducedMotion ? 0 : 1;
      petals.forEach((p) => {
        p.y += (p.speed / 100) * speedMul;
        p.rot += p.rotSpeed * speedMul;
        if (p.y > 1.05) {
          p.y = -0.05;
          p.x = Math.random();
        }
        const sway = Math.sin(now / 1800 + p.swayPhase) * p.sway * 0.03;
        drawPetal(p, (p.x + sway) * width, p.y * height);
      });
      raf = requestAnimationFrame(frame);
    }

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [isSmall, reducedMotion]);

  // ---------------- heart canvas, starts once the gift is opened ----------------
  useEffect(() => {
    if (!opened) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext("2d");
    let raf;
    let width, height, dpr;

    const RING_COUNT = isSmall ? 6 : 8;
    const POINTS_PER_RING = isSmall ? 110 : 150;
    const SPARK_COUNT = isSmall ? 16 : 34;
    const BLUR_BASE = isSmall ? 5 : 9;
    const BLUR_DEPTH = isSmall ? 6 : 11;

    const rings = [];

    function buildPoints(scaleBase) {
      rings.length = 0;
      for (let r = 0; r < RING_COUNT; r++) {
        const scale = scaleBase * (0.58 + (r / (RING_COUNT - 1)) * 0.46);
        const jitter = r * 0.6;
        const pts = [];
        for (let i = 0; i < POINTS_PER_RING; i++) {
          const t = (i / POINTS_PER_RING) * Math.PI * 2;
          const x = 16 * Math.pow(Math.sin(t), 3);
          const y = -(
            13 * Math.cos(t) -
            5 * Math.cos(2 * t) -
            2 * Math.cos(3 * t) -
            Math.cos(4 * t)
          );
          pts.push({ x: x * scale, y: y * scale, order: Math.random() + jitter });
        }
        pts.sort((a, b) => a.order - b.order);
        rings.push(pts);
      }
    }

    const sparks = Array.from({ length: SPARK_COUNT }).map(() => ({
      a: Math.random() * Math.PI * 2,
      r: Math.random(),
      speed: 0.12 + Math.random() * 0.3,
      size: 1 + Math.random() * 1.9,
      phase: Math.random() * Math.PI * 2,
    }));

    function resize() {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, isSmall ? 2 : 2.5);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildPoints(Math.min(width, height) / 34);
    }

    function onPointerMove(e) {
      const rect = wrap.getBoundingClientRect();
      const px = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
      const py = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
      pointer.current.x = px;
      pointer.current.y = py;
      pointer.current.active = true;
      pointer.current.tiltY = (px / rect.width - 0.5) * (isSmall ? 8 : 16);
      pointer.current.tiltX = -(py / rect.height - 0.5) * (isSmall ? 8 : 16);
      if (outerRef.current && !reducedMotion) {
        outerRef.current.style.transform = `perspective(900px) rotateX(${pointer.current.tiltX}deg) rotateY(${pointer.current.tiltY}deg)`;
      }
    }
    function onPointerLeave() {
      pointer.current.active = false;
      if (outerRef.current) {
        outerRef.current.style.transform = `perspective(900px) rotateX(0deg) rotateY(0deg)`;
      }
    }
    function onTap(e) {
      const rect = wrap.getBoundingClientRect();
      const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX;
      const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY;
      const px = clientX - rect.left - width / 2;
      const py = clientY - rect.top - height / 2;
      const count = isSmall ? 6 : 8;
      for (let i = 0; i < count; i++) {
        bursts.current.push({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 2.4,
          vy: -1.2 - Math.random() * 1.6,
          life: 1,
          size: 8 + Math.random() * 10,
          hue: 335 + Math.random() * 20,
        });
      }
      pointer.current.x = clientX - rect.left;
      pointer.current.y = clientY - rect.top;
      pointer.current.active = true;
      if (navigator.vibrate) navigator.vibrate(12);
    }

    const start = performance.now();
    const DRAW_MS = reducedMotion ? 1 : isSmall ? 2000 : 2400;

    function frame(now) {
      const elapsed = now - start;
      const drawT = Math.min(1, elapsed / DRAW_MS);
      const eased = 1 - Math.pow(1 - drawT, 3);

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2 + Math.min(width, height) * 0.03;
      const breathe =
        reducedMotion || drawT < 1 ? 1 : 1 + Math.sin(now / 900) * 0.012;
      const hueShift = reducedMotion ? 0 : Math.sin(now / 4000) * 6;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breathe, breathe);

      const totalGlyphs = rings.length * POINTS_PER_RING;
      const revealed = Math.floor(totalGlyphs * eased);

      let count = 0;
      const fontSize = Math.max(7, Math.min(width, height) * 0.0185);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let r = 0; r < rings.length; r++) {
        const pts = rings[r];
        const depthT = r / (rings.length - 1);
        for (let i = 0; i < pts.length; i++) {
          if (count >= revealed) break;
          count++;
          const p = pts[i];

          let dx = 0,
            dy = 0;
          if (pointer.current.active) {
            const mx = pointer.current.x - cx;
            const my = pointer.current.y - cy;
            const ddx = p.x - mx;
            const ddy = p.y - my;
            const dist = Math.hypot(ddx, ddy);
            const REPEL_R = Math.min(width, height) * 0.14;
            if (dist < REPEL_R && dist > 0.01) {
              const f = (1 - dist / REPEL_R) * 6;
              dx = (ddx / dist) * f;
              dy = (ddy / dist) * f;
            }
          }

          const hue = 340 - depthT * 8 + hueShift;
          const light = 68 + depthT * 18;
          const alpha = 0.55 + depthT * 0.4;
          const ch = phrase[(r * 37 + i) % phrase.length];

          ctx.save();
          ctx.translate(p.x + dx, p.y + dy);
          ctx.font = `600 ${fontSize}px "Segoe UI", ui-sans-serif, system-ui, sans-serif`;
          ctx.shadowColor = `hsla(${hue}, 85%, 70%, 0.95)`;
          ctx.shadowBlur = BLUR_BASE + depthT * BLUR_DEPTH;
          ctx.fillStyle = `hsla(${hue}, 90%, ${light}%, ${alpha})`;
          ctx.fillText(ch, 0, 0);
          ctx.restore();
        }
        if (count >= revealed) break;
      }

      if (drawT > 0.6) {
        const glowT = (drawT - 0.6) / 0.4;
        [0.32, 0.2].forEach((frac, idx) => {
          const grad = ctx.createRadialGradient(
            0,
            0,
            0,
            0,
            0,
            Math.min(width, height) * frac
          );
          grad.addColorStop(0, `rgba(255,150,178,${(idx === 0 ? 0.1 : 0.16) * glowT})`);
          grad.addColorStop(1, "rgba(255,150,178,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, Math.min(width, height) * frac, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      if (drawT > 0.5) {
        const sparkT = Math.min(1, (drawT - 0.5) / 0.5);
        const R = Math.min(width, height) * 0.42;
        sparks.forEach((s) => {
          const rise = ((now / 1000) * s.speed + s.phase) % 3;
          const yOff = -rise * R * 0.55;
          const wob = Math.sin(now / 600 + s.phase) * 6;
          const x = Math.cos(s.a) * R * 0.35 * s.r + wob;
          const y = Math.sin(s.a) * R * 0.25 * s.r + yOff;
          const fade = Math.max(0, 1 - rise / 3) * sparkT;
          ctx.beginPath();
          ctx.fillStyle = `rgba(255, 214, 224, ${0.55 * fade})`;
          ctx.shadowColor = "rgba(255,190,205,0.9)";
          ctx.shadowBlur = isSmall ? 3 : 6;
          ctx.arc(x, y, s.size, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      bursts.current.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.vy += 0.035;
        b.life -= 0.018;
      });
      bursts.current = bursts.current.filter((b) => b.life > 0);
      bursts.current.forEach((b) => {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.font = `${b.size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = `hsla(${b.hue}, 90%, 75%, 0.9)`;
        ctx.shadowBlur = isSmall ? 4 : 8;
        ctx.fillStyle = `hsla(${b.hue}, 90%, 78%, 1)`;
        ctx.fillText("♥", 0, 0);
        ctx.restore();
      });

      ctx.restore();
      raf = requestAnimationFrame(frame);
    }

    resize();
    setReady(true);
    raf = requestAnimationFrame(frame);

    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    wrap.addEventListener("mousemove", onPointerMove);
    wrap.addEventListener("touchmove", onPointerMove, { passive: true });
    wrap.addEventListener("mouseleave", onPointerLeave);
    wrap.addEventListener("click", onTap);
    wrap.addEventListener("touchend", onTap, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      wrap.removeEventListener("mousemove", onPointerMove);
      wrap.removeEventListener("touchmove", onPointerMove);
      wrap.removeEventListener("mouseleave", onPointerLeave);
      wrap.removeEventListener("click", onTap);
      wrap.removeEventListener("touchend", onTap);
    };
  }, [opened, phrase, isSmall, reducedMotion]);

  return (
    <div className="th-page">
      <canvas ref={petalsRef} className="th-petals" />

      {opened && (
        <button
          className="th-sound-toggle"
          onClick={toggleMusic}
          aria-label={musicOn ? "Turn off music" : "Turn on music"}
          aria-pressed={musicOn}
        >
          {musicOn ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" />
              <path
                d="M16.5 8.5a5 5 0 0 1 0 7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M19 6a9 9 0 0 1 0 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity="0.6"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" />
              <path
                d="M16 9l5 5M21 9l-5 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      )}

      <div className={`th-gift ${opened ? "th-gift-hidden" : ""}`} onClick={openGift}>
        <svg viewBox="0 0 120 120" width="96" height="96" className="th-gift-icon">
          <rect x="20" y="46" width="80" height="58" rx="6" fill="none" stroke="currentColor" strokeWidth="3" />
          <rect x="20" y="46" width="80" height="16" fill="none" stroke="currentColor" strokeWidth="3" />
          <rect x="56" y="46" width="8" height="58" fill="none" stroke="currentColor" strokeWidth="3" />
          <path
            d="M60 46c-10-18-34-18-30-2 2 8 16 2 30 2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M60 46c10-18 34-18 30-2-2 8-16 2-30 2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        </svg>
        <p className="th-gift-text">tap to open</p>
      </div>

      <div ref={outerRef} className="th-outer">
        <div
          ref={wrapRef}
          className={`th-canvas-wrap ${ready ? "th-visible" : ""}`}
        >
          <canvas ref={canvasRef} className="th-canvas" />
        </div>
      </div>

      <div className={`th-caption ${ready ? "th-visible" : ""}`}>
        {typed}
        <span
          className="th-cursor"
          style={{ opacity: typed.length < caption.length ? 1 : 0 }}
        >
          |
        </span>
      </div>
    </div>
  );
}