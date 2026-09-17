"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

const PALETTE = {
  White: { label: "留白", hex: "#F7F7F5", ratio: 50 },
  Red: { label: "紅", hex: "#E31B32", ratio: 20 },
  Blue: { label: "藍", hex: "#0759B8", ratio: 15 },
  Yellow: { label: "黃", hex: "#FFD028", ratio: 10 },
  Black: { label: "黑", hex: "#171717", ratio: 5 },
} as const;
type Colour = keyof typeof PALETTE;
type Ratios = Record<Colour, number>;
type Block = { id: number; row: number; column: number; width: number; height: number; colour: Colour };
type DragState = { id: number; offsetX: number; offsetY: number; row: number; column: number } | null;
/** 將外部文字或圖片解碼為可縮放的色彩／複雜度矩陣。 */
type MatrixProfile = { colours: Colour[]; complexity: number[]; width: number; height: number };

const DEFAULT_RATIOS = Object.fromEntries(Object.entries(PALETTE).map(([key, value]) => [key, value.ratio])) as Ratios;
const CELL = 42;

/** 可重現亂數：相同 seed 與設定必定產生相同的構圖。 */
function randomFrom(seed: number) {
  let value = seed >>> 0;
  return () => { value += 0x6d2b79f5; let result = value; result = Math.imul(result ^ (result >>> 15), result | 1); result ^= result + Math.imul(result ^ (result >>> 7), result | 61); return ((result ^ (result >>> 14)) >>> 0) / 4294967296; };
}
const makeSeed = () => Math.floor(Math.random() * 999_999) + 1;
const hash = (value: string) => [...value].reduce((sum, character) => ((sum << 5) - sum + character.charCodeAt(0)) | 0, 2166136261) >>> 0;
const nearestColour = (r: number, g: number, b: number): Colour => (Object.keys(PALETTE) as Colour[]).reduce((best, name) => {
  const hex = PALETTE[name].hex; const pr = parseInt(hex.slice(1, 3), 16); const pg = parseInt(hex.slice(3, 5), 16); const pb = parseInt(hex.slice(5, 7), 16);
  const current = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; const old = PALETTE[best].hex; const br = parseInt(old.slice(1, 3), 16); const bg = parseInt(old.slice(3, 5), 16); const bb = parseInt(old.slice(5, 7), 16);
  return current < (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2 ? name : best;
}, "White");

function isFree(cells: boolean[][], row: number, column: number, width: number, height: number) {
  return row >= 0 && column >= 0 && row + height <= cells.length && column + width <= cells[0].length && Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => !cells[row + y][column + x]).every(Boolean)).every(Boolean);
}
function occupy(cells: boolean[][], block: Omit<Block, "id" | "colour">) { for (let y = block.row; y < block.row + block.height; y += 1) for (let x = block.column; x < block.column + block.width; x += 1) cells[y][x] = true; }
function profileValue(profile: MatrixProfile, row: number, column: number, rows: number, columns: number) {
  const x = Math.min(profile.width - 1, Math.floor(column / columns * profile.width));
  const y = Math.min(profile.height - 1, Math.floor(row / rows * profile.height));
  return y * profile.width + x;
}
function colourAt(block: Omit<Block, "id" | "colour">, rows: number, columns: number, random: () => number, ratios: Ratios, source?: MatrixProfile) {
  if (source) return source.colours[profileValue(source, block.row + block.height / 2, block.column + block.width / 2, rows, columns)] ?? "White";
  const names = Object.keys(PALETTE) as Colour[]; let cursor = random() * 100; for (const name of names) { cursor -= ratios[name]; if (cursor <= 0) return name; } return "White";
}

/**
 * 動態規劃求取目前空白區中的最佳矩形。
 * heights[x] 記錄「以目前列為底、向上連續空白」的高度；每次掃描只增量更新，
 * 因此能在拖放時即時為殘缺區域找到較大的可用區塊，而非壓縮整張畫布。
 */
function bestEmptyRectangle(cells: boolean[][], profile?: MatrixProfile, rows = cells.length, columns = cells[0].length) {
  const heights = Array<number>(columns).fill(0);
  let best: Omit<Block, "id" | "colour"> | null = null;
  let bestScore = -1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) heights[column] = cells[row][column] ? 0 : heights[column] + 1;
    for (let left = 0; left < columns; left += 1) {
      let height = Number.POSITIVE_INFINITY;
      for (let right = left; right < Math.min(columns, left + 5); right += 1) {
        height = Math.min(height, heights[right]);
        if (!height) break;
        // 影像紋理較高的位置保留小單元；平坦區域優先形成較大的色面。
        const complexity = profile?.complexity[profileValue(profile, row, left, rows, columns)] ?? 0.5;
        const cappedHeight = Math.min(height, complexity > 0.55 ? 2 : 5);
        const area = (right - left + 1) * cappedHeight;
        const score = area - Math.abs((right - left + 1) - cappedHeight) * 0.08;
        if (score > bestScore) { bestScore = score; best = { row: row - cappedHeight + 1, column: left, width: right - left + 1, height: cappedHeight }; }
      }
    }
  }
  return best;
}

