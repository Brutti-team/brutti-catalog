import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Expand, Minimize, Minus, Plus, RotateCcw } from 'lucide-react';
import { publicAssetUrl } from '../lib/assets';
import type { ProductImage } from '../lib/types';

type Props = {
  images: readonly ProductImage[];
  productName: string;
};

type PointerStart = { x: number; y: number };

export default function ProductPhotoViewer({ images, productName }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<PointerStart | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const active = images[Math.min(imageIndex, Math.max(0, images.length - 1))];
  const firstImageId = images[0]?.id;

  useEffect(() => {
    setImageIndex(0);
    setTilt({ x: 0, y: 0 });
    setZoom(1);
  }, [firstImageId]);

  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement === container.current);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFallbackFullscreen(false);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  if (!active) return <p className="product-photo-empty">Add a product photo above to preview it here automatically.</p>;

  const changePhoto = (direction: number) => {
    setImageIndex(current => (current + direction + images.length) % images.length);
    setTilt({ x: 0, y: 0 });
  };
  const reset = () => {
    setImageIndex(0);
    setTilt({ x: 0, y: 0 });
    setZoom(1);
  };
  const adjustZoom = (factor: number) => setZoom(current => Math.max(1, Math.min(2.5, current * factor)));

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    setTilt({
      x: Math.max(-9, Math.min(9, -dy / 14)),
      y: Math.max(-15, Math.min(15, dx / 12)),
    });
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const startPoint = pointerStart.current;
    pointerStart.current = null;
    if (!startPoint) return;
    const dx = event.clientX - startPoint.x;
    if (images.length > 1 && Math.abs(dx) > 65) {
      changePhoto(dx < 0 ? 1 : -1);
    } else {
      setTilt({ x: 0, y: 0 });
    }
  };

  async function toggleFullscreen() {
    if (fallbackFullscreen) { setFallbackFullscreen(false); return; }
    if (document.fullscreenElement === container.current) { await document.exitFullscreen(); return; }
    try {
      if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else setFallbackFullscreen(true);
    } catch {
      setFallbackFullscreen(true);
    }
  }

  const isFullscreen = expanded || fallbackFullscreen;
  return (
    <div className="product-photo-viewer">
      <div
        ref={container}
        className={`product-model-stage product-photo-stage${fallbackFullscreen ? ' is-expanded' : ''}`}
        role="group"
        aria-label={`Interactive photo view of ${productName}`}
        tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowRight' && images.length > 1) { event.preventDefault(); changePhoto(1); }
          if (event.key === 'ArrowLeft' && images.length > 1) { event.preventDefault(); changePhoto(-1); }
        }}
      >
        <div
          className="product-photo-drag-area"
          onPointerDown={start}
          onPointerMove={drag}
          onPointerUp={end}
          onPointerCancel={() => { pointerStart.current = null; setTilt({ x: 0, y: 0 }); }}
        >
          <div
            className="product-photo-picture"
            style={{ transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${zoom})` }}
          >
            <img
              key={active.id}
              src={publicAssetUrl(active.url)}
              alt={active.alt || productName}
              draggable={false}
              onError={event => {
                if (!event.currentTarget.src.endsWith('/images/placeholder.svg'))
                  event.currentTarget.src = publicAssetUrl('/images/placeholder.svg');
              }}
            />
          </div>
        </div>
        <span className="product-photo-counter">{imageIndex + 1} / {images.length} · Original product photo</span>
        <p className="product-model-hint">{images.length > 1 ? 'Drag sideways to explore the available angles' : 'Drag to tilt · Use controls to zoom'}</p>
        <div className="product-model-actions" role="group" aria-label="Interactive photo controls">
          {images.length > 1 && (
            <>
              <button type="button" onClick={() => changePhoto(-1)} aria-label="Previous product photo"><ArrowLeft size={16} /></button>
              <button type="button" onClick={() => changePhoto(1)} aria-label="Next product photo"><ArrowRight size={16} /></button>
            </>
          )}
          <button type="button" onClick={() => adjustZoom(1 / 1.25)} aria-label="Zoom out" disabled={zoom <= 1}><Minus size={16} /></button>
          <button type="button" onClick={() => adjustZoom(1.25)} aria-label="Zoom in" disabled={zoom >= 2.5}><Plus size={16} /></button>
          <button type="button" onClick={reset} aria-label="Reset photo view" title="Reset view"><RotateCcw size={16} /></button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen">
            {isFullscreen ? <Minimize size={16} /> : <Expand size={16} />}
          </button>
        </div>
      </div>
      <p className="product-photo-explainer">Uses the product photos already uploaded. The perspective effect is a photo preview, not a reconstructed 3D model; unphotographed sides cannot be shown.</p>
    </div>
  );
}
