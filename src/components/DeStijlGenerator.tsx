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
function colourAt(block: Omit<Block, "id" | "colour">, rows: number, columns: number, random: () => number, ratios: Ratios, source?: Colour[]) {
  if (source?.length) return source[Math.min(source.length - 1, Math.floor((block.row + block.height / 2) / rows * Math.sqrt(source.length)) * Math.sqrt(source.length) + Math.floor((block.column + block.width / 2) / columns * Math.sqrt(source.length)))] ?? "White";
  const names = Object.keys(PALETTE) as Colour[]; let cursor = random() * 100; for (const name of names) { cursor -= ratios[name]; if (cursor <= 0) return name; } return "White";
}

/**
 * 以「約束式局部重新排版」取代全域動態規劃：拖曳物件先保留，其他矩形依面積重放；
 * 不能放入的區塊捨棄，最後用小區塊補滿空格。這能在每次放開滑鼠時立即完成。
 */
function pack(rows: number, columns: number, ratios: Ratios, seed: number, source?: Colour[], preferred?: Block, existing: Block[] = []) {
  const random = randomFrom(seed); const cells = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false)); const output: Block[] = []; let id = 0;
  const add = (block: Omit<Block, "id" | "colour">, colour?: Colour) => { occupy(cells, block); output.push({ ...block, id: id += 1, colour: colour ?? colourAt(block, rows, columns, random, ratios, source) }); };
  if (preferred && isFree(cells, preferred.row, preferred.column, preferred.width, preferred.height)) add(preferred, preferred.colour);
  for (const block of [...existing].sort((a, b) => b.width * b.height - a.width * a.height)) if (block.id !== preferred?.id && isFree(cells, block.row, block.column, block.width, block.height)) add(block, block.colour);
  const shapes = [[3, 3], [2, 2], [3, 1], [1, 3], [2, 1], [1, 2], [1, 1]];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    if (cells[row][column]) continue;
    const candidates = shapes.filter(([height, width]) => isFree(cells, row, column, width, height));
    const [height, width] = candidates[Math.floor(random() * candidates.length)] ?? [1, 1]; add({ row, column, width, height });
  }
  return output;
}

function balance(current: Ratios, changed: Colour, value: number): Ratios {
  const next = { ...current, [changed]: value }; const others = (Object.keys(next) as Colour[]).filter((name) => name !== changed); const previous = others.reduce((sum, name) => sum + current[name], 0); const available = 100 - value;
  others.forEach((name) => { next[name] = previous ? Math.round(available * current[name] / previous) : Math.floor(available / others.length); });
  next[others[0]] += 100 - (Object.values(next) as number[]).reduce((sum, item) => sum + item, 0); return next;
}

