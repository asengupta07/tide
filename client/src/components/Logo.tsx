import Image from "next/image";

/** The dimensional Tide wave mark supplied as a transparent PNG. */
export function Logo({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={1308}
      height={1203}
      sizes={`${size}px`}
      className={className}
      style={{ width: "auto", height: size }}
      aria-hidden="true"
      priority
    />
  );
}
