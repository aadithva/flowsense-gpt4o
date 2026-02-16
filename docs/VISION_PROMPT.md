# Vision Analysis Prompt

This document contains the complete prompt sent to the OpenAI Vision model for each keyframe analysis.

## Location in Code

The prompt is defined in [packages/shared/src/constants.ts](../packages/shared/src/constants.ts:10) as `VISION_MODEL_PROMPT`.

## Full Prompt

```
You are a UX interaction-flow evaluator. You will be given a screenshot (frame) from a task-completion screen recording.
Your job is to score the interaction quality using this rubric (0/1/2 each), based only on what is visible.

Rubric categories (score 0/1/2):
1) Action → Response Integrity
2) Feedback & System Status Visibility
3) Interaction Predictability & Affordance
4) Flow Continuity & Friction
5) Error Handling & Recovery
6) Micro-interaction Quality (Polish)
7) Efficiency & Interaction Cost

Instructions:
- If the frame does not provide enough evidence for a category, score 1 and say "insufficient evidence in this frame".
- Be strict about dead clicks, missing loading state, unclear disabled state, and confusing affordances.
- Keep justifications concise (1–2 lines per category).
- Provide issue tags from this fixed set only:
  dead_click, delayed_response, ambiguous_response, missing_spinner, unclear_disabled_state, no_progress_feedback,
  misleading_affordance, surprise_navigation, mode_switch_surprise, backtracking, repeated_actions, context_loss,
  silent_error, blocking_error, recovery_unclear, jarring_transition, distracting_animation, focus_confusion,
  too_many_steps, over_clicking, excessive_cursor_travel, redundant_confirmations
- Provide 3–8 improvement suggestions, each with severity high/med/low.

Return ONLY valid JSON that matches this schema:
{
  "rubric_scores": { "cat1":0|1|2, "cat2":0|1|2, "cat3":0|1|2, "cat4":0|1|2, "cat5":0|1|2, "cat6":0|1|2, "cat7":0|1|2 },
  "justifications": { "cat1": "...", "cat2":"...", "cat3":"...", "cat4":"...", "cat5":"...", "cat6":"...", "cat7":"..." },
  "issue_tags": ["..."],
  "suggestions": [
    { "severity":"high|med|low", "title":"...", "description":"..." }
  ]
}
```

## Scoring Rubric Details

### Category 1: Action → Response Integrity (0/1/2)
- **2 (Good)**: Every user action produces immediate, clear visual feedback
- **1 (Fair)**: Most actions have feedback, minor delays acceptable
- **0 (Poor)**: Dead clicks, missing responses, or ambiguous feedback

**Key Issues to Detect**:
- `dead_click`: Click with no visible response
- `delayed_response`: Significant lag between action and feedback
- `ambiguous_response`: Unclear what changed after action

### Category 2: Feedback & System Status Visibility (0/1/2)
- **2 (Good)**: System state always visible, loading states clear, progress shown
- **1 (Fair)**: Some status indicators present but incomplete
- **0 (Poor)**: Silent operations, no loading indicators, unclear system state

**Key Issues to Detect**:
- `missing_spinner`: No loading indicator during wait
- `unclear_disabled_state`: Can't tell if element is disabled
- `no_progress_feedback`: Long operation without progress indication

### Category 3: Interaction Predictability & Affordance (0/1/2)
- **2 (Good)**: All interactive elements look interactive, non-interactive elements don't
- **1 (Fair)**: Most affordances are clear with minor confusion
- **0 (Poor)**: Misleading visual cues, unexpected behavior

**Key Issues to Detect**:
- `misleading_affordance`: Visual suggests wrong interaction
- `surprise_navigation`: Unexpected page change
- `mode_switch_surprise`: Unexpected context switch

### Category 4: Flow Continuity & Friction (0/1/2)
- **2 (Good)**: Smooth progression, no backtracking, context preserved
- **1 (Fair)**: Minor friction but generally smooth
- **0 (Poor)**: Forced backtracking, repeated steps, context loss

**Key Issues to Detect**:
- `backtracking`: User must go back to redo steps
- `repeated_actions`: Same action multiple times
- `context_loss`: Information lost between steps

### Category 5: Error Handling & Recovery (0/1/2)
- **2 (Good)**: Errors clearly shown with actionable recovery steps
- **1 (Fair)**: Errors shown but recovery unclear
- **0 (Poor)**: Silent errors, blocking errors, unclear recovery

**Key Issues to Detect**:
- `silent_error`: Error with no notification
- `blocking_error`: Error prevents progress without clear solution
- `recovery_unclear`: Don't know how to fix error

### Category 6: Micro-interaction Quality (Polish) (0/1/2)
- **2 (Good)**: Smooth transitions, good focus management, pleasant animations
- **1 (Fair)**: Functional but could be smoother
- **0 (Poor)**: Jarring transitions, confusing focus, distracting animations

**Key Issues to Detect**:
- `jarring_transition`: Abrupt state changes
- `distracting_animation`: Animations draw focus inappropriately
- `focus_confusion`: Focus state unclear or wrong

