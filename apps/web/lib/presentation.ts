import type { VerificationState } from './indexer';

export function formatUtcDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function abbreviate(value: string, visible = 10): string {
  if (value.length <= visible * 2 + 1) {
    return value;
  }
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

export function verificationLabel(state: VerificationState): string {
  switch (state) {
    case 'verified':
      return 'Indexer: verified';
    case 'pending':
      return 'Indexer: pending';
    case 'invalid':
      return 'Indexer: invalid';
  }
}
