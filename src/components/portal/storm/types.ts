export type StormMeta = {
  center: { lat: number; lng: number };
  radiusMiles: number;
  canManage: boolean;
  reps: { id: string; name: string }[];
};
