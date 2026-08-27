import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * MoneyFlowAmbience: Subtle decorative floating fintech glyphs (₫, %, ▲, ▼, data nodes)
 * with cursor parallax and faint edge flow paths.
 */
export function MoneyFlowAmbience() {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 40, stiffness: 60 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const handleMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 30;
      const y = (e.clientY / window.innerHeight - 0.5) * 30;
      mouseX.set(x);
      mouseY.set(y);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div
      className="money-flow-ambient-container"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden'
      }}
      aria-hidden="true"
    >
      {/* Edge Data Flow Line 1: Left Rail */}
      <div className="flow-line flow-line-left" />

      {/* Edge Data Flow Line 2: Right Rail */}
      <div className="flow-line flow-line-right" />

      {/* Floating Glyph 1: ₫ (VND Currency Glyph) Top Left */}
      <motion.div
        className="floating-fintech-glyph glyph-vnd"
        style={{
          top: '18%',
          left: '5%',
          x: useTransform(smoothX, (v) => v * 0.8),
          y: useTransform(smoothY, (v) => v * 0.8)
        }}
      >
        ₫
      </motion.div>

      {/* Floating Glyph 2: % (Yield / Growth Glyph) Top Right */}
      <motion.div
        className="floating-fintech-glyph glyph-percent"
        style={{
          top: '24%',
          right: '6%',
          x: useTransform(smoothX, (v) => -v * 1.1),
          y: useTransform(smoothY, (v) => -v * 1.1)
        }}
      >
        %
      </motion.div>

      {/* Floating Glyph 3: ▲ (Gain / Upward Pulse) Mid Left */}
      <motion.div
        className="floating-fintech-glyph glyph-gain-arrow"
        style={{
          top: '62%',
          left: '4%',
          x: useTransform(smoothX, (v) => v * 1.2),
          y: useTransform(smoothY, (v) => v * 1.2)
        }}
      >
        ▲
      </motion.div>

      {/* Floating Glyph 4: Data Node Orb Bottom Right */}
      <motion.div
        className="floating-fintech-glyph glyph-node"
        style={{
          bottom: '15%',
          right: '5%',
          x: useTransform(smoothX, (v) => -v * 0.7),
          y: useTransform(smoothY, (v) => -v * 0.7)
        }}
      >
        ⬡
      </motion.div>
    </div>
  );
}

