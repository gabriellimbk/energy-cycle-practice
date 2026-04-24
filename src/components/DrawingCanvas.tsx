import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, Pencil } from 'lucide-react';

export interface DrawingCanvasSnapshot {
  imageData: string;
  boardSize: {
    width: number;
    height: number;
  };
  viewport?: {
    x: number;
    y: number;
  };
  strokes?: Stroke[];
  templateOffset?: {
    x: number;
    y: number;
  };
}

export type TemplateLayout = 3 | 4 | 5;

export interface DrawingCanvasRef {
  clear: () => void;
  getImageData: () => string;
  getAnalysisImages: () => string[];
  getSnapshot: () => DrawingCanvasSnapshot | null;
  focusTemplate: () => void;
}

interface DrawingCanvasProps {
  initialSnapshot?: DrawingCanvasSnapshot | null;
  displayScale?: number;
  templateLayout?: TemplateLayout;
  onTemplateChange?: (layout: TemplateLayout) => void;
  onClear?: () => void;
}

interface StrokePoint {
  x: number;
  y: number;
}

interface Stroke {
  mode: 'draw' | 'erase';
  color: string;
  size: number;
  points: StrokePoint[];
}

interface ExportRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PENCIL_STROKE_WIDTH = 3;
const ERASER_STROKE_WIDTH = 20;
const DRAW_COLOR = '#1a1a1a';
const BACKGROUND_COLOR = '#ffffff';
const BOARD_WIDTH_MULTIPLIER = 2;
const BOARD_HEIGHT_MULTIPLIER = 2;
const BOARD_HORIZONTAL_PADDING = 140;
const BOARD_VERTICAL_PADDING = 220;
const MIN_BOARD_WIDTH = 1800;
const MIN_BOARD_HEIGHT = 1200;
const TEMPLATE_STROKE_COLOR = '#477a7a';
const TEMPLATE_BORDER = '2px dashed rgba(71, 122, 122, 0.9)';
const ANALYSIS_EXPORT_SCALE = 2;
const HESS_CALCULATION_TITLE = "Hess's Law Calculation";
const TEMPLATE_TOP_PADDING = 112;
const HESS_TITLE_TOP_PADDING = 20;
const TEMPLATE_FOCUS_TOP_INSET = 140;
const TEMPLATE_BASE_FRAME_WIDTH = Math.min(MIN_BOARD_WIDTH * 0.9, 1040);
const TEMPLATE_LEFT_MARGIN = (MIN_BOARD_WIDTH - TEMPLATE_BASE_FRAME_WIDTH) / 2;

function samePoint(left: StrokePoint, right: StrokePoint) {
  return left.x === right.x && left.y === right.y;
}

