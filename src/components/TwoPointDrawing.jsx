import React, { useState, useRef, useCallback, useEffect } from 'react';

const WIDTH = 500;
const HEIGHT = 500;
const MIN = -10;
const MAX = 10;
/** One full segment past MIN/MAX so arrows sit one unit beyond the last tick */
const EXTENDED_MIN = MIN - 1;
const EXTENDED_MAX = MAX + 1;
const PADDING = 40;
const centerX = WIDTH / 2;
const centerY = HEIGHT / 2;
const plotWidth = WIDTH - 2 * PADDING;
const plotHeight = HEIGHT - 2 * PADDING;
const scaleX = plotWidth / (MAX - MIN);
const scaleY = plotHeight / (MAX - MIN);

/** Map value x in [MIN, MAX] to SVG x */
const valueToX = (x) => centerX + x * scaleX;
/** Map value y in [MIN, MAX] to SVG y (SVG y increases downward) */
const valueToY = (y) => centerY - y * scaleY;
/** Map SVG x to value */
const xToValue = (px) => (px - centerX) / scaleX;
/** Map SVG y to value */
const yToValue = (py) => (centerY - py) / scaleY;

/** Clamp value to [MIN, MAX] */
const clamp = (v) => Math.max(MIN, Math.min(MAX, v));
/** Round value to nearest integer and clamp */
const roundToTick = (v) => Math.round(clamp(v));

const GRID_CELL = scaleX; // 1 unit
const POINT_RADIUS = 6;
const LINE_ANIMATION_DURATION_MS = 1500;
const LINE_ARROW_SIZE = 10;

const tickValues = Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i);

/** Clip the infinite line through p1 and p2 to the rectangle [minX,maxX] x [minY,maxY]. Returns [end1, end2] or null. Works in any coordinate system (value or SVG). */
function clipLineToRect(p1, p2, minX, maxX, minY, maxY) {
	const x1 = p1.x;
	const y1 = p1.y;
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const ts = [];
	if (Math.abs(dx) > 1e-10) {
		const tMin = (minX - x1) / dx;
		const yMin = y1 + tMin * dy;
		if (yMin >= minY && yMin <= maxY) ts.push(tMin);
		const tMax = (maxX - x1) / dx;
		const yMax = y1 + tMax * dy;
		if (yMax >= minY && yMax <= maxY) ts.push(tMax);
	}
	if (Math.abs(dy) > 1e-10) {
		const tMin = (minY - y1) / dy;
		const xMin = x1 + tMin * dx;
		if (xMin >= minX && xMin <= maxX) ts.push(tMin);
		const tMax = (maxY - y1) / dy;
		const xMax = x1 + tMax * dx;
		if (xMax >= minX && xMax <= maxX) ts.push(tMax);
	}
	if (ts.length < 2) return null;
	const tLo = Math.min(...ts);
	const tHi = Math.max(...ts);
	return [
		{ x: x1 + tLo * dx, y: y1 + tLo * dy },
		{ x: x1 + tHi * dx, y: y1 + tHi * dy },
	];
}

/** Order clip endpoints so that the line goes from "near p1" to "near p2". */
function orderEndpointsByPoints(clipEnd1, clipEnd2, p1, p2) {
	const d1a = (clipEnd1.x - p1.x) ** 2 + (clipEnd1.y - p1.y) ** 2;
	const d2a = (clipEnd2.x - p1.x) ** 2 + (clipEnd2.y - p1.y) ** 2;
	return d1a <= d2a ? [clipEnd1, clipEnd2] : [clipEnd2, clipEnd1];
}

/** Container bounds in SVG pixel space (full graph area). */
const CONTAINER_LEFT = 0;
const CONTAINER_TOP = 0;
const CONTAINER_RIGHT = WIDTH;
const CONTAINER_BOTTOM = HEIGHT;