export default function DeStijlGenerator() {
  const [columns, setColumns] = useState(20); const [rows, setRows] = useState(30); const [lineWidth, setLineWidth] = useState(4); const [ratios, setRatios] = useState<Ratios>(DEFAULT_RATIOS); const [seed, setSeed] = useState(makeSeed); const [source, setSource] = useState<Colour[]>(); const [sourceLabel, setSourceLabel] = useState("純 Seed 生成"); const [blocks, setBlocks] = useState<Block[]>(() => pack(30, 20, DEFAULT_RATIOS, seed)); const [drag, setDrag] = useState<DragState>(null); const [text, setText] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null); const step = CELL + lineWidth; const size = useMemo(() => ({ width: columns * step + lineWidth, height: rows * step + lineWidth }), [columns, rows, lineWidth, step]);
  const regenerate = (nextSeed = makeSeed(), nextSource = source) => { setSeed(nextSeed); setBlocks(pack(rows, columns, ratios, nextSeed, nextSource)); };
  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect(); return { column: Math.floor((event.clientX - rect.left) / step), row: Math.floor((event.clientY - rect.top) / step) }; }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) { const point = canvasPoint(event); const block = [...blocks].reverse().find((item) => point.row >= item.row && point.row < item.row + item.height && point.column >= item.column && point.column < item.column + item.width); if (!block) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: block.id, offsetX: point.column - block.column, offsetY: point.row - block.row, row: block.row, column: block.column }); }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) { if (!drag) return; const point = canvasPoint(event); setDrag({ ...drag, row: point.row - drag.offsetY, column: point.column - drag.offsetX }); }
  function pointerUp(event: PointerEvent<HTMLCanvasElement>) { if (!drag) return; const moving = blocks.find((block) => block.id === drag.id); const target = moving && { ...moving, row: drag.row, column: drag.column }; if (target && target.row >= 0 && target.column >= 0 && target.row + target.height <= rows && target.column + target.width <= columns) setBlocks(pack(rows, columns, ratios, seed, source, target, blocks)); setDrag(null); event.currentTarget.releasePointerCapture(event.pointerId); }
  function draw() { const canvas = canvasRef.current; if (!canvas) return; canvas.width = size.width; canvas.height = size.height; const context = canvas.getContext("2d"); if (!context) return; context.fillStyle = "#191919"; context.fillRect(0, 0, size.width, size.height); const drawn = drag ? blocks.filter((block) => block.id !== drag.id) : blocks; [...drawn, ...(drag ? [{ id: drag.id, row: drag.row, column: drag.column, width: blocks.find((item) => item.id === drag.id)?.width ?? 1, height: blocks.find((item) => item.id === drag.id)?.height ?? 1, colour: blocks.find((item) => item.id === drag.id)?.colour ?? "White" } as Block] : [])].forEach((block) => { context.fillStyle = PALETTE[block.colour].hex; context.fillRect(lineWidth + block.column * step, lineWidth + block.row * step, block.width * CELL + (block.width - 1) * lineWidth, block.height * CELL + (block.height - 1) * lineWidth); }); }
  useEffect(draw, [blocks, drag, size, lineWidth, step]);
  function exportPng() { const canvas = canvasRef.current; if (!canvas) return; const link = document.createElement("a"); link.download = `destijl-${seed}.png`; link.href = canvas.toDataURL("image/png"); link.click(); }
  function encodeText() { if (!text.trim()) return; const nextSeed = hash(text); const map = Array.from({ length: 400 }, (_, index) => (Object.keys(PALETTE) as Colour[])[(text.charCodeAt(index % text.length) + index) % 5]); setSource(map); setSourceLabel("文字矩陣"); regenerate(nextSeed, map); }
  function uploadImage(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const image = new Image(); image.onload = () => { const temp = document.createElement("canvas"); temp.width = temp.height = 20; const context = temp.getContext("2d")!; context.drawImage(image, 0, 0, 20, 20); const pixels = context.getImageData(0, 0, 20, 20).data; const map = Array.from({ length: 400 }, (_, index) => nearestColour(pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2])); setSource(map); setSourceLabel(`圖片矩陣 · ${file.name}`); regenerate(hash(`${file.name}${file.size}`), map); URL.revokeObjectURL(image.src); }; image.src = URL.createObjectURL(file); }
  function changeColumns(value: number) { setColumns(value); setBlocks(pack(rows, value, ratios, seed, source)); }
  function changeRows(value: number) { setRows(value); setBlocks(pack(value, columns, ratios, seed, source)); }
  function changeRatio(name: Colour, value: number) { const next = balance(ratios, name, value); setRatios(next); setBlocks(pack(rows, columns, next, seed, source)); }
  return <main className="editor"><div className="canvas-scroll"><canvas ref={canvasRef} className="artboard" style={{ width: size.width, height: size.height }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setDrag(null)} /></div><aside className="inspector"><div className="titlebar"><span className="window-dot red" /><span className="window-dot yellow" /><span className="window-dot green" /><strong>De Stijl Studio</strong></div><p className="eyebrow">CANVAS · {columns} × {rows} · {sourceLabel}</p><section><h1>構圖控制</h1><label>欄數 <output>{columns}</output><input type="range" min="5" max="50" value={columns} onChange={(event) => changeColumns(Number(event.target.value))} /></label><label>列數 <output>{rows}</output><input type="range" min="5" max="50" value={rows} onChange={(event) => changeRows(Number(event.target.value))} /></label><label>格線 <output>{lineWidth}px</output><input type="range" min="2" max="12" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label></section><section><h2>色彩配額 <span>100%</span></h2>{(Object.keys(PALETTE) as Colour[]).map((name) => <label className="colour" key={name}><i style={{ background: PALETTE[name].hex }} />{PALETTE[name].label}<output>{ratios[name]}%</output><input type="range" min="0" max="100" value={ratios[name]} onChange={(event) => changeRatio(name, Number(event.target.value))} /></label>)}</section><section className="source"><h2>編碼輸入</h2><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="輸入一段文字，轉為色彩矩陣…" /><button onClick={encodeText}>轉譯文字矩陣</button><label className="upload">上傳圖片並取樣<input type="file" accept="image/*" onChange={uploadImage} /></label></section><div className="actions"><button className="secondary" onClick={() => { setSource(undefined); setSourceLabel("純 Seed 生成"); regenerate(); }}>重新生成</button><button className="primary" onClick={exportPng}>匯出 PNG</button></div><p className="hint">拖曳任一色塊即可重新排版；衝突區塊會被移除，缺口即時補滿。</p></aside></main>;
}
