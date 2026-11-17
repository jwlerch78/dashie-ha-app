// supabase/functions/voice-conversation/calendar-write-decline.ts — what voice SAYS when the household has calendar
// changes by voice turned off (calendar.writeAccess ∉ {voice, both}). NEW FILE (D-586).
//
// ⚖️ John 11-17: "Let's default voice edits to off, but we need a way for the LLM to respond intelligently that the
// calendar settings need to be updated to allow it to update calendars."
//
// Names the SETTING, never a navigation path: the brain serves Android, web and iOS, and their menus differ — and so do
// the option labels (native: "Voice only" / "Both"; web: "Voice only" / "Voice & touch"), so it says "an option that
// includes voice" rather than naming one. "Calendar Editing" is the row's title on both (CalendarPageSchema.kt,
// settings-calendar-page.js).
//
// 🔴 CROSS-BOUNDARY (JS_KOTLIN_CONTRACTS row 273): the device-fulfilled lane (Gemini Live → calendar-write-tool.js)
// speaks `calw.err.voiceOff` from js/core/voice/voice-strings.js. Same moment, same words — gated by
// test:calendar-voice-decline, which imports both and asserts they are identical.

export const CALENDAR_VOICE_OFF_DECLINE =
  'Calendar changes by voice are turned off for this home. You can turn them on in Calendar settings, under Calendar Editing — choose an option that includes voice.';
