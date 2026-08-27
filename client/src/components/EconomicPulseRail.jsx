import React from 'react';

const CATEGORIES = [
  { id: 'market', label: 'Thị trường', dotColor: '#2563eb', bg: '#eff6ff' },
  { id: 'company', label: 'Doanh nghiệp', dotColor: '#7c3aed', bg: '#faf5ff' },
  { id: 'macro', label: 'Vĩ mô', dotColor: '#059669', bg: '#ecfdf5' },
  { id: 'global', label: 'Quốc tế', dotColor: '#ea580c', bg: '#fff7ed' }
];

export function EconomicPulseRail() {
  return (
    <div className="economic-pulse-rail" aria-label="Luồng thông tin kinh tế">
      <span className="pulse-rail-title">LUỒNG TIN KINH TẾ:</span>
      <div className="pulse-rail-chips">
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="pulse-chip" style={{ backgroundColor: cat.bg }}>
            <span className="pulse-dot" style={{ backgroundColor: cat.dotColor }} />
            <span style={{ fontWeight: 600, color: 'var(--color-slate-700)' }}>{cat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

