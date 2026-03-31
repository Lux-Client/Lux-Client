import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { useTranslation } from 'react-i18next';
import {
  Paintbrush,
  Eraser,
  PaintBucket,
  Trash2,
  Download,
  Check,
  Undo2,
  Redo2,
  Grid3X3,
} from 'lucide-react';
import ColorPicker from './ColorPicker';

const CANVAS_SIZE = 32;
const DEFAULT_COLOR = '#ff6600';

export function PixelEditorModal({ isOpen, onClose, onSave, initialIcon }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentColor, setCurrentColor] = useState(DEFAULT_COLOR);
  const [currentTool, setCurrentTool] = useState<'brush' | 'eraser' | 'fill'>('brush');
  const [brushSize, setBrushSize] = useState(1);
  const [palette, setPalette] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const initialLoadDone = useRef<string | null>(null);

  const getCtx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d', { willReadFrequently: true });
  };

  useEffect(() => {
    if (!isOpen) {
      initialLoadDone.current = null;
      return;
    }

    // Small delay to ensure canvas is ready in the DOM
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = getCtx();
      if (!ctx) return;

      // Only load if this specific icon hasn't been loaded in this modal session
      if (initialLoadDone.current === initialIcon) return;

      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      ctx.imageSmoothingEnabled = false;

      const finishLoad = (data: ImageData) => {
        setHistory([data]);
        setHistoryIndex(0);
        initialLoadDone.current = initialIcon || 'empty';
      };

      if (initialIcon && initialIcon.startsWith('data:image')) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
          const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          finishLoad(imageData);
        };
        img.onerror = () => {
          ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          finishLoad(imageData);
        };
        img.src = initialIcon;
      } else {
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        finishLoad(imageData);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, initialIcon]);

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(imageData);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const ctx = getCtx();
      if (ctx) ctx.putImageData(history[newIndex], 0, 0);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const ctx = getCtx();
      if (ctx) ctx.putImageData(history[newIndex], 0, 0);
    }
  };

  const getPixelPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = (e as React.MouseEvent).clientX - rect.left;
      y = (e as React.MouseEvent).clientY - rect.top;
    }

    const px = Math.floor((x / rect.width) * canvas.width);
    const py = Math.floor((y / rect.height) * canvas.height);

    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return null;
    return { x: px, y: py };
  };

  const drawPixel = (px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getCtx();
    if (!ctx) return;

    const halfSize = Math.floor(brushSize / 2);
    const startX = px - halfSize;
    const startY = py - halfSize;

    if (currentTool === 'eraser') {
      ctx.clearRect(startX, startY, brushSize, brushSize);
    } else {
      ctx.fillStyle = currentColor;
      ctx.fillRect(startX, startY, brushSize, brushSize);
    }
  };

  const floodFill = (startX: number, startY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getCtx();
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const targetColor = getPixelColor(startX, startY, data, canvas.width);
    const fillColor = hexToRgba(currentColor);

    if (colorsMatch(targetColor, fillColor)) return;

    const stack = [[startX, startY]];
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const pos = (y * canvas.width + x) * 4;

      if (colorsMatch(getPixelColor(x, y, data, canvas.width), targetColor)) {
        data[pos] = fillColor.r;
        data[pos + 1] = fillColor.g;
        data[pos + 2] = fillColor.b;
        data[pos + 3] = fillColor.a;

        if (x > 0) stack.push([x - 1, y]);
        if (x < canvas.width - 1) stack.push([x + 1, y]);
        if (y > 0) stack.push([x, y - 1]);
        if (y < canvas.height - 1) stack.push([x, y + 1]);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    saveToHistory();
  };

  const getPixelColor = (x: number, y: number, data: Uint8ClampedArray, width: number) => {
    const pos = (y * width + x) * 4;
    return {
      r: data[pos],
      g: data[pos + 1],
      b: data[pos + 2],
      a: data[pos + 3],
    };
  };

  const hexToRgba = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b, a: 255 };
  };

  const colorsMatch = (c1: any, c2: any) => {
    return c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && c1.a === c2.a;
  };

  const isDrawing = useRef(false);
  const lastPixel = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getPixelPos(e);
    if (!pos) return;

    if (currentTool === 'fill') {
      floodFill(pos.x, pos.y);
    } else {
      isDrawing.current = true;
      lastPixel.current = pos;
      drawPixel(pos.x, pos.y);
      
      // Update palette
      if (currentTool === 'brush') {
        setPalette(prev => {
          const filtered = prev.filter(c => c !== currentColor);
          return [currentColor, ...filtered].slice(0, 8);
        });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing.current) return;
    const pos = getPixelPos(e);
    if (!pos) return;

    if (lastPixel.current?.x !== pos.x || lastPixel.current?.y !== pos.y) {
      drawPixel(pos.x, pos.y);
      lastPixel.current = pos;
    }
  };

  const handleMouseUp = () => {
    if (isDrawing.current) {
      isDrawing.current = false;
      saveToHistory();
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      saveToHistory();
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'instance-icon.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  const handleUseIcon = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      onSave(canvas.toDataURL('image/png'));
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl" aria-describedby="pixel-editor-description">
        <DialogHeader>
          <DialogTitle>{t('pixel_editor.title')}</DialogTitle>
          <DialogDescription id="pixel-editor-description" className="sr-only">
            {t('pixel_editor.description', 'Create and edit custom instance icons with a 32x32 pixel grid.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-6 p-1">
          <div className="flex-1 flex flex-col items-center gap-4">
            <div className="relative aspect-square w-full max-w-[320px] bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAAXNSR0IArs4c6QAAACpJREFUGFdjZEACJ06c+M/AwMDIACHYGBgYGJkgAnAByAAqABOACMAGIAMAunIKf89M99AAAAAASUVORK5CYII=')] bg-repeat rounded-lg border-2 border-border overflow-hidden cursor-crosshair shadow-inner">
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="w-full h-full image-pixelated pointer-events-auto"
              />
              {showGrid && (
                <div
                  className="absolute inset-0 pointer-events-none opacity-20"
                  style={{
                    backgroundImage: `linear-gradient(to right, gray 1px, transparent 1px), linear-gradient(to bottom, gray 1px, transparent 1px)`,
                    backgroundSize: `${100 / CANVAS_SIZE}% ${100 / CANVAS_SIZE}%`
                  }}
                />
              )}
            </div>

            <div className="flex gap-2 w-full justify-center">
              <Button
                variant={currentTool === 'brush' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setCurrentTool('brush')}
                title={t('pixel_editor.brush')}
              >
                <Paintbrush className="w-4 h-4" />
              </Button>
              <Button
                variant={currentTool === 'eraser' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setCurrentTool('eraser')}
                title={t('pixel_editor.eraser')}
              >
                <Eraser className="w-4 h-4" />
              </Button>
              <Button
                variant={currentTool === 'fill' ? 'default' : 'outline'}
                size="icon"
                onClick={() => setCurrentTool('fill')}
                title={t('pixel_editor.fill')}
              >
                <PaintBucket className="w-4 h-4" />
              </Button>
              <div className="w-px h-8 bg-border mx-1" />
              <Button
                variant="outline"
                size="icon"
                onClick={undo}
                disabled={historyIndex <= 0}
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="w-full md:w-48 flex flex-col gap-5">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tools</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGrid(!showGrid)}
                  className="text-xs h-8"
                >
                  <Grid3X3 className="w-3.5 h-3.5 mr-1.5" />
                  Grid
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="text-xs h-8 text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {t('pixel_editor.clear')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t('pixel_editor.brush_size', 'Brush Size')}</Label>
                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{brushSize}px</span>
              </div>
              <Slider
                value={[brushSize]}
                min={1}
                max={8}
                step={1}
                onValueChange={(val) => setBrushSize(val[0])}
                className="py-2"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t('skins.color', 'Color')}</Label>
              <div className="p-2 border rounded-lg bg-muted/30">
                <ColorPicker label="" value={currentColor} onChange={setCurrentColor} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t('pixel_editor.palette', 'Palette')}</Label>
              <div className="grid grid-cols-4 gap-2">
                {palette.map((color, i) => (
                  <button
                    key={i}
                    className="h-8 w-full rounded-md border border-border shadow-sm transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: color }}
                    onClick={() => setCurrentColor(color)}
                  />
                ))}
                {Array.from({ length: Math.max(0, 8 - palette.length) }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-8 w-full rounded-md border border-dashed border-border bg-muted/20" />
                ))}
              </div>
            </div>

            <div className="mt-auto space-y-2 pt-4 border-t">
              <Button
                variant="outline"
                className="w-full justify-start text-xs h-9"
                onClick={handleDownload}
              >
                <Download className="w-3.5 h-3.5 mr-2" />
                {t('pixel_editor.download', 'Download PNG')}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleUseIcon} className="gap-1.5">
            <Check className="w-4 h-4" />
            {t('pixel_editor.use_as_icon')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
