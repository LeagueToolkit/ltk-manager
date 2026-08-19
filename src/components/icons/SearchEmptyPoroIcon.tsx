import Mark from "@/assets/icons/SearchEmptyPoroIcon.svg?react";

interface SearchEmptyPoroIconProps {
  className?: string;
}

export function SearchEmptyPoroIcon({ className }: SearchEmptyPoroIconProps) {
  return <Mark className={className} />;
}
