"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 德．史提爾常用的原色與預設面積比例。 */
const COLOURS = {
  White: { label: "留白", hex: "#F6F4EF", ratio: 50 },
  Red: { label: "紅", hex: "#D51E2F", ratio: 20 },
  Blue: { label: "藍", hex: "#164B9A", ratio: 15 },
  Yellow: { label: "黃", hex: "#F2C230", ratio: 10 },
  Black: { label: "黑", hex: "#171717", ratio: 5 },
} as const;

type ColourName = keyof typeof COLOURS;
type Ratios = Record<ColourName, number>;
type Block = { row: number; column: number; width: number; height: number; colour: ColourName };
const DEFAULT_RATIOS = Object.fromEntries(Object.entries(COLOURS).map(([name, colour]) => [name, colour.ratio])) as Ratios;

/** 將整數 seed 轉成可重現的亂數函式，讓喜歡的作品可以再次生成。 */
function createRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
const randomSeed = () => Math.floor(Math.random() * 999_999) + 1;

/** 保持五種色彩比例精準加總為 100，免除手動修正配額。 */
function balanceRatios(current: Ratios, changed: ColourName, nextValue: number): Ratios {
  const result = { ...current, [changed]: nextValue };
  const others = (Object.keys(result) as ColourName[]).filter((name) => name !== changed);
  const previousTotal = others.reduce((sum, name) => sum + current[name], 0);
  const available = 100 - nextValue;
  others.forEach((name) => { result[name] = previousTotal ? Math.round((available * current[name]) / previousTotal) : Math.floor(available / others.length); });
  const difference = 100 - (Object.values(result) as number[]).reduce((sum, value) => sum + value, 0);
  const target = others.reduce((largest, name) => result[name] > result[largest] ? name : largest, others[0]);
  result[target] += difference;
  return result;
}

function fits(cells: boolean[][], row: number, column: number, width: number, height: number) {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => !cells[row + y][column + x]).every(Boolean)).every(Boolean);
}
function occupy(cells: boolean[][], row: number, column: number, width: number, height: number) {
  for (let y = row; y < row + height; y += 1) for (let x = column; x < column + width; x += 1) cells[y][x] = true;
}
function touches(left: Omit<Block, "colour">, right: Omit<Block, "colour">) {
  const horizontal = (left.column + left.width === right.column || right.column + right.width === left.column) && Math.max(left.row, right.row) < Math.min(left.row + left.height, right.row + right.height);
  const vertical = (left.row + left.height === right.row || right.row + right.height === left.row) && Math.max(left.column, right.column) < Math.min(left.column + left.width, right.column + right.width);
  return horizontal || vertical;
}

/** 先安排大區塊，再以方向性長條填補；最後用配額與相鄰排斥規則分色。 */
function generateComposition(rows: number, columns: number, ratios: Ratios, seed: number): Block[] {
  const random = createRandom(seed);
  const cells = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false));
  const blocks: Omit<Block, "colour">[] = [];
  const shapes = [[3, 3], [2, 2], [1, 3], [3, 1], [1, 2], [2, 1], [1, 1]];
  for (const [height, width] of shapes) {
    for (let attempt = 0; attempt < Math.max(4, Math.round(rows * columns / (width * height * 2))); attempt += 1) {
      if (height > rows || width > columns) continue;
      const row = Math.floor(random() * (rows - height + 1));
      const column = Math.floor(random() * (columns - width + 1));
      if (!fits(cells, row, column, width, height)) continue;
      occupy(cells, row, column, width, height); blocks.push({ row, column, width, height });
    }
  }
  // 補足所有空格，畫面才會是完整的視覺系統。
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    if (cells[row][column]) continue;
    let width = 1; let height = 1;
    while (column + width < columns && !cells[row][column + width]) width += 1;
    while (row + height < rows && !cells[row + height][column]) height += 1;
    if (height > width) width = 1; else height = 1;
    occupy(cells, row, column, width, height); blocks.push({ row, column, width, height });
  }
  const total = rows * columns;
  const quotas = Object.fromEntries((Object.keys(ratios) as ColourName[]).map((name) => [name, Math.round(total * ratios[name] / 100)])) as Ratios;
  const largest = (Object.keys(quotas) as ColourName[]).reduce((best, name) => quotas[name] > quotas[best] ? name : best);
  quotas[largest] += total - (Object.values(quotas) as number[]).reduce((sum, value) => sum + value, 0);
  const painted: Block[] = [];
  for (const block of [...blocks].sort((a, b) => b.width * b.height - a.width * a.height)) {
    const adjacent = new Set(painted.filter((other) => touches(block, other)).map((other) => other.colour));
    const area = block.width * block.height;
    const names = Object.keys(COLOURS) as ColourName[];
    let candidates = names.filter((name) => quotas[name] >= area && (name === "White" || !adjacent.has(name)));
    if (!candidates.length) candidates = names.filter((name) => !adjacent.has(name));
    if (!candidates.length) candidates = names;
    let cursor = random() * candidates.reduce((sum, name) => sum + Math.max(1, quotas[name]), 0);
    const colour = candidates.find((name) => (cursor -= Math.max(1, quotas[name])) <= 0) ?? candidates[0];
    quotas[colour] -= area; painted.push({ ...block, colour });
  }
  return painted;
}

function RangeControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="control"><span><span>{label}</span><output>{value}</output></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

export default function DeStijlGenerator() {
  const [columns, setColumns] = useState(10); const [rows, setRows] = useState(10); const [lineWidth, setLineWidth] = useState(8);
  const [ratios, setRatios] = useState<Ratios>(DEFAULT_RATIOS); const [seed, setSeed] = useState(randomSeed);
  const canvasRef = useRef<HTMLCanvasElement>(null); const previewRef = useRef<HTMLDivElement>(null);
  const composition = useMemo(() => generateComposition(rows, columns, ratios, seed), [columns, ratios, rows, seed]);
  const drawCanvas = useCallback((resolution: number) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const side = Math.max(240, resolution); const line = Math.max(2, Math.round(lineWidth * side / 100)); const cell = (side - line * (columns + 1)) / columns;
    canvas.width = side; canvas.height = side;
    const context = canvas.getContext("2d"); if (!context) return null;
    context.fillStyle = "#171717"; context.fillRect(0, 0, side, side);
    composition.forEach((block) => { const x = line + block.column * (cell + line); const y = line + block.row * (cell + line); context.fillStyle = COLOURS[block.colour].hex; context.fillRect(x, y, block.width * cell + (block.width - 1) * line, block.height * cell + (block.height - 1) * line); });
    return canvas;
  }, [columns, composition, lineWidth]);
  useEffect(() => { const preview = previewRef.current; if (!preview) return; const resize = () => drawCanvas(Math.min(preview.clientWidth - 32, preview.clientHeight - 32)); resize(); const observer = new ResizeObserver(resize); observer.observe(preview); return () => observer.disconnect(); }, [drawCanvas]);
  const regenerate = () => setSeed(randomSeed());
  const reset = () => { setColumns(10); setRows(10); setLineWidth(8); setRatios(DEFAULT_RATIOS); regenerate(); };
  function downloadPng() { const canvas = drawCanvas(1800); if (!canvas) return; const link = document.createElement("a"); link.download = `destijl-${seed.toString().padStart(6, "0")}.png`; link.href = canvas.toDataURL("image/png"); link.click(); if (previewRef.current) drawCanvas(Math.min(previewRef.current.clientWidth - 32, previewRef.current.clientHeight - 32)); }
  return <main className="studio-shell"><aside className="sidebar"><header className="brand"><p>GENERATIVE STUDY · 01</p><h1>De Stijl<br /><em>Studio</em></h1><span>參數化構圖實驗室</span></header><section><h2>畫布結構</h2><RangeControl label="欄數 Columns" value={columns} min={5} max={24} onChange={setColumns} /><RangeControl label="列數 Rows" value={rows} min={5} max={24} onChange={setRows} /><RangeControl label="線條粗細" value={lineWidth} min={2} max={16} onChange={setLineWidth} /></section><section><div className="section-heading"><h2>色彩比例</h2><span>100%</span></div>{(Object.keys(COLOURS) as ColourName[]).map((name) => <label className="colour-control" key={name}><span><i style={{ backgroundColor: COLOURS[name].hex }} />{COLOURS[name].label}<output>{ratios[name]}%</output></span><input type="range" min="0" max="100" value={ratios[name]} onChange={(event) => setRatios(balanceRatios(ratios, name, Number(event.target.value)))} /></label>)}</section><div className="actions"><button className="primary" onClick={regenerate}>產生新構圖 <span>↗</span></button><button className="secondary" onClick={downloadPng}>匯出 1800px PNG</button><button className="text-button" onClick={reset}>重設所有參數</button></div></aside><section className="workspace"><div className="workspace-header"><div><p>DE STIJL / DIGITAL COMPOSITION</p><h2>將秩序化為可操作的視覺語言</h2></div><div className="seed"><span>REPRODUCIBLE SEED</span><strong>{seed.toString().padStart(6, "0")}</strong></div></div><div className="preview" ref={previewRef}><canvas ref={canvasRef} aria-label="風格派生成作品預覽" /></div><footer><span>以色彩配額、格線與可重現亂數，探索偶然中的秩序。</span><span>© 2026 KENT CHEN</span></footer></section></main>;
}
