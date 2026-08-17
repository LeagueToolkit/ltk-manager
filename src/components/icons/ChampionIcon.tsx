interface ChampionIconProps {
  className?: string;
}

export function ChampionIcon({ className }: ChampionIconProps) {
  return (
    <svg viewBox="0.7 0.7 12.6 12.6" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.9 4.9C11.9 1.4 7 0.7 7 0.7C7 0.7 2.1 1.4 2.1 4.9C2.1 8.4 2.24 8.96 1.4 9.8C1.4 9.8 2.03 13.3 4.9 13.3C4.9 13.3 3.5 11.9 4.9 8.4C4.9 8.4 2.8 8.4 3.5 5.6C4.048 5.57 4.595 5.684 5.085 5.929C5.576 6.175 5.995 6.544 6.3 7V10.5L7 11.2L7.7 10.5V7C7.995 6.534 8.412 6.157 8.905 5.911C9.399 5.664 9.95 5.557 10.5 5.6C11.2 8.4 9.1 8.4 9.1 8.4C10.5 11.97 9.1 13.3 9.1 13.3C11.97 13.3 12.6 9.8 12.6 9.8C11.76 8.96 11.9 8.4 11.9 4.9Z"
      />
    </svg>
  );
}
