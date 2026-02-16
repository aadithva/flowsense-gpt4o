import { describe, expect, it } from 'vitest';
import {
  calculateWeightedScore100,
  determineQualityGateStatus,
  determineSeverity,
} from './summary';
import type { RubricScores } from '@interactive-flow/shared';

describe('summary metrics', () => {
  it('calculates weighted score on a 0-100 scale', () => {
    const scores: RubricScores = {
      cat1: 2,
      cat2: 2,
      cat3: 2,
      cat4: 2,
      cat5: 2,
      cat6: 2,
      cat7: 2,
    };

    expect(calculateWeightedScore100(scores)).toBe(100);
  });

  it('blocks runs with critical issues even if score is high', () => {
    expect(determineQualityGateStatus(90, 1)).toBe('block');
  });

  it('returns warn between thresholds', () => {
    expect(determineQualityGateStatus(70, 0)).toBe('warn');
  });

  it('classifies issue severities consistently', () => {
    expect(determineSeverity('dead_click')).toBe('high');
    expect(determineSeverity('missing_spinner')).toBe('med');
    expect(determineSeverity('focus_confusion')).toBe('low');
  });
});
