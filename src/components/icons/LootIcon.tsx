interface LootIconProps {
  className?: string;
}

export function LootIcon({ className }: LootIconProps) {
  return (
    <svg viewBox="0 0 27 25" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.991 11.453L10.611 8.733L10.951 7.373L18.431 1.933L22.809 2.317L24.022 4.041L19.137 7.323L26.52 18.04L24.853 19.213L17.446 8.46L12.991 11.453Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.259 16.198L8.145 10.799L14.549 12.599L16.741 18.868L12.855 24.267L6.451 22.467L4.259 16.198ZM10.333 13.57L12 19.285L7 21.57L9.222 18.142L10.333 13.57Z"
      />
      <path d="M5.5 8L4.5 0L8 6L8.5 9L5.5 8Z" />
      <path d="M4.5 9.5L0 8L4 11.5L5.5 10.5L4.5 9.5Z" />
    </svg>
  );
}
