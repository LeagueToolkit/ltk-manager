import { useId } from "react";

interface HexshadeIconProps {
  className?: string;
}

/**
 * The Ancient Spark orb, the mark for Hexshade, the viewport's shader pipeline.
 *
 * The violet-to-cyan gradient is the mark's identity, so it keeps its colors
 * in both themes rather than taking `currentColor`. The gradient id is per
 * instance, because `url(#id)` resolves to the first element of that id, and a
 * copy in a hidden tab paints nothing.
 */
export function HexshadeIcon({ className }: HexshadeIconProps) {
  const gradient = useId();

  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.99986 15.0546C11.8957 15.0546 15.0539 11.8964 15.0539 8.00059C15.0539 4.10474 11.8957 0.946533 7.99986 0.946533C4.10401 0.946533 0.945801 4.10474 0.945801 8.00059C0.945801 11.8964 4.10401 15.0546 7.99986 15.0546ZM12.2248 3.64934C11.3162 2.65291 10.0074 2.02767 8.55268 2.02767C5.80877 2.02767 3.5844 4.25204 3.5844 6.99595C3.5844 8.73328 4.47614 10.2623 5.82688 11.1504C3.99992 10.6861 2.50912 9.34633 1.80084 7.58946C1.81143 10.9221 4.44524 13.6204 7.69267 13.6204C10.3145 13.6204 12.5364 11.8616 13.3007 9.43014C12.9595 9.96769 12.4934 10.4376 11.9138 10.7926C10.9805 11.3643 9.91529 11.5383 8.91594 11.3622C9.2166 11.2934 9.51139 11.1753 9.78895 11.0053C11.1631 10.1636 11.5948 8.36729 10.7531 6.99311C9.91138 5.61893 8.11505 5.18727 6.74087 6.02898C6.04085 6.45775 5.58541 7.13426 5.41829 7.87649C5.11516 6.18034 5.85304 4.39545 7.41101 3.44118C8.95289 2.49676 10.8545 2.63752 12.2248 3.64934Z"
        fill={`url(#${gradient})`}
      />
      <defs>
        <linearGradient
          id={gradient}
          x1="6.12946"
          y1="-2.47361"
          x2="7.99986"
          y2="15.0546"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.377915" stopColor="#774DDB" />
          <stop offset="1" stopColor="#16C5F5" />
        </linearGradient>
      </defs>
    </svg>
  );
}
