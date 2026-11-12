import { useEffect, useRef, useState } from "react";
import { Expand, Minus, Plus, RotateCcw } from "lucide-react";
import { publicAssetUrl } from "../lib/assets";
import { catalogModelUrl, type ProductModelAsset } from "../lib/product-models";

type ViewerElement = HTMLElement & {
  getCameraOrbit?: () => { theta: number; phi: number; radius: number };
  cameraOrbit?: string;
  jumpCameraToGoal?: () => void;
};

let viewerLoader: Promise<void> | null = null;

function ensureViewerLoaded(): Promise<void> {
  if (window.customElements.get("model-viewer")) return Promise.resolve();
  if (viewerLoader) return viewerLoader;
  viewerLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js";
    script.onload = () => {
      window.customElements.whenDefined("model-viewer").then(() => resolve(), reject);
    };
    script.onerror = () => reject(new Error("Could not load the 3D viewer. Check your connection."));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    viewerLoader = null;
    throw error;
  });
  return viewerLoader;
}

interface Props {
  model: ProductModelAsset;
  productName: string;
  poster?: string;
}

export default function ProductModelViewer({ model, productName, poster }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ViewerElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let element: ViewerElement | null = null;
    setReady(false);
    setError("");

    void ensureViewerLoaded().then(() => {
      if (cancelled || !hostRef.current) return;
      const viewer = document.createElement("model-viewer") as ViewerElement;
      element = viewer;
      modelRef.current = viewer;
      viewer.setAttribute("src", catalogModelUrl(model.src));
      viewer.setAttribute("alt", "Interactive verified 3D model of " + productName);
      viewer.setAttribute("camera-controls", "");
      viewer.setAttribute("interaction-prompt", "auto");
      viewer.setAttribute("shadow-intensity", "0.8");
      viewer.setAttribute("exposure", "1.05");
      viewer.setAttribute("environment-image", "neutral");
      viewer.setAttribute("loading", "eager");
      if (poster) viewer.setAttribute("poster", publicAssetUrl(poster));
      viewer.addEventListener("load", () => { if (!cancelled) setReady(true); });
      viewer.addEventListener("error", () => {
        if (!cancelled) setError("This product's 3D file could not be opened. View its original photos instead.");
      });
      for (const [index, hotspot] of (model.hotspots ?? []).entries()) {
        const marker = document.createElement("button");
        marker.className = "pub-model-hotspot";
        marker.slot = "hotspot-" + (index + 1);
        marker.setAttribute("data-position", hotspot.position);
        marker.setAttribute("data-normal", hotspot.normal);
        marker.setAttribute("aria-label", hotspot.label);
        marker.textContent = String(index + 1);
        const tooltip = document.createElement("span");
        tooltip.textContent = hotspot.label;
        marker.appendChild(tooltip);
        viewer.appendChild(marker);
      }
      hostRef.current.appendChild(viewer);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to display the 3D model.");
    });
    return () => {
      cancelled = true;
      modelRef.current = null;
      if (element?.parentElement) element.parentElement.removeChild(element);
    };
  }, [model, productName, poster]);

  function zoom(factor: number) {
    const viewer = modelRef.current;
    const orbit = viewer?.getCameraOrbit?.();
    if (!viewer || !orbit) return;
    const radius = Math.max(0.1, Math.min(orbit.radius * factor, 100));
    viewer.cameraOrbit = orbit.theta + "rad " + orbit.phi + "rad " + radius + "m";
    viewer.jumpCameraToGoal?.();
  }

  function reset() {
    const viewer = modelRef.current;
    if (!viewer) return;
    viewer.removeAttribute("camera-orbit");
    viewer.setAttribute("camera-orbit", "auto auto auto");
    viewer.jumpCameraToGoal?.();
  }

  async function fullscreen() {
    const container = fullscreenRef.current;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container?.requestFullscreen();
    } catch {
      setError("Fullscreen is unavailable in this browser.");
    }
  }

  return (
    <div className="pub-model-viewer" ref={fullscreenRef}>
      <div ref={hostRef} className="pub-model-canvas" aria-label={"3D product model: " + productName} />
      {!ready && !error && <p className="pub-model-loading" role="status">Preparing your 3D view…</p>}
      {error && <p className="pub-model-error" role="alert">{error}</p>}
      <div className="pub-model-actions" aria-label="3D model controls">
        <button type="button" disabled={!ready} onClick={() => zoom(0.8)} aria-label="Zoom in"><Plus size={18} /></button>
        <button type="button" disabled={!ready} onClick={() => zoom(1.25)} aria-label="Zoom out"><Minus size={18} /></button>
        <button type="button" disabled={!ready} onClick={reset} aria-label="Reset 3D view"><RotateCcw size={18} /></button>
        <button type="button" disabled={!ready} onClick={() => void fullscreen()} aria-label="Fullscreen 3D view"><Expand size={18} /></button>
      </div>
      <p className="pub-model-hint">Drag to rotate · Scroll or pinch to zoom</p>
    </div>
  );
}
