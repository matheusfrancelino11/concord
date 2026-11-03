import React from "react";

interface ConcordLogoProps {
  size?: number;
  variant?: "full" | "mascot";
  animated?: boolean;
  isWinking?: boolean;
  className?: string;
  eyeColor?: string;
  bodyColor?: string;
}

export const ConcordLogo: React.FC<ConcordLogoProps> = ({
  size = 48,
  variant = "full",
  animated = false,
  isWinking = false,
  className = "",
  eyeColor = "#1DB954",
  bodyColor = "#FFFFFF",
}) => {
  // If variant is "mascot", we use the viewBox around the mascot body
  // Mascot bbox: approx X: 152 to 872, Y: 248 to 776
  const viewBox = variant === "full" ? "0 0 1024 1024" : "140 230 740 560";

  return (
    <div
      className={`inline-flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={viewBox}
        width="100%"
        height="100%"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={animated ? "concord-mascot-animated" : ""}
      >
        <defs>
          <linearGradient id="concord-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#24D366" />
            <stop offset="100%" stop-color="#1DB954" />
          </linearGradient>
          <filter id="concord-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="6" stdDeviation="12" floodColor="#000000" floodOpacity="0.2" />
          </filter>
        </defs>

        {variant === "full" && (
          <rect
            className="concord-squircle"
            x="32"
            y="32"
            width="960"
            height="960"
            rx="220"
            fill="url(#concord-bg-grad)"
          />
        )}

        <g
          id="concord-character"
          filter={variant === "full" ? "url(#concord-shadow)" : undefined}
          className={`concord-mascot-part ${
            isWinking
              ? "animate-concord-face-tilt"
              : animated
              ? "animate-concord-breathe"
              : ""
          }`}
        >
          {/* Mascot Body */}
          <path
            className="concord-body concord-mascot-part"
            d="M 620.95 248.11 L 647.47 253.08 L 693.04 265.51 L 726.18 277.11 L 761.80 292.85 L 794.95 344.22 L 814.83 382.33 L 834.72 428.73 L 847.14 465.19 L 859.57 514.07 L 867.03 557.98 L 871.17 606.87 L 871.17 659.89 L 869.51 679.78 L 867.86 682.26 L 819.80 714.58 L 763.46 744.41 L 712.92 765.12 L 680.61 774.23 L 663.21 750.20 L 635.87 704.64 L 557.16 711.26 L 506.61 710.43 L 476.79 707.95 L 405.53 695.52 L 364.11 683.09 L 334.28 671.49 L 325.99 680.61 L 329.31 683.92 L 358.31 699.66 L 383.99 710.43 L 363.28 746.89 L 342.56 775.06 L 287.05 756.00 L 227.40 727.83 L 186.80 703.81 L 154.49 680.61 L 152.00 658.24 L 153.66 586.98 L 161.11 531.47 L 173.54 476.79 L 192.60 420.45 L 211.65 377.36 L 238.17 328.48 L 262.20 292.85 L 303.62 274.62 L 335.11 263.85 L 396.42 248.94 L 403.05 248.94 L 427.90 291.19 L 458.56 287.05 L 499.16 284.57 L 544.73 285.39 L 594.44 291.19 L 620.95 248.11 Z"
            fill={bodyColor}
          />

          {/* Left Eye (Smooth, natural wink) */}
          <path
            className={`concord-eye-left concord-mascot-part ${
              isWinking
                ? "animate-concord-wink-smooth"
                : animated
                ? "animate-concord-wink"
                : ""
            }`}
            d="M 329.31 471.82 L 454.42 528.16 L 455.25 533.96 L 450.27 549.70 L 437.02 570.41 L 420.45 583.67 L 407.19 589.47 L 394.76 591.95 L 380.68 591.95 L 371.56 590.30 L 354.99 583.67 L 343.39 575.38 L 334.28 565.44 L 328.48 556.33 L 324.34 547.21 L 319.36 528.99 L 318.54 509.10 L 320.19 496.67 L 329.31 471.82 Z"
            fill={eyeColor}
          />

          {/* Right Eye (Organic reaction & brow lift) */}
          <path
            className={`concord-eye-right concord-mascot-part ${
              isWinking ? "animate-concord-eye-react" : ""
            }`}
            d="M 690.55 453.59 L 696.35 464.36 L 702.15 484.24 L 703.81 509.10 L 701.32 526.50 L 697.18 539.76 L 690.55 553.01 L 683.09 562.96 L 665.69 577.04 L 657.41 581.18 L 641.67 585.33 L 625.10 585.33 L 613.50 582.84 L 600.24 577.04 L 591.95 571.24 L 581.18 560.47 L 573.73 548.87 L 567.93 534.78 L 565.44 521.53 L 690.55 453.59 Z"
            fill={eyeColor}
          />

          {/* Cheeky Smirk (Organic curl & flex) */}
          <path
            className={`concord-smirk concord-mascot-part ${
              isWinking
                ? "animate-concord-smirk-curl"
                : animated
                ? "animate-concord-smirk"
                : ""
            }`}
            d="M 731.98 571.24 L 747.72 572.07 L 759.32 578.70 L 765.95 590.30 L 766.78 601.07 L 753.52 592.78 L 746.89 612.67 L 738.61 626.75 L 722.86 643.32 L 712.09 650.78 L 685.58 663.21 L 647.47 673.15 L 599.41 678.95 L 547.21 678.95 L 583.67 670.67 L 612.67 661.55 L 639.18 650.78 L 668.18 635.87 L 702.98 611.84 L 728.66 586.98 L 731.98 581.18 L 718.72 576.21 L 724.52 572.90 L 731.98 571.24 Z"
            fill={eyeColor}
          />
        </g>
      </svg>
    </div>
  );
};
