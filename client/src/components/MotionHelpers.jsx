import React, { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform, animate } from 'framer-motion';

/**
 * GlobalCursorSpotlight: Soft radial light layer following cursor smoothly on desktop.
 * Sits behind content, uses MotionValues for 60fps zero-setState performance.
 */
export function GlobalCursorSpotlight() {
  const mouseX = useMotionValue(-1000);
  const mouseY = useMotionValue(-1000);

  const springConfig = { damping: 28, stiffness: 180 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    // Only enable on non-touch devices with fine pointer
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const handleMouseMove = (e) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <motion.div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 600,
        height: 600,
        x: useTransform(smoothX, (x) => x - 300),
        y: useTransform(smoothY, (y) => y - 300),
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, rgba(16, 185, 129, 0.04) 45%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 0,
        filter: 'blur(30px)'
      }}
    />
  );
}

/**
 * PointerHalo: Subtle secondary pointer aura on desktop.
 */
export function PointerHalo() {
  const mouseX = useMotionValue(-100);
  const mouseY = useMotionValue(-100);
  const [isHoveringClickable, setIsHoveringClickable] = useState(false);

  const springConfig = { damping: 20, stiffness: 300 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const handleMouseMove = (e) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);

      const target = e.target;
      if (
        target &&
        (target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.closest('button') ||
          target.closest('a') ||
          target.classList.contains('row-interactive') ||
          target.classList.contains('radio-card-item'))
      ) {
        setIsHoveringClickable(true);
      } else {
        setIsHoveringClickable(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <motion.div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 32,
        height: 32,
        x: useTransform(smoothX, (x) => x - 16),
        y: useTransform(smoothY, (y) => y - 16),
        borderRadius: '50%',
        border: '1.5px solid rgba(37, 99, 235, 0.35)',
        backgroundColor: 'rgba(37, 99, 235, 0.04)',
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'width 0.2s ease, height 0.2s ease'
      }}
      animate={{
        scale: isHoveringClickable ? 1.6 : 1,
        borderColor: isHoveringClickable ? 'rgba(37, 99, 235, 0.6)' : 'rgba(37, 99, 235, 0.25)'
      }}
    />
  );
}

/**
 * MultiLayerBackground: Multi-depth ambient layers with subtle geometric data grid.
 */
export function MultiLayerBackground() {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 35, stiffness: 80 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const handleMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 35;
      const y = (e.clientY / window.innerHeight - 0.5) * 35;
      mouseX.set(x);
      mouseY.set(y);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden'
      }}
    >
      {/* Layer 1: Subtle Fintech Grid Texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(to right, rgba(226, 232, 240, 0.35) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(226, 232, 240, 0.35) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 65% at 50% 30%, #000 60%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 65% at 50% 30%, #000 60%, transparent 100%)',
          opacity: 0.7
        }}
      />

      {/* Layer 2: Deep Ambient Mesh Glows with Parallax */}
      <motion.div
        style={{
          position: 'absolute',
          top: '-15%',
          left: '-8%',
          width: '58vw',
          height: '58vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(191, 219, 254, 0.42) 0%, rgba(219, 234, 254, 0) 70%)',
          filter: 'blur(55px)',
          x: smoothX,
          y: smoothY
        }}
      />

      <motion.div
        style={{
          position: 'absolute',
          top: '-12%',
          right: '-12%',
          width: '52vw',
          height: '52vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167, 243, 208, 0.38) 0%, rgba(209, 250, 229, 0) 70%)',
          filter: 'blur(60px)',
          x: useTransform(smoothX, (v) => -v * 1.15),
          y: useTransform(smoothY, (v) => -v * 1.15)
        }}
      />

      <motion.div
        style={{
          position: 'absolute',
          bottom: '-25%',
          left: '20%',
          width: '65vw',
          height: '45vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(224, 231, 255, 0.35) 0%, rgba(241, 245, 249, 0) 70%)',
          filter: 'blur(75px)',
          x: useTransform(smoothX, (v) => v * 0.75),
          y: useTransform(smoothY, (v) => v * 0.75)
        }}
      />
    </div>
  );
}

