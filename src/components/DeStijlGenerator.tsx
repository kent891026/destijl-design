"use client";

import React, { useState, useEffect, useRef } from 'react';

const COLORS = {
  White: '#F4F4F4',
  Red: '#C5001A',
  Blue: '#003882',
  Yellow: '#E0AA0F',
  Black: '#1A1A1A'
};

const BLOCK_SHAPES = [
  [1, 1], [1, 1], [1, 1], [1, 1],
  [1, 2], [2, 1], 
  [2, 2], [2, 2],
  [1, 3], [3, 1],
];

export default function DeStijlGenerator() {
  const [cols, setCols] = useState(10);
  const [rows, setRows] = useState(10);
  const [lineWidth, setLineWidth] = useState(8);
  const [weights, setWeights] = useState({ White: 50, Red: 20, Blue: 15, Yellow: 10, Black: 5 });
  const [seed, setSeed] = useState(Math.random()); 
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWeightChange = (color: string, newVal: number) => {
    let diff = newVal - weights[color as keyof typeof weights];
    if (diff === 0) return;

    let newWeights = { ...weights };
    newWeights[color as keyof typeof weights] = newVal;

    const otherColors = Object.keys(weights).filter(c => c !== color) as (keyof typeof weights)[];
    const sumOthers = otherColors.reduce((sum, c) => sum + weights[c], 0);

    if (sumOthers > 0) {
      otherColors.forEach(c => {
        let proportion = weights[c] / sumOthers;
        newWeights[c] = Math.max(0, weights[c] - diff * proportion);
      });
    } else {
      let split = -diff / otherColors.length;
      otherColors.forEach(c => newWeights[c] = Math.max(0, split));
    }

    const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
    if (total > 0) {
      Object.keys(newWeights).forEach(c => {
        newWeights[c as keyof typeof weights] = (newWeights[c as keyof typeof weights] / total) * 100;
      });
    }
    setWeights(newWeights);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const containerWidth = container.clientWidth - 40; 
    const containerHeight = container.clientHeight - 40;
    
    const availableWidth = containerWidth - (cols + 1) * lineWidth;
    const availableHeight = containerHeight - (rows + 1) * lineWidth;
    
    const maxCellWidth = availableWidth / cols;
    const maxCellHeight = availableHeight / rows;
    
    const actualCellSize = Math.min(maxCellWidth, maxCellHeight);
    
    const canvasWidth = cols * actualCellSize + (cols + 1) * lineWidth;
    const canvasHeight = rows * actualCellSize + (rows + 1) * lineWidth;
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const totalArea = rows * cols;
    let quotas: Record<string, number> = {};
    Object.keys(weights).forEach(c => {
      quotas[c] = Math.floor(totalArea * (weights[c as keyof typeof weights] / 100));
    });

    let allocatedArea = Object.values(quotas).reduce((a, b) => a + b, 0);
    if (allocatedArea < totalArea) {
      const maxColor = Object.keys(quotas).reduce((a, b) => quotas[a] > quotas[b] ? a : b);
      quotas[maxColor] += (totalArea - allocatedArea);
    }

    let occupied = Array.from({ length: rows }, () => Array(cols).fill(false));

    ctx.fillStyle = '#000000'; 
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;

        let shapes = [...BLOCK_SHAPES].sort(() => Math.random() - 0.5);
        let placed_r = 1, placed_c = 1;

        for (let [span_r, span_c] of shapes) {
          if (r + span_r <= rows && c + span_c <= cols) {
            let canFit = true;
            for (let cr = r; cr < r + span_r; cr++) {
              for (let cc = c; cc < c + span_c; cc++) {
                if (occupied[cr][cc]) canFit = false;
              }
            }
            if (canFit) {
              placed_r = span_r;
              placed_c = span_c;
              break;
            }
          }
        }

        const blockArea = placed_r * placed_c;
        const availableColors = Object.keys(quotas).filter(color => quotas[color] >= blockArea);
        
        let chosenColor = availableColors.length > 0 
          ? availableColors[Math.floor(Math.random() * availableColors.length)]
          : Object.keys(quotas).reduce((a, b) => quotas[a] > quotas[b] ? a : b);

        quotas[chosenColor] -= blockArea;

        for (let mr = r; mr < r + placed_r; mr++) {
          for (let mc = c; mc < c + placed_c; mc++) {
            occupied[mr][mc] = true;
          }
        }

        const x1 = lineWidth + c * (actualCellSize + lineWidth);
        const y1 = lineWidth + r * (actualCellSize + lineWidth);
        const w = (placed_c * actualCellSize) + ((placed_c - 1) * lineWidth);
        const h = (placed_r * actualCellSize) + ((placed_r - 1) * lineWidth);

        ctx.fillStyle = COLORS[chosenColor as keyof typeof COLORS];
        ctx.fillRect(x1, y1, w, h);
      }
    }
  }, [cols, rows, lineWidth, weights, seed]);

  // 一鍵下載圖片功能
  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `DeStijl_Art_${new Date().getTime()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="flex h-screen bg-[#111111] text-white font-sans overflow-hidden">
      {/* 左側控制面板 (寬度鎖死為 w-80，避免變形) */}
      <div className="w-80 min-w-[20rem] bg-[#1A1A1A] p-6 shadow-2xl z-10 flex flex-col gap-5 overflow-y-auto">
        <h1 className="text-2xl font-bold text-gray-100">De Stijl Studio</h1>
        
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Grid Settings</h2>
          <div>
            <label className="flex justify-between text-sm mb-1">
              <span>Columns (行)</span><span className="w-8 text-right font-mono">{cols}</span>
            </label>
            <input type="range" min="5" max="25" value={cols} onChange={e => setCols(Number(e.target.value))} className="w-full accent-blue-500" />
          </div>
          <div>
            <label className="flex justify-between text-sm mb-1">
              <span>Rows (列)</span><span className="w-8 text-right font-mono">{rows}</span>
            </label>
            <input type="range" min="5" max="25" value={rows} onChange={e => setRows(Number(e.target.value))} className="w-full accent-blue-500" />
          </div>
          <div>
            <label className="flex justify-between text-sm mb-1">
              <span>Line Width</span><span className="w-8 text-right font-mono">{lineWidth}</span>
            </label>
            <input type="range" min="2" max="20" value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} className="w-full accent-blue-500" />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Area Quotas (%)</h2>
          {Object.entries(weights).map(([color, val]) => (
            <div key={color}>
              <label className="flex justify-between text-sm mb-1 items-center">
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border border-gray-600" style={{ backgroundColor: COLORS[color as keyof typeof COLORS] }}></div>
                  {color}
                </span>
                {/* 鎖定百分比數字的寬度，避免推擠 */}
                <span className="w-12 text-right font-mono">{Math.round(val)}%</span>
              </label>
              <input 
                type="range" min="0" max="100" value={val} 
                onChange={e => handleWeightChange(color, Number(e.target.value))}
                className="w-full accent-gray-500" 
              />
            </div>
          ))}
        </div>

        <div className="mt-auto pt-4 flex flex-col gap-3">
          <button 
            onClick={() => setSeed(Math.random())}
            className="w-full bg-white text-black font-bold py-3 rounded-lg hover:bg-gray-200 transition-colors"
          >
            隨機重構 (Regenerate)
          </button>
          <button 
            onClick={downloadImage}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-500 transition-colors"
          >
            存取圖片 (Save PNG)
          </button>
        </div>
      </div>

      {/* 右側畫布區 (確保 flex-1 填滿剩餘空間，overflow-hidden 防止出現捲軸抖動) */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center bg-[#0A0A0A] p-10 relative overflow-hidden">
        <canvas ref={canvasRef} className="shadow-2xl" />
      </div>
    </div>
  );
}