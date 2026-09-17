"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const PALETTE = {
  White: { label: "留白", hex: "#F7F7F5", ratio: 50 },
  Red: { label: "紅", hex: "#E31B32", ratio: 20 },
  Blue: { label: "藍", hex: "#0759B8", ratio: 15 },
  Yellow: { label: "黃", hex: "#FFD028", ratio: 10 },
  Black: { label: "黑", hex: "#171717", ratio: 5 },
} as const;

type Colour = keyof typeof PALETTE;
type Ratios = Record<Colour, number>;
type SizeRatios = Record<number, number>;
type Block = { id: number; row: number; column: number; width: number; height: number; colour: Colour };
type DragState = { id: number; offsetX: number; offsetY: number; row: number; column: number } | null;
type MatrixProfile = { colours: Colour[]; complexity: number[]; width: number; height: number };
type Metrics = { width: number; height: number; cell: number; line: number };

const DEFAULT_COLOUR_RATIOS = Object.fromEntries(Object.entries(PALETTE).map(([key, value]) => [key, value.ratio])) as Ratios;
const DEFAULT_SIZE_RATIOS: SizeRatios = { 1: 18, 2: 28, 3: 26, 4: 18, 5: 10 };

/** 相同 seed、比例與矩陣尺寸會產生同一組構圖。 */
function randomFrom(seed: number) {
  let value = seed >>> 0;
  return () => { value += 0x6d2b79f5; let result = value; result = Math.imul(result ^ (result >>> 15), result | 1); result ^= result + Math.imul(result ^ (result >>> 7), result | 61); return ((result ^ (result >>> 14)) >>> 0) / 4294967296; };
}
const makeSeed = () => Math.floor(Math.random() * 999_999) + 1;
const hash = (value: string) => [...value].reduce((sum, character) => ((sum << 5) - sum + character.charCodeAt(0)) | 0, 2166136261) >>> 0;

function balance<T extends Record<string | number, number>>(current: T, changed: string | number, value: number): T {
  const next = { ...current, [changed]: value } as Record<string | number, number>;
  const others = Object.keys(next).filter((name) => name !== String(changed));
  if (!others.length) return { ...current, [changed]: 100 } as T;
  const previous = others.reduce((sum, name) => sum + (current[name] ?? 0), 0);
  const available = 100 - value;
  others.forEach((name) => { next[name] = previous ? Math.round(available * (current[name] ?? 0) / previous) : Math.floor(available / others.length); });
  next[others[0]] += 100 - Object.values(next).reduce((sum, item) => sum + item, 0);
  return next as T;
}

function resizeSizeRatios(current: SizeRatios, maxTier: number) {
  const next: SizeRatios = {};
  for (let tier = 1; tier <= maxTier; tier += 1) next[tier] = current[tier] ?? Math.floor(100 / maxTier);
  const total = Object.values(next).reduce((sum, value) => sum + value, 0);
  Object.keys(next).forEach((key) => { next[Number(key)] = Math.round(next[Number(key)] / total * 100); });
  next[1] += 100 - Object.values(next).reduce((sum, value) => sum + value, 0);
  return next;
}

function nearestColour(r: number, g: number, b: number): Colour {
  return (Object.keys(PALETTE) as Colour[]).reduce((best, name) => {
    const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const [pr, pg, pb] = rgb(PALETTE[name].hex); const [br, bg, bb] = rgb(PALETTE[best].hex);
    return (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2 < (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2 ? name : best;
  }, "White");
}

function profileIndex(profile: MatrixProfile, row: number, column: number, rows: number, columns: number) {
  const x = Math.min(profile.width - 1, Math.max(0, Math.floor(column / columns * profile.width)));
  const y = Math.min(profile.height - 1, Math.max(0, Math.floor(row / rows * profile.height)));
  return y * profile.width + x;
}
function isFree(cells: boolean[][], row: number, column: number, width: number, height: number) {
  return row >= 0 && column >= 0 && row + height <= cells.length && column + width <= cells[0].length && Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => !cells[row + y][column + x]).every(Boolean)).every(Boolean);
}
function mark(cells: boolean[][], block: Omit<Block, "id" | "colour">) { for (let y = block.row; y < block.row + block.height; y += 1) for (let x = block.column; x < block.column + block.width; x += 1) cells[y][x] = true; }
function overlaps(left: Block, right: Block) { return left.column < right.column + right.width && left.column + left.width > right.column && left.row < right.row + right.height && left.row + left.height > right.row; }