function midpoint(left: StrokePoint, right: StrokePoint): StrokePoint {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function getTouchCenter(touchA: Touch, touchB: Touch) {
  return {
    x: (touchA.clientX + touchB.clientX) / 2,
    y: (touchA.clientY + touchB.clientY) / 2,
  };
}

function findTouchByIdentifier(touchList: TouchList, identifier: number) {
  for (let index = 0; index < touchList.length; index += 1) {
    if (touchList[index].identifier === identifier) {
      return touchList[index];
    }
  }

  return null;
}

function getTemplateBoxes(templateLayout: TemplateLayout, width: number, _height: number) {
  const safeWidth = Math.max(480, width);
  const frameWidth = Math.min(safeWidth * 0.9, 1040);
  const frameStartX = Math.max(40, Math.min(TEMPLATE_LEFT_MARGIN, safeWidth - frameWidth - 40));
  const boxHeight = templateLayout === 4 ? 62 : 52;
  const horizontalGap = templateLayout === 4
    ? Math.max(120, frameWidth * 0.18)
    : Math.max(56, frameWidth * 0.08);
  const baseBoxWidth = Math.min(470, Math.max(280, (frameWidth - horizontalGap) / 2));
  const outwardGrowth = templateLayout === 4 ? 42 : 0;
  const boxWidth = baseBoxWidth + outwardGrowth;
  const leftX = frameStartX - outwardGrowth;
  const rightX = frameStartX + frameWidth - baseBoxWidth;
  const topY = 60 + TEMPLATE_TOP_PADDING;
  const standardRowGap = 120;
  const expandedRowGap = templateLayout === 4 ? 184 : 140;
  const lowerRowGap = templateLayout === 4 || templateLayout === 5 ? expandedRowGap : standardRowGap;
  const secondRowY = topY + lowerRowGap;
  const bottomY = secondRowY + lowerRowGap;

  const boxes = [
    { left: leftX, top: topY, width: boxWidth, height: boxHeight },
    { left: rightX, top: topY, width: boxWidth, height: boxHeight },
  ];

  if (templateLayout === 4 || templateLayout === 5) {
    boxes.push(
      { left: leftX, top: secondRowY, width: boxWidth, height: boxHeight },
      { left: rightX, top: secondRowY, width: boxWidth, height: boxHeight },
    );
  }

  if (templateLayout === 3) {
    const centerWidth = Math.min(520, Math.max(340, frameWidth * 0.56));
    boxes.push({ left: (safeWidth - centerWidth) / 2, top: bottomY, width: centerWidth, height: boxHeight });
  }

  if (templateLayout === 5) {
    const centerWidth = Math.min(560, Math.max(360, frameWidth * 0.58));
    boxes.push({ left: (safeWidth - centerWidth) / 2, top: bottomY, width: centerWidth, height: boxHeight });
  }

  return boxes;
}

function getTemplateBounds(templateLayout: TemplateLayout, width: number, height: number) {
  const boxes = getTemplateBoxes(templateLayout, width, height);
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function getHessCalculationTitlePosition(templateLayout: TemplateLayout, width: number, height: number) {
  const bounds = getTemplateBounds(templateLayout, width, height);
  return {
    left: bounds.left,
    top: bounds.top + bounds.height + 88 + HESS_TITLE_TOP_PADDING,
  };
}

function clampRegion(region: ExportRegion, width: number, height: number): ExportRegion {
  const left = Math.max(0, Math.min(region.left, width));
  const top = Math.max(0, Math.min(region.top, height));
  const right = Math.max(left + 1, Math.min(region.left + region.width, width));
  const bottom = Math.max(top + 1, Math.min(region.top + region.height, height));

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function applyTemplateOffset(
  boxes: { left: number; top: number; width: number; height: number }[],
  offset: { x: number; y: number }
) {
  return boxes.map((box) => ({
    ...box,
    left: box.left + offset.x,
    top: box.top + offset.y,
  }));
}

const DrawingCanvas = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(({ initialSnapshot, displayScale = 1, templateLayout = 3, onTemplateChange, onClear }, ref) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scaledPaperRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const livePointsRef = useRef<StrokePoint[]>([]);
  const activePointerIdRef = useRef<number | null>(null);
  const isDrawingRef = useRef(false);
  const displayScaleRef = useRef(displayScale);
  const latestScaleRef = useRef(displayScale);
  latestScaleRef.current = displayScale;
  const hasInitializedViewportRef = useRef(false);
  const boardSizeRef = useRef({
    width: Math.max(MIN_BOARD_WIDTH, initialSnapshot?.boardSize.width ?? MIN_BOARD_WIDTH),
    height: Math.max(MIN_BOARD_HEIGHT, initialSnapshot?.boardSize.height ?? MIN_BOARD_HEIGHT),
  });
  const templateOffsetRef = useRef({
    x: initialSnapshot?.templateOffset?.x || 0,
    y: initialSnapshot?.templateOffset?.y || 0,
  });
  const viewportMetricsRef = useRef({
    width: 0,
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const penTouchSuppressionUntilRef = useRef(0);
  const touchScrollRef = useRef({
    active: false,
    primaryId: null as number | null,
    secondaryId: null as number | null,
    centerX: 0,
    centerY: 0,
  });
  const blocksMouseInputRef = useRef(
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [mode, setMode] = useState<'pencil' | 'eraser'>('pencil');
  const modeRef = useRef<'pencil' | 'eraser'>('pencil');
  const [, bumpTemplate] = useState(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const syncViewportMetrics = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const width = Math.max(1, scroller.clientWidth);
    const height = Math.max(1, scroller.clientHeight);
    viewportMetricsRef.current = {
      width,
      height,
      scrollLeft: scroller.scrollLeft / latestScaleRef.current,
      scrollTop: scroller.scrollTop / latestScaleRef.current,
    };
  }, []);

  const focusTemplateViewport = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const scale = latestScaleRef.current;
    const bounds = getTemplateBounds(templateLayout as TemplateLayout, boardSizeRef.current.width, boardSizeRef.current.height);
    const offsetBounds = {
      ...bounds,
      left: bounds.left + templateOffsetRef.current.x,
      top: bounds.top + templateOffsetRef.current.y,
    };
    const targetLeft = (offsetBounds.left + offsetBounds.width / 2) * scale - scroller.clientWidth / 2;
    const targetTop = Math.max(0, offsetBounds.top * scale - TEMPLATE_FOCUS_TOP_INSET);
    scroller.scrollLeft = Math.max(0, Math.round(targetLeft));
    scroller.scrollTop = Math.max(0, Math.round(targetTop));
    syncViewportMetrics();
  }, [syncViewportMetrics, templateLayout]);

  const drawBoardBackground = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (backgroundImageRef.current) {
      ctx.drawImage(backgroundImageRef.current, 0, 0, width, height);
    }
  }, []);

  const drawStrokeOnContext = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    const points = stroke.points;
    if (!points.length) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1 || (points.length === 2 && samePoint(points[0], points[1]))) {
      const point = points[0];
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + 0.01, point.y + 0.01);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const mid = midpoint(current, next);
      ctx.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }, []);

  const redrawAll = useCallback(() => {
    const ctx = contextRef.current;
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, boardSizeRef.current.width, boardSizeRef.current.height);
    drawBoardBackground(ctx, boardSizeRef.current.width, boardSizeRef.current.height);

    for (const stroke of strokesRef.current) {
      drawStrokeOnContext(ctx, stroke);
    }
  }, [drawBoardBackground, drawStrokeOnContext]);

  const cloneStrokes = useCallback((strokes: Stroke[]) => {
    return strokes.map((stroke) => ({
      mode: stroke.mode,
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map((point) => ({ ...point })),
    }));
  }, []);

  const getStrokeBounds = useCallback((strokes: Stroke[]) => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const stroke of strokes) {
      const padding = Math.max(12, stroke.size * 1.75);
      for (const point of stroke.points) {
        minX = Math.min(minX, point.x - padding);
        minY = Math.min(minY, point.y - padding);
        maxX = Math.max(maxX, point.x + padding);
        maxY = Math.max(maxY, point.y + padding);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    return clampRegion({
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
    }, boardSizeRef.current.width, boardSizeRef.current.height);
  }, []);

  const expandRegion = useCallback((region: ExportRegion, paddingX: number, paddingY: number) => {
    return clampRegion({
      left: region.left - paddingX,
      top: region.top - paddingY,
      width: region.width + paddingX * 2,
      height: region.height + paddingY * 2,
    }, boardSizeRef.current.width, boardSizeRef.current.height);
  }, []);

  const mergeRegions = useCallback((regions: Array<ExportRegion | null | undefined>) => {
    const validRegions = regions.filter(Boolean) as ExportRegion[];
    if (validRegions.length === 0) {
      return null;
    }

    const left = Math.min(...validRegions.map((region) => region.left));
    const top = Math.min(...validRegions.map((region) => region.top));
    const right = Math.max(...validRegions.map((region) => region.left + region.width));
    const bottom = Math.max(...validRegions.map((region) => region.top + region.height));

    return clampRegion({
      left,
      top,
      width: right - left,
      height: bottom - top,
    }, boardSizeRef.current.width, boardSizeRef.current.height);
  }, []);

  const renderBoardToContext = useCallback((target: CanvasRenderingContext2D, width: number, height: number, strokes: Stroke[]) => {
    const inkLayer = document.createElement('canvas');
    inkLayer.width = Math.max(1, width);
    inkLayer.height = Math.max(1, height);
    const inkContext = inkLayer.getContext('2d');
    if (!inkContext) {
      return;
    }

    for (const stroke of strokes) {
      drawStrokeOnContext(inkContext, stroke);
    }

    target.fillStyle = BACKGROUND_COLOR;
    target.fillRect(0, 0, width, height);
    drawBoardBackground(target, width, height);

    target.save();
    target.setLineDash([14, 10]);
    target.strokeStyle = TEMPLATE_STROKE_COLOR;
    target.lineWidth = 2;
    for (const box of applyTemplateOffset(
      getTemplateBoxes(templateLayout as TemplateLayout, width, height),
      templateOffsetRef.current,
    )) {
      target.strokeRect(box.left, box.top, box.width, box.height);
    }
    target.restore();
    target.drawImage(inkLayer, 0, 0, width, height);
  }, [drawBoardBackground, drawStrokeOnContext, templateLayout]);

  const createRenderedExportCanvas = useCallback((scale = 1) => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(1, Math.round(boardSizeRef.current.width * scale));
    exportCanvas.height = Math.max(1, Math.round(boardSizeRef.current.height * scale));
    const exportContext = exportCanvas.getContext('2d');
    if (!exportContext) {
      return null;
    }

    exportContext.setTransform(scale, 0, 0, scale, 0, 0);
    renderBoardToContext(exportContext, boardSizeRef.current.width, boardSizeRef.current.height, strokesRef.current);
    exportContext.setTransform(1, 0, 0, 1, 0, 0);

    return exportCanvas;
  }, [renderBoardToContext]);

  const createCroppedDataUrl = useCallback((sourceCanvas: HTMLCanvasElement, region: ExportRegion, scale = 1) => {
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.max(1, Math.round(region.width * scale));
    cropCanvas.height = Math.max(1, Math.round(region.height * scale));
    const cropContext = cropCanvas.getContext('2d');
    if (!cropContext) {
      return '';
    }

    cropContext.drawImage(
      sourceCanvas,
      Math.round(region.left * scale),
      Math.round(region.top * scale),
      Math.round(region.width * scale),
      Math.round(region.height * scale),
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );

    return cropCanvas.toDataURL('image/png');
  }, []);

  const configureContext = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = DRAW_COLOR;
    ctx.lineWidth = PENCIL_STROKE_WIDTH;
  }, []);

  const applyPaperSize = useCallback(() => {
    const scaledPaper = scaledPaperRef.current;
    const paper = paperRef.current;
    if (!paper || !scaledPaper) {
      return;
    }

    paper.style.width = `${boardSizeRef.current.width}px`;
    paper.style.height = `${boardSizeRef.current.height}px`;
    scaledPaper.style.width = `${boardSizeRef.current.width * latestScaleRef.current}px`;
    scaledPaper.style.height = `${boardSizeRef.current.height * latestScaleRef.current}px`;
  }, []);

  const getMaxStrokeExtent = useCallback(() => {
    let maxX = 0;
    let maxY = 0;

    for (const stroke of strokesRef.current) {
      for (const point of stroke.points) {
        maxX = Math.max(maxX, point.x + stroke.size);
        maxY = Math.max(maxY, point.y + stroke.size);
      }
    }

    if (activeStrokeRef.current) {
      for (const point of activeStrokeRef.current.points) {
        maxX = Math.max(maxX, point.x + activeStrokeRef.current.size);
        maxY = Math.max(maxY, point.y + activeStrokeRef.current.size);
      }
    }

    return { maxX, maxY };
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(boardSizeRef.current.width * ratio));
    canvas.height = Math.max(1, Math.round(boardSizeRef.current.height * ratio));
    canvas.style.width = `${boardSizeRef.current.width}px`;
    canvas.style.height = `${boardSizeRef.current.height}px`;

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) {
      return;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    configureContext(ctx);
    contextRef.current = ctx;
    redrawAll();
  }, [configureContext, redrawAll]);

  const notePenActivity = useCallback((durationMs = 650) => {
    penTouchSuppressionUntilRef.current = Date.now() + durationMs;

    if (touchScrollRef.current.active) {
      touchScrollRef.current = {
        active: false,
        primaryId: null,
        secondaryId: null,
        centerX: 0,
        centerY: 0,
      };
    }
  }, []);

  const touchScrollAllowed = useCallback(() => {
    return Date.now() >= penTouchSuppressionUntilRef.current;
  }, []);

  const getRelativePoint = useCallback((event: PointerEvent): StrokePoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / latestScaleRef.current,
      y: (event.clientY - rect.top) / latestScaleRef.current,
    };
  }, []);

  const ensurePaperSize = useCallback((point: StrokePoint | null = null) => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return null;
    }

    const scrollerWidth = Math.max(320, scroller.clientWidth);
    const scrollerHeight = Math.max(620, scroller.clientHeight);
    let nextWidth = Math.max(
      MIN_BOARD_WIDTH,
      boardSizeRef.current.width || 0,
      Math.round(scrollerWidth * BOARD_WIDTH_MULTIPLIER),
    );
    let nextHeight = Math.max(
      MIN_BOARD_HEIGHT,
      boardSizeRef.current.height || 0,
      Math.round(scrollerHeight * BOARD_HEIGHT_MULTIPLIER),
    );

    const templateBounds = getTemplateBounds(templateLayout as TemplateLayout, nextWidth, nextHeight);
    nextWidth = Math.max(nextWidth, Math.ceil(templateBounds.left + templateBounds.width + BOARD_HORIZONTAL_PADDING));
    nextHeight = Math.max(nextHeight, Math.ceil(templateBounds.top + templateBounds.height + BOARD_VERTICAL_PADDING * 2));

    const changed = nextWidth !== boardSizeRef.current.width || nextHeight !== boardSizeRef.current.height;
    boardSizeRef.current = {
      width: nextWidth,
      height: nextHeight,
    };

    if (changed) {
      applyPaperSize();
      resizeCanvas();
      bumpTemplate((v: number) => v + 1);
    }

    if (!point) {
      return null;
    }

    return point;
  }, [applyPaperSize, bumpTemplate, getMaxStrokeExtent, resizeCanvas]);

  const ensureViewportRoom = useCallback(() => {
  }, []);

  const appendPoint = useCallback((point: StrokePoint) => {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke) {
      return;
    }

    const lastPoint = activeStroke.points[activeStroke.points.length - 1];
    if (!lastPoint || !samePoint(lastPoint, point)) {
      activeStroke.points.push(point);
      livePointsRef.current.push(point);
    }
  }, []);

  const shouldIgnorePointer = useCallback((event: PointerEvent) => {
    if (!event.isPrimary) {
      return true;
    }

    if (event.pointerType === 'mouse' && blocksMouseInputRef.current) {
      return true;
    }

    return false;
  }, []);

  const scheduleStrokeRender = useCallback(() => {
    if (rafIdRef.current !== null) {
      return;
    }

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;

      const ctx = contextRef.current;
      const activeStroke = activeStrokeRef.current;
      if (!ctx || !activeStroke || !livePointsRef.current.length) {
        return;
      }

      drawStrokeOnContext(ctx, {
        mode: activeStroke.mode,
        color: activeStroke.color,
        size: activeStroke.size,
        points: livePointsRef.current,
      });

      livePointsRef.current = livePointsRef.current.slice(-2);
    });
  }, [drawStrokeOnContext]);

  const flushStrokeRender = useCallback(() => {
    const ctx = contextRef.current;
    const activeStroke = activeStrokeRef.current;

    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (!ctx || !activeStroke || !livePointsRef.current.length) {
      return;
    }

    drawStrokeOnContext(ctx, {
      mode: activeStroke.mode,
      color: activeStroke.color,
      size: activeStroke.size,
      points: livePointsRef.current,
    });

    livePointsRef.current = livePointsRef.current.slice(-2);
  }, [drawStrokeOnContext]);

  const commitActiveStroke = useCallback(() => {
    flushStrokeRender();

    if (activeStrokeRef.current) {
      strokesRef.current.push({
        mode: activeStrokeRef.current.mode,
        color: activeStrokeRef.current.color,
        size: activeStrokeRef.current.size,
        points: [...activeStrokeRef.current.points],
      });
    }
  }, [flushStrokeRender]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    if (!canvas || !scroller) {
      return;
    }

    applyPaperSize();
    resizeCanvas();
    syncViewportMetrics();

    if (initialSnapshot?.viewport) {
      scroller.scrollLeft = initialSnapshot.viewport.x * latestScaleRef.current;
      scroller.scrollTop = initialSnapshot.viewport.y * latestScaleRef.current;
      hasInitializedViewportRef.current = true;
    } else if (!hasInitializedViewportRef.current) {
      const viewportWidth = Math.max(1, scroller.clientWidth - 8);
      scroller.scrollLeft = Math.max(0, Math.round((boardSizeRef.current.width * latestScaleRef.current - viewportWidth) / 2));
      scroller.scrollTop = 0;
      hasInitializedViewportRef.current = true;
    }
    syncViewportMetrics();

    const observer = new ResizeObserver(() => {
      ensurePaperSize();
      resizeCanvas();
      syncViewportMetrics();
    });

    observer.observe(scroller);
    window.addEventListener('resize', resizeCanvas);
    scroller.addEventListener('scroll', syncViewportMetrics, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      scroller.removeEventListener('scroll', syncViewportMetrics);
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [applyPaperSize, ensurePaperSize, initialSnapshot?.viewport, resizeCanvas, syncViewportMetrics]);

  useEffect(() => {
    applyPaperSize();
  }, [applyPaperSize, displayScale]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const previousScale = displayScaleRef.current;

    if (activeStrokeRef.current) {
      commitActiveStroke();
      activeStrokeRef.current = null;
      livePointsRef.current = [];
      activePointerIdRef.current = null;
      isDrawingRef.current = false;
      setIsDrawing(false);
    }

    if (!scroller || previousScale === displayScale) {
      displayScaleRef.current = displayScale;
      syncViewportMetrics();
      return;
    }

    const viewportCenterX = (scroller.scrollLeft + scroller.clientWidth / 2) / previousScale;
    const viewportCenterY = (scroller.scrollTop + scroller.clientHeight / 2) / previousScale;
    const nextScrollLeft = viewportCenterX * displayScale - scroller.clientWidth / 2;
    const nextScrollTop = viewportCenterY * displayScale - scroller.clientHeight / 2;

    scroller.scrollLeft = Math.max(0, nextScrollLeft);
    scroller.scrollTop = Math.max(0, nextScrollTop);
    displayScaleRef.current = displayScale;
    redrawAll();
    syncViewportMetrics();
  }, [commitActiveStroke, displayScale, redrawAll, syncViewportMetrics]);

  useLayoutEffect(() => {
    if (!initialSnapshot) {
      hasInitializedViewportRef.current = false;
      strokesRef.current = [];
      backgroundImageRef.current = null;
      templateOffsetRef.current = { x: 0, y: 0 };
      redrawAll();
      return;
    }

    boardSizeRef.current = {
      width: Math.max(MIN_BOARD_WIDTH, initialSnapshot.boardSize.width),
      height: Math.max(MIN_BOARD_HEIGHT, initialSnapshot.boardSize.height),
    };
    hasInitializedViewportRef.current = false;
    templateOffsetRef.current = {
      x: initialSnapshot.templateOffset?.x || 0,
      y: initialSnapshot.templateOffset?.y || 0,
    };
    applyPaperSize();
    resizeCanvas();
    strokesRef.current = cloneStrokes(initialSnapshot.strokes || []);
    backgroundImageRef.current = null;
    redrawAll();
  }, [applyPaperSize, cloneStrokes, initialSnapshot, redrawAll, resizeCanvas]);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const scroller = scrollerRef.current;
      strokesRef.current = [];
      activeStrokeRef.current = null;
      livePointsRef.current = [];
      backgroundImageRef.current = null;
      activePointerIdRef.current = null;
      isDrawingRef.current = false;
      setIsDrawing(false);
      boardSizeRef.current = {
        width: Math.max(MIN_BOARD_WIDTH, scroller ? Math.round(scroller.clientWidth * BOARD_WIDTH_MULTIPLIER) : MIN_BOARD_WIDTH),
        height: Math.max(MIN_BOARD_HEIGHT, scroller ? Math.round(scroller.clientHeight * BOARD_HEIGHT_MULTIPLIER) : MIN_BOARD_HEIGHT),
      };
      templateOffsetRef.current = { x: 0, y: 0 };
      hasInitializedViewportRef.current = false;
      applyPaperSize();
      resizeCanvas();

      if (scroller) {
        const viewportWidth = Math.max(1, scroller.clientWidth);
        scroller.scrollLeft = Math.max(0, Math.round((boardSizeRef.current.width * latestScaleRef.current - viewportWidth) / 2));
        scroller.scrollTop = 0;
      }

      syncViewportMetrics();
      redrawAll();
    },
    getImageData: () => {
      const exportCanvas = createRenderedExportCanvas();
      if (!exportCanvas) {
        return '';
      }

      return exportCanvas.toDataURL('image/png');
    },
    getAnalysisImages: () => {
      const exportCanvas = createRenderedExportCanvas(ANALYSIS_EXPORT_SCALE);
      if (!exportCanvas) {
        return [];
      }

      const strokeBounds = getStrokeBounds(strokesRef.current);
      const rawTemplateBounds = getTemplateBounds(templateLayout as TemplateLayout, boardSizeRef.current.width, boardSizeRef.current.height);
      const templateBounds = expandRegion(
        clampRegion(
          {
            ...rawTemplateBounds,
            left: rawTemplateBounds.left + templateOffsetRef.current.x,
            top: rawTemplateBounds.top + templateOffsetRef.current.y,
          },
          boardSizeRef.current.width,
          boardSizeRef.current.height,
        ),
        140,
        140,
      );
      const contentFocus = strokeBounds ? expandRegion(strokeBounds, 140, 140) : null;
      const mergedFocus = mergeRegions([templateBounds, contentFocus]);

      const images = [exportCanvas.toDataURL('image/png')];

      if (mergedFocus) {
        images.push(createCroppedDataUrl(exportCanvas, mergedFocus, ANALYSIS_EXPORT_SCALE));
      }

      if (contentFocus && (!mergedFocus || contentFocus.width !== mergedFocus.width || contentFocus.height !== mergedFocus.height || contentFocus.left !== mergedFocus.left || contentFocus.top !== mergedFocus.top)) {
        images.push(createCroppedDataUrl(exportCanvas, contentFocus, ANALYSIS_EXPORT_SCALE));
      }

      return images.filter(Boolean);
    },
    getSnapshot: () => {
      const scroller = scrollerRef.current;
      const exportCanvas = createRenderedExportCanvas();
      if (!exportCanvas) {
        return null;
      }

      return {
        imageData: exportCanvas.toDataURL('image/png'),
        boardSize: { ...boardSizeRef.current },
        viewport: {
          x: (scroller?.scrollLeft || 0) / latestScaleRef.current,
          y: (scroller?.scrollTop || 0) / latestScaleRef.current,
        },
        strokes: cloneStrokes(strokesRef.current),
        templateOffset: { ...templateOffsetRef.current },
      };
    },
    focusTemplate: () => {
      focusTemplateViewport();
    },
  }), [applyPaperSize, cloneStrokes, createCroppedDataUrl, createRenderedExportCanvas, expandRegion, focusTemplateViewport, getStrokeBounds, mergeRegions, redrawAll, resizeCanvas, syncViewportMetrics, templateLayout]);

  const startDrawing = useCallback((event: PointerEvent) => {
    if (isDrawingRef.current || event.pointerType !== 'pen' && event.pointerType !== 'mouse') {
      return;
    }

    if (shouldIgnorePointer(event)) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (event.pointerType === 'pen') {
      notePenActivity(900);
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    let point = getRelativePoint(event);
    if (!point) {
      return;
    }

    ensurePaperSize(point);
    point = getRelativePoint(event);
    if (!point) {
      return;
    }

    activeStrokeRef.current = {
      mode: modeRef.current === 'eraser' ? 'erase' : 'draw',
      color: DRAW_COLOR,
      size: modeRef.current === 'eraser' ? ERASER_STROKE_WIDTH : PENCIL_STROKE_WIDTH,
      points: [point, point],
    };
    livePointsRef.current = [point, point];
    activePointerIdRef.current = event.pointerId;
    isDrawingRef.current = true;
    setIsDrawing(true);

    const shouldUsePointerCapture = event.pointerType === 'mouse';
    if (shouldUsePointerCapture && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore capture failure.
      }
    }

    scheduleStrokeRender();
    event.preventDefault();
  }, [ensurePaperSize, getRelativePoint, notePenActivity, scheduleStrokeRender, shouldIgnorePointer]);

  const cancelActiveStroke = useCallback(() => {
    const canvas = canvasRef.current;
    const pointerId = activePointerIdRef.current;

    activeStrokeRef.current = null;
    livePointsRef.current = [];
    activePointerIdRef.current = null;
    isDrawingRef.current = false;
    setIsDrawing(false);

    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    redrawAll();

    if (
      canvas &&
      pointerId !== null &&
      canvas.releasePointerCapture &&
      canvas.hasPointerCapture?.(pointerId)
    ) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch (_error) {
        // Ignore release failure.
      }
    }
  }, [redrawAll]);

  const draw = useCallback((event: PointerEvent) => {
    if (!isDrawingRef.current || activePointerIdRef.current !== event.pointerId) {
      return;
    }

    if (event.pointerType === 'mouse' && (shouldIgnorePointer(event) || event.buttons === 0)) {
      cancelActiveStroke();
      return;
    }

    if (event.pointerType === 'pen') {
      notePenActivity(900);
    }

    let point = getRelativePoint(event);
    if (!point) {
      return;
    }

    ensurePaperSize(point);
    point = getRelativePoint(event);
    if (!point) {
      return;
    }

    appendPoint(point);
    scheduleStrokeRender();
    event.preventDefault();
  }, [appendPoint, cancelActiveStroke, ensurePaperSize, getRelativePoint, notePenActivity, scheduleStrokeRender, shouldIgnorePointer]);

  const stopDrawing = useCallback((event?: PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (event && activePointerIdRef.current !== event.pointerId) {
      return;
    }

    if (event?.pointerType === 'pen') {
      notePenActivity(700);
    }

    if (event) {
      let point = getRelativePoint(event);
      if (point) {
        ensurePaperSize(point);
        point = getRelativePoint(event);
        if (point) {
          appendPoint(point);
        }
      }
      event.preventDefault();
    }

    commitActiveStroke();

    activeStrokeRef.current = null;
    livePointsRef.current = [];
    activePointerIdRef.current = null;
    isDrawingRef.current = false;
    setIsDrawing(false);

    if (
      event &&
      event.pointerType === 'mouse' &&
      canvas.releasePointerCapture &&
      canvas.hasPointerCapture?.(event.pointerId)
    ) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore release failure.
      }
    }
  }, [appendPoint, commitActiveStroke, ensurePaperSize, getRelativePoint, notePenActivity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    if (!canvas || !scroller) {
      return;
    }

    const stopTouchNavigation = () => {
      touchScrollRef.current = {
        active: false,
        primaryId: null,
        secondaryId: null,
        centerX: 0,
        centerY: 0,
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      startDrawing(event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      draw(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      stopDrawing(event);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      stopDrawing(event);
    };

    const handlePointerLeave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        stopDrawing(event);
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!touchScrollAllowed()) {
        event.preventDefault();
        return;
      }

      if (event.touches.length < 2) {
        event.preventDefault();
        return;
      }

      const primaryTouch = event.touches[0];
      const secondaryTouch = event.touches[1];
      const center = getTouchCenter(primaryTouch, secondaryTouch);
      touchScrollRef.current = {
        active: true,
        primaryId: primaryTouch.identifier,
        secondaryId: secondaryTouch.identifier,
        centerX: center.x,
        centerY: center.y,
      };
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!touchScrollAllowed()) {
        event.preventDefault();
        return;
      }

      if (!touchScrollRef.current.active) {
        if (event.touches.length >= 2) {
          handleTouchStart(event);
        } else {
          event.preventDefault();
        }
        return;
      }

      const primaryTouch = touchScrollRef.current.primaryId === null ? null : findTouchByIdentifier(event.touches, touchScrollRef.current.primaryId);
      const secondaryTouch = touchScrollRef.current.secondaryId === null ? null : findTouchByIdentifier(event.touches, touchScrollRef.current.secondaryId);

      if (!primaryTouch || !secondaryTouch) {
        stopTouchNavigation();
        event.preventDefault();
        return;
      }

      const center = getTouchCenter(primaryTouch, secondaryTouch);
      const deltaX = center.x - touchScrollRef.current.centerX;
      const deltaY = center.y - touchScrollRef.current.centerY;

      scroller.scrollLeft -= deltaX;
      scroller.scrollTop -= deltaY;
      touchScrollRef.current.centerX = center.x;
      touchScrollRef.current.centerY = center.y;
      ensureViewportRoom();
      event.preventDefault();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2 && touchScrollRef.current.active) {
        const primaryTouch = touchScrollRef.current.primaryId === null ? null : findTouchByIdentifier(event.touches, touchScrollRef.current.primaryId);
        const secondaryTouch = touchScrollRef.current.secondaryId === null ? null : findTouchByIdentifier(event.touches, touchScrollRef.current.secondaryId);

        if (primaryTouch && secondaryTouch) {
          const center = getTouchCenter(primaryTouch, secondaryTouch);
          touchScrollRef.current.centerX = center.x;
          touchScrollRef.current.centerY = center.y;
          event.preventDefault();
          return;
        }
      }

      stopTouchNavigation();
      event.preventDefault();
    };

    const preventGestureDefault = (event: Event) => {
      event.preventDefault();
    };

    canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
    canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
    canvas.addEventListener('pointerup', handlePointerUp, { passive: false });
    canvas.addEventListener('pointercancel', handlePointerCancel, { passive: false });
    canvas.addEventListener('pointerleave', handlePointerLeave, { passive: false });
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    canvas.addEventListener('gesturestart', preventGestureDefault, { passive: false } as AddEventListenerOptions);
    canvas.addEventListener('gesturechange', preventGestureDefault, { passive: false } as AddEventListenerOptions);
    canvas.addEventListener('gestureend', preventGestureDefault, { passive: false } as AddEventListenerOptions);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
      canvas.removeEventListener('gesturestart', preventGestureDefault as EventListener);
      canvas.removeEventListener('gesturechange', preventGestureDefault as EventListener);
      canvas.removeEventListener('gestureend', preventGestureDefault as EventListener);
    };
  }, [draw, ensureViewportRoom, startDrawing, stopDrawing, touchScrollAllowed]);

  return (
    <div
      className="drawing-surface relative w-full h-full rounded-2xl overflow-hidden bg-natural-canvas shadow-inner shadow-black/5 select-none"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="absolute top-4 left-4 flex gap-2 z-10">
        <button
          onClick={() => setMode('pencil')}
          className={`p-2.5 rounded-lg transition-all shadow-sm border ${
            mode === 'pencil'
              ? 'bg-natural-olive text-white border-natural-olive'
              : 'bg-white text-natural-muted border-natural-border hover:bg-natural-bg'
          }`}
          title="Pencil"
        >
          <Pencil size={18} />
        </button>
        <button
          onClick={() => setMode('eraser')}
          className={`p-2.5 rounded-lg transition-all shadow-sm border ${
            mode === 'eraser'
              ? 'bg-natural-olive text-white border-natural-olive'
              : 'bg-white text-natural-muted border-natural-border hover:bg-natural-bg'
          }`}
          title="Eraser"
        >
          <Eraser size={18} />
        </button>
        {onClear && (
          <button
            onClick={onClear}
            className="px-3 py-2.5 rounded-lg transition-all shadow-sm border text-sm font-black leading-none bg-white text-natural-muted border-natural-border hover:bg-natural-bg hover:text-natural-ink"
            title="Clear canvas"
          >
            Clear
          </button>
        )}
      </div>

      <div
        ref={scrollerRef}
        className="absolute inset-0 overflow-auto touch-none"
        style={{ touchAction: 'none' }}
      >
        <div ref={scaledPaperRef} className="relative">
          <div
            ref={paperRef}
            className="absolute top-0 left-0 origin-top-left bg-white"
            style={{ transform: `scale(${displayScale})` }}
          >
            <div className="absolute inset-0 pointer-events-none z-[5]">
              {applyTemplateOffset(
                getTemplateBoxes(templateLayout as TemplateLayout, boardSizeRef.current.width, boardSizeRef.current.height),
                templateOffsetRef.current,
              ).map((box, index) => (
                <div
                  key={`${templateLayout}-${index}`}
                  className="absolute rounded-sm"
                  style={{
                    left: `${box.left}px`,
                    top: `${box.top}px`,
                    width: `${box.width}px`,
                    height: `${box.height}px`,
                    border: TEMPLATE_BORDER,
                    boxSizing: 'border-box',
                  }}
                />
              ))}
              {(() => {
                const title = getHessCalculationTitlePosition(
                  templateLayout as TemplateLayout,
                  boardSizeRef.current.width,
                  boardSizeRef.current.height,
                );
                return (
                  <p
                    className="absolute text-[20px] font-black text-natural-muted underline decoration-2 underline-offset-4 whitespace-nowrap"
                    style={{
                      left: `${title.left + templateOffsetRef.current.x}px`,
                      top: `${title.top + templateOffsetRef.current.y}px`,
                    }}
                  >
                    {HESS_CALCULATION_TITLE}
                  </p>
                );
              })()}
            </div>
            <canvas
              ref={canvasRef}
              className="relative z-10 block cursor-crosshair select-none"
              style={{ touchAction: 'none' }}
            />
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 text-[10px] text-natural-muted/50 font-bold uppercase tracking-widest pointer-events-none z-10">
        {isDrawing ? 'Writing' : 'Two-Finger Move'}
      </div>
    </div>
  );
});

DrawingCanvas.displayName = 'DrawingCanvas';

export default DrawingCanvas;
