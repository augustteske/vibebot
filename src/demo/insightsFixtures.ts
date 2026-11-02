import type { InsightsMetrics } from '../features/insights/InsightsWidget';

export const SYNTHETIC_METRICS: InsightsMetrics = {
  outsideHoursPercent: 25.0,
  participationEvenness: 89.8,
  recognitionPercent: 20.0,
  participantCount: 6,
  messageCount: 20,
};

export const FEW_PARTICIPANTS_METRICS: InsightsMetrics = {
  ...SYNTHETIC_METRICS,
  participantCount: 4,
};