/** 動態規劃：heights 連續累積空格高度，找到目前空洞中可容納的最大矩形。 */
function bestEmptyRectangle(cells: boolean[][], maxTier: number, profile?: MatrixProfile, rows = cells.length, columns = cells[0].length) {
  const heights = Array<number>(columns).fill(0); let best: Omit<Block, "id" | "colour"> | null = null; let score = -1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) heights[column] = cells[row][column] ? 0 : heights[column] + 1;
    for (let left = 0; left < columns; left += 1) {
      let height = Number.POSITIVE_INFINITY;
      for (let right = left; right < Math.min(columns, left + maxTier); right += 1) {
        height = Math.min(height, heights[right]); if (!height) break;
        const complex = profile?.complexity[profileIndex(profile, row, left, rows, columns)] ?? 0.35;
        const cappedHeight = Math.min(height, complex > .52 ? 2 : maxTier);
        const area = (right - left + 1) * cappedHeight;
        const candidateScore = area - Math.abs((right - left + 1) - cappedHeight) * .08;
        if (candidateScore > score) { score = candidateScore; best = { row: row - cappedHeight + 1, column: left, width: right - left + 1, height: cappedHeight }; }
      }
    }
  }
  return best;
}

function chooseTier(quotas: SizeRatios, random: () => number) {
  const choices = Object.keys(quotas).map(Number).filter((tier) => quotas[tier] > 0);
  if (!choices.length) return 1;
  const total = choices.reduce((sum, tier) => sum + quotas[tier], 0); let cursor = random() * total;
  return choices.find((tier) => (cursor -= quotas[tier]) <= 0) ?? choices[0];
}
/** 將可用矩形裁成「一邊為 tier、另一邊不超過 tier」的合法階數區塊。 */
function cropToTier(space: Omit<Block, "id" | "colour">, tier: number, random: () => number) {
  const width = Math.min(space.width, tier); const height = Math.min(space.height, tier);
  if (space.width >= tier && space.height >= tier) return random() > .5 ? { ...space, width: tier, height: Math.max(1, Math.min(tier, space.height)) } : { ...space, width: Math.max(1, Math.min(tier, space.width)), height: tier };
  return { ...space, width, height };
}

/** 將矩形共享的邊轉為圖結構；權重是兩塊相鄰邊的長度。 */
function buildAdjacency(blocks: Block[], rows: number, columns: number) {
  const owners = Array.from({ length: rows }, () => Array<number>(columns).fill(-1));
  blocks.forEach((block, index) => { for (let row = block.row; row < block.row + block.height; row += 1) for (let column = block.column; column < block.column + block.width; column += 1) owners[row][column] = index; });
  const graph = Array.from({ length: blocks.length }, () => new Map<number, number>());
  const connect = (left: number, right: number) => { if (left === right || left < 0 || right < 0) return; graph[left].set(right, (graph[left].get(right) ?? 0) + 1); graph[right].set(left, (graph[right].get(left) ?? 0) + 1); };
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) { if (column + 1 < columns) connect(owners[row][column], owners[row][column + 1]); if (row + 1 < rows) connect(owners[row][column], owners[row + 1][column]); }
  return graph;
}

/**
 * 配額約束圖著色 + 模擬退火隨機漫步。
 * 每次隨機嘗試一個換色提案；相鄰同色受到最高懲罰，配額誤差與來源矩陣偏好次之。
 * 退火前期允許少量非最佳變化以跳出局部解，後期逐漸收斂為色彩分散的構圖。
 */
