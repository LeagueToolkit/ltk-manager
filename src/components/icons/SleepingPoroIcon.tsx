import Mark from "@/assets/icons/SleepingPoroIcon.svg?react";

interface SleepingPoroIconProps {
  className?: string;
}

export function SleepingPoroIcon({ className }: SleepingPoroIconProps) {
  return <Mark className={className} />;
}
