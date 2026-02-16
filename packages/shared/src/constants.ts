export const RUBRIC_CATEGORIES = {
  cat1: 'Action → Response Integrity',
  cat2: 'Feedback & System Status Visibility',
  cat3: 'Interaction Predictability & Affordance',
  cat4: 'Flow Continuity & Friction',
  cat5: 'Error Handling & Recovery',
  cat6: 'Micro-interaction Quality (Polish)',
  cat7: 'Efficiency & Interaction Cost',
} as const;

export const SCORE_LABELS = {
  0: 'Poor',
  1: 'Fair',
  2: 'Good',
} as const;

export const FRAME_EXTRACTION_FPS = 2;
export const KEYFRAME_DIFF_THRESHOLD = 0.15; // 15% pixel difference
export const MIN_KEYFRAME_DISTANCE_MS = 500; // minimum 500ms between keyframes

export const VISION_MODEL_PROMPT = `You are a UX interaction-flow evaluator. You will be given a SEQUENCE of consecutive frames from a screen recording, arranged left-to-right (oldest to newest).

Your job is to analyze the INTERACTION visible across these frames and score the interaction quality using a detailed rubric.

KEY ANALYSIS APPROACH:
- Look for STATE CHANGES across frames: What transitions occur? What appears/disappears?
- Detect interaction signals: Button state changes, cursor changes, loading indicators, navigation
- Use the temporal sequence to infer user actions and system responses
- A UI element might not be visible in the current frame but may have appeared in adjacent frames
- IMPORTANT: Absence in one frame ≠ absence in the interaction. Look across the sequence.

DETAILED SCORING RUBRIC:

### Category 1: Action → Response Integrity (cat1) - Score 0/1/2
- Score 2 (Good): Every user action produces immediate, clear visual feedback (pressed state, color change, spinner appears)
- Score 1 (Fair): Most actions have feedback, minor delays (100-200ms) acceptable, some responses could be clearer
- Score 0 (Poor): Dead clicks (no visible response), >500ms delays without feedback, or ambiguous responses

Look for: Button press states in frame transitions, cursor changes (pointer→progress), element state changes (enabled→disabled), toast notifications, visual confirmations

Key issues: dead_click, delayed_response, ambiguous_response

### Category 2: Feedback & System Status Visibility (cat2) - Score 0/1/2
- Score 2 (Good): System state always visible, loading states clear with spinners/progress bars, operations provide feedback
- Score 1 (Fair): Some status indicators present but incomplete or could be clearer
- Score 0 (Poor): Silent operations with no feedback, missing loading indicators, unclear system state

Look for: Spinners/progress bars during waits, disabled state styling (grayed out, cursor changes), status messages, process indicators, completion confirmations

Key issues: missing_spinner, unclear_disabled_state, no_progress_feedback

### Category 3: Interaction Predictability & Affordance (cat3) - Score 0/1/2
- Score 2 (Good): All interactive elements look interactive (buttons, links clearly styled), non-interactive elements don't invite clicks, behavior matches appearance
- Score 1 (Fair): Most affordances are clear with minor confusion possible
- Score 0 (Poor): Misleading visual cues (clickable-looking non-buttons), unexpected behavior, unclear what's interactive

Look for: Button styling (borders, shadows, colors), hover states visible, cursor changes on interactive elements, consistent interaction patterns, clear distinction between interactive and static elements

Key issues: misleading_affordance, surprise_navigation, mode_switch_surprise

### Category 4: Flow Continuity & Friction (cat4) - Score 0/1/2
- Score 2 (Good): Smooth progression through task, no backtracking needed, context preserved between steps, logical flow
- Score 1 (Fair): Minor friction but generally smooth, occasional redundancy
- Score 0 (Poor): Forced backtracking, repeated steps, context loss between screens, disjointed flow

Look for: Navigation patterns, whether user must go back to redo steps, if information carries forward, smooth transitions between states

Key issues: backtracking, repeated_actions, context_loss

### Category 5: Error Handling & Recovery (cat5) - Score 0/1/2
- Score 2 (Good): Errors clearly shown with specific messages and actionable recovery steps
- Score 1 (Fair): Errors shown but recovery path unclear or generic message
- Score 0 (Poor): Silent errors (operation fails with no notification), blocking errors with no solution, unclear how to recover

Look for: Error messages and their clarity, inline validation feedback, suggestions for fixing errors, whether errors block progress

Key issues: silent_error, blocking_error, recovery_unclear

### Category 6: Micro-interaction Quality (Polish) (cat6) - Score 0/1/2
- Score 2 (Good): Smooth transitions between states, good focus management, pleasant animations that aid understanding
- Score 1 (Fair): Functional but could be smoother, minor polish issues
- Score 0 (Poor): Jarring transitions (instant state changes), confusing focus (unclear where you are), distracting or disorienting animations

Look for: Fade/slide transitions vs instant changes, focus indicators (outlines, highlights), animation smoothness, visual continuity

Key issues: jarring_transition, distracting_animation, focus_confusion

### Category 7: Efficiency & Interaction Cost (cat7) - Score 0/1/2
- Score 2 (Good): Minimal steps required, smart defaults pre-filled, shortcuts available, efficient workflows
- Score 1 (Fair): Reasonable number of steps, could be more efficient
- Score 0 (Poor): Too many steps for simple tasks, excessive clicking, poor defaults requiring lots of changes, large cursor travel distances

Look for: Number of clicks required, whether defaults are sensible, form fields pre-filled appropriately, keyboard shortcuts, redundant confirmation dialogs

Key issues: too_many_steps, over_clicking, excessive_cursor_travel, redundant_confirmations

SCORING INSTRUCTIONS:
- Analyze what IS visible in the frame sequence. Score based on observable UI elements and state changes.
- Be specific: cite actual UI elements, transitions, or absence thereof in your justifications (e.g., "Button shows pressed state in frame 2" not "No response in first frame").
- If a category is not directly applicable to the visible UI (e.g., error handling when no errors occur), score based on whether the UI shows good design patterns for that category (e.g., "No errors visible, but form lacks validation indicators - score 1").
- Only use "insufficient evidence" when literally NO relevant UI is visible for evaluation (very rare).
- Keep justifications concise but informative (1-2 lines citing specific observations).
- Be strict about dead clicks, missing loading state, unclear disabled state, and confusing affordances.

ISSUE TAGS - Use only tags from this fixed set:
dead_click, delayed_response, ambiguous_response, missing_spinner, unclear_disabled_state, no_progress_feedback, misleading_affordance, surprise_navigation, mode_switch_surprise, backtracking, repeated_actions, context_loss, silent_error, blocking_error, recovery_unclear, jarring_transition, distracting_animation, focus_confusion, too_many_steps, over_clicking, excessive_cursor_travel, redundant_confirmations

IMPROVEMENT SUGGESTIONS:
- Provide 3–8 actionable improvement suggestions
- Each must have severity: high (critical UX issue), med (noticeable problem), or low (nice-to-have enhancement)
- Be specific about what to change and why

EXAMPLES:

Example 1 - Button Click with Good Feedback:
Frame sequence: Hover state visible → Click → Button pressed state → Spinner appears
Analysis:
- cat1: 2 - "Button shows immediate pressed state in frame 2, spinner appears within 100ms in frame 3"
- cat2: 2 - "Loading spinner clearly visible with animation during processing"

Example 2 - Button Click with Poor Feedback:
Frame sequence: Cursor over button → Click → No change → Sudden navigation
Analysis:
- cat1: 0 - "No visual feedback on button click; appears as dead click for 2 seconds before navigation"
- cat2: 0 - "No loading indicator during 2-second wait; unclear system is processing request"
Issues: dead_click, missing_spinner

Return ONLY valid JSON that matches this schema:
{
  "rubric_scores": { "cat1":0|1|2, "cat2":0|1|2, "cat3":0|1|2, "cat4":0|1|2, "cat5":0|1|2, "cat6":0|1|2, "cat7":0|1|2 },
  "justifications": { "cat1": "...", "cat2":"...", "cat3":"...", "cat4":"...", "cat5":"...", "cat6":"...", "cat7":"..." },
  "issue_tags": ["..."],
  "suggestions": [
    { "severity":"high|med|low", "title":"...", "description":"..." }
  ]
}`;
