/**
 * Change Detection Module
 * V3 Accuracy Upgrade - Day 3-4: Change-Focused Preprocessing
 *
 * Provides region-based change detection and annotation for better
 * context in vision analysis.
 */

import sharp from 'sharp';

// =============================================================================
// Types
// =============================================================================

export interface ChangeRegion {
  /** Grid position (0-indexed) */
  row: number;
  col: number;
  /** Normalized position (0-1) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Change intensity (0-1) */
  intensity: number;
  /** Classified change type */
  changeType: ChangeType;
}

export type ChangeType =
  | 'interaction_feedback' // Button press, hover state, focus change
  | 'navigation'           // Page/view transition
  | 'content_update'       // Text/data change
  | 'modal_overlay'        // Modal, dialog, dropdown appeared
  | 'loading_indicator'    // Spinner, progress bar
  | 'error_state'          // Error message, validation
  | 'cursor_movement'      // Cursor position change only
  | 'minor_change'         // Small UI update
  | 'no_change';           // No significant change

export interface FrameChangeAnalysis {
  /** Overall change score (0-1) */
  overallChangeScore: number;
  /** Classified change regions */
  regions: ChangeRegion[];
  /** Primary change type for the frame */
  primaryChangeType: ChangeType;
  /** Human-readable change description for prompt */
  changeDescription: string;
  /** Detected cursor position if visible */
  cursorPosition?: { x: number; y: number };
  /** Whether a modal/overlay is detected */
  hasModalOverlay: boolean;
  /** Whether loading indicators are present */
  hasLoadingIndicator: boolean;
}

export interface ChangeDetectionConfig {
  /** Grid size for region analysis */
  gridRows: number;
  gridCols: number;
  /** Minimum intensity to consider a region changed */
  minRegionIntensity: number;
  /** Pixel difference threshold */
  pixelDiffThreshold: number;
  /** Size to resize frames for analysis */
  analysisSize: number;
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_CHANGE_DETECTION_CONFIG: ChangeDetectionConfig = {
  gridRows: 4,
  gridCols: 4,
  minRegionIntensity: 0.05,
  pixelDiffThreshold: 25,
  analysisSize: 256,
};

// Common UI patterns for change classification
const CHANGE_TYPE_PATTERNS = {
  // Center changes often indicate modals
  centerRegions: [[1, 1], [1, 2], [2, 1], [2, 2]],
  // Top changes may indicate navigation
  topRegions: [[0, 0], [0, 1], [0, 2], [0, 3]],
  // Bottom changes may indicate status bars or footers
  bottomRegions: [[3, 0], [3, 1], [3, 2], [3, 3]],
};

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze changes between two frames
 */
export async function analyzeFrameChanges(
  previousBuffer: Buffer,
  currentBuffer: Buffer,
  config: ChangeDetectionConfig = DEFAULT_CHANGE_DETECTION_CONFIG
): Promise<FrameChangeAnalysis> {
  try {
    // Resize both frames to analysis size
    const size = config.analysisSize;
    const [prevData, currData] = await Promise.all([
      sharp(previousBuffer)
        .resize(size, size, { fit: 'fill' })
        .raw()
        .toBuffer(),
      sharp(currentBuffer)
        .resize(size, size, { fit: 'fill' })
        .raw()
        .toBuffer(),
    ]);

    // Calculate per-region change intensity
    const regions = calculateRegionChanges(
      prevData,
      currData,
      size,
      config
    );

    // Calculate overall change score
    const overallChangeScore = regions.reduce((sum, r) => sum + r.intensity, 0) / regions.length;

    // Classify change types for each region
    const classifiedRegions = classifyChangeTypes(regions, config);

    // Determine primary change type
    const primaryChangeType = determinePrimaryChangeType(classifiedRegions, overallChangeScore);

    // Check for modal overlay (high intensity in center)
    const hasModalOverlay = detectModalOverlay(classifiedRegions, config);

    // Check for loading indicators (specific patterns)
    const hasLoadingIndicator = detectLoadingIndicator(classifiedRegions);

    // Generate human-readable description
    const changeDescription = generateChangeDescription(
      classifiedRegions,
      primaryChangeType,
      overallChangeScore,
      hasModalOverlay,
      hasLoadingIndicator
    );

    return {
      overallChangeScore,
      regions: classifiedRegions,
      primaryChangeType,
      changeDescription,
      hasModalOverlay,
      hasLoadingIndicator,
    };
  } catch (error) {
    console.error('[ChangeDetection] Analysis error:', error);
    // Return minimal result on error
    return {
      overallChangeScore: 0,
      regions: [],
      primaryChangeType: 'no_change',
      changeDescription: 'Unable to analyze frame changes',
      hasModalOverlay: false,
      hasLoadingIndicator: false,
    };
  }
}

// =============================================================================
// Region Analysis
// =============================================================================

function calculateRegionChanges(
  prevData: Buffer,
  currData: Buffer,
  size: number,
  config: ChangeDetectionConfig
): ChangeRegion[] {
  const { gridRows, gridCols, pixelDiffThreshold } = config;
  const regionHeight = Math.floor(size / gridRows);
  const regionWidth = Math.floor(size / gridCols);
  const bytesPerPixel = 3; // RGB
  const regions: ChangeRegion[] = [];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      let changedPixels = 0;
      let totalPixels = 0;

      const startY = row * regionHeight;
      const endY = Math.min((row + 1) * regionHeight, size);
      const startX = col * regionWidth;
      const endX = Math.min((col + 1) * regionWidth, size);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const pixelIndex = (y * size + x) * bytesPerPixel;
          totalPixels++;

          // Compare RGB values
          let maxDiff = 0;
          for (let c = 0; c < bytesPerPixel; c++) {
            const diff = Math.abs(prevData[pixelIndex + c] - currData[pixelIndex + c]);
            maxDiff = Math.max(maxDiff, diff);
          }

          if (maxDiff > pixelDiffThreshold) {
            changedPixels++;
          }
        }
      }

      const intensity = totalPixels > 0 ? changedPixels / totalPixels : 0;

      regions.push({
        row,
        col,
        x: col / gridCols,
        y: row / gridRows,
        width: 1 / gridCols,
        height: 1 / gridRows,
        intensity,
        changeType: 'no_change', // Will be classified later
      });
    }
  }

  return regions;
}