/**
 * TiltCard: 3D perspective card tilt with dynamic spotlight glare.
 */
export function TiltCard({
  children,
  className = '',
  style = {},
  tiltMax = 5,
  glare = true,
  borderGlow = false,
  onClick,
  ...props
}) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [isHovered, setIsHovered] = useState(false);

  const springConfig = { damping: 24, stiffness: 240 };
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [tiltMax, -tiltMax]), springConfig);
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-tiltMax, tiltMax]), springConfig);

  const handleMouseMove = (e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const mouseFromLeft = e.clientX - rect.left;
    const mouseFromTop = e.clientY - rect.top;

    mouseX.set(mouseFromLeft);
    mouseY.set(mouseFromTop);

    x.set((mouseFromLeft / width) - 0.5);
    y.set((mouseFromTop / height) - 0.5);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      className={`tilt-card ${borderGlow ? 'card-border-glow' : ''} ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        transformStyle: 'preserve-3d',
        rotateX,
        rotateY,
        perspective: 1000,
        position: 'relative',
        ...style
      }}
      whileTap={{ scale: 0.985 }}
      {...props}
    >
      {children}

      {/* Dynamic Cursor Spotlight Glare */}
      {glare && isHovered && (
        <motion.div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            borderRadius: 'inherit',
            background: `radial-gradient(circle 260px at ${mouseX.get()}px ${mouseY.get()}px, rgba(255, 255, 255, 0.45), transparent 75%)`,
            zIndex: 3
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        />
      )}
    </motion.div>
  );
}

/**
 * MagneticButton: Shifts smoothly towards cursor when hovered with spring compression.
 */
export function MagneticButton({
  children,
  className = '',
  style = {},
  strength = 4,
  onClick,
  disabled = false,
  ...props
}) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { damping: 16, stiffness: 220 };
  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  const handleMouseMove = (e) => {
    if (disabled || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = (e.clientX - centerX) / (rect.width / 2);
    const deltaY = (e.clientY - centerY) / (rect.height / 2);

    x.set(deltaX * strength);
    y.set(deltaY * strength);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      className={`magnetic-btn ${className}`}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        x: springX,
        y: springY,
        ...style
      }}
      whileHover={!disabled ? { scale: 1.025 } : {}}
      whileTap={!disabled ? { scale: 0.96 } : {}}
      {...props}
    >
      {children}
    </motion.button>
  );
}

/**
 * CountUp: Smooth number transition on mount or value change.
 */
export function CountUp({
  value,
  duration = 0.65,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = ''
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(0);

  useEffect(() => {
    if (typeof value !== 'number' || isNaN(value)) {
      setDisplayValue(value);
      return;
    }

    const startVal = prevValueRef.current;
    prevValueRef.current = value;

    const controls = animate(startVal, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        setDisplayValue(latest);
      }
    });

    return () => controls.stop();
  }, [value, duration]);

  if (typeof value !== 'number' || isNaN(value)) {
    return <span className={className}>{value}</span>;
  }

  const formatted = decimals > 0
    ? Number(displayValue).toFixed(decimals)
    : Math.round(displayValue).toLocaleString('vi-VN');

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  );
}

/**
 * AnimatedNavTabs: Spring-sliding active indicator for navigation.
 */
export function AnimatedNavTabs({ tabs, activeTab, onChange }) {
  return (
    <nav className="nav-pill-wrapper" aria-label="Điều hướng chính" style={{ position: 'relative' }}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`nav-pill-item ${isActive ? 'active' : ''}`}
            style={{ position: 'relative', zIndex: 1 }}
          >
            {isActive && (
              <motion.div
                layoutId="activeTabPill"
                className="nav-active-pill-bg"
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 2px 8px -1px rgba(15, 23, 42, 0.1), 0 1px 2px rgba(15, 23, 42, 0.04)',
                  zIndex: -1
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            <motion.span
              animate={{ scale: isActive ? 1.12 : 1 }}
              transition={{ duration: 0.15 }}
            >
              {tab.icon}
            </motion.span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