function optimiseColours(blocks: Block[], rows: number, columns: number, ratios: Ratios, seed: number, profile?: MatrixProfile, lockedIds = new Set<number>()) {
  const random = randomFrom(seed ^ 0x9e3779b9); const graph = buildAdjacency(blocks, rows, columns); const totalArea = rows * columns;
  const target = Object.fromEntries((Object.keys(PALETTE) as Colour[]).map((name) => [name, totalArea * ratios[name] / 100])) as Ratios;
  const used = Object.fromEntries((Object.keys(PALETTE) as Colour[]).map((name) => [name, 0])) as Ratios;
  blocks.forEach((block) => { used[block.colour] += block.width * block.height; });
  const unlocked = blocks.map((_, index) => index).filter((index) => !lockedIds.has(blocks[index].id));
  const energy = (index: number, candidate: Colour) => {
    const block = blocks[index]; const area = block.width * block.height; const original = block.colour;
    const sameColourEdges = [...graph[index]].reduce((sum, [neighbour, edge]) => sum + (blocks[neighbour].colour === candidate ? edge : 0), 0);
    const colourPenalty = sameColourEdges * 90;
    if (candidate === original) return colourPenalty;
    const currentQuota = Math.abs(used[original] - target[original]) + Math.abs(used[candidate] - target[candidate]);
    const nextQuota = Math.abs(used[original] - area - target[original]) + Math.abs(used[candidate] + area - target[candidate]);
    const preferred = profile?.colours[profileIndex(profile, block.row + block.height / 2, block.column + block.width / 2, rows, columns)];
    return colourPenalty + (nextQuota - currentQuota) * .55 + (preferred && candidate !== preferred ? 6 : 0);
  };
  const iterations = Math.min(30_000, Math.max(800, unlocked.length * 30));
  for (let step = 0; step < iterations; step += 1) {
    const index = unlocked[Math.floor(random() * unlocked.length)]; if (index === undefined) break;
    const block = blocks[index]; const names = (Object.keys(PALETTE) as Colour[]).filter((name) => name !== block.colour); const candidate = names[Math.floor(random() * names.length)];
    const before = energy(index, block.colour); const after = energy(index, candidate); const temperature = 10 * (1 - step / iterations) + .18;
    if (after <= before || random() < Math.exp((before - after) / temperature)) { const area = block.width * block.height; used[block.colour] -= area; used[candidate] += area; block.colour = candidate; }
  }
  return blocks;
}

/** 依色彩與階數配額填滿空間；已存在的區塊會被保留，不會被隨機重做。 */
function buildLayout(rows: number, columns: number, colourRatios: Ratios, sizeRatios: SizeRatios, maxTier: number, seed: number, profile?: MatrixProfile, existing: Block[] = []) {
  const random = randomFrom(seed); const cells = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false)); const output: Block[] = []; let nextId = Math.max(0, ...existing.map((block) => block.id));
  const colourQuota = Object.fromEntries((Object.keys(colourRatios) as Colour[]).map((name) => [name, Math.round(rows * columns * colourRatios[name] / 100)])) as Ratios;
  const sizeQuota = Object.fromEntries(Object.entries(sizeRatios).map(([tier, ratio]) => [Number(tier), Math.round(rows * columns * ratio / 100)])) as SizeRatios;
  const add = (shape: Omit<Block, "id" | "colour">, colour?: Colour, id?: number) => {
    const area = shape.width * shape.height; const tier = Math.max(shape.width, shape.height); let selected = colour;
    if (!selected && profile) selected = profile.colours[profileIndex(profile, shape.row + shape.height / 2, shape.column + shape.width / 2, rows, columns)] ?? "White";
    if (!selected) selected = (Object.keys(colourQuota) as Colour[]).reduce((best, name) => colourQuota[name] > colourQuota[best] ? name : best);
    mark(cells, shape); colourQuota[selected] -= area; sizeQuota[tier] = (sizeQuota[tier] ?? 0) - area; output.push({ ...shape, id: id ?? ++nextId, colour: selected });
  };
  // 原有未碰撞區塊先回到原位，確保拖曳只改變路徑附近的畫面。
  existing.forEach((block) => { if (isFree(cells, block.row, block.column, block.width, block.height)) add(block, block.colour, block.id); });
  while (true) {
    const space = bestEmptyRectangle(cells, maxTier, profile, rows, columns); if (!space) break;
    const shape = cropToTier(space, chooseTier(sizeQuota, random), random); add(shape);
  }
  return optimiseColours(output, rows, columns, colourRatios, seed, profile, new Set(existing.map((block) => block.id)));
}

