import { useEffect, useRef, useState } from 'react';
import { Box, Expand, Minimize, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import { publicAssetUrl } from '../lib/assets';
import { downloadProductModel } from '../lib/catalog';
import type { ProductModel } from '../lib/types';
import { createModelScene } from '../lib/model-scene';
import { disposeModel, loadModel } from '../lib/model-loader';

type Props = {
  model?: ProductModel;
  files?: readonly File[];
  productName: string;
  poster?: string;
  onPreview?: (state: 'loading' | 'ready' | 'error') => void;
};

export default function ProductModelViewer({ model, files, productName, poster, onPreview }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createModelScene> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [statistics, setStatistics] = useState<{ triangles: number; vertices: number; meshes: number }>();
  const [canWireframe, setCanWireframe] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [retry, setRetry] = useState(0);
  const modelPath = model?.path;
  const modelName = model?.name;

  useEffect(() => {
    const viewport = host.current;
    if (!viewport) return;
    const controller = new AbortController();
    let view: ReturnType<typeof createModelScene> | undefined;
    const signal = controller.signal;
    setReady(false);
    setError('');
    setWarning('');
    setWireframe(false);
    setAutoRotate(false);
    setStatistics(undefined);
    setCanWireframe(false);
    onPreview?.('loading');
    async function load() {
      try {
        const selected = files ?? (modelPath && modelName ? [await downloadProductModel({ path: modelPath, name: modelName }, signal)] : []);
        if (signal.aborted) return;
        if (!selected.length) throw new Error('Choose a model file first.');
        try {
          view = createModelScene(viewport!, productName, () => {
            if (signal.aborted) return;
            setReady(false);
            setError('The 3D canvas was interrupted. Try opening the model again.');
            onPreview?.('error');
          });
        } catch { throw new Error('3D is unavailable on this device. Try a browser with WebGL 2.'); }
        sceneRef.current = view;
        const result = await loadModel(selected, view.renderer);
        if (signal.aborted) { disposeModel(result.object); return; }
        if (view.renderer.getContext().isContextLost()) {
          disposeModel(result.object);
          throw new Error('The 3D canvas was interrupted. Try opening the model again.');
        }
        try {
          setCanWireframe(view.show(result.object));
          setStatistics(view.getStatistics());
        }
        catch (cause) { disposeModel(result.object); throw cause; }
        setWarning(result.warning);
        setReady(true);
        onPreview?.('ready');
      } catch (cause) {
        if (signal.aborted) return;
        view?.dispose();
        view = undefined;
        sceneRef.current = null;
        setError(cause instanceof Error ? cause.message : 'The 3D model could not be opened.');
        onPreview?.('error');
      }
    }
    void load();
    return () => {
      controller.abort();
      view?.dispose();
      sceneRef.current = null;
    };
  }, [files, modelPath, modelName, productName, onPreview, retry]);

  useEffect(() => {
    function sync() { setExpanded(document.fullscreenElement === container.current); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') setFallbackFullscreen(false); }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  async function fullscreen() {
    if (fallbackFullscreen) { setFallbackFullscreen(false); return; }
    if (document.fullscreenElement === container.current) { await document.exitFullscreen(); return; }
    try {
      if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else setFallbackFullscreen(true);
    } catch { setFallbackFullscreen(true); }
  }

  const isFullscreen = expanded || fallbackFullscreen;
  return (
    <div>
      <div className={`product-model-stage product-model-stage--studio${fallbackFullscreen ? ' is-expanded' : ''}`} ref={container}>
        {poster && !ready && <img src={publicAssetUrl(poster)} className="product-model-poster" alt="" />}
        <div ref={host} className="product-model-canvas" />
        {!ready && !error && <p className="product-model-message" role="status">Loading 3D model…</p>}
        {error && <div className="product-model-message"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(attempt => attempt + 1)}>Try again</button></div>}
        {ready && (
          <>
            <div className="product-model-studio-info" aria-label="3D model information">
              <p className="product-model-studio-kicker">INTERACTIVE OBJECT</p>
              <p className="product-model-studio-name">{productName}</p>
              {statistics && <dl className="product-model-studio-stats">
                <div><dt>Triangles</dt><dd>{statistics.triangles.toLocaleString()}</dd></div>
                <div><dt>Vertices</dt><dd>{statistics.vertices.toLocaleString()}</dd></div>
                <div><dt>Meshes</dt><dd>{statistics.meshes.toLocaleString()}</dd></div>
              </dl>}
            </div>
            <p className="product-model-hint">Drag to rotate 360° · Scroll or pinch to zoom · Explore top and underside</p>
            <div className="product-model-actions" role="group" aria-label="3D model controls">
              <button type="button" onClick={() => sceneRef.current?.zoom(1.25)} aria-label="Zoom out" title="Zoom out"><Minus size={16} /></button>
              <button type="button" onClick={() => sceneRef.current?.zoom(.8)} aria-label="Zoom in" title="Zoom in"><Plus size={16} /></button>
              <button type="button" onClick={() => sceneRef.current?.reset()} aria-label="Reset view" title="Reset view"><RotateCcw size={15} /><span>Reset view</span></button>
              <button type="button" aria-pressed={autoRotate} aria-label={autoRotate ? 'Pause rotation' : 'Auto rotate'} title={autoRotate ? 'Pause rotation' : 'Auto rotate'} onClick={() => {
                const next = !autoRotate;
                sceneRef.current?.setAutoRotate(next);
                setAutoRotate(next);
              }}>{autoRotate ? <Pause size={16} /> : <Play size={16} />}<span>{autoRotate ? 'Pause' : 'Auto rotate'}</span></button>
              <button type="button" disabled={!canWireframe} aria-pressed={wireframe} aria-label="Wireframe" title="Wireframe" onClick={() => {
                sceneRef.current?.wireframe(!wireframe);
                setWireframe(!wireframe);
              }}><Box size={16} /><span>Wireframe</span></button>
              <button type="button" onClick={() => void fullscreen()} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {isFullscreen ? <Minimize size={16} /> : <Expand size={16} />}
              </button>
            </div>
          </>
        )}
      </div>
      {warning && <p className="product-model-texture-note" role="status">{warning}</p>}
    </div>
  );
}
