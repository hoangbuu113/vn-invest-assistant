import React from 'react';
import { motion } from 'framer-motion';

const ORBIT_NODES = [
  { id: 'cash', label: 'Tiền mặt', icon: '💵', color: '#3b82f6' },
  { id: 'assets', label: 'Tài sản', icon: '📈', color: '#6366f1' },
  { id: 'market', label: 'Thị trường', icon: '🌐', color: '#06b6d4' },
  { id: 'portfolio', label: 'Danh mục', icon: '💎', color: '#10b981' }
];

export function WealthOrbit() {
  return (
    <div className="wealth-orbit-chip-container" aria-label="Vòng tuần hoàn vốn">
      <span className="wealth-orbit-title">CHU TRÌNH VỐN:</span>
      <div className="wealth-orbit-track">
        {ORBIT_NODES.map((node, index) => (
          <React.Fragment key={node.id}>
            <div className="wealth-orbit-node" style={{ '--node-color': node.color }}>
              <span className="wealth-orbit-icon">{node.icon}</span>
              <span className="wealth-orbit-label">{node.label}</span>
            </div>
            {index < ORBIT_NODES.length - 1 && (
              <motion.span
                className="wealth-orbit-arrow"
                animate={{ x: [0, 3, 0] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut', delay: index * 0.3 }}
              >
                &rarr;
              </motion.span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