/** 將被拖曳目標擠出的舊區塊優先安置到來源位置及其移動路徑附近，再補洞。 */
function exchangeAlongPath(blocks: Block[], moving: Block, target: Block, rows: number, columns: number, colourRatios: Ratios, sizeRatios: SizeRatios, maxTier: number, seed: number, profile?: MatrixProfile) {
  const displaced = blocks.filter((block) => block.id !== moving.id && overlaps(block, target));
  const survivors = blocks.filter((block) => block.id !== moving.id && !displaced.some((item) => item.id === block.id));
  const cells = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false)); mark(cells, target); survivors.forEach((block) => mark(cells, block));
  const rowDirection = Math.sign(target.row - moving.row); const columnDirection = Math.sign(target.column - moving.column);
  const relocated: Block[] = [...survivors, target];
  for (const block of displaced.sort((a, b) => b.width * b.height - a.width * a.height)) {
    const positions = Array.from({ length: rows - block.height + 1 }, (_, row) => Array.from({ length: columns - block.width + 1 }, (_, column) => ({ row, column }))).flat()
      .sort((a, b) => (Math.abs(a.row - moving.row) + Math.abs(a.column - moving.column) + Math.max(0, (a.row - moving.row) * rowDirection + (a.column - moving.column) * columnDirection) * .25) - (Math.abs(b.row - moving.row) + Math.abs(b.column - moving.column) + Math.max(0, (b.row - moving.row) * rowDirection + (b.column - moving.column) * columnDirection) * .25));
    const slot = positions.find((position) => isFree(cells, position.row, position.column, block.width, block.height));
    if (slot) { const placed = { ...block, ...slot }; mark(cells, placed); relocated.push(placed); }
  }
  return buildLayout(rows, columns, colourRatios, sizeRatios, maxTier, seed, profile, relocated);
}

