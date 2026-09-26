"use client";

/**
 * Paper Design shaders (@paper-design/shaders-react), used as real visuals, not decoration:
 *  - TideWater: the hero. Slow water caustics in the accent hue; the product is literally about tides of
 *    liquidity moving between an active and a passive part.
 *  - GrainBand: a grain gradient band behind the governance section, one colour family, low intensity.
 * Both honour prefers-reduced-motion by freezing the shader (speed 0). WebGL only mounts on the client.
 */
import { useReducedMotion } from "motion/react";
import { Water, GrainGradient, Dithering } from "@paper-design/shaders-react";

export function TideWater({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Water
      className={className}
      style={{ width: "100%", height: "100%" }}
      colorBack="#0b0f14"
      colorHighlight="#58c9b6"
      highlights={0.16}
      layering={0.55}
      waves={0.28}
      edges={0.35}
      caustic={0.6}
      effectScale={1.1}
      speed={reduce ? 0 : 0.35}
    />
  );
}

export function GrainBand({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <GrainGradient
      className={className}
      style={{ width: "100%", height: "100%" }}
      colorBack="#0b0f14"
      colors={["#0f3a35", "#1d6d61", "#58c9b6", "#11161d"]}
      softness={0.7}
      intensity={0.35}
      noise={0.35}
      shape="wave"
      speed={reduce ? 0 : 0.25}
    />
  );
}

export function DitherField({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Dithering
      className={className}
      style={{ width: "100%", height: "100%" }}
      colorBack="#0f141b"
      colorFront="#2f8f80"
      shape="wave"
      type="4x4"
      pxSize={3}
      speed={reduce ? 0 : 0.3}
    />
  );
}