### Category 7: Efficiency & Interaction Cost (0/1/2)
- **2 (Good)**: Minimal steps, smart defaults, keyboard shortcuts available
- **1 (Fair)**: Reasonable number of steps
- **0 (Poor)**: Too many steps, excessive clicking, poor defaults

**Key Issues to Detect**:
- `too_many_steps`: Task requires excessive steps
- `over_clicking`: Multiple clicks for single action
- `excessive_cursor_travel`: Large mouse movements required
- `redundant_confirmations`: Unnecessary confirmation dialogs

## Customization Guide

### To Make Analysis Stricter

Edit the prompt to:
- Lower the threshold for score 2 (Good)
- Add more specific issues to detect
- Require more improvement suggestions

### To Make Analysis More Lenient

Edit the prompt to:
- Raise the threshold for score 0 (Poor)
- Focus on critical issues only
- Accept "insufficient evidence" more often

### To Add New Issue Tags

1. Add to `IssueTag` type in [packages/shared/src/types.ts](../packages/shared/src/types.ts:6)
2. Add to `issueTagSchema` in [packages/shared/src/schemas.ts](../packages/shared/src/schemas.ts:30)
3. Add to prompt issue tag list
4. Add description in [backend/src/summary.ts](../backend/src/summary.ts:58) `getIssueDescription()`

### To Adjust for Specific Domains

You can create domain-specific prompts:

```typescript
// In backend/src/vision.ts
const domainPrompts = {
  copilot: COPILOT_SPECIFIC_PROMPT,
  generic: VISION_MODEL_PROMPT,
};

// Use based on run metadata
const prompt = run.domain ? domainPrompts[run.domain] : domainPrompts.generic;
```

## Upgrade Paths

### Sequential Frame Analysis

For better accuracy, analyze 2-3 frames in sequence:

```typescript
// Pseudo-code
const frames = [currentFrame, nextFrame, nextNextFrame];
const prompt = `Analyze this sequence of frames to detect click → response patterns...`;
```

This helps detect:
- Actual vs perceived response time
- Loading state visibility
- State changes between frames

### Multi-Modal Analysis

Combine vision with:
- **Video metadata**: FPS, resolution, duration
- **Cursor tracking**: Detect click positions
- **Audio**: Detect system sounds or lack thereof
- **OCR**: Extract and analyze text content

## Model Selection

Current default: `gpt-4-vision-preview`

Alternatives:
- `gpt-4o`: Faster, similar quality
- Claude 3 Opus: Via Anthropic API (requires adapter)
- Custom fine-tuned model: For domain-specific analysis

## Cost Optimization

Strategies to reduce API costs:

1. **Keyframe Selection**: Only analyze truly different frames
2. **Batch Requests**: Group multiple frames per API call
3. **Caching**: Cache analysis for identical frames
4. **Smaller Images**: Resize to minimum required resolution
5. **Selective Analysis**: Only analyze categories relevant to domain

## Example Responses

### Good Frame Example

```json
{
  "rubric_scores": { "cat1": 2, "cat2": 2, "cat3": 2, "cat4": 2, "cat5": 2, "cat6": 2, "cat7": 2 },
  "justifications": {
    "cat1": "Button shows pressed state immediately on click",
    "cat2": "Loading spinner visible during operation",
    "cat3": "All buttons have clear hover states and cursor changes",
    "cat4": "Single-page flow with no backtracking",
    "cat5": "Error message includes fix suggestion",
    "cat6": "Smooth fade transition between states",
    "cat7": "Only 3 clicks required for complete task"
  },
  "issue_tags": [],
  "suggestions": [
    {
      "severity": "low",
      "title": "Add keyboard shortcut",
      "description": "Consider adding Cmd+Enter to submit form"
    }
  ]
}
```

### Problematic Frame Example

```json
{
  "rubric_scores": { "cat1": 0, "cat2": 0, "cat3": 1, "cat4": 1, "cat5": 0, "cat6": 1, "cat7": 0 },
  "justifications": {
    "cat1": "Button clicked but no visible response occurred",
    "cat2": "No loading indicator visible despite wait time",
    "cat3": "Disabled button not visually distinct from enabled",
    "cat4": "User had to click back button and re-enter data",
    "cat5": "Error occurred but no message displayed",
    "cat6": "Transition caused layout shift",
    "cat7": "Required 8 clicks when 2 would suffice"
  },
  "issue_tags": ["dead_click", "missing_spinner", "silent_error", "too_many_steps"],
  "suggestions": [
    {
      "severity": "high",
      "title": "Add button pressed state",
      "description": "Show visual feedback immediately when button is clicked"
    },
    {
      "severity": "high",
      "title": "Display loading spinner",
      "description": "Show spinner during the 3-second wait after button click"
    },
    {
      "severity": "high",
      "title": "Show error message",
      "description": "Display inline error with actionable fix when operation fails"
    },
    {
      "severity": "med",
      "title": "Reduce click count",
      "description": "Combine steps into single form submission"
    }
  ]
}
```

