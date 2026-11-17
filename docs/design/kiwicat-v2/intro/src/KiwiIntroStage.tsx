import React, { useEffect, useRef } from 'react';
import { IntroPose, KIWI_INTRO_CONFIG } from './kiwiIntroTimeline';
import { renderKiwiIntroFrame } from './kiwiRenderer';

export interface KiwiIntroStageProps {
  pose: IntroPose;
  size?: number;
  showFrame?: boolean;
  isPlaying?: boolean;
  onSkip?: () => void;
}

export const KiwiIntroStage: React.FC<KiwiIntroStageProps> = ({
  pose,
  size = 320,
  showFrame = true,
  isPlaying = false,
  onSkip,
}) => {
  const fogLayerRef = useRef<HTMLDivElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const earBufferRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (pose.mascotOpacity <= 0.004) return;
    if (!earBufferRef.current) {
      earBufferRef.current = document.createElement('canvas');
    }

    const fogLayerEl = fogLayerRef.current;
    if (fogLayerEl) {
      fogLayerEl.style.opacity = pose.fogOpacity.toFixed(3);
      fogLayerEl.style.setProperty('--fog-core', `${pose.fogCore.toFixed(1)}%`);
      fogLayerEl.style.setProperty('--fog-mid', `${pose.fogMid.toFixed(1)}%`);
      fogLayerEl.style.setProperty('--fog-mist', `${pose.fogMist.toFixed(1)}%`);
      fogLayerEl.style.setProperty('--fog-edge', `${pose.fogEdge.toFixed(1)}%`);
    }

    const fogCanvas = fogCanvasRef.current;
    const faceCanvas = faceCanvasRef.current;
    if (!fogCanvas || !faceCanvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderKiwiIntroFrame(
      fogCanvas,
      faceCanvas,
      earBufferRef.current,
      size,
      dpr,
      pose,
      KIWI_INTRO_CONFIG
    );
  }, [pose, size]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isPlaying && onSkip && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
      e.preventDefault();
      onSkip();
    }
  };

  const expand = showFrame ? pose.windowExpand : 0;
  const targetW = 640;
  const targetH = 370;
  const stageWidth = size + (targetW - size) * expand;
  const stageHeight = size + (targetH - size) * expand;
  const squircleR = size * 0.24;
  const stageRadiusPx = squircleR + (16 - squircleR) * expand;

  return (
    <div
      role={isPlaying ? 'button' : 'img'}
      tabIndex={isPlaying ? 0 : -1}
      aria-label={
        isPlaying
          ? 'Palco da intro do Byte Kiwi Cat. Clique para pular.'
          : 'Palco da intro do Byte Kiwi Cat.'
      }
      onClick={() => {
        if (isPlaying && onSkip) onSkip();
      }}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        width: `${stageWidth.toFixed(1)}px`,
        maxWidth: '100%',
        height: `${stageHeight.toFixed(1)}px`,
        borderRadius: showFrame ? `${stageRadiusPx.toFixed(1)}px` : 0,
        backgroundColor: showFrame ? KIWI_INTRO_CONFIG.surfaceBg : 'transparent',
        overflow: showFrame ? 'hidden' : 'visible',
        opacity: pose.stageOpacity,
        transform: `scale(${pose.stageScale.toFixed(4)})`,
        transformOrigin: 'center center',
        boxShadow: showFrame
          ? '0 28px 80px -20px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) inset'
          : 'none',
        cursor: isPlaying ? 'pointer' : 'default',
        userSelect: 'none',
        willChange: 'width, height, border-radius, transform, opacity',
      }}
    >
      {/* Container central fixo do Kiwi Cat (evita distorção durante o estiramento da moldura) */}
      <div
        aria-hidden={pose.mascotOpacity <= 0.01}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size,
          height: size,
          transform: 'translate(-50%, -50%)',
          opacity: pose.mascotOpacity,
          pointerEvents: 'none',
        }}
      >
        {/* Camada .fog-layer (z-1): Névoa volumétrica WebGL2 + Arco Orbital + Máscara Radial */}
        <div
          ref={fogLayerRef}
          className="fog-layer"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            maskImage:
              'radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%))',
            WebkitMaskImage:
              'radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%))',
          }}
        >
          <canvas
            ref={fogCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Camada .face-layer (z-10): Orelhas Flat-3D separadas + Olhos 3D + Faíscas Comic */}
        <div
          className="face-layer"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <canvas
            ref={faceCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              pointerEvents: 'none',
            }}
          />

          <svg
            viewBox="0 0 240 240"
            width={size}
            height={size}
            aria-hidden="true"
            style={{
              position: 'relative',
              zIndex: 10,
              display: 'block',
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            {pose.sparkleOpacity > 0.01 && (
              <g
                fill="#FFFFFF"
                opacity={pose.sparkleOpacity.toFixed(3)}
                transform={`translate(120 120) scale(${pose.sparkleScale.toFixed(
                  3
                )}) rotate(${pose.sparkleRotationDeg.toFixed(2)}) translate(-120 -120)`}
              >
                <path d="M 52 96 L 54.5 103 L 61.5 105.5 L 54.5 108 L 52 115 L 49.5 108 L 42.5 105.5 L 49.5 103 Z" />
                <path d="M 190 66 L 192.5 73 L 199.5 75.5 L 192.5 78 L 190 85 L 187.5 78 L 180.5 75.5 L 187.5 73 Z" />
                <path
                  d="M 196 120 L 197.5 124.5 L 202 126 L 197.5 127.5 L 196 132 L 194.5 127.5 L 190 126 L 194.5 124.5 Z"
                  opacity="0.85"
                />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Janela do App simulada (caixinhas de exemplo) renderizada após a moldura se esticar */}
      {showFrame && pose.windowChromeOpacity > 0.01 && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex flex-col pointer-events-none"
          style={{ opacity: pose.windowChromeOpacity }}
        >
          {/* Barra superior da janela macOS */}
          <div className="h-10 px-4 border-b border-white/[0.07] bg-white/[0.02] flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]/85" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]/85" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]/85" />
              <div className="ml-3 h-2.5 w-20 rounded bg-white/[0.12]" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-24 rounded-md bg-white/[0.06] border border-white/[0.06]" />
              <div className="h-4 w-4 rounded-md bg-white/[0.08]" />
            </div>
          </div>

          {/* Conteúdo interno do app em caixas de exemplo */}
          <div
            className="flex-1 flex min-h-0 overflow-hidden"
            style={{
              opacity: pose.appContentOpacity,
              transform: `translateY(${((1 - pose.appContentOpacity) * 10).toFixed(1)}px)`,
            }}
          >
            {/* Barra lateral esquerda */}
            <div className="w-36 border-r border-white/[0.06] bg-white/[0.015] p-3.5 hidden sm:flex flex-col gap-2.5 shrink-0">
              <div className="h-6 rounded-lg bg-gradient-to-r from-cyan-400/20 to-indigo-400/20 border border-cyan-300/15 mb-1 flex items-center px-2 gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-300/80" />
                <span className="h-2 w-14 rounded bg-white/25" />
              </div>
              <div className="h-2.5 w-24 rounded bg-white/[0.12]" />
              <div className="h-2.5 w-20 rounded bg-white/[0.07]" />
              <div className="h-2.5 w-28 rounded bg-white/[0.07]" />
              <div className="h-2.5 w-16 rounded bg-white/[0.07]" />
              <div className="mt-auto pt-2 border-t border-white/[0.05] flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/[0.1]" />
                <span className="h-2 w-14 rounded bg-white/[0.1]" />
              </div>
            </div>

            {/* Área principal */}
            <div className="flex-1 p-4 flex flex-col gap-3.5 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="h-3.5 w-32 rounded bg-white/[0.16]" />
                  <div className="h-2 w-48 rounded bg-white/[0.07]" />
                </div>
                <div className="h-7 w-20 rounded-lg bg-gradient-to-r from-cyan-400/25 via-indigo-400/25 to-pink-400/25 border border-white/[0.12]" />
              </div>

              {/* Grade de 3 caixinhas de exemplo */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
                  <div className="w-5 h-5 rounded-md bg-cyan-400/20 border border-cyan-300/20" />
                  <div className="h-2.5 w-14 rounded bg-white/[0.14]" />
                  <div className="h-2 w-full rounded bg-white/[0.06]" />
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
                  <div className="w-5 h-5 rounded-md bg-indigo-400/20 border border-indigo-300/20" />
                  <div className="h-2.5 w-16 rounded bg-white/[0.14]" />
                  <div className="h-2 w-4/5 rounded bg-white/[0.06]" />
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
                  <div className="w-5 h-5 rounded-md bg-pink-400/20 border border-pink-300/20" />
                  <div className="h-2.5 w-12 rounded bg-white/[0.14]" />
                  <div className="h-2 w-full rounded bg-white/[0.06]" />
                </div>
              </div>

              {/* Painel inferior maior */}
              <div className="flex-1 rounded-xl bg-white/[0.025] border border-white/[0.06] p-3.5 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between">
                  <div className="h-2.5 w-24 rounded bg-white/[0.12]" />
                  <div className="h-2 w-12 rounded bg-white/[0.07]" />
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-full rounded bg-white/[0.07]" />
                  <div className="h-2.5 w-5/6 rounded bg-white/[0.06]" />
                  <div className="h-2.5 w-2/3 rounded bg-white/[0.05]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
