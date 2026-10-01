export const STATUS_TONE: Record<string, 'gold' | 'live' | 'navy' | 'gray'> =
  { live: 'live', registration: 'navy', upcoming: 'gold', finished: 'gray' };
export const FLOW = ['upcoming', 'registration', 'live', 'finished'] as const;