/** Arrow polygon points (SVG) with tip at (sx,sy) and direction (dx,dy) normalized; size in px. */
function arrowPoints(sx, sy, dx, dy, size) {
	const half = size / 2;
	const baseX = sx - size * dx;
	const baseY = sy - size * dy;
	const perpX = -dy;
	const perpY = dx;
	const leftX = baseX + half * perpX;
	const leftY = baseY + half * perpY;
	const rightX = baseX - half * perpX;
	const rightY = baseY - half * perpY;
	return `${sx},${sy} ${leftX},${leftY} ${rightX},${rightY}`;
}

const MAX_LINES = 2;

const TwoPointDrawing = () => {
	const [history, setHistory] = useState([]); // [{ p1, p2 }, ...] all completed lines in order
	const [historyIndex, setHistoryIndex] = useState(0); // how many lines are "current" (for undo/redo)
	const [points, setPoints] = useState([]); // current segment: 0, 1, or 2 points
	const [lineProgress, setLineProgress] = useState(0); // 0..1 for growing line
	const [hoverPreview, setHoverPreview] = useState(null); // { x, y } in value space, or null
	const containerRef = useRef(null);
	const pendingLineRef = useRef(null); // segment to commit when animation hits 1
	const historyIndexRef = useRef(0);
	historyIndexRef.current = historyIndex;

	// Display at most MAX_LINES. While animating the third line (points.length === 2),
	// show one fewer completed line so the oldest is removed before the new line animates.
	const completedLines =
		points.length === 2
			? history.slice(0, historyIndex).slice(-(MAX_LINES - 1))
			: history.slice(0, historyIndex).slice(-MAX_LINES);

	const clientToSvg = useCallback((clientX, clientY) => {
		const el = containerRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		return {
			x: Math.max(0, Math.min(WIDTH, x)),
			y: Math.max(0, Math.min(HEIGHT, y)),
		};
	}, []);

	const handleClick = useCallback(
		(e) => {
			const pt = clientToSvg(e.clientX, e.clientY);
			if (!pt) return;
			const vx = roundToTick(xToValue(pt.x));
			const vy = roundToTick(yToValue(pt.y));
			const valuePoint = { x: vx, y: vy };

			setPoints((prev) => {
				if (prev.length === 0) {
					setLineProgress(0);
					return [valuePoint];
				}
				if (prev.length === 1) {
					setLineProgress(0);
					return [...prev, valuePoint];
				}
				return prev; // animating; ignore click
			});
		},
		[clientToSvg]
	);

	const handleMouseMove = useCallback(
		(e) => {
			const pt = clientToSvg(e.clientX, e.clientY);
			if (!pt) {
				setHoverPreview(null);
				return;
			}
			setHoverPreview({
				x: roundToTick(xToValue(pt.x)),
				y: roundToTick(yToValue(pt.y)),
			});
		},
		[clientToSvg]
	);

	const handleMouseLeave = useCallback(() => {
		setHoverPreview(null);
	}, []);

	// When we have 2 points, run the line growth animation then commit to completedLines
	useEffect(() => {
		if (points.length !== 2) return;
		pendingLineRef.current = [points[0], points[1]];
		const start = performance.now();
		const tick = (now) => {
			const elapsed = now - start;
			const progress = Math.min(1, elapsed / LINE_ANIMATION_DURATION_MS);
			setLineProgress(progress);
			if (progress < 1) {
				requestAnimationFrame(tick);
			} else {
				const [p1, p2] = pendingLineRef.current || [];
				if (p1 && p2) {
					const idx = historyIndexRef.current;
					setHistory((prev) => [...prev.slice(0, idx), { p1, p2 }]);
					setHistoryIndex(idx + 1);
					setPoints([]);
					setLineProgress(0);
				}
			}
		};
		const id = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(id);
	}, [points.length]);

	const allPoints = [
		...completedLines.flatMap((seg) => [seg.p1, seg.p2]),
		...points,
	];

	const canUndo = historyIndex > 0;
	const canRedo = historyIndex < history.length;
	const canReset = history.length > 0 || points.length > 0;

	const [showGlow, setShowGlow] = useState(true);

	// Axis line endpoints: extend one segment past MIN/MAX (arrows at extended ends)
	const arrowSize = 10;
	const arrowHeight = 7;
	const xMin = valueToX(EXTENDED_MIN);
	const xMax = valueToX(EXTENDED_MAX);
	const yMin = valueToY(EXTENDED_MIN);
	const yMax = valueToY(EXTENDED_MAX);
	const xAxisLeft = xMin + arrowSize;
	const xAxisRight = xMax - arrowSize;
	const yAxisTop = yMax + arrowSize;
	const yAxisBottom = yMin - arrowSize;

	const p1 = points[0];
	const p2 = points[1];
	const x1 = p1 ? valueToX(p1.x) : 0;
	const y1 = p1 ? valueToY(p1.y) : 0;
	const x2 = p2 ? valueToX(p2.x) : 0;
	const y2 = p2 ? valueToY(p2.y) : 0;

	/** Renders a line (value-space p1, p2) extended to container edges (SVG bounds) with arrows. Returns { lineProps, arrow1, arrow2 } or null. */
	const renderExtendedLine = (segP1, segP2) => {
		const svgP1 = { x: valueToX(segP1.x), y: valueToY(segP1.y) };
		const svgP2 = { x: valueToX(segP2.x), y: valueToY(segP2.y) };
		const clip = clipLineToRect(
			svgP1,
			svgP2,
			CONTAINER_LEFT,
			CONTAINER_RIGHT,
			CONTAINER_TOP,
			CONTAINER_BOTTOM
		);
		if (!clip) return null;
		const [e1, e2] = orderEndpointsByPoints(clip[0], clip[1], svgP1, svgP2);
		const sx1 = e1.x;
		const sy1 = e1.y;
		const sx2 = e2.x;
		const sy2 = e2.y;
		const dx = sx2 - sx1;
		const dy = sy2 - sy1;
		const len = Math.hypot(dx, dy) || 1;
		const ux = dx / len;
		const uy = dy / len;
		const arrow1 = arrowPoints(sx1, sy1, -ux, -uy, LINE_ARROW_SIZE);
		const arrow2 = arrowPoints(sx2, sy2, ux, uy, LINE_ARROW_SIZE);
		return {
			lineProps: {
				x1: sx1,
				y1: sy1,
				x2: sx2,
				y2: sy2,
				stroke: '#1967d2',
				strokeWidth: 3,
				strokeLinecap: 'round',
			},
			arrow1,
			arrow2,
		};
	};

	return (
		<div
			ref={containerRef}
			className="two-point-drawing"
			role="button"
			tabIndex={0}
			onClick={handleClick}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			style={{
				position: 'relative',
				width: WIDTH,
				height: HEIGHT,
				border: '1px solid #ccc',
				borderRadius: 4,
				overflow: 'hidden',
				backgroundColor: '#fff',
				cursor: 'crosshair',
				userSelect: 'none',
				WebkitUserSelect: 'none',
				MozUserSelect: 'none',
				msUserSelect: 'none',
			}}
		>
			{/* Undo, Redo, Reset */}
			<div className={`segmented-glow-button simple-glow compact${!showGlow ? ' hide-orbit' : ''}`} style={{ position: 'absolute', top: 11, right: 12, zIndex: 1 }}>
				<div className="segment-container">
					<button
						type="button"
						className={`segment ${!canUndo ? 'inactive' : ''}`}
						onClick={(e) => {
							e.stopPropagation();
							if (canUndo) setShowGlow(false);
							setHistoryIndex((i) => Math.max(0, i - 1));
						}}
						disabled={!canUndo}
					>
						Undo
					</button>
					<button
						type="button"
						className={`segment ${!canRedo ? 'inactive' : ''}`}
						onClick={(e) => {
							e.stopPropagation();
							if (canRedo) setShowGlow(false);
							setHistoryIndex((i) => Math.min(history.length, i + 1));
						}}
						disabled={!canRedo}
					>
						Redo
					</button>
					<button
						type="button"
						className={`segment ${!canReset ? 'inactive' : ''}`}
						onClick={(e) => {
							e.stopPropagation();
							if (canReset) setShowGlow(false);
							setHistory([]);
							setHistoryIndex(0);
							setPoints([]);
							setLineProgress(0);
						}}
						disabled={!canReset}
					>
						Reset
					</button>
				</div>
			</div>
			<svg width={WIDTH} height={HEIGHT} style={{ display: 'block', pointerEvents: 'none' }}>
				<defs>
					<pattern
						id="grid-two-point"
						x={PADDING}
						y={PADDING}
						width={GRID_CELL}
						height={GRID_CELL}
						patternUnits="userSpaceOnUse"
					>
						<path
							d={`M 0 0 L 0 ${GRID_CELL} M 0 0 L ${GRID_CELL} 0 M ${GRID_CELL} 0 L ${GRID_CELL} ${GRID_CELL} M 0 ${GRID_CELL} L ${GRID_CELL} ${GRID_CELL}`}
							stroke="#e6e6e6"
							strokeWidth="1"
							fill="none"
						/>
					</pattern>
				</defs>
				<rect width={WIDTH} height={HEIGHT} fill="url(#grid-two-point)" />
				{/* X axis */}
				<line
					x1={xAxisLeft}
					y1={centerY}
					x2={xAxisRight}
					y2={centerY}
					stroke="#999999"
					strokeWidth={2}
				/>
				{/* Y axis */}
				<line
					x1={centerX}
					y1={yAxisTop}
					x2={centerX}
					y2={yAxisBottom}
					stroke="#999999"
					strokeWidth={2}
				/>
				{/* Axis labels */}
				<text
					x={valueToX(10)}
					y={centerY - 12}
					textAnchor="middle"
					fontSize="14px"
					fontWeight="bold"
					fontStyle="italic"
					fill="#999999"
					fontFamily="'Latin Modern Roman CK12', 'Latin Modern Roman', serif"
				>
					x-axis
				</text>
				<text
					x={centerX + 14}
					y={yMax + 5}
					textAnchor="start"
					dominantBaseline="middle"
					fontSize="14px"
					fontWeight="bold"
					fontStyle="italic"
					fill="#999999"
					fontFamily="'Latin Modern Roman CK12', 'Latin Modern Roman', serif"
				>
					y-axis
				</text>
				{/* X axis ticks and labels */}
				{tickValues.map((value) => {
					const x = valueToX(value);
					return (
						<g key={`x-${value}`}>
							<line
								x1={x}
								y1={centerY}
								x2={x}
								y2={centerY + 10}
								stroke="#999999"
								strokeWidth={1.5}
							/>
							{value !== 0 && (
								<text
									x={x}
									y={centerY + 26}
									textAnchor="middle"
									fontSize="14px"
									fontWeight="bold"
									fill="#999999"
									fontFamily="'Latin Modern Roman CK12', 'Latin Modern Roman', serif"
								>
									{value < 0 ? '\u002D' + (-value) : value}
								</text>
							)}
						</g>
					);
				})}
				{/* Y axis ticks and labels */}
				{tickValues.map((value) => {
					const y = valueToY(value);
					return (
						<g key={`y-${value}`}>
							<line
								x1={centerX}
								y1={y}
								x2={centerX - 10}
								y2={y}
								stroke="#999999"
								strokeWidth={1.5}
							/>
							{value !== 0 && (
								<text
									x={centerX - 14}
									y={y + 5}
									textAnchor="end"
									fontSize="14px"
									fontWeight="bold"
									fill="#999999"
									fontFamily="'Latin Modern Roman CK12', 'Latin Modern Roman', serif"
								>
									{value < 0 ? '\u002D' + (-value) : value}
								</text>
							)}
						</g>
					);
				})}
				{/* Arrows at all 4 ends: right (+x), left (-x), top (+y), bottom (-y) */}
				<polygon
					points={`${xMax - arrowSize},${centerY - arrowHeight} ${xMax},${centerY} ${xMax - arrowSize},${centerY + arrowHeight}`}
					fill="#999999"
				/>
				<polygon
					points={`${xMin + arrowSize},${centerY - arrowHeight} ${xMin},${centerY} ${xMin + arrowSize},${centerY + arrowHeight}`}
					fill="#999999"
				/>
				<polygon
					points={`${centerX - arrowHeight},${yMax + arrowSize} ${centerX},${yMax} ${centerX + arrowHeight},${yMax + arrowSize}`}
					fill="#999999"
				/>
				<polygon
					points={`${centerX - arrowHeight},${yMin - arrowSize} ${centerX},${yMin} ${centerX + arrowHeight},${yMin - arrowSize}`}
					fill="#999999"
				/>
				{/* Hover preview: where a point would be placed */}
				{hoverPreview && (
					<circle
						cx={valueToX(hoverPreview.x)}
						cy={valueToY(hoverPreview.y)}
						r={POINT_RADIUS}
						fill="#1967d2"
						fillOpacity={0.4}
						stroke="#1967d2"
						strokeOpacity={0.5}
						strokeWidth={2}
					/>
				)}
				{/* Completed lines (max 2): extended to edges with arrows */}
				{completedLines.map((seg, idx) => {
					const r = renderExtendedLine(seg.p1, seg.p2);
					if (!r) return null;
					return (
						<g key={idx}>
							<line {...r.lineProps} />
							<polygon points={r.arrow1} fill="#1967d2" />
							<polygon points={r.arrow2} fill="#1967d2" />
						</g>
					);
				})}
				{/* Animated line (current segment): starts at midpoint, both ends grow to container edges with arrows */}
				{points.length === 2 && (() => {
					const svgP1 = { x: valueToX(p1.x), y: valueToY(p1.y) };
					const svgP2 = { x: valueToX(p2.x), y: valueToY(p2.y) };
					const clip = clipLineToRect(
						svgP1,
						svgP2,
						CONTAINER_LEFT,
						CONTAINER_RIGHT,
						CONTAINER_TOP,
						CONTAINER_BOTTOM
					);
					if (!clip) return null;
					const [e1, e2] = orderEndpointsByPoints(clip[0], clip[1], svgP1, svgP2);
					const sx1 = e1.x;
					const sy1 = e1.y;
					const sx2 = e2.x;
					const sy2 = e2.y;
					const dx = sx2 - sx1;
					const dy = sy2 - sy1;
					const fullLen = Math.hypot(dx, dy) || 1;
					const ux = dx / fullLen;
					const uy = dy / fullLen;
					const midX = (sx1 + sx2) / 2;
					const midY = (sy1 + sy2) / 2;
					const halfLen = fullLen / 2;
					// Grow from center to container edges: length depends on angle and position
					const growLen = lineProgress * halfLen;
					const startX = midX - growLen * ux;
					const startY = midY - growLen * uy;
					const endX = midX + growLen * ux;
					const endY = midY + growLen * uy;
					const arrowLeft = arrowPoints(startX, startY, -ux, -uy, LINE_ARROW_SIZE);
					const arrowRight = arrowPoints(endX, endY, ux, uy, LINE_ARROW_SIZE);
					return (
						<g>
							<line
								x1={startX}
								y1={startY}
								x2={endX}
								y2={endY}
								stroke="#1967d2"
								strokeWidth={3}
								strokeLinecap="round"
							/>
							<polygon points={arrowLeft} fill="#1967d2" />
							<polygon points={arrowRight} fill="#1967d2" />
						</g>
					);
				})()}
				{/* All points: completed line endpoints + current points */}
				{allPoints.map((p, i) => (
					<circle
						key={i}
						cx={valueToX(p.x)}
						cy={valueToY(p.y)}
						r={POINT_RADIUS}
						fill="#1967d2"
						stroke="#fff"
						strokeWidth={2}
					/>
				))}
			</svg>
		</div>
	);
};

export default TwoPointDrawing;