/**
 * 先保留使用者拖曳的矩形，再安置未衝突區塊；擠不下的區塊自然捨棄。
 * 之後以動態規劃反覆尋找最大空白矩形並補滿，形成快速且穩定的局部重排。
 */
function pack(rows: number, columns: number, ratios: Ratios, seed: number, source?: MatrixProfile, preferred?: Block, existing: Block[] = []) {
  const random = randomFrom(seed); const cells = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false)); const output: Block[] = []; let id = 0;
  const add = (block: Omit<Block, "id" | "colour">, colour?: Colour) => { occupy(cells, block); output.push({ ...block, id: id += 1, colour: colour ?? colourAt(block, rows, columns, random, ratios, source) }); };
  if (preferred && isFree(cells, preferred.row, preferred.column, preferred.width, preferred.height)) add(preferred, preferred.colour);
  for (const block of [...existing].sort((a, b) => b.width * b.height - a.width * a.height)) if (block.id !== preferred?.id && isFree(cells, block.row, block.column, block.width, block.height)) add(block, block.colour);
  while (true) {
    const next = bestEmptyRectangle(cells, source, rows, columns);
    if (!next) break;
    add(next);
  }
  return output;
}

function balance(current: Ratios, changed: Colour, value: number): Ratios {
  const next = { ...current, [changed]: value }; const others = (Object.keys(next) as Colour[]).filter((name) => name !== changed); const previous = others.reduce((sum, name) => sum + current[name], 0); const available = 100 - value;
  others.forEach((name) => { next[name] = previous ? Math.round(available * current[name] / previous) : Math.floor(available / others.length); });
  next[others[0]] += 100 - (Object.values(next) as number[]).reduce((sum, item) => sum + item, 0); return next;
}