// =============================================================================
// Change Classification
// =============================================================================

function classifyChangeTypes(
  regions: ChangeRegion[],
  config: ChangeDetectionConfig
): ChangeRegion[] {
  return regions.map(region => {
    if (region.intensity < config.minRegionIntensity) {
      return { ...region, changeType: 'no_change' as ChangeType };
    }

    // High intensity in center suggests modal
    const isCenter = CHANGE_TYPE_PATTERNS.centerRegions.some(
      ([r, c]) => region.row === r && region.col === c
    );

    // Top region changes suggest navigation
    const isTop = CHANGE_TYPE_PATTERNS.topRegions.some(
      ([r, c]) => region.row === r && region.col === c
    );

    // Bottom region changes
    const isBottom = CHANGE_TYPE_PATTERNS.bottomRegions.some(
      ([r, c]) => region.row === r && region.col === c
    );

    let changeType: ChangeType;

    if (region.intensity > 0.5 && isCenter) {
      changeType = 'modal_overlay';
    } else if (region.intensity > 0.4 && isTop) {
      changeType = 'navigation';
    } else if (region.intensity > 0.3) {
      changeType = 'content_update';
    } else if (region.intensity > 0.15) {
      changeType = 'interaction_feedback';
    } else {
      changeType = 'minor_change';
    }

    return { ...region, changeType };
  });
}

function determinePrimaryChangeType(
  regions: ChangeRegion[],
  overallScore: number
): ChangeType {
  if (overallScore < 0.02) {
    return 'no_change';
  }

  // Count change types
  const typeCounts = new Map<ChangeType, number>();
  for (const region of regions) {
    if (region.changeType !== 'no_change') {
      typeCounts.set(
        region.changeType,
        (typeCounts.get(region.changeType) || 0) + region.intensity
      );
    }
  }

  // Find dominant type
  let maxType: ChangeType = 'minor_change';
  let maxWeight = 0;

  for (const [type, weight] of typeCounts) {
    if (weight > maxWeight) {
      maxWeight = weight;
      maxType = type;
    }
  }

  return maxType;
}

