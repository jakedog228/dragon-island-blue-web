


export function destroyParticleLifetimeMs(
  baseLifeSeconds: number,
  varianceSeconds: number,
  randomSigned: number,
): number {
  return Math.max(0, (baseLifeSeconds + varianceSeconds * randomSigned) * 1000);
}


export function destroyParticleSizePt(
  baseSizePx: number,
  varianceSizePx: number,
  randomSigned: number,
  contentScaleFactor: number,
): number {
  if (!(contentScaleFactor > 0) || !Number.isFinite(contentScaleFactor)) {
    throw new Error(`destroy particle size needs a positive content scale factor: ${contentScaleFactor}`);
  }
  return Math.max(0, (baseSizePx + varianceSizePx * randomSigned) / contentScaleFactor);
}

export interface ParticleEmissionStep {
  emitCounterSeconds: number;
  spawnCount: number;
}

export interface DestroyParticlePlacement {
  position: { x: number; y: number };
  positionVariance: { x: number; y: number };
}


export function destroyParticlePlacement(
  rendererRoot: Readonly<{
    position: Readonly<{ x: number; y: number }>;
    scaledContentSize: Readonly<{ w: number; h: number }>;
  }>,
): DestroyParticlePlacement {
  const { w, h } = rendererRoot.scaledContentSize;
  if (!Number.isFinite(w) || w < 0 || !Number.isFinite(h) || h < 0) {
    throw new Error("destroy particle renderer size must be finite and nonnegative");
  }
  const halfWidth = w / 2;
  return {
    position: {
      x: rendererRoot.position.x + halfWidth,
      y: rendererRoot.position.y + h,
    },
    positionVariance: { x: halfWidth, y: 0 },
  };
}


export function advanceDestroyParticleEmission(
  emitCounterSeconds: number,
  dtSeconds: number,
  emissionRate: number,
  availableSlots: number,
): ParticleEmissionStep {
  if (!(emissionRate > 0) || availableSlots <= 0) {
    return { emitCounterSeconds, spawnCount: 0 };
  }
  const interval = 1 / emissionRate;
  let counter = emitCounterSeconds + dtSeconds;
  let spawnCount = 0;
  while (counter > interval && spawnCount < availableSlots) {
    counter -= interval;
    spawnCount += 1;
  }
  return { emitCounterSeconds: counter, spawnCount };
}