export default function DeStijlGenerator() {
  const [columns, setColumns] = useState(20); const [rows, setRows] = useState(30); const [lineWidth, setLineWidth] = useState(4); const [ratios, setRatios] = useState<Ratios>(DEFAULT_RATIOS); const [seed, setSeed] = useState(makeSeed); const [source, setSource] = useState<MatrixProfile>(); const [sourceLabel, setSourceLabel] = useState("純 Seed 生成"); const [blocks, setBlocks] = useState<Block[]>(() => pack(30, 20, DEFAULT_RATIOS, seed)); const [drag, setDrag] = useState<DragState>(null); const [text, setText] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null); const step = CELL + lineWidth; const size = useMemo(() => ({ width: columns * step + lineWidth, height: rows * step + lineWidth }), [columns, rows, lineWidth, step]);
  const regenerate = (nextSeed = makeSeed(), nextSource = source) => { setSeed(nextSeed); setBlocks(pack(rows, columns, ratios, nextSeed, nextSource)); };
  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect(); return { column: Math.floor((event.clientX - rect.left) / step), row: Math.floor((event.clientY - rect.top) / step) }; }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) { const point = canvasPoint(event); const block = [...blocks].reverse().find((item) => point.row >= item.row && point.row < item.row + item.height && point.column >= item.column && point.column < item.column + item.width); if (!block) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: block.id, offsetX: point.column - block.column, offsetY: point.row - block.row, row: block.row, column: block.column }); }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) { if (!drag) return; const point = canvasPoint(event); setDrag({ ...drag, row: point.row - drag.offsetY, column: point.column - drag.offsetX }); }
  function pointerUp(event: PointerEvent<HTMLCanvasElement>) { if (!drag) return; const moving = blocks.find((block) => block.id === drag.id); if (moving) { const target = { ...moving, row: Math.max(0, Math.min(rows - moving.height, drag.row)), column: Math.max(0, Math.min(columns - moving.width, drag.column)) }; setBlocks(pack(rows, columns, ratios, seed, source, target, blocks)); } setDrag(null); event.currentTarget.releasePointerCapture(event.pointerId); }
  function draw() { const canvas = canvasRef.current; if (!canvas) return; canvas.width = size.width; canvas.height = size.height; const context = canvas.getContext("2d"); if (!context) return; context.fillStyle = "#191919"; context.fillRect(0, 0, size.width, size.height); const drawn = drag ? blocks.filter((block) => block.id !== drag.id) : blocks; [...drawn, ...(drag ? [{ id: drag.id, row: drag.row, column: drag.column, width: blocks.find((item) => item.id === drag.id)?.width ?? 1, height: blocks.find((item) => item.id === drag.id)?.height ?? 1, colour: blocks.find((item) => item.id === drag.id)?.colour ?? "White" } as Block] : [])].forEach((block) => { context.fillStyle = PALETTE[block.colour].hex; context.fillRect(lineWidth + block.column * step, lineWidth + block.row * step, block.width * CELL + (block.width - 1) * lineWidth, block.height * CELL + (block.height - 1) * lineWidth); }); }
  useEffect(draw, [blocks, drag, size, lineWidth, step]);
  function exportPng() { const canvas = canvasRef.current; if (!canvas) return; const link = document.createElement("a"); link.download = `destijl-${seed}.png`; link.href = canvas.toDataURL("image/png"); link.click(); }
  function encodeText() { if (!text.trim()) return; const nextSeed = hash(text); const map = Array.from({ length: rows * columns }, (_, index) => { const code = text.charCodeAt(index % text.length); return (Object.keys(PALETTE) as Colour[])[(code + index * 17) % 5]; }); const profile = { colours: map, complexity: map.map((_, index) => (text.charCodeAt(index % text.length) % 100) / 100), width: columns, height: rows }; setSource(profile); setSourceLabel("文字矩陣"); regenerate(nextSeed, profile); }
  function uploadImage(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const image = new Image(); image.onload = () => { const temp = document.createElement("canvas"); temp.width = columns; temp.height = rows; const context = temp.getContext("2d")!; context.drawImage(image, 0, 0, columns, rows); const pixels = context.getImageData(0, 0, columns, rows).data; const luminance = (index: number) => .2126 * pixels[index * 4] + .7152 * pixels[index * 4 + 1] + .0722 * pixels[index * 4 + 2]; const profile = { colours: Array.from({ length: rows * columns }, (_, index) => nearestColour(pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2])), complexity: Array.from({ length: rows * columns }, (_, index) => { const x = index % columns; const y = Math.floor(index / columns); const neighbours = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < columns && ny < rows).map(([nx, ny]) => luminance(ny * columns + nx)); return neighbours.length ? Math.min(1, neighbours.reduce((sum, value) => sum + Math.abs(value - luminance(index)), 0) / neighbours.length / 64) : 0; }), width: columns, height: rows }; setSource(profile); setSourceLabel(`圖片矩陣 · ${file.name}`); regenerate(hash(`${file.name}${file.size}`), profile); URL.revokeObjectURL(image.src); }; image.src = URL.createObjectURL(file); }
  function changeColumns(value: number) { setColumns(value); setBlocks(pack(rows, value, ratios, seed, source)); }
  function changeRows(value: number) { setRows(value); setBlocks(pack(value, columns, ratios, seed, source)); }
  function changeRatio(name: Colour, value: number) { const next = balance(ratios, name, value); setRatios(next); setBlocks(pack(rows, columns, next, seed, source)); }
  return <main className="editor"><div className="canvas-scroll"><canvas ref={canvasRef} className="artboard" style={{ width: size.width, height: size.height }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setDrag(null)} /></div><aside className="inspector"><div className="titlebar"><span className="window-dot red" /><span className="window-dot yellow" /><span className="window-dot green" /><strong>De Stijl Studio</strong></div><p className="eyebrow">CANVAS · {columns} × {rows} · {sourceLabel}</p><section><h1>構圖控制</h1><label>欄數 <output>{columns}</output><input type="range" min="5" max="50" value={columns} onChange={(event) => changeColumns(Number(event.target.value))} /></label><label>列數 <output>{rows}</output><input type="range" min="5" max="50" value={rows} onChange={(event) => changeRows(Number(event.target.value))} /></label><label>格線 <output>{lineWidth}px</output><input type="range" min="2" max="12" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label></section><section><h2>色彩配額 <span>100%</span></h2>{(Object.keys(PALETTE) as Colour[]).map((name) => <label className="colour" key={name}><i style={{ background: PALETTE[name].hex }} />{PALETTE[name].label}<output>{ratios[name]}%</output><input type="range" min="0" max="100" value={ratios[name]} onChange={(event) => changeRatio(name, Number(event.target.value))} /></label>)}</section><section className="source"><h2>編碼輸入</h2><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="輸入一段文字，轉為色彩矩陣…" /><button onClick={encodeText}>轉譯文字矩陣</button><label className="upload">上傳圖片並取樣<input type="file" accept="image/*" onChange={uploadImage} /></label></section><div className="actions"><button className="secondary" onClick={() => { setSource(undefined); setSourceLabel("純 Seed 生成"); regenerate(); }}>重新生成</button><button className="primary" onClick={exportPng}>匯出 PNG</button></div><p className="hint">拖曳任一色塊即可重新排版；衝突區塊會被移除，缺口即時補滿。</p></aside></main>;
}