// =============================================================================
// Pattern Detection
// =============================================================================

function detectModalOverlay(
  regions: ChangeRegion[],
  config: ChangeDetectionConfig
): boolean {
  // Check if center regions have high intensity while edges have lower
  const centerRegions = regions.filter(r =>
    CHANGE_TYPE_PATTERNS.centerRegions.some(
      ([row, col]) => r.row === row && r.col === col
    )
  );

  const edgeRegions = regions.filter(r =>
    !CHANGE_TYPE_PATTERNS.centerRegions.some(
      ([row, col]) => r.row === row && r.col === col
    )
  );

  const centerAvg = centerRegions.reduce((s, r) => s + r.intensity, 0) / centerRegions.length;
  const edgeAvg = edgeRegions.reduce((s, r) => s + r.intensity, 0) / edgeRegions.length;

  // Modal pattern: center changes significantly more than edges
  return centerAvg > 0.3 && centerAvg > edgeAvg * 2;
}

function detectLoadingIndicator(regions: ChangeRegion[]): boolean {
  // Loading indicators often show as small, localized changes
  // This is a heuristic - could be improved with ML
  const smallChanges = regions.filter(
    r => r.intensity > 0.05 && r.intensity < 0.2
  );
  return smallChanges.length >= 1 && smallChanges.length <= 3;
}

// =============================================================================
// Description Generation
// =============================================================================

function generateChangeDescription(
  regions: ChangeRegion[],
  primaryType: ChangeType,
  overallScore: number,
  hasModal: boolean,
  hasLoading: boolean
): string {
  if (overallScore < 0.02) {
    return 'No significant visual changes detected between frames.';
  }

  const changedRegions = regions.filter(r => r.changeType !== 'no_change');
  const parts: string[] = [];

  // Describe overall change level
  if (overallScore > 0.4) {
    parts.push('Major visual change detected');
  } else if (overallScore > 0.15) {
    parts.push('Moderate visual change detected');
  } else {
    parts.push('Minor visual change detected');
  }

  // Describe location
  const locations = describeChangeLocations(changedRegions);
  if (locations) {
    parts.push(locations);
  }

  // Describe type
  switch (primaryType) {
    case 'modal_overlay':
      parts.push('A modal or overlay appears to have opened');
      break;
    case 'navigation':
      parts.push('The view or page appears to have changed');
      break;
    case 'content_update':
      parts.push('Content in the interface has been updated');
      break;
    case 'interaction_feedback':
      parts.push('UI feedback from an interaction is visible');
      break;
    case 'loading_indicator':
      parts.push('Loading or progress indicator detected');
      break;
    case 'error_state':
      parts.push('An error state or validation message may be present');
      break;
    default:
      break;
  }

  // Add modal/loading context
  if (hasModal && primaryType !== 'modal_overlay') {
    parts.push('(possible modal/overlay present)');
  }
  if (hasLoading && primaryType !== 'loading_indicator') {
    parts.push('(loading indicator may be present)');
  }

  return parts.join('. ') + '.';
}

function describeChangeLocations(regions: ChangeRegion[]): string {
  if (regions.length === 0) return '';

  const locations: string[] = [];
  const hasTop = regions.some(r => r.row === 0);
  const hasBottom = regions.some(r => r.row >= 3);
  const hasLeft = regions.some(r => r.col === 0);
  const hasRight = regions.some(r => r.col >= 3);
  const hasCenter = regions.some(r => r.row >= 1 && r.row <= 2 && r.col >= 1 && r.col <= 2);

  if (hasTop) locations.push('top');
  if (hasBottom) locations.push('bottom');
  if (hasLeft && !hasRight) locations.push('left');
  if (hasRight && !hasLeft) locations.push('right');
  if (hasCenter && !hasTop && !hasBottom) locations.push('center');

  if (locations.length === 0) return '';
  if (locations.length > 2) return 'Changes across multiple areas';
  return `Changes in the ${locations.join(' and ')} region`;
}

// =============================================================================
// Exports for Testing
// =============================================================================

export const __testing = {
  calculateRegionChanges,
  classifyChangeTypes,
  determinePrimaryChangeType,
  detectModalOverlay,
  detectLoadingIndicator,
  generateChangeDescription,
};
