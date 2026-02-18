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

const tickValues = Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i);

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

	const buttonStyle = (enabled) => ({
		padding: '4px 8px',
		fontSize: 12,
		cursor: enabled ? 'pointer' : 'default',
		opacity: enabled ? 1 : 0.5,
	});

	// Axis line endpoints: extend one segment past MIN/MAX (arrows at extended ends)
	const arrowSize = 8;
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
	const lineEndX = x1 + lineProgress * (x2 - x1);
	const lineEndY = y1 + lineProgress * (y2 - y1);

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
				backgroundColor: '#fafafa',
				cursor: 'crosshair',
			}}
		>
			{/* Undo, Redo, Reset */}
			<div
				style={{
					position: 'absolute',
					top: 11,
					right: 12,
					display: 'flex',
					gap: 6,
					alignItems: 'center',
					zIndex: 1,
				}}
			>
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						setHistoryIndex((i) => Math.max(0, i - 1));
					}}
					disabled={!canUndo}
					style={buttonStyle(canUndo)}
				>
					Undo
				</button>
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						setHistoryIndex((i) => Math.min(history.length, i + 1));
					}}
					disabled={!canRedo}
					style={buttonStyle(canRedo)}
				>
					Redo
				</button>
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						setHistory([]);
						setHistoryIndex(0);
						setPoints([]);
						setLineProgress(0);
					}}
					disabled={!canReset}
					style={{
						...buttonStyle(canReset),
						backgroundColor: '#e34242',
						borderRadius: 6,
						border: 'none',
					}}
				>
					Reset
				</button>
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
							stroke="#e0e0e0"
							strokeWidth="0.5"
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
					stroke="#333"
					strokeWidth={2}
				/>
				{/* Y axis */}
				<line
					x1={centerX}
					y1={yAxisTop}
					x2={centerX}
					y2={yAxisBottom}
					stroke="#333"
					strokeWidth={2}
				/>
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
								stroke="#333"
								strokeWidth={1.5}
							/>
							{value !== 0 && (
								<text
									x={x}
									y={centerY + 26}
									textAnchor="middle"
									fontSize={14}
									fill="#333"
									fontFamily="system-ui, sans-serif"
								>
									{value}
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
								stroke="#333"
								strokeWidth={1.5}
							/>
							{value !== 0 && (
								<text
									x={centerX - 14}
									y={y + 5}
									textAnchor="end"
									fontSize={14}
									fill="#333"
									fontFamily="system-ui, sans-serif"
								>
									{value}
								</text>
							)}
						</g>
					);
				})}
				{/* Arrows at all 4 ends: right (+x), left (-x), top (+y), bottom (-y) */}
				<polygon
					points={`${xMax - arrowSize},${centerY - arrowSize} ${xMax},${centerY} ${xMax - arrowSize},${centerY + arrowSize}`}
					fill="#333"
				/>
				<polygon
					points={`${xMin + arrowSize},${centerY - arrowSize} ${xMin},${centerY} ${xMin + arrowSize},${centerY + arrowSize}`}
					fill="#333"
				/>
				<polygon
					points={`${centerX - arrowSize},${yMax + arrowSize} ${centerX},${yMax} ${centerX + arrowSize},${yMax + arrowSize}`}
					fill="#333"
				/>
				<polygon
					points={`${centerX - arrowSize},${yMin - arrowSize} ${centerX},${yMin} ${centerX + arrowSize},${yMin - arrowSize}`}
					fill="#333"
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
				{/* Completed lines (max 2) */}
				{completedLines.map((seg, idx) => (
					<line
						key={idx}
						x1={valueToX(seg.p1.x)}
						y1={valueToY(seg.p1.y)}
						x2={valueToX(seg.p2.x)}
						y2={valueToY(seg.p2.y)}
						stroke="#1967d2"
						strokeWidth={3}
						strokeLinecap="round"
					/>
				))}
				{/* Animated line from first to second point (current segment) */}
				{points.length === 2 && (
					<line
						x1={x1}
						y1={y1}
						x2={lineEndX}
						y2={lineEndY}
						stroke="#1967d2"
						strokeWidth={3}
						strokeLinecap="round"
					/>
				)}
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
