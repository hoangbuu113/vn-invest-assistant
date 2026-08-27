import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export function Fintech3DOrb({ size = 110, className = '' }) {
  const mountRef = useRef(null);
  const [hasWebGL, setHasWebGL] = useState(true);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHasWebGL(false);
      return;
    }

    let animationFrameId;
    let renderer, scene, camera, rootGroup;
    let coreSphere, wireframeGlobe, constellationNodes, constellationLines, ring1, ring2, particlePoints, candleBars;
    let isVisible = true;

    try {
      // 1. Scene & Camera
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.z = 4.5;

      // 2. WebGL Renderer
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setSize(size, size);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);

      rootGroup = new THREE.Group();
      scene.add(rootGroup);

      // 3. Layered Translucent Financial Core
      const coreGeo = new THREE.SphereGeometry(0.85, 24, 24);
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x1d4ed8,
        roughness: 0.1,
        metalness: 0.5,
        transparent: true,
        opacity: 0.6,
        emissive: 0x1e3a8a,
        emissiveIntensity: 0.35
      });
      coreSphere = new THREE.Mesh(coreGeo, coreMat);
      rootGroup.add(coreSphere);

      // 4. Financial Network Wireframe & Nodes (Constellation)
      const nodeCount = 14;
      const nodePositions = [];
      const nodeGeo = new THREE.SphereGeometry(0.035, 8, 8);
      const nodeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const nodesGroup = new THREE.Group();

      for (let i = 0; i < nodeCount; i++) {
        const theta = (i / nodeCount) * Math.PI * 2 + (i % 2) * 0.4;
        const phi = Math.acos((i / (nodeCount - 1)) * 2 - 1);
        const r = 0.98;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        const node = new THREE.Mesh(nodeGeo, nodeMat);
        node.position.set(x, y, z);
        nodesGroup.add(node);
        nodePositions.push(new THREE.Vector3(x, y, z));
      }
      rootGroup.add(nodesGroup);
      constellationNodes = nodesGroup;

      // 5. Constellation Network Connection Lines
      const linePositions = [];
      for (let i = 0; i < nodePositions.length; i++) {
        for (let j = i + 1; j < nodePositions.length; j++) {
          if (nodePositions[i].distanceTo(nodePositions[j]) < 0.95) {
            linePositions.push(nodePositions[i].x, nodePositions[i].y, nodePositions[i].z);
            linePositions.push(nodePositions[j].x, nodePositions[j].y, nodePositions[j].z);
          }
        }
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.4
      });
      constellationLines = new THREE.LineSegments(lineGeo, lineMat);
      rootGroup.add(constellationLines);

      // 6. Mini Candlestick Geometric Markers
      const candleGroup = new THREE.Group();
      const candleCount = 4;
      const barGeo = new THREE.BoxGeometry(0.04, 0.22, 0.04);
      const wickGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.35, 6);
      const greenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

      for (let i = 0; i < candleCount; i++) {
        const isGreen = i % 2 === 0;
        const mat = isGreen ? greenMat : redMat;
        const bar = new THREE.Mesh(barGeo, mat);
        const wick = new THREE.Mesh(wickGeo, mat);
        const cMesh = new THREE.Group();
        cMesh.add(bar);
        cMesh.add(wick);

        const angle = (i / candleCount) * Math.PI * 2;
        const radius = 1.32;
        cMesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.4, Math.sin(angle) * 0.5);
        cMesh.rotation.z = Math.sin(angle) * 0.3;
        candleGroup.add(cMesh);
      }
      rootGroup.add(candleGroup);
      candleBars = candleGroup;

      // 7. Thin Precision Orbital Rings
      const ringGeo1 = new THREE.TorusGeometry(1.4, 0.012, 12, 64);
      const ringMat1 = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.75 });
      ring1 = new THREE.Mesh(ringGeo1, ringMat1);
      ring1.rotation.x = Math.PI / 2.6;
      rootGroup.add(ring1);

      const ringGeo2 = new THREE.TorusGeometry(1.58, 0.01, 12, 64);
      const ringMat2 = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.65 });
      ring2 = new THREE.Mesh(ringGeo2, ringMat2);
      ring2.rotation.y = Math.PI / 3.2;
      ring2.rotation.x = -Math.PI / 4.8;
      rootGroup.add(ring2);

      // 8. Ambient Particle Field
      const particleCount = 20;
      const particlePositions = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = 1.35 + Math.random() * 0.5;

        particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        particlePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        particlePositions[i * 3 + 2] = r * Math.cos(phi);
      }

      const particleGeo = new THREE.BufferGeometry();
      particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      const particleMat = new THREE.PointsMaterial({
        color: 0x93c5fd,
        size: 0.045,
        transparent: true,
        opacity: 0.8
      });
      particlePoints = new THREE.Points(particleGeo, particleMat);
      rootGroup.add(particlePoints);

      // 9. Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
      scene.add(ambientLight);

      const light1 = new THREE.PointLight(0x3b82f6, 2.5, 10);
      light1.position.set(3, 3, 3);
      scene.add(light1);

      const light2 = new THREE.PointLight(0x10b981, 1.8, 10);
      light2.position.set(-3, -2, 2);
      scene.add(light2);

      // Pointer Parallax
      let targetRotX = 0;
      let targetRotY = 0;

      const handleMouseMove = (e) => {
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const x = (e.clientX - centerX) / (window.innerWidth / 2);
        const y = (e.clientY - centerY) / (window.innerHeight / 2);
        targetRotY = x * 0.45;
        targetRotX = y * 0.45;
      };

      window.addEventListener('mousemove', handleMouseMove, { passive: true });

      const handleVisibilityChange = () => {
        isVisible = !document.hidden;
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // 10. Animation Loop
      const clock = new THREE.Clock();
      const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        if (!isVisible) return;

        const delta = clock.getDelta();

        // Slow rotations
        coreSphere.rotation.y += delta * 0.3;
        constellationNodes.rotation.y -= delta * 0.22;
        constellationLines.rotation.y -= delta * 0.22;
        ring1.rotation.z += delta * 0.4;
        ring2.rotation.z -= delta * 0.32;
        candleGroup.rotation.y += delta * 0.2;
        particlePoints.rotation.y += delta * 0.1;

        // Smooth mouse inertia lerp
        rootGroup.rotation.y += (targetRotY - rootGroup.rotation.y) * 0.06;
        rootGroup.rotation.x += (targetRotX - rootGroup.rotation.x) * 0.06;

        renderer.render(scene, camera);
      };

      animate();

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        cancelAnimationFrame(animationFrameId);

        if (renderer && renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }

        // Dispose memory
        coreGeo.dispose();
        coreMat.dispose();
        nodeGeo.dispose();
        nodeMat.dispose();
        lineGeo.dispose();
        lineMat.dispose();
        barGeo.dispose();
        wickGeo.dispose();
        greenMat.dispose();
        redMat.dispose();
        ringGeo1.dispose();
        ringMat1.dispose();
        ringGeo2.dispose();
        ringMat2.dispose();
        particleGeo.dispose();
        particleMat.dispose();
        renderer.dispose();
      };
    } catch (err) {
      console.warn('WebGL initialization failed, falling back to 2D icon:', err);
      setHasWebGL(false);
    }
  }, [size]);

  if (!hasWebGL) {
    return (
      <div
        className={`fintech-orb-fallback ${className}`}
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(16,185,129,0.15))',
          border: '1px solid rgba(59,130,246,0.3)',
          boxShadow: '0 4px 16px rgba(37,99,235,0.15)',
          fontSize: size * 0.4
        }}
      >
        <span className="float-icon">💎</span>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className={`fintech-3d-orb-container ${className}`}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        userSelect: 'none'
      }}
    />
  );
}