export default function DeStijlGenerator() {
  const [columns, setColumns] = useState(50); const [rows, setRows] = useState(50); const [lineWidth, setLineWidth] = useState(3); const [maxTier, setMaxTier] = useState(5);
  const [colourRatios, setColourRatios] = useState<Ratios>(DEFAULT_COLOUR_RATIOS); const [sizeRatios, setSizeRatios] = useState<SizeRatios>(DEFAULT_SIZE_RATIOS); const [seed, setSeed] = useState(makeSeed);
  const [profile, setProfile] = useState<MatrixProfile>(); const [sourceLabel, setSourceLabel] = useState("純 Seed 生成"); const [text, setText] = useState(""); const [drag, setDrag] = useState<DragState>(null); const [boundarySide, setBoundarySide] = useState(320);
  const [blocks, setBlocks] = useState<Block[]>(() => buildLayout(50, 50, DEFAULT_COLOUR_RATIOS, DEFAULT_SIZE_RATIOS, 5, seed));
  const canvasRef = useRef<HTMLCanvasElement>(null); const boundaryRef = useRef<HTMLDivElement>(null);
  const metrics = useMemo<Metrics>(() => { const unit = boundarySide / Math.max(rows, columns); const line = Math.min(lineWidth, Math.max(1, unit * .18)); return { width: columns * unit, height: rows * unit, cell: unit - line, line }; }, [boundarySide, columns, lineWidth, rows]);
  const rebuild = useCallback((nextSeed = makeSeed(), nextProfile = profile, nextRows = rows, nextColumns = columns, nextColours = colourRatios, nextSizes = sizeRatios, nextMaxTier = maxTier) => { setSeed(nextSeed); setBlocks(buildLayout(nextRows, nextColumns, nextColours, nextSizes, nextMaxTier, nextSeed, nextProfile)); }, [colourRatios, maxTier, profile, rows, columns, sizeRatios]);
  useEffect(() => { const boundary = boundaryRef.current; if (!boundary) return; const observe = () => setBoundarySide(Math.max(180, Math.floor(Math.min(boundary.clientWidth, boundary.clientHeight)))); observe(); const observer = new ResizeObserver(observe); observer.observe(boundary); return () => observer.disconnect(); }, []);
  const paint = useCallback((context: CanvasRenderingContext2D, scale: number, drawMetrics: Metrics) => { context.fillStyle = "#171717"; context.fillRect(0, 0, drawMetrics.width, drawMetrics.height); const drawBlocks = drag ? blocks.filter((block) => block.id !== drag.id) : blocks; const dragged = drag && blocks.find((block) => block.id === drag.id); [...drawBlocks, ...(dragged ? [{ ...dragged, row: drag.row, column: drag.column }] : [])].forEach((block) => { context.fillStyle = PALETTE[block.colour].hex; context.fillRect(drawMetrics.line + block.column * (drawMetrics.cell + drawMetrics.line), drawMetrics.line + block.row * (drawMetrics.cell + drawMetrics.line), block.width * drawMetrics.cell + (block.width - 1) * drawMetrics.line, block.height * drawMetrics.cell + (block.height - 1) * drawMetrics.line); }); }, [blocks, drag]);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(metrics.width * dpr); canvas.height = Math.round(metrics.height * dpr); const context = canvas.getContext("2d"); if (!context) return; context.setTransform(dpr, 0, 0, dpr, 0, 0); paint(context, dpr, metrics); }, [metrics, paint]);
  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { column: Math.floor((event.clientX - rect.left) / rect.width * columns), row: Math.floor((event.clientY - rect.top) / rect.height * rows) }; }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) { const point = canvasPoint(event); const block = [...blocks].reverse().find((item) => point.row >= item.row && point.row < item.row + item.height && point.column >= item.column && point.column < item.column + item.width); if (!block) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: block.id, offsetX: point.column - block.column, offsetY: point.row - block.row, row: block.row, column: block.column }); }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) { if (!drag) return; const point = canvasPoint(event); setDrag({ ...drag, row: point.row - drag.offsetY, column: point.column - drag.offsetX }); }
  function pointerUp(event: PointerEvent<HTMLCanvasElement>) { if (!drag) return; const moving = blocks.find((block) => block.id === drag.id); if (moving) { const target = { ...moving, row: Math.max(0, Math.min(rows - moving.height, drag.row)), column: Math.max(0, Math.min(columns - moving.width, drag.column)) }; setBlocks(exchangeAlongPath(blocks, moving, target, rows, columns, colourRatios, sizeRatios, maxTier, seed, profile)); } setDrag(null); event.currentTarget.releasePointerCapture(event.pointerId); }
  function exportPng() { const scale = 2400 / Math.max(rows, columns); const line = Math.min(lineWidth * scale, Math.max(1, scale * .18)); const exportMetrics = { width: columns * scale, height: rows * scale, cell: scale - line, line }; const output = document.createElement("canvas"); output.width = exportMetrics.width; output.height = exportMetrics.height; const context = output.getContext("2d"); if (!context) return; paint(context, 1, exportMetrics); const link = document.createElement("a"); link.download = `destijl-${seed}.png`; link.href = output.toDataURL("image/png"); link.click(); }
  function changeMatrixSize(value: number) { const next = resizeSizeRatios(sizeRatios, value); setMaxTier(value); setSizeRatios(next); rebuild(seed, profile, rows, columns, colourRatios, next, value); }
  function encodeText() { if (!text.trim()) return; const nextSeed = hash(text); const colours = Array.from({ length: rows * columns }, (_, index) => (Object.keys(PALETTE) as Colour[])[(text.charCodeAt(index % text.length) + index * 17) % 5]); const nextProfile = { colours, complexity: colours.map((_, index) => text.charCodeAt(index % text.length) % 100 / 100), width: columns, height: rows }; setProfile(nextProfile); setSourceLabel("文字矩陣"); rebuild(nextSeed, nextProfile); }
  function uploadImage(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const image = new Image(); image.onload = () => { const sample = document.createElement("canvas"); sample.width = columns; sample.height = rows; const context = sample.getContext("2d"); if (!context) return; context.drawImage(image, 0, 0, columns, rows); const pixels = context.getImageData(0, 0, columns, rows).data; const brightness = (index: number) => .2126 * pixels[index * 4] + .7152 * pixels[index * 4 + 1] + .0722 * pixels[index * 4 + 2]; const nextProfile = { colours: Array.from({ length: rows * columns }, (_, index) => nearestColour(pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2])), complexity: Array.from({ length: rows * columns }, (_, index) => { const x = index % columns; const y = Math.floor(index / columns); const nearby = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < columns && ny < rows).map(([nx, ny]) => brightness(ny * columns + nx)); return nearby.length ? Math.min(1, nearby.reduce((sum, value) => sum + Math.abs(value - brightness(index)), 0) / nearby.length / 64) : 0; }), width: columns, height: rows }; setProfile(nextProfile); setSourceLabel(`圖片矩陣 · ${file.name}`); rebuild(hash(`${file.name}${file.size}`), nextProfile); URL.revokeObjectURL(image.src); }; image.src = URL.createObjectURL(file); }
  function changeRows(value: number) { setRows(value); rebuild(seed, profile, value, columns); }
  function changeColumns(value: number) { setColumns(value); rebuild(seed, profile, rows, value); }
  return <main className="editor"><section className="canvas-area"><div className="boundary" ref={boundaryRef}><canvas ref={canvasRef} className="artboard" style={{ width: metrics.width, height: metrics.height }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setDrag(null)} /><button className="canvas-regenerate" aria-label="重新生成構圖" onClick={() => rebuild()}>↻ <span>重新生成</span></button></div><p className="boundary-note">BOUNDARY 50 × 50 · 實際構圖 {columns} × {rows}</p></section><aside className="inspector"><div className="titlebar"><span className="window-dot red" /><span className="window-dot yellow" /><span className="window-dot green" /><strong>De Stijl Studio</strong></div><p className="eyebrow">{sourceLabel} · SEED {seed.toString().padStart(6, "0")}</p><section><h1>構圖控制</h1><label>寬度 <output>{columns}</output><input type="range" min="5" max="50" value={columns} onChange={(event) => changeColumns(Number(event.target.value))} /></label><label>高度 <output>{rows}</output><input type="range" min="5" max="50" value={rows} onChange={(event) => changeRows(Number(event.target.value))} /></label><label>格線 <output>{lineWidth}px</output><input type="range" min="1" max="8" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label></section><section><h2>色彩配額 <span>100%</span></h2>{(Object.keys(PALETTE) as Colour[]).map((name) => <label className="colour" key={name}><i style={{ background: PALETTE[name].hex }} />{PALETTE[name].label}<output>{colourRatios[name]}%</output><input type="range" min="0" max="100" value={colourRatios[name]} onChange={(event) => { const next = balance(colourRatios, name, Number(event.target.value)); setColourRatios(next); rebuild(seed, profile, rows, columns, next); }} /></label>)}</section><section><h2>方格階數配額 <span>100%</span></h2><label>最大階數 <output>{maxTier}</output><input type="range" min="1" max="8" value={maxTier} onChange={(event) => changeMatrixSize(Number(event.target.value))} /></label>{Array.from({ length: maxTier }, (_, index) => index + 1).map((tier) => <label className="tier" key={tier}>{tier} 階矩陣 <output>{sizeRatios[tier]}%</output><input type="range" min="0" max="100" value={sizeRatios[tier]} onChange={(event) => { const next = balance(sizeRatios, tier, Number(event.target.value)); setSizeRatios(next); rebuild(seed, profile, rows, columns, colourRatios, next); }} /></label>)}</section><section className="source"><h2>編碼輸入</h2><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="輸入文字，轉為矩陣…" /><button onClick={encodeText}>轉譯文字矩陣</button><label className="upload">上傳圖片並取樣<input type="file" accept="image/*" onChange={uploadImage} /></label></section><div className="actions"><button className="secondary" onClick={() => { setProfile(undefined); setSourceLabel("純 Seed 生成"); rebuild(); }}>重新生成</button><button className="primary" onClick={exportPng}>匯出 PNG</button></div><p className="hint">拖曳色塊時，系統優先以來源位置與拖曳路徑交換既有方塊；不能安置的部分才會由動態規劃補滿。</p></aside></main>;
}
