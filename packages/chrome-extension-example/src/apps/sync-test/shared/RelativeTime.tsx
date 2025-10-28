import { memo } from 'react';
import { useTimeStore } from './timeStore';

type RelativeTimeProps = {
  timestamp: number;
};

export const RelativeTime = memo(function RelativeTime({ timestamp }: RelativeTimeProps) {
  const relativeTime = useTimeStore(s => s.formatRelativeTime(timestamp));
  return <>{relativeTime}</>;
});
