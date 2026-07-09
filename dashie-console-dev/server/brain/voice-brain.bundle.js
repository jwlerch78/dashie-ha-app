/* ============================================================
   AUTO-GENERATED — DO NOT EDIT BY HAND
   ------------------------------------------------------------
   The voice-conversation brain core, bundled for the Node add-on (on-prem L3).
   ONE core, TWO runtimes: the cloud Deno edge fn runs the TS source directly;
   this CJS bundle is the add-on's copy of the SAME source. Never hand-edit.
   Source git SHA: 88d54fb5906948955b07af4f61656ce2a1fb6d28
   Regenerate:  node scripts/build-node-brain.mjs && ./sync-brain-bundle.sh
   Contract:    supabase/functions/voice-conversation/README.md + build plan §13.16
   ============================================================ */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// supabase/functions/voice-conversation/orchestrator.ts
var orchestrator_exports = {};
__export(orchestrator_exports, {
  runOrchestration: () => runOrchestration
});
module.exports = __toCommonJS(orchestrator_exports);

// supabase/functions/voice-conversation/templates.ts
var BASE_CONTEXT = `# Base Context

You are generating responses for a voice-controlled family assistant. Your output will be spoken aloud directly to the user.

Current date and time: {{DATE_TIME}}

{{LANGUAGE_INSTRUCTION}}
{{CHAT_HISTORY}}

The user said: "{{USER_REQUEST}}"

Note: Speech-to-text may not be entirely accurate.

If the request is empty, garbled, or has no clear intent, it is likely background noise or a wake-word misfire \u2014 reply only with "Sorry, I didn't catch that." Do NOT ask a clarifying question and do NOT guess what was meant (asking a question on noise creates a loop).

Write your response as if speaking directly to the user. Use "you" to address them, not "the user".
`;
var RESPONSE_FORMAT_INITIAL = `# Response Format

Respond with ONE of these JSON formats:

## 1. RESPONSE (can answer directly)
Use this when you already know the answer (general knowledge, math, definitions, etc.)
\`\`\`json
{
  "type": "response",
  "voice": "Brief spoken answer (max 20 words)",
  "text": "Extra details NOT in voice (max 100 words) or null",
  "image": {"searchTerms": "keywords", "criteria": "visual desc", "fallback": "generic"} or null
}
\`\`\`

Rules:
- voice and text should not repeat each other
- image: Only for visual topics. Null for weather, time, math, definitions.
- Be CONCISE and family-friendly

## 2. INFO_REQUEST (need to fetch data)
Use this when you need family-specific data (calendar, weather, locations, chores, etc.)
\`\`\`json
{
  "type": "info_request",
  "tool": "tool_name",
  "query": {/* tool-specific params */},
  "context": "why needed",
  "processing_message": "what you'll do with the data"
}
\`\`\`

Available tools:
{{AVAILABLE_TOOLS_LIST}}

## 3. ACTION (change dashboard state)
\`\`\`json
{
  "type": "action",
  "voice": "Confirmation (max 20 words)",
  "text": null,
  "action": {"category": "theme|voice|display|chores", "command": "...", "parameters": {...}}
}
\`\`\`

Examples:
- "What's the weather?" \u2192 info_request with tool: "weather_data"
- "When is Charlie's next game?" \u2192 info_request with tool: "calendar_events"
- "Charlie fed the dogs" \u2192 info_request with tool: "chores", query: {hint: "fed the dogs", member_hint: "Charlie"}
- "Where is Mary?" \u2192 info_request with tool: "family_locations", query: {member_name: "Mary"}
- "When did Mary get home?" \u2192 info_request with tool: "location_events", query: {member_name: "Mary", location_name: "home", event_type: "arrive"}
- "What year was the Constitution signed?" \u2192 Direct response (you know this)
- "What's 25 times 12?" \u2192 Direct response (you can calculate)

CRITICAL: Respond ONLY with raw JSON. Do NOT wrap in markdown code fences (no \`\`\`json blocks). Just the JSON object directly.
`;
var RESPONSE_FORMAT_FULL = `# Response Format

Respond with ONE of these JSON formats:

## 1. RESPONSE (can answer now)
\`\`\`json
{
  "type": "response",
  "voice": "Brief spoken answer (max 20 words)",
  "text": "Extra details NOT in voice (max 100 words) or null",
  "action": null,
  "image": {"searchTerms": "keywords", "criteria": "visual desc", "fallback": "generic"} or null,
  "display_events": [0] or null,
  "timing": {"departure_time": "10:15 AM", "arrival_time": "11:00 AM"} or null,
  "trip": {"event_id": "uuid", "event_type": "arrive", "event_time": "ISO8601", "location_name": "Home", "member_name": "Mary"} or null,
  "member_location": true or null,
  "show_weather_overlay": true or null
}
\`\`\`

Rules:
- voice \u2260 text (don't repeat)
- image: Only for visual topics. Null for weather/time/math.
- display_events: For calendar queries, include event indices (idx field from calendar data) to show as visual event cards. Use for 1-10 specific events that answer the question. 1-2 events show as large cards, 3+ events show as a compact list grouped by day. Example: "When is Charlie's next game?" \u2192 display_events: [0] to show the first matching event. Example: "What are Mary's games this month?" \u2192 display_events: [0, 1, 2, 3, 4, 5] to show multiple games in list format.
- timing: For travel time queries ONLY. Include the exact departure and arrival times you calculate. These must match what you say in voice.
- trip: For location event queries ONLY. Include the primary event that answers the question (arrival or departure). We'll display a map showing the journey.
- member_location: For "where is X right now?" queries ONLY. Set to true to display a map card with the member's current location, avatar, distance from home, and travel time. We'll use the location data already provided to render the card.
- show_weather_overlay: For weather queries where user would benefit from seeing the forecast visually. Set to true to display the weather overlay modal with current conditions, hourly forecast, 10-day forecast, and animated radar. Use when user asks about weather forecast, weekend weather, or multi-day planning.
- Be CONCISE and family-friendly

## 2. INFO_REQUEST (need more data)
\`\`\`json
{
  "type": "info_request",
  "tool": "calendar_events|family_members|web_search|chores|location_events|travel_time|family_locations|weather_data",
  "query": {/* tool-specific params */},
  "context": "why needed",
  "processing_message": "what you'll do with the data"
}
\`\`\`

Tools:
- calendar_events: query: {time_range: "today|tomorrow|this_week|next_week|weekend|next_30_days|next_60_days"}
- family_members: query: {} (no params needed) - For questions about who someone is, their age, relationship, etc.
- web_search: query: "your search query string" (IMPORTANT: query should be a STRING, not an object)
- chores: query: {hint: "task description", member_hint: "name"} - Use when someone reports completing a task
- location_events: query: {member_name: "Mary", location_name: "home", timeframe: "yesterday", event_type: "arrive"} - For arrival/departure HISTORY (past events). **Use the exact location name from the user's query** (e.g., "auntie's", "grandma's house", "school"). **Timeframe options:** "today", "tonight", "yesterday", "last night", "last_24h", "last_week". Use "tonight" or "last night" when user says those words - they handle early morning hours intelligently.
- travel_time: query: {event_title: "game", member_name: "Jack"} - For "when should we leave?" questions
- family_locations: query: {member_name: "Mary"} - **Use this for "where is X right now?" questions.** Returns CURRENT GPS location with travel time from home and today's calendar events for context. Use for: "where is Mary?", "where's Dad right now?", "how far is Mom?", "when will Mary get home?"
- weather_data: query: {show_overlay: true} - For weather questions. Returns current conditions, hourly forecast, and 10-day forecast. Set show_overlay: true to display the visual weather overlay with radar.

## 3. ACTION (change dashboard or complete chores)
\`\`\`json
{
  "type": "action",
  "voice": "Confirmation (max 20 words)",
  "text": null,
  "action": {"category": "theme|voice|display|chores", "command": "...", "parameters": {...}}
}
\`\`\`

Examples:
- "Charlie fed the dogs" \u2192 info_request with tool: "chores", query: {hint: "fed the dogs", member_hint: "Charlie"}
- "Mary walked the dogs" \u2192 info_request with tool: "chores", query: {hint: "walked the dogs", member_hint: "Mary"}
- "When did Mary get home last night?" \u2192 info_request with tool: "location_events", query: {member_name: "Mary", location_name: "home", timeframe: "last night", event_type: "arrive"}
- "What time did Mary get home tonight?" \u2192 info_request with tool: "location_events", query: {member_name: "Mary", location_name: "home", timeframe: "tonight", event_type: "arrive"}
- "What time did Dad leave work?" \u2192 info_request with tool: "location_events", query: {member_name: "Dad", location_name: "work", event_type: "depart"}
- "What time did Mary get to auntie's last night?" \u2192 info_request with tool: "location_events", query: {member_name: "Mary", location_name: "auntie's", timeframe: "last night", event_type: "arrive"}
- "Where is Mary right now?" \u2192 info_request with tool: "family_locations", query: {member_name: "Mary"}
- "Where's Dad?" \u2192 info_request with tool: "family_locations", query: {member_name: "Dad"}
- "How far away is Mom?" \u2192 info_request with tool: "family_locations", query: {member_name: "Mom"}

CRITICAL: Respond ONLY with raw JSON. Do NOT wrap in markdown code fences (no \`\`\`json blocks). Just the JSON object directly.
`;
var INQUIRY_HOME_ASSISTANT = `# Inquiry Context: Home Assistant Command Parsing

**CRITICAL: This is a task execution context. Parse the user's command and return structured actions. No personality, no chitchat.**

Current date and time: {{DATE_TIME}}

## User's Command

The user said: "{{USER_REQUEST}}"

## Your Task

Parse the user's natural language command into Home Assistant service calls. The user may be requesting:
1. Single action: "turn on the kitchen lights" \u2192 one service call
2. Multiple actions: "turn on the lights and close the garage" \u2192 multiple service calls
3. Actions with parameters: "set the thermostat to 72" \u2192 service call with temperature parameter

## Available Entities

These are the controllable entities in the user's Home Assistant:

\`\`\`json
{{HA_ENTITIES}}
\`\`\`

## Matching Guidelines

**Entity Matching:**
- Match the user's spoken name to the \`friendly_name\` field
- Be flexible with variations: "living room lights" matches "Living Room Light"
- "the lights" with no room specified \u2192 ask which lights, OR use context if only one area mentioned
- "all the lights" \u2192 return multiple service calls for each matching light entity

**Action Mapping:**
| User Says | Domain | Service |
|-----------|--------|---------|
| "turn on" / "switch on" | light, switch, fan | turn_on |
| "turn off" / "switch off" | light, switch, fan | turn_off |
| "toggle" | light, switch | toggle |
| "open" | cover | open_cover |
| "close" | cover | close_cover |
| "lock" | lock | lock |
| "unlock" | lock | unlock |
| "set to X degrees" | climate | set_temperature |
| "set brightness to X%" | light | turn_on (with brightness) |
| "activate" / "run" | scene, script | turn_on |

**Climate/Thermostat:**
- "set thermostat to 72" \u2192 climate.set_temperature with temperature: 72
- "turn up the heat" \u2192 climate.set_temperature, increase by ~2 degrees from current
- "turn on the AC" \u2192 climate.set_hvac_mode with hvac_mode: "cool"

## Response Format

Return an ACTION response with \`category: "homeassistant"\` and \`command: "execute_commands"\`:

\`\`\`json
{
  "type": "action",
  "voice": "Brief confirmation (max 15 words)",
  "action": {
    "category": "homeassistant",
    "command": "execute_commands",
    "parameters": {
      "commands": [
        {
          "domain": "light",
          "service": "turn_on",
          "data": {
            "entity_id": "light.kitchen_lights"
          }
        },
        {
          "domain": "cover",
          "service": "close_cover",
          "data": {
            "entity_id": "cover.garage_door"
          }
        }
      ]
    }
  }
}
\`\`\`

## Examples

**Single light:**
User: "Turn on the kitchen lights"
\`\`\`json
{
  "type": "action",
  "voice": "Turning on the kitchen lights.",
  "action": {
    "category": "homeassistant",
    "command": "execute_commands",
    "parameters": {
      "commands": [
        {"domain": "light", "service": "turn_on", "data": {"entity_id": "light.kitchen_lights"}}
      ]
    }
  }
}
\`\`\`

**Multiple actions:**
User: "Turn on the family room lights and close the garage door"
\`\`\`json
{
  "type": "action",
  "voice": "Turning on family room lights and closing the garage.",
  "action": {
    "category": "homeassistant",
    "command": "execute_commands",
    "parameters": {
      "commands": [
        {"domain": "light", "service": "turn_on", "data": {"entity_id": "light.family_room"}},
        {"domain": "cover", "service": "close_cover", "data": {"entity_id": "cover.garage_door"}}
      ]
    }
  }
}
\`\`\`

**Thermostat:**
User: "Set the thermostat to 72"
\`\`\`json
{
  "type": "action",
  "voice": "Setting the thermostat to 72 degrees.",
  "action": {
    "category": "homeassistant",
    "command": "execute_commands",
    "parameters": {
      "commands": [
        {"domain": "climate", "service": "set_temperature", "data": {"entity_id": "climate.thermostat", "temperature": 72}}
      ]
    }
  }
}
\`\`\`

**Light with brightness:**
User: "Set the bedroom lights to 50 percent"
\`\`\`json
{
  "type": "action",
  "voice": "Setting bedroom lights to 50 percent.",
  "action": {
    "category": "homeassistant",
    "command": "execute_commands",
    "parameters": {
      "commands": [
        {"domain": "light", "service": "turn_on", "data": {"entity_id": "light.bedroom", "brightness_pct": 50}}
      ]
    }
  }
}
\`\`\`

## Error Handling

**If entity not found:**
\`\`\`json
{
  "type": "response",
  "voice": "I couldn't find a device matching 'basement lights'. Check Home Assistant for available devices.",
  "text": null
}
\`\`\`

**If action unclear:**
\`\`\`json
{
  "type": "response",
  "voice": "What would you like me to do with the kitchen lights? Turn on, turn off, or adjust brightness?",
  "text": null,
  "trigger_listening": true
}
\`\`\`

## Critical Rules

1. **No personality** - This is pure task execution. Be brief and direct.
2. **Return raw JSON only** - No markdown code fences. Just the JSON object.
3. **Multiple commands in one response** - Group all actions into the \`commands\` array.
4. **Verify entity exists** - Only include entities that exist in the provided list.
5. **Voice confirmation should summarize** - "Turning on lights and closing garage" not "Executing 2 commands".
`;
var INQUIRY_WEB_SEARCH = `# Inquiry Context: Web Search

This appears to be a request that requires information from the web.

## How to Use Search Results

1. The search results contain relevant web content for the user's query
2. Synthesize the information into a clear, accurate response
3. If results are insufficient or unclear, acknowledge limitations
4. Always provide family-friendly content

## Response Guidelines

- **Lead with the direct answer** in one or two sentences \u2014 answer only what was asked.
- **Synthesize, don't recite** \u2014 never read out source names, URLs, or "according to\u2026" preambles.
- **Spoken-friendly** \u2014 conversational plain sentences; no lists, headings, or bullets.
- **No commentary or sign-off** \u2014 skip "Hope that helps!", opinions, and filler.
- **Add at most one sentence of detail** only if it materially helps; otherwise stop.
- **If the results don't answer it**, say so briefly rather than guessing.

## Example Questions and Responses

**"Who won the game last night?"**
- Voice: "The Eagles beat the Cowboys, 24 to 17."

**"How tall is the Eiffel Tower?"**
- Voice: "About 330 meters \u2014 just over a thousand feet."

**"Fun fact about otters?"**
- Voice: "Otters hold hands while they sleep so they don't drift apart."

## Search Results

\`\`\`json
{{SEARCH_RESULTS}}
\`\`\`

Provide a helpful, spoken-friendly response based on these search results. Lead with the direct answer; do not mention sources or URLs.
`;
var INQUIRY_CALENDAR_EVENTS = `# Inquiry Context: Calendar Events

You have been provided with family calendar data below based on keyword detection in the user's query.

**IMPORTANT: First, evaluate whether this calendar data is actually relevant to the user's question.**

If the user is asking about:
- **External events** (World Cup, Olympics, Super Bowl, NFL/NBA/MLB schedules, concerts, movie releases, etc.) \u2192 The calendar data is NOT relevant. Use \`web_search\` instead.
- **General knowledge questions** that happen to contain words like "schedule", "event", or "game" \u2192 The calendar data is NOT relevant. Use \`web_search\` instead.
- **Family activities, appointments, or personal schedules** \u2192 The calendar data IS relevant. Use it to answer.

If the calendar data is NOT relevant to the question, respond with an \`info_request\` for \`web_search\` to get the actual information needed.

This is a request pertaining to {{MEMBER_NAME}}'s calendar{{TAGS_CONTEXT}}.

Current date and time: {{DATE_TIME}}

## Smart Calendar Filtering Applied

The event data has been pre-filtered as follows:
- INCLUDES: Events from calendars explicitly assigned to {{MEMBER_NAME}}
- INCLUDES: Events from "family calendars" (shared calendars not assigned to anyone)
- EXCLUDES: Events from calendars assigned to OTHER family members

This ensures you see personal events AND shared family events, but NOT other family members' personal events.

## How to Use This Calendar Data

1. The "summary" field gives you an overview of what was found
2. The "events" array contains ALL events in the timeframe
3. Each event has: time, title, calendar_id, location (optional), notes (optional), week (optional)
4. The "time" field format:
   - All-day events: "Day, Mon DD" (e.g., "Sun, Nov 16")
   - Timed events: "Day, Mon DD, HH:MM AM/PM - HH:MM AM/PM"
5. The "week" field (when present) indicates "this_week" or "next_week" - use this to prioritize

## Member Filtering (IMPORTANT)

When the query is about a specific family member:
- The "member_details" object contains the person's name, nickname, relationship, and notes
- The notes field contains important context: teams, schools, activities, etc.
- YOU must determine which events are relevant by finding DIRECT EVIDENCE:
  a) Event title/description containing family member's name (or nickname)
  b) Event details matching SPECIFIC information in member's notes (e.g., exact team name "Celtic 2014s")
  c) Event location matching member's school/facility from notes
- DO NOT assume all events of an activity type belong to someone (e.g., not all soccer = their soccer)
- Multiple family members may participate in the same sport - use team names to distinguish
- If no events match with direct evidence, say so clearly

## Calendar Tags

Calendars have user-defined tags (e.g., "sports", "school", "music"):
- The "calendars" array shows which calendars contributed events and their tags
- Use tags for context when explaining events (e.g., "Charlie has a soccer game..." not just "an event")
{{TAGS_FILTER_NOTE}}

## Response Guidelines

- Be specific about dates and times
- Use natural language for times (e.g., "Saturday at 9 AM" not "Sat, Jan 13, 9:00 AM")
- Acknowledge the person by name/nickname in your response
- If no relevant events found, provide a friendly "no events" message

## Member Details

{{MEMBER_DETAILS}}

## Retrieved Calendar Data

\`\`\`json
{{CALENDAR_DATA}}
\`\`\`

## IMPORTANT: Display Event Cards

**Include \`display_events\` in your response** to show visual event cards alongside your voice response. Use the \`idx\` field from each event in the data:

\`\`\`json
{
  "type": "response",
  "voice": "Charlie has a soccer game Saturday at 9 AM at Sports Park.",
  "text": null,
  "display_events": [0]
}
\`\`\`

Guidelines for display_events:
- Use for 1-10 specific events that answer the question
- 1-2 events show as large detail cards
- 3+ events show as a compact list grouped by day
- Use the \`idx\` field from the event data (e.g., \`display_events: [0, 1, 2]\`)
- Example: "When is Charlie's next game?" \u2192 \`display_events: [0]\` (first matching event)
- Example: "What are Mary's games this month?" \u2192 \`display_events: [0, 1, 2, 3, 4, 5]\`
- If no relevant events or asking about external events, omit display_events

Now provide a helpful response. If the calendar data answers the user's question, use it. If not (e.g., they're asking about external events like sports leagues, concerts, etc.), request a web_search instead.
`;
var INQUIRY_FAMILY_MEMBERS = `# Inquiry Context: Family Members

This appears to be a request about family members or their information.

## How to Use Family Data

1. The data contains information about family members stored in the system
2. Each member has: name, nickname, relationship, notes, and assigned calendars
3. Use this information to provide personalized responses

## Retrieved Data

\`\`\`json
{{FAMILY_DATA}}
\`\`\`

Please provide a helpful response based on this family information.
`;
var INQUIRY_CHORES = `# Inquiry Context: Chores

**CRITICAL: You have already been provided with chores data below. Use this data to match the user's request. DO NOT request additional information.**

Current date and time: {{DATE_TIME}}

## User's Request

The user said: "{{USER_REQUEST}}"

## Your Task

Match the user's spoken request to chore(s) in the list below. The user may:
1. Complete one chore: "Charlie fed the dogs" \u2192 find "Feed dogs" chore + "Charlie" member
2. Complete multiple chores for one person: "Charlie brushed his teeth and made his bed" \u2192 find both chores for Charlie
3. Complete same chore for multiple people: "Charlie and Jack both made their beds" \u2192 complete "Make bed" for both Charlie AND Jack
4. Ask about chores: "What chores does Sarah have?" \u2192 list Sarah's chores
5. Undo a completion: "Undo" or "Never mind" \u2192 undo last completion(s)

## Matching Guidelines

**Chore Title Matching (Semantic):**
- Match by meaning, not exact words: "fed the dogs" \u2192 "Feed dogs" \u2713
- "did my homework" \u2192 "Do homework" \u2713
- "cleaned my room" \u2192 "Clean bedroom" \u2713
- Consider common variations and synonyms
- Be flexible with tense: "brushed teeth" \u2192 "Brush teeth"

**Member Name Matching:**
- Check both \`name\` (full_name) and \`nickname\` fields
- "Charlie" could match nickname "Charlie" or full name "Charles"
- If member name not mentioned, you MUST ask who completed it

**Assignment Rules:**
- \`assignment_type: "anyone"\` \u2192 any member can complete
- \`assignment_type: "individual"\` \u2192 only members in \`assigned_member_ids\` can complete
- Check the assignment before confirming completion

**"All their chores" for multiple members:**
When user says "Charlie AND Jack finished all their chores", for EACH chore:
- If \`assignment_type: "individual"\` with both in \`assigned_member_ids\` \u2192 complete for BOTH
- If \`assignment_type: "anyone"\` \u2192 complete for BOTH (each member gets credit)
- Create separate completion entries for each member who can do that chore

## Available Chores

\`\`\`json
{{CHORES_DATA}}
\`\`\`

## Family Members

\`\`\`json
{{FAMILY_MEMBERS}}
\`\`\`

## Today's Completions

\`\`\`json
{{TODAYS_COMPLETIONS}}
\`\`\`

## Response Guidelines

**If you can match one or more chores + member:**
Return an ACTION response with \`category: "chores"\` and \`command: "complete_chores"\`.
Put ALL matched chores in the \`completions\` array parameter.

**Single Chore Example:**
User: "Charlie fed the dogs"
\u2192 Match "Feed dogs" chore + "Charlie" member
\u2192 Return action with 1 completion in the array

**Multiple Chores Example (one person):**
User: "Charlie brushed his teeth and made his bed and took a shower"
\u2192 Match "Brush teeth", "Make bed", "Take shower" (if they exist)
\u2192 Return action with 3 completions in the array (all for Charlie)

**Multiple People Example (same chore):**
User: "Charlie and Jack both made their beds"
\u2192 Match "Make bed" chore + both "Charlie" and "Jack" members
\u2192 Return action with 2 completions: one for Charlie, one for Jack
\`\`\`json
{
  "completions": [
    {"chore_id": "bed-chore-id", "member_id": "charlie-id", "chore_title": "Make bed", "member_name": "Charlie"},
    {"chore_id": "bed-chore-id", "member_id": "jack-id", "chore_title": "Make bed", "member_name": "Jack"}
  ]
}
\`\`\`

**Multiple People, Different Chores Example:**
User: "Charlie made his bed and Jack fed the fish"
\u2192 Match "Make bed" for Charlie AND "Feed fish" for Jack
\u2192 Return action with 2 completions: different chores, different members
\`\`\`json
{
  "completions": [
    {"chore_id": "bed-chore-id", "member_id": "charlie-id", "chore_title": "Make bed", "member_name": "Charlie"},
    {"chore_id": "fish-chore-id", "member_id": "jack-id", "chore_title": "Feed fish", "member_name": "Jack"}
  ]
}
\`\`\`

**Voice Response for Completions:**
IMPORTANT: Always mention the points earned in your voice response! Check each chore's \`points\` field to calculate totals.

- Single: "Done! Charlie earned 10 points for feeding the dogs."
- Multiple chores, one person: "Charlie completed 3 chores and earned 25 points!"
- Same chore, multiple people: "Charlie and Jack both made their beds! 20 points total."
- Different chores, different people: "Done! Charlie made his bed and Jack fed the fish. 15 points earned."

**If member name is missing:**
Return a RESPONSE asking "Who completed that chore?" (or "those chores?" if multiple) with \`trigger_listening: true\`

**If no matching chore found:**
Return a RESPONSE: "I couldn't find a chore matching [what they said]. Try saying the chore name more specifically."

**If some chores matched but not all:**
Complete the ones that matched and mention which one(s) couldn't be found in your voice response.
Example voice: "I completed brush teeth and make bed for Charlie, but I couldn't find a chore matching took a shower."

**If chore already completed today by this SPECIFIC member (check todays_completions):**
Check if the \`family_member_id\` in todays_completions matches the member completing the chore.
- ONLY skip a chore if that SPECIFIC MEMBER already completed it today
- Different members CAN complete the same chore (each gets their own completion)
- "anyone" chores can be completed by multiple different members

Example: If Jack completed "Make bed" today, and Charlie now says "I made my bed":
- Check todays_completions for a completion with Charlie's member_id AND the "Make bed" chore_id
- If NOT found \u2192 Complete it for Charlie (Jack's completion doesn't block Charlie)
- If found \u2192 Skip and say "Charlie already made the bed today"

If ALL requested chores were already done BY THAT MEMBER, return a RESPONSE: "[Member] already completed [chore(s)] today."

**For undo requests:**

IMPORTANT: Check \`todays_completions\` above to see what was completed today. Each completion record has an \`id\` field - this is the **completion_id** you should use for undo operations.

**Generic undo (no specifics mentioned):**
If user just says "undo" or "undo that" without mentioning a member or chore name:
\`\`\`json
{
  "type": "action",
  "voice": "Undoing that.",
  "action": {
    "category": "chores",
    "command": "undo",
    "parameters": {}
  }
}
\`\`\`

**Specific undo (member or chore mentioned):**
If user says "undo Mary's chore", "undo the dishwasher", "undo Charlie's feeding":
1. Find the matching completion(s) in \`todays_completions\`
2. Get the \`id\` field from each matching completion record - this is the completion_id
3. Return action with \`completion_ids\` array:

\`\`\`json
{
  "type": "action",
  "voice": "Undoing Mary's dishwasher chore.",
  "action": {
    "category": "chores",
    "command": "undo",
    "parameters": {
      "completion_ids": ["completion-uuid-from-todays_completions"],
      "member_name": "Mary"
    }
  }
}
\`\`\`

**Bulk undo (all chores for one member):**
If user says "undo all of Charlie's chores":
1. Find ALL completions for that member in \`todays_completions\`
2. Collect all \`id\` values from those completion records
3. Return action with all completion_ids:

\`\`\`json
{
  "type": "action",
  "voice": "Undoing all 4 of Charlie's chores.",
  "action": {
    "category": "chores",
    "command": "undo",
    "parameters": {
      "completion_ids": ["id1", "id2", "id3", "id4"],
      "member_name": "Charlie"
    }
  }
}
\`\`\`

**Bulk undo (multiple members):**
If user says "undo all of Charlie's AND Jack's chores":
1. Find ALL completions for EACH mentioned member in \`todays_completions\`
2. Collect all \`id\` values from ALL matching completion records
3. Return action with ALL completion_ids combined:

\`\`\`json
{
  "type": "action",
  "voice": "Undoing all chores for Charlie and Jack. 7 completions removed.",
  "action": {
    "category": "chores",
    "command": "undo",
    "parameters": {
      "completion_ids": ["charlie-id1", "charlie-id2", "charlie-id3", "jack-id1", "jack-id2", "jack-id3", "jack-id4"],
      "member_names": ["Charlie", "Jack"]
    }
  }
}
\`\`\`

**For chore queries (what chores does X have):**
Return a RESPONSE listing the member's chores, but distinguish between personal and shared chores:

**How to categorize chores for queries:**
- \`assignment_type: "individual"\` with member in \`assigned_member_ids\` \u2192 These are the member's PERSONAL chores (assigned specifically to them)
- \`assignment_type: "anyone"\` \u2192 These are SHARED/HOUSEHOLD chores that anyone can do (not specifically assigned to this person)

**Example response structure:**
If Mary has 2 personal chores and there are 4 "anyone" chores:
- Voice: "Mary has 2 personal chores left: brush teeth and make bed. There are also 4 shared household chores anyone can do."
- Or: "Mary still needs to brush her teeth and make her bed. Plus there are shared chores like feeding the pets that anyone can help with."

**Key distinction:**
- Don't list ALL "anyone" chores as if they're personally assigned to the member
- Emphasize their personal responsibilities first
- Mention shared chores as optional/available but not required of that specific person
`;
var INQUIRY_REWARDS = `# Inquiry Context: Rewards

**CRITICAL: You have already been provided with rewards data below. Use this data to match the user's request. DO NOT request additional information.**

Current date and time: {{DATE_TIME}}

## User's Request

The user said: "{{USER_REQUEST}}"

## Your Task

Match the user's spoken request to reward(s) in the list below. The user may:
1. Redeem a reward: "Charlie wants the ice cream reward", "Redeem movie night for Jack", "Charlie can redeem screen time" \u2192 find reward + member
2. Ask about rewards: "What rewards can Sarah get?" \u2192 list Sarah's available rewards
3. Check points: "How many points does Jack have?" \u2192 report point balance
4. Cancel a redemption: "Cancel Charlie's reward" or "Undo" \u2192 cancel pending redemption

## Matching Guidelines

**Reward Title Matching (Semantic):**
- Match by meaning, not exact words: "wants ice cream" \u2192 "Ice cream treat"
- "get the movie" \u2192 "Movie night"
- "wants screen time" \u2192 "Extra screen time"
- Consider common variations and synonyms
- Be flexible with phrasing

**Member Name Matching:**
- Check both \`name\` (full_name) and \`nickname\` fields
- "Charlie" could match nickname "Charlie" or full name "Charles"
- If member name not mentioned, you MUST ask who wants the reward

**Assignment Rules:**
- \`assignment_type: "anyone"\` \u2192 any member can redeem
- \`assignment_type: "individual"\` \u2192 only members in \`assigned_member_ids\` can redeem
- Check the assignment before confirming redemption

**Point Validation:**
- Check member's \`total_points\` against reward's \`point_cost\`
- If insufficient points, inform the user how many more they need
- Never allow redemption if points are insufficient

## Available Rewards

\`\`\`json
{{REWARDS_DATA}}
\`\`\`

## Family Members (with point balances)

\`\`\`json
{{FAMILY_MEMBERS}}
\`\`\`

## Recent Redemptions (for cancel requests)

\`\`\`json
{{RECENT_REDEMPTIONS}}
\`\`\`

## Response Guidelines

**If you can match reward + member with sufficient points:**
Return an ACTION response with \`category: "rewards"\` and \`command: "redeem_reward"\`.

**Single Redemption Example:**
User: "Charlie wants the ice cream reward"
\u2192 Match "Ice cream treat" reward + "Charlie" member
\u2192 Verify Charlie has enough points (check \`total_points\` >= \`point_cost\`)
\u2192 Return action with redemption details

\`\`\`json
{
  "type": "action",
  "voice": "Done! Charlie redeemed Ice cream treat for 50 points. 120 points remaining.",
  "action": {
    "category": "rewards",
    "command": "redeem_reward",
    "parameters": {
      "reward_id": "reward-uuid-from-data",
      "family_member_id": "member-uuid-from-data",
      "reward_title": "Ice cream treat",
      "member_name": "Charlie"
    }
  }
}
\`\`\`

**Voice Response for Redemptions:**
IMPORTANT: Always mention the points spent AND remaining balance in your voice response!

- Single: "Done! Charlie redeemed [reward] for [cost] points. [remaining] points left."
- With encouragement: "Awesome! Sarah got [reward]! [cost] points spent, [remaining] to go."

**If member name is missing:**
Return a RESPONSE asking "Who wants to redeem that reward?" with \`trigger_listening: true\`

**If no matching reward found:**
Return a RESPONSE: "I couldn't find a reward matching [what they said]. Try saying the reward name more specifically."

**If insufficient points:**
Return a RESPONSE explaining the shortage:
"[Member] needs [X] more points for [reward]. They have [current] points but it costs [cost]."

**If reward not available to member (assignment_type: individual):**
Return a RESPONSE: "Sorry, [reward] isn't available to [member]. It's only for [assigned members]."

**For cancel/undo requests:**

IMPORTANT: Check \`recent_redemptions\` above to see pending redemptions. If there are redemptions and the user mentions a member name OR a reward name, look up the actual redemption ID from that data.

**Generic undo (no specifics mentioned):**
If user just says "undo" or "cancel that" without mentioning a member or reward name:
\`\`\`json
{
  "type": "action",
  "voice": "Cancelling that redemption.",
  "action": {
    "category": "rewards",
    "command": "cancel_redemption",
    "parameters": {}
  }
}
\`\`\`

**Specific cancel (member or reward mentioned):**
If user says "cancel Charlie's reward", "undo the ice cream":
1. Find the matching redemption in \`recent_redemptions\`
2. Get the \`id\` (redemption_id) from that record
3. Return action with those details:

\`\`\`json
{
  "type": "action",
  "voice": "Cancelled Charlie's Ice cream treat. 50 points refunded.",
  "action": {
    "category": "rewards",
    "command": "cancel_redemption",
    "parameters": {
      "redemption_id": "actual-uuid-from-recent_redemptions",
      "reward_title": "Ice cream treat",
      "member_name": "Charlie"
    }
  }
}
\`\`\`

**For reward queries (what rewards can X get):**
Return a RESPONSE listing the member's available rewards they can afford:
- Filter by assignment (anyone OR assigned to them)
- Filter by affordability (total_points >= point_cost)
- List rewards with their costs

**For point balance queries (how many points does X have):**
Return a RESPONSE with the member's current point balance from \`family_members\` data.
`;
var INQUIRY_LOCATION_EVENTS = `# Inquiry Context: Location Events

You have been provided with location history data below based on keyword detection in the user's query.

**IMPORTANT: This data shows when family members arrived at or departed from saved locations (Home, Work, School, etc.).**

Current date and time: {{DATE_TIME}}

## What This Data Contains

Location events are recorded when family members:
- Enter a saved location (geofence) - recorded as "arrive"
- Leave a saved location (geofence) - recorded as "depart"

Events are stored for 7 days and include:
- The family member who triggered the event
- The location name (e.g., "Home", "Work", "CFMS") - the user-defined name
- The location type (e.g., "home", "work", "school") - the semantic category
- The event type ("arrive" or "depart")
- The exact time of the event

**IMPORTANT: The \`location_type\` field helps match user queries to locations. For example, if a user asks "when did Charlie leave school?", events at "CFMS" will match because its \`location_type\` is "school".**

**IMPORTANT: Each event has a \`time_local\` field (e.g., "7:21 PM") which is the LOCAL time. Always use \`time_local\` when speaking times to the user. Do NOT try to convert the \`time\` field yourself - it's in UTC and will confuse you.**

## Query Details

- **Member requested**: {{MEMBER_NAME}}
- **Location filter**: {{LOCATION_NAME}}
- **Timeframe**: {{TIMEFRAME}}
- **Event type filter**: {{EVENT_TYPE}}

## How to Interpret This Data

1. **Arrival events** ("arrive") mean the person entered the location's geofence
2. **Departure events** ("depart") mean the person left the location's geofence
3. Events are sorted by time, most recent first
4. **Use \`time_local\` for speaking times** - this is already converted to local time (e.g., "7:21 PM")
5. The \`time\` field is UTC - do not use it for speaking, only for the trip object
6. If no events are found, it means:
   - The person hasn't triggered any geofence events in the timeframe
   - OR location tracking may not be enabled for that person
   - OR there are no saved locations configured

## Response Guidelines

- Use natural, conversational language
- Be specific about times (e.g., "Mary got home at 5:42 PM" not "Mary arrived at home")
- If multiple events, summarize the pattern (e.g., "Dad left work at 5:30 PM and got home at 6:15 PM")
- If no events found, explain what might have happened
- Acknowledge the person by name/nickname in your response
- For "when did X get home?" questions, look for the most recent "arrive" event at "Home"
- For "did X go to work?" questions, look for either an "arrive" at "Work" or "depart" from "Home"

## CRITICAL: Include Trip Data in Response

**You MUST include a \`trip\` object in your response** when answering about a specific arrival or departure event. This allows us to display a map of the journey.

\`\`\`json
{
  "type": "response",
  "voice": "Mary got home at 6:45 PM last night.",
  "text": null,
  "trip": {
    "event_id": "uuid-of-the-primary-event",
    "event_type": "arrive",
    "event_time": "2024-12-12T18:45:00Z",
    "location_name": "Home",
    "member_name": "Mary"
  }
}
\`\`\`

The \`trip\` object contains:
- \`event_id\`: The \`id\` field from the event in the data (the one that directly answers the question)
- \`event_type\`: "arrive" or "depart"
- \`event_time\`: The ISO timestamp of the event
- \`location_name\`: The location name from the event
- \`member_name\`: The family member's name

**The event you include should be the PRIMARY event that answers the user's question.**
- "When did Mary get home?" \u2192 include the arrival event at Home
- "What time did Dad leave work?" \u2192 include the departure event at Work

## Example Responses

Good: "Mary got home at 6:45 PM last night."
\`\`\`json
{
  "type": "response",
  "voice": "Mary got home at 6:45 PM last night.",
  "text": null,
  "trip": {
    "event_id": "abc123",
    "event_type": "arrive",
    "event_time": "2024-12-12T18:45:00Z",
    "location_name": "Home",
    "member_name": "Mary"
  }
}
\`\`\`

Good: "Dad left work at 5:30 PM and got home at 6:15 PM."
\`\`\`json
{
  "type": "response",
  "voice": "Dad left work at 5:30 PM and got home at 6:15 PM.",
  "text": null,
  "trip": {
    "event_id": "def456",
    "event_type": "arrive",
    "event_time": "2024-12-12T18:15:00Z",
    "location_name": "Home",
    "member_name": "Dad"
  }
}
\`\`\`

If no events are found, do NOT include the \`trip\` field:
\`\`\`json
{
  "type": "response",
  "voice": "I don't see any location events for Mary in the last 24 hours.",
  "text": "Location tracking may not be enabled, or she hasn't triggered any geofence events."
}
\`\`\`

## Member Details

{{MEMBER_DETAILS}}

## Retrieved Location Events

\`\`\`json
{{LOCATION_EVENTS_DATA}}
\`\`\`

Now provide a helpful, natural response about the location history. If no events were found, let the user know and suggest possible reasons (location tracking may not be enabled, no geofence events in that timeframe, etc.).
`;
var INQUIRY_TRAVEL_TIME = `# Inquiry Context: Travel Time

You have been provided with travel time data for an upcoming trip or event.

**IMPORTANT: Use this data to answer questions about when to leave, travel times, and arrival planning.**

Current date and time: {{DATE_TIME}}

## What This Data Contains

Travel time calculations include:
- Distance from origin to destination
- Estimated travel time (with current traffic conditions)
- Traffic level indicator (light/moderate/heavy)
- Recommended departure time (accounting for early arrival buffer)
- Early arrival buffer applied (varies by event type)

## Query Details

- **Event**: {{EVENT_TITLE}}
- **Event Start Time**: {{EVENT_START_TIME}}
- **Event Location**: {{EVENT_LOCATION}}
- **Origin**: {{ORIGIN_ADDRESS}}
- **Event Notes**: {{EVENT_NOTES}}

## CRITICAL: Check Event Notes for Arrival Time

**Before using the default recommended departure time, check the event notes for a specific arrival time instruction.**

Look for phrases like:
- "arrive by 11am" or "arrive by 11:00"
- "be there by 10:30"
- "arrival time: 9am"
- "need to be there 30 minutes early"

**If the event notes specify an arrival time, calculate the departure time based on that arrival time, NOT the event start time.** For example:
- Event starts at 12:00 PM but notes say "arrive by 11:00 AM"
- With a 40-minute drive, you should leave by 10:20 AM (to arrive by 11:00 AM)
- Do NOT use the 12:00 PM start time in this case

## How to Interpret This Data

1. **Travel Duration**: The time shown includes current/predicted traffic conditions
2. **Recommended Departure**: The system-calculated departure accounts for:
   - Travel time with traffic
   - Default early arrival buffer (games: 30 min, practices: 15 min, other: 5 min)
   - **However, if event notes specify an arrival time, override this calculation**
3. **Traffic Level**:
   - "light" = Normal conditions, travel time is close to no-traffic estimate
   - "moderate" = Some delays, 10-30% longer than normal
   - "heavy" = Significant delays, >30% longer than normal

## Response Guidelines

- Give a clear, direct answer about when to leave
- **If event notes specify an arrival time, use that for your calculation and mention it**
- Mention the travel time and any traffic considerations
- Include the event start time for context
- If traffic is moderate or heavy, mention this
- Use natural language for times (e.g., "You should leave by 4:15 PM" not "depart at 16:15:00")
- If no travel data is available (e.g., event has no location), explain this clearly

## CRITICAL: Include Timing Data in Response

**You MUST include \`timing\` in your response JSON** with the exact times you calculate. This ensures the visual display matches what you say.

\`\`\`json
{
  "type": "response",
  "voice": "Leave by 10:15 AM to arrive by 11 AM for Jack's game.",
  "text": "It's about a 40-minute drive.",
  "timing": {
    "departure_time": "10:15 AM",
    "arrival_time": "11:00 AM"
  }
}
\`\`\`

The \`timing\` object contains:
- \`departure_time\`: The time you tell the user to leave (formatted like "10:15 AM")
- \`arrival_time\`: The time you expect them to arrive (formatted like "11:00 AM")

**These times MUST match exactly what you say in the voice response.** The display card uses these values directly.

## Example Responses

Good: "The notes say to arrive by 11 AM for Jack's noon game. It's about a 40-minute drive, so you should leave by 10:15 AM."
\`\`\`json
{
  "type": "response",
  "voice": "The notes say to arrive by 11 AM for Jack's noon game. It's about a 40-minute drive, so you should leave by 10:15 AM.",
  "text": null,
  "timing": {"departure_time": "10:15 AM", "arrival_time": "11:00 AM"}
}
\`\`\`

Good: "You should leave by 4:15 PM to get to Jack's soccer game on time. It's about a 25-minute drive, and I've built in 30 minutes for warmup since it's a game."
\`\`\`json
{
  "type": "response",
  "voice": "You should leave by 4:15 PM to get to Jack's soccer game on time. It's about a 25-minute drive.",
  "text": "I've built in 30 minutes for warmup since it's a game.",
  "timing": {"departure_time": "4:15 PM", "arrival_time": "4:40 PM"}
}
\`\`\`

Good: "The dentist appointment is 15 minutes away. Leave by 2:40 PM to arrive a few minutes early for your 3 PM appointment."
\`\`\`json
{
  "type": "response",
  "voice": "The dentist appointment is 15 minutes away. Leave by 2:40 PM to arrive a few minutes early.",
  "text": null,
  "timing": {"departure_time": "2:40 PM", "arrival_time": "2:55 PM"}
}
\`\`\`

Good: "Traffic is moderate right now, so leave a bit earlier than usual - around 5:30 PM to make the 6:30 practice."
\`\`\`json
{
  "type": "response",
  "voice": "Traffic is moderate right now, so leave a bit earlier than usual - around 5:30 PM to make the 6:30 practice.",
  "text": null,
  "timing": {"departure_time": "5:30 PM", "arrival_time": "6:15 PM"}
}
\`\`\`

## Retrieved Travel Time Data

\`\`\`json
{{TRAVEL_TIME_DATA}}
\`\`\`

Now provide a helpful, natural response about when to leave and travel time. Be specific about the recommended departure time, and remember to check the event notes for any specific arrival time requirements.
`;
var INQUIRY_FAMILY_LOCATIONS = `# Inquiry Context: Family Member Current Location

You have been provided with real-time location data below based on keyword detection in the user's query.

**IMPORTANT: This data shows where a family member is RIGHT NOW, along with travel time to get home IF they were to leave now.**

Current date and time: {{DATE_TIME}}

## What This Data Contains

- **Current GPS coordinates** with reverse-geocoded address
- **Travel time and distance from home** (with current traffic conditions) - this is how long it WOULD take, not an ETA
- **Movement status** - whether they're stationary, driving, moving, etc.
- **Whether they're at a saved location** (Home, Work, School, etc.)
- **Today's calendar events** for context about where they might be going

## Query Details

- **Member requested**: {{MEMBER_NAME}}

## How to Interpret This Data

1. **Location fields** (use in this priority order for response):
   - \`at_saved_location.name\` - **BEST** - If present, use this! (e.g., "Home", "Work", "School", "Grandma's")
   - \`location.place_name\` - Business/landmark name from GPS (e.g., "Starbucks", "Tampa International Airport")
   - \`location.address\` - Street address (e.g., "123 Main St, Tampa, FL")
   - \`location.city\` + \`location.state\` - General area (e.g., "Tampa, FL")
2. **Age of location data** (\`age_description\`, \`age_minutes\`) - How recent the GPS fix is
3. **Movement status** (\`movement_status\`) - Key field! Indicates:
   - \`stationary\` - Not moving (recent data)
   - \`likely_stationary\` - Probably not moving (data 5-30 min old)
   - \`driving\` - Actively driving
   - \`in_vehicle_stopped\` - In car but stopped
   - \`moving\` - Walking or slow movement
   - \`unknown_stale_data\` - Data is 30+ minutes old
4. **At saved location** (\`at_saved_location\`) - If they're at a saved place like Home, Work, School, etc. This is the most useful location info when present!
5. **Travel from home** - How long it WOULD take to get home if they left now (NOT an ETA!)
6. **Today's events** - Their calendar for context

## CRITICAL: Travel Time vs ETA

**DO NOT say "she'll be home at X" or "ETA is X" unless they are actively driving (\`movement_status: "driving"\`).**

- If stationary/likely_stationary: Say "about X minutes from home if she left now" or "X minutes away with current traffic"
- If driving: Use \`eta_home_if_left_now\` to give an actual ETA (e.g., "she should be home around 4:15 PM")
- Never assume someone is leaving - they might be at a destination

## Response Guidelines

- Be conversational and helpful
- **Lead with WHERE they are** - address, saved location name, or general area
- **For travel time**: Say "about X minutes from home" or "X away if they left now" - NOT "ETA is X"
- **Mention if they're at a saved location** (e.g., "at Work" or "at School")
- **Use calendar context** if relevant to explain why they might be there
- **Note movement status** if relevant (driving, stationary, etc.)
- **Note data freshness** if location is stale (>5 minutes old)

## Example Responses

**At a saved location (use at_saved_location.name):**
"Mary is at School right now. She's about 25 minutes from home with current traffic."

**At a place with a name (use place_name):**
"Mary is at Starbucks on Dale Mabry right now. It'd take her about 15 minutes to get home if she left now."

**At an address (use address):**
"Mary is at 1234 Main Street in Tampa. She's about 20 minutes from home with current traffic."

**Only city/state available:**
"Mary is in Tampa right now. Traffic is moderate, so it'd take her about 50 minutes to get home if she left now."

**Actively driving:**
"Mary is on the road right now, about 20 minutes from home. She should be back around 3:45 PM."

**With calendar context:**
"Mary is in downtown Tampa - looks like she has a meeting there at 2pm. She's about 35 minutes from home if she leaves after."

**Stale location data:**
"Mary's last known location was near USF campus about 15 minutes ago. She might be in class - I see she has Chemistry at 1pm."

**No location available:**
"I don't have a current location for Mary. Location sharing might not be enabled on her device."

## Member Details

{{MEMBER_DETAILS}}

## Retrieved Location Data

\`\`\`json
{{LOCATION_DATA}}
\`\`\`

## IMPORTANT: Include Map Display

**Always include \`"member_location": true\` in your response** to display a map card showing the member's location with their avatar, distance from home, and travel time. Example:

\`\`\`json
{
  "type": "response",
  "voice": "Mary is at School, about 25 minutes from home.",
  "text": null,
  "member_location": true
}
\`\`\`

Now provide a helpful, natural response about where this family member is. Be careful not to assume they're heading home - phrase travel time as "X minutes from home" not "ETA is X".
`;
var INQUIRY_WEATHER = `# Inquiry Context: Weather Data

You have been provided with weather data below based on the user's weather-related question.

**This data contains current conditions, hourly forecast (next 6 hours), and 10-day daily forecast for the family's location.**

Current date and time: {{DATE_TIME}}

## What This Data Contains

- **Current conditions**: Temperature, weather description, wind speed, humidity
- **Hourly forecast**: Next 6 hours with temperature, precipitation chance, wind, humidity
- **Daily forecast**: 10-day forecast with highs, lows, precipitation chance, UV index
- **Location**: City and state for the forecast

## Query Details

- **Location**: {{LOCATION_CITY}}, {{LOCATION_STATE}}

## How to Interpret This Data

1. **Temperature**: All temperatures are in Fahrenheit
2. **Precipitation chance**: Percentage chance of rain/snow (rounded to 5%)
3. **Wind speed**: In miles per hour (mph)
4. **Humidity**: Percentage
5. **UV Index**: Scale 0-11+ (0-2 low, 3-5 moderate, 6-7 high, 8-10 very high, 11+ extreme)

## Response Guidelines

- **Be conversational and natural** - Answer like a helpful family assistant
- **Lead with the most relevant info** for their question (current temp, rain chance, etc.)
- **Keep voice responses concise** - 20 words max for voice
- **Add context when helpful** - "Good day for outdoor activities" or "Might want a jacket"
- **Don't recite all the data** - Pick what's relevant to their question
- **Use show_weather flag** when visual would help (forecast questions, planning questions)

## Example Questions and Responses

**"What's the weather?"** (general question)
- Voice: "It's 45 degrees and cloudy. Chance of rain this afternoon around 60%."
- Text: null (or add wind/humidity if notably high/low)
- show_weather_overlay: true

**"Will it rain today?"** (specific question)
- Voice: "Yes, 60% chance of rain starting around 3pm. Might want an umbrella."
- Text: null
- show_weather_overlay: false (simple answer, no visual needed)

**"What's the weather this weekend?"** (forecast question)
- Voice: "Saturday looks nice, sunny and 55. Sunday has a 40% chance of showers."
- Text: null
- show_weather_overlay: true (user wants to see the forecast)

**"Should I bring a jacket?"** (practical question)
- Voice: "Yes, it's 45 degrees now and dropping to 38 tonight. Definitely jacket weather."
- Text: null
- show_weather_overlay: false

**"How windy is it?"** (specific detail)
- Voice: "Winds are about 15 miles per hour right now."
- Text: null
- show_weather_overlay: false

**"Is it a good day for the park?"** (planning question)
- Voice: "Perfect day for it! 68 degrees and sunny, low chance of rain."
- text: null
- show_weather_overlay: true

## Retrieved Weather Data

\`\`\`json
{{WEATHER_DATA}}
\`\`\`

## IMPORTANT: Show Weather Overlay Flag

If showing a visual forecast would help the user (general weather questions, forecast questions, multi-day planning questions), set \`show_weather_overlay: true\` in your response:

\`\`\`json
{
  "type": "response",
  "voice": "Here's the forecast. Currently 45 and cloudy with rain expected this afternoon.",
  "text": null,
  "show_weather_overlay": true
}
\`\`\`

For simple questions (specific temp, yes/no rain questions, wind speed), you can omit the flag or set it to false.

Now provide a helpful, natural response about the weather. Be conversational and answer what they actually asked.
`;
var INQUIRY_SPORTS = `# Sports Data

You requested sports data and here are the results.

The user asked: "{{USER_REQUEST}}"

Sports results (live from the sports provider):
{{SPORTS_DATA}}

## Response Guidelines

- Answer the user's specific question directly and conversationally \u2014 a score, a
  result, who won, or when the next game is.
- Lead with the outcome: e.g. "Mexico beat South Korea 2-0" or "The Lakers play
  the Celtics tonight at 7:30."
- **Always write scores as digits joined by a hyphen \u2014 "2-0", "3-1", "110-104" \u2014
  never spelled out ("two to nothing", "zero to zero"). When you name the leading
  or winning team, put their score first: "France leads 1-0".**
- Use the team/country names from the data. Include the score when the game is
  final or in progress; for upcoming games give the matchup and start time. If the
  game is in progress, include the clock/period from \`detail\` (e.g. "37'", "4th").
- **Scoring detail (when the data includes an \`events\` array): mention the key
  scoring plays in the \`text\` field, not the spoken \`voice\`. Use the \`clock\` and
  \`player\` from each event \u2014 phrasing follows the sport: soccer goals "Messi 38'",
  football "Kelce TD (Q2)", etc. Mark soccer penalties "(pen)" and own goals
  "(OG)". Keep \`voice\` to the score/result; put scorers and extra games in \`text\`.**
  Not every sport returns events (e.g. basketball usually has none) \u2014 if \`events\`
  is absent, just give the score.
- If there are multiple games, summarize the most relevant one (the team the user
  asked about) in the voice; put extra games in the text field.
- If the results are empty or don't contain the game asked about, say you
  couldn't find that game \u2014 do NOT invent a score or scorers.
- Keep the spoken \`voice\` answer under 25 words and natural to hear aloud.
`;
var AVAILABLE_TOOLS_LIST = `- calendar_events: query: {time_range: "today|tomorrow|this_week|next_week|weekend|next_30_days|next_60_days"} - Family calendar events
- family_members: query: {} - Info about family members (age, relationship, etc.)
- web_search: query: "search string" - Current events, news, external info (IMPORTANT: query is a STRING)
- chores: query: {hint: "task description", member_hint: "name"} - When someone reports completing a chore
- rewards: query: {} - Rewards catalog and redemption status
- location_events: query: {member_name: "Mary", location_name: "home", timeframe: "today|yesterday|last_night", event_type: "arrive|depart"} - Arrival/departure history
- travel_time: query: {event_title: "game", member_name: "Jack"} - When to leave for an event
- family_locations: query: {member_name: "Mary"} - Current GPS location ("where is X right now?")
- weather_data: query: {show_overlay: true} - Weather forecast for family location
- home_assistant: query: {command_hint: "transcript"} - Smart home control (lights, thermostat, garage, etc.)
- sports: query: {sport: "soccer|football|basketball|baseball|hockey", league: "nfl|nba|mlb|nhl|college-football|world-cup|premier-league|...", team: "team or country name", date: "YYYY-MM-DD (optional)", type: "score|schedule"} - Live game scores and schedules for a specific team/league (prefer over web_search for any game result, score, or upcoming game)`;
function fillTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const v = values[key];
    return v !== void 0 && v !== null ? v : "";
  });
}
function formatDateTime(tz) {
  const now = /* @__PURE__ */ new Date();
  const requested = tz?.trim();
  const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return fmtInZone(now, requested || serverZone);
  } catch {
    return fmtInZone(now, serverZone);
  }
}
function fmtInZone(now, timeZone) {
  const date = now.toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const time = now.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  return `${date}, ${time}`;
}

// supabase/functions/voice-conversation/personality-prompt-builder.js
function buildPersonalityPrompt(personality) {
  if (!personality) {
    return { responsePrefix: "", responseSuffix: "" };
  }
  if (!hasStructuredFields(personality)) {
    return {
      responsePrefix: "",
      responseSuffix: addFamilyNotes("", personality.family_notes)
    };
  }
  let prefix = "";
  let suffix = "";
  if (personality.personality_overview) {
    const overview = personality.personality_overview.trim();
    const name = personality.name || "this character";
    prefix += `Embody this character, ${name}: ${overview}`;
    if (!prefix.endsWith(".") && !prefix.endsWith("!") && !prefix.endsWith("?")) {
      prefix += ".";
    }
    prefix += "\n\n";
  }
  if (personality.similar_persona) {
    prefix += `Channel a personality similar to ${personality.similar_persona}.

`;
  }
  if (personality.adjectives && personality.adjectives.length > 0) {
    const adjectiveList = formatList(personality.adjectives);
    prefix += `Be ${adjectiveList} in your responses.

`;
  }
  if (personality.topics && personality.topics.length > 0) {
    const topicList = formatList(personality.topics);
    prefix += `Topics you naturally reference: ${topicList}.

`;
  }
  if (personality.example_phrases && personality.example_phrases.length > 0) {
    suffix += "\n\nUse phrases like:\n";
    personality.example_phrases.forEach((phrase) => {
      const cleanPhrase = phrase.trim().replace(/^["']|["']$/g, "");
      suffix += `- "${cleanPhrase}"
`;
    });
  }
  suffix = addFamilyNotes(suffix, personality.family_notes);
  suffix += "\n\nVARY YOUR RESPONSES - don't start every response the same way. Mix up your openings.";
  return { responsePrefix: prefix.trim(), responseSuffix: suffix };
}
function addFamilyNotes(suffix, familyNotes) {
  if (familyNotes && familyNotes.trim()) {
    suffix += `

Family-specific notes: ${familyNotes.trim()}`;
  }
  return suffix;
}
function formatList(items) {
  if (!items || items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const allButLast = items.slice(0, -1).join(", ");
  const last = items[items.length - 1];
  return `${allButLast}, and ${last}`;
}
function hasStructuredFields(personality) {
  if (!personality) return false;
  return !!(personality.personality_overview || personality.similar_persona || personality.adjectives && personality.adjectives.length > 0 || personality.topics && personality.topics.length > 0 || personality.example_phrases && personality.example_phrases.length > 0);
}

// supabase/functions/voice-conversation/prompt.ts
var INQUIRY_BY_TYPE = {
  "home-assistant": INQUIRY_HOME_ASSISTANT,
  "web-search": INQUIRY_WEB_SEARCH,
  "calendar-events": INQUIRY_CALENDAR_EVENTS,
  "family-members": INQUIRY_FAMILY_MEMBERS,
  "chores": INQUIRY_CHORES,
  "rewards": INQUIRY_REWARDS,
  "location-events": INQUIRY_LOCATION_EVENTS,
  "travel-time": INQUIRY_TRAVEL_TIME,
  "family-locations": INQUIRY_FAMILY_LOCATIONS,
  "weather": INQUIRY_WEATHER,
  "sports": INQUIRY_SPORTS
};
function languageNameFor(code) {
  return {
    "en-US": "English",
    "en-GB": "British English",
    "es-ES": "Spanish",
    "es-US": "Spanish",
    "fr-FR": "French",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-BR": "Brazilian Portuguese",
    "nl-NL": "Dutch",
    "pl-PL": "Polish",
    "hi-IN": "Hindi",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "zh-CN": "Simplified Chinese"
    // deno-lint-ignore no-explicit-any
  }[code] || code;
}
function buildInquiryValues(inquiryType, data, baseValues) {
  switch (inquiryType) {
    case "calendar-events":
      return {
        ...baseValues,
        MEMBER_NAME: data.member_details?.nickname || data.member_details?.name || "the family",
        TAGS_CONTEXT: data.metadata?.tag_filter ? ` and events related to ${data.metadata.tag_filter.join(", ")}` : "",
        TAGS_FILTER_NOTE: data.metadata?.tag_filter ? ` (filtered by: ${data.metadata.tag_filter.join(", ")})` : "",
        MEMBER_DETAILS: data.member_details ? JSON.stringify(data.member_details, null, 2) : "No specific member filter applied.",
        CALENDAR_DATA: JSON.stringify(data, null, 2)
      };
    case "family-members":
      return { ...baseValues, FAMILY_DATA: JSON.stringify(data, null, 2) };
    case "web-search":
      return { ...baseValues, SEARCH_RESULTS: JSON.stringify(data, null, 2) };
    case "chores":
      return {
        ...baseValues,
        CHORES_DATA: JSON.stringify(data.chores, null, 2),
        FAMILY_MEMBERS: JSON.stringify(data.family_members, null, 2),
        TODAYS_COMPLETIONS: JSON.stringify(data.todays_completions, null, 2)
      };
    case "rewards":
      return {
        ...baseValues,
        REWARDS_DATA: JSON.stringify(data.rewards, null, 2),
        FAMILY_MEMBERS: JSON.stringify(data.family_members, null, 2),
        RECENT_REDEMPTIONS: JSON.stringify(data.recent_redemptions, null, 2)
      };
    case "location-events":
      return {
        ...baseValues,
        MEMBER_NAME: data.member_details?.nickname || data.member_details?.name || data.query?.member_name || "unknown",
        LOCATION_NAME: data.query?.location_name || "any location",
        TIMEFRAME: data.query?.timeframe || "today",
        EVENT_TYPE: data.query?.event_type || "all events",
        MEMBER_DETAILS: data.member_details ? JSON.stringify(data.member_details, null, 2) : "Member not found or not specified.",
        LOCATION_EVENTS_DATA: JSON.stringify(data, null, 2)
      };
    case "travel-time":
      return {
        ...baseValues,
        EVENT_TITLE: data.event?.title || data.event?.summary || "Unknown event",
        EVENT_START_TIME: data.event?.startTime || data.timing?.eventStart || "Unknown time",
        EVENT_LOCATION: data.event?.location || data.destination?.address || "Unknown location",
        ORIGIN_ADDRESS: data.origin?.address || "Home",
        EVENT_NOTES: data.event?.description || data.event?.notes || "No notes",
        TRAVEL_TIME_DATA: JSON.stringify(data, null, 2)
      };
    case "family-locations":
      return {
        ...baseValues,
        MEMBER_NAME: data.member?.nickname || data.member?.name || data.query?.member_name || "unknown",
        MEMBER_DETAILS: data.member ? JSON.stringify(data.member, null, 2) : "Member not found.",
        LOCATION_DATA: JSON.stringify(data, null, 2)
      };
    case "weather":
      return {
        ...baseValues,
        LOCATION_CITY: data.location?.city || "Unknown",
        LOCATION_STATE: data.location?.state || "",
        WEATHER_DATA: JSON.stringify(data, null, 2)
      };
    case "sports":
      return { ...baseValues, SPORTS_DATA: JSON.stringify(data, null, 2) };
    case "home-assistant":
      return {
        ...baseValues,
        HA_ENTITIES: JSON.stringify(data.entities || [], null, 2),
        HA_ENTITIES_BY_DOMAIN: JSON.stringify(data.entities_by_domain || {}, null, 2),
        COMMAND_HINT: data.command_hint || baseValues.USER_REQUEST
      };
    default:
      return baseValues;
  }
}
function buildPrompt({ userRequest, inquiryType, retrievedData, context = {} }) {
  const dateTime = formatDateTime(context.timezone);
  let personalityConfig = null;
  if (context.customPersonalityConfig) {
    const result = buildPersonalityPrompt(context.customPersonalityConfig) || {};
    personalityConfig = {
      name: context.customPersonalityConfig.name,
      responsePrefix: result.responsePrefix,
      responseSuffix: result.responseSuffix
    };
  }
  const languageCode = context.language || "system";
  const languageInstruction = languageCode && languageCode !== "system" ? `Respond in ${languageNameFor(languageCode)}.` : "";
  const baseValues = {
    DATE_TIME: dateTime,
    USER_REQUEST: userRequest,
    CHAT_HISTORY: context.chatHistory || "",
    AVAILABLE_TOOLS_LIST,
    LANGUAGE_INSTRUCTION: languageInstruction,
    ...context
  };
  let prompt = fillTemplate(BASE_CONTEXT, baseValues);
  if (personalityConfig) {
    prompt = (personalityConfig.responsePrefix || "") + "\n\n" + prompt;
  }
  if (inquiryType && retrievedData) {
    const inquiryTemplate = INQUIRY_BY_TYPE[inquiryType];
    if (inquiryTemplate) {
      const inquiryValues = buildInquiryValues(inquiryType, retrievedData, baseValues);
      prompt += "\n\n" + fillTemplate(inquiryTemplate, inquiryValues);
    }
    prompt += "\n\n" + fillTemplate(RESPONSE_FORMAT_FULL, baseValues);
  } else {
    prompt += "\n\n" + fillTemplate(RESPONSE_FORMAT_INITIAL, baseValues);
  }
  if (personalityConfig && personalityConfig.responseSuffix) {
    prompt += personalityConfig.responseSuffix;
  }
  return prompt;
}

// supabase/functions/voice-conversation/parse.ts
function parseContent(content) {
  if (!content || typeof content !== "string") return null;
  let body = content.trim();
  body = body.replace(/^\s*```(?:json|JSON)?\s*\r?\n?/i, "").replace(/\r?\n?\s*```\s*$/i, "").trim();
  const firstBrace = body.indexOf("{");
  if (firstBrace > 0) body = body.slice(firstBrace);
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
  }
  if (!parsed) {
    const cleaned = body.replace(/,(\s*[}\]])/g, "$1");
    try {
      parsed = JSON.parse(cleaned);
    } catch {
    }
    if (!parsed) {
      const repaired = repairTruncatedJson(cleaned);
      if (repaired) {
        try {
          parsed = JSON.parse(repaired);
        } catch {
        }
      }
    }
  }
  return parsed ? normalizeParsedShape(parsed) : null;
}
function normalizeParsedShape(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (typeof parsed.voice === "string") parsed.voice = sanitizeVoice(parsed.voice);
  const KNOWN_TOOLS = /* @__PURE__ */ new Set([
    "web_search",
    "calendar_events",
    "family_members",
    "chores",
    "rewards",
    "location_events",
    "travel_time",
    "family_locations",
    "weather_data",
    "home_assistant"
  ]);
  if (parsed.type && KNOWN_TOOLS.has(parsed.type) && parsed.type !== "info_request") {
    return {
      type: "info_request",
      tool: parsed.type,
      query: parsed.query,
      context: parsed.context,
      processing_message: parsed.processing_message
    };
  }
  return parsed;
}
function isLikelyNoise(text) {
  if (!text || typeof text !== "string") return true;
  return !new RegExp("\\p{L}", "u").test(text);
}
function sanitizeVoice(s) {
  if (!s || typeof s !== "string") return s;
  let out = s;
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/(\*\*|__)(.*?)\1/g, "$2");
  out = out.replace(/(\*|_)(.*?)\1/g, "$2");
  out = out.replace(/~~(.*?)~~/g, "$1");
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  out = out.replace(/^\s{0,3}>\s?/gm, "");
  out = out.replace(/^\s*([-*+•]|\d+\.)\s+/gm, "");
  out = out.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
    ""
  );
  out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
function repairTruncatedJson(s) {
  if (!s || s[0] !== "{") return null;
  let inString = false;
  let escape = false;
  const stack = [];
  let validEnd = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
    if (stack.length > 0 && (ch === "," || ch === "}" || ch === "]")) validEnd = i;
  }
  if (inString) return null;
  if (stack.length === 0) return s;
  let prefix = s;
  if (validEnd !== -1 && validEnd < s.length - 1) prefix = s.slice(0, validEnd + 1);
  prefix = prefix.replace(/,(\s*)$/, "$1");
  const closers = stack.map((c) => c === "{" ? "}" : "]").reverse().join("");
  return prefix + closers;
}

// supabase/functions/voice-conversation/models.ts
function providerForModel(modelId) {
  if (!modelId || typeof modelId !== "string") return "claude";
  const id = modelId.toLowerCase();
  if (id.startsWith("claude-")) return "claude";
  if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3")) return "openai";
  if (id.startsWith("gemini-")) return "gemini";
  if (id.startsWith("us.amazon.") || id.startsWith("bedrock-") || id.includes("nova")) return "bedrock";
  return "claude";
}

// supabase/functions/voice-conversation/force-search.ts
var ROLE_WORDS = [
  "president",
  "vice president",
  "prime minister",
  "pm",
  "chancellor",
  "premier",
  "chief minister",
  "mayor",
  "governor",
  "senator",
  "ceo",
  "chief executive",
  "cfo",
  "coo",
  "chairman",
  "chairwoman",
  "chairperson",
  "pope",
  "king",
  "queen",
  "monarch",
  "emperor",
  "leader",
  "secretary general",
  "secretary-general",
  "director general",
  "head coach",
  "manager",
  "commissioner"
];
var TITLE_WORDS = [
  "champion",
  "champions",
  "world champion",
  "reigning champion",
  "defending champion",
  "title holder",
  "world number one",
  "number one",
  "mvp"
];
var EVENT_WORDS = [
  "super bowl",
  "world series",
  "world cup",
  "nba finals",
  "nba championship",
  "stanley cup",
  "champions league",
  "masters",
  "wimbledon",
  "us open",
  "election",
  "grand prix",
  "f1 championship"
];
var LEAD_VERBS = ["runs", "leads", "heads", "owns", "founded", "controls"];
function alt(words) {
  return words.slice().sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}
var ROLE_RE = new RegExp(
  `\\bwho(?:'s| is| are| was| were)?\\s+(?:the\\s+)?(?:current|sitting|reigning|new|incoming|present)?\\s*(?:${alt(ROLE_WORDS)})\\b`,
  "i"
);
var LEAD_RE = new RegExp(`\\bwho\\s+(?:${alt(LEAD_VERBS)})\\s+\\w+`, "i");
var TITLE_RE = new RegExp(
  `\\bwho(?:'s| is| are)?\\s+(?:the\\s+)?(?:current|reigning|defending)\\s+(?:[\\w-]+\\s+){0,2}(?:${alt(TITLE_WORDS)})\\b`,
  "i"
);
var WON_RE = new RegExp(
  `\\bwho\\s+won\\s+(?:the\\s+)?(?:(?:most recent|last|latest|current)\\s+)?(?:${alt([...EVENT_WORDS, ...TITLE_WORDS])})\\b`,
  "i"
);
var EXPLICIT_YEAR_RE = /\b(?:18|19|20)\d\d\b/;
var FAMILY_RE = /\b(?:my|our|your|his|her|their)\s+(?:family|mom|mother|dad|father|sister|brother|son|daughter|kids?|child|children|wife|husband|grandma|grandpa|aunt|uncle|cousin|parents?)\b/i;
function detectMutableEntity(text) {
  const normalized = (text || "").toLowerCase().trim().replace(/[.,!?;:]+$/g, "");
  if (!normalized) return null;
  if (FAMILY_RE.test(normalized)) return null;
  if (EXPLICIT_YEAR_RE.test(normalized)) return null;
  if (ROLE_RE.test(normalized)) return "role";
  if (LEAD_RE.test(normalized)) return "lead";
  if (TITLE_RE.test(normalized)) return "title";
  if (WON_RE.test(normalized)) return "won";
  return null;
}

// supabase/functions/voice-conversation/synthesis/sports.ts
function resolveWhen(query) {
  const w = String(query?.when ?? "").toLowerCase();
  if (w === "last" || w === "next" || w === "live") return w;
  const t = String(query?.type ?? "").toLowerCase();
  if (t === "schedule") return "next";
  if (t === "score") return "last";
  return "";
}
function deriveState(g) {
  const s = (g.status || "").toLowerCase();
  if (g.winner || s.includes("final") || s.includes("full")) return "post";
  if (g.homeScore == null && g.awayScore == null || s.includes("scheduled") || s.includes("pre")) return "pre";
  return "in";
}
function pickGame(games, team, when) {
  const matches = team ? games.filter((g) => (g.home || "").toLowerCase().includes(team) || (g.away || "").toLowerCase().includes(team)) : games.slice();
  const pool = matches.length ? matches : games;
  const byState = (st) => pool.filter((g) => deriveState(g) === st);
  if (when === "last") return byState("post").slice(-1)[0] || byState("in")[0] || pool[0];
  if (when === "next") return byState("pre")[0] || pool[0];
  if (when === "live") return byState("in")[0] || pool[0];
  return byState("in")[0] || byState("post").slice(-1)[0] || byState("pre")[0] || pool[0];
}
function groupScorers(g) {
  const out = [];
  for (const e of g.events || []) {
    if (!e.player || (e.scoreValue ?? 0) <= 0) continue;
    let entry = out.find((s) => s.player === e.player && s.side === e.side);
    if (!entry) {
      entry = { player: e.player, side: e.side, clocks: [] };
      out.push(entry);
    }
    if (e.clock) entry.clocks.push(e.clock);
  }
  return out;
}
function scorersText(g) {
  const scorers = groupScorers(g);
  if (!scorers.length) return null;
  const list = scorers.map((s) => `${s.player}${s.clocks.length ? ` (${s.clocks.join(", ")})` : ""}`).join(", ");
  return `Scorers: ${list}`;
}
var WEEKDAYS = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday"
};
function tidyDetail(detail) {
  let d = (detail || "").trim();
  if (!d) return "";
  d = d.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/, (_m, abbr) => WEEKDAYS[abbr] || abbr);
  d = d.replace(/\s+[A-Z]{2,4}\.?$/, "");
  return d.trim();
}
function scheduleWhen(g) {
  const d = tidyDetail(g.detail);
  return d && /\d/.test(d) ? d : "";
}
function card(g, state) {
  return {
    type: "sports",
    league: g.league,
    state,
    detail: tidyDetail(g.detail) || g.startTime,
    home: { name: g.home || "", score: g.homeScore ?? null, record: g.homeRecord, logo: g.homeLogo, color: g.homeColor },
    away: { name: g.away || "", score: g.awayScore ?? null, record: g.awayRecord, logo: g.awayLogo, color: g.awayColor },
    winner: g.winner ?? null,
    scorers: groupScorers(g)
  };
}
function finalLine(g) {
  const hs = g.homeScore ?? 0, as = g.awayScore ?? 0;
  if (hs === as) return `${g.home} and ${g.away} tied ${hs} to ${as}.`;
  const homeWon = g.winner ? g.winner === "home" : hs > as;
  const [w, ws, l, ls] = homeWon ? [g.home, hs, g.away, as] : [g.away, as, g.home, hs];
  return `${w} beat ${l} ${ws} to ${ls}.`;
}
function liveLine(g) {
  const hs = g.homeScore ?? 0, as = g.awayScore ?? 0;
  const when = tidyDetail(g.detail) ? `, ${tidyDetail(g.detail)}` : "";
  return `${g.away} ${as}, ${g.home} ${hs}${when}.`;
}
function scheduledLine(g, team) {
  const teamName = team && (g.away || "").toLowerCase().includes(team) ? g.away : g.home;
  const opp = teamName === g.home ? g.away : g.home;
  const when = scheduleWhen(g);
  return `${teamName} play ${opp}${when ? `, ${when}` : ""}.`;
}
function noGamesLine(query) {
  const team = String(query?.team ?? "").trim();
  return team ? `I couldn't find a game for ${team}.` : `I couldn't find that game.`;
}
function noRecentResultLine(g, query) {
  const team = String(query?.team ?? "").trim() || g.home || "that team";
  const opp = (g.home || "").toLowerCase().includes(team.toLowerCase()) ? g.away : g.home;
  const when = scheduleWhen(g);
  return `I couldn't find a recent ${team} result \u2014 their next game is${when ? ` ${when}` : ""} vs ${opp}.`;
}
function templateSports(result, query) {
  const games = Array.isArray(result?.games) ? result.games : [];
  const team = String(query?.team ?? "").toLowerCase();
  const when = resolveWhen(query);
  if (!team) {
    return { voice: "", text: null, structured_data: null, fallback: true };
  }
  if (games.length === 0) {
    return { voice: noGamesLine(query), text: null, structured_data: null };
  }
  const game = pickGame(games, team, when);
  const state = deriveState(game);
  if (when === "last" && state === "pre") {
    return { voice: noRecentResultLine(game, query), text: null, structured_data: card(game, state) };
  }
  const voice = state === "post" ? finalLine(game) : state === "in" ? liveLine(game) : scheduledLine(game, team);
  const text = state === "pre" ? null : scorersText(game);
  return { voice, text, structured_data: card(game, state) };
}

// supabase/functions/voice-conversation/retention.ts
function retainFields(persist, userText, responseText, subtext) {
  if (!persist) return {};
  return {
    prompt_text: userText || null,
    response_text: responseText || null,
    display_text: subtext || null
  };
}

// supabase/functions/voice-conversation/orchestrator.ts
var TOOL_STATUS = {
  web_search: "Searching the web\u2026",
  sports: "Checking the score\u2026",
  home_assistant: "Asking Home Assistant\u2026",
  calendar_events: "Checking your calendar\u2026",
  weather_data: "Checking the weather\u2026"
};
function statusForTool(tool) {
  return TOOL_STATUS[tool] || "Looking that up\u2026";
}
var REQUEST_TYPE = "voice_conversation";
async function runOrchestration(deps, io) {
  const { req, userId, token, supabase } = deps;
  const t0 = Date.now();
  if (isLikelyNoise(req.text)) return noiseTurn(t0);
  const modelId = req.options?.model || await io.getDefaultModel(supabase);
  const provider = providerForModel(modelId);
  const sessionId = req.conversation_id || crypto.randomUUID();
  const [personality, retainEnabled] = await Promise.all([
    io.resolvePersonality(supabase, userId, req.endpoint_id, req.options?.personality_id),
    io.readRetainTranscripts(supabase, userId)
  ]);
  const callerMode = req.options?.retain_mode === "caller";
  const retain = {
    serverPersist: retainEnabled && !callerMode,
    // brain writes text to Supabase
    callerRetain: retainEnabled && callerMode,
    // caller stores text HA-locally
    userText: req.text
  };
  const context = {
    customPersonalityConfig: personality,
    chatHistory: formatHistory(req.history),
    language: req.language || "system",
    timezone: req.timezone
    // client IANA zone → correct "today" in the prompt (server is UTC)
  };
  const forced = detectMutableEntity(req.text);
  const p1Prompt = buildPrompt({ userRequest: req.text, inquiryType: null, context });
  const forcedContent = forced ? JSON.stringify({
    type: "info_request",
    tool: "web_search",
    query: req.text,
    context: `forced web_search (mutable entity: ${forced})`,
    processing_message: "Looking that up\u2026"
  }) : null;
  const pass1 = forcedContent ? { ok: true, latency_ms: 0, raw: { content: forcedContent, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } } : await io.callGateway({ provider, prompt: p1Prompt, modelId });
  if (!pass1.ok || !pass1.raw) {
    return errorTurn(t0, pass1, [stageErr("pass1", pass1)]);
  }
  const p1Parsed = parseContent(pass1.raw.content);
  const p1Stage = passStage("pass1", pass1, p1Parsed?.type);
  const route = routeOf(p1Parsed);
  deps.onStage?.({ stage: "routed", route, elapsed_ms: Date.now() - t0 });
  if (p1Parsed?.type === "info_request" && p1Parsed.tool) {
    deps.onStage?.({ stage: "fetching", tool: p1Parsed.tool, status: statusForTool(p1Parsed.tool), elapsed_ms: Date.now() - t0 });
  }
  if (!p1Parsed || p1Parsed.type === "response" || p1Parsed.type === "action") {
    await logPass(
      io,
      token,
      REQUEST_TYPE,
      req.endpoint_id,
      sessionId,
      p1Prompt,
      pass1,
      retainFields(retain.serverPersist, retain.userText, responseTextOf(p1Parsed, pass1.raw), p1Parsed?.text ?? null)
    );
    return finalize({ t0, parsed: p1Parsed, raw: pass1.raw, stages: [p1Stage], usage: pass1.raw.usage, latency: pass1.latency_ms, retain, sessionId, route });
  }
  if (p1Parsed.type === "info_request" && p1Parsed.tool === "web_search") {
    await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
    const queryStr = typeof p1Parsed.query === "string" ? p1Parsed.query : p1Parsed.query?.query || p1Parsed.query?.q || req.text;
    const tFetch = Date.now();
    let search;
    try {
      search = await io.runWebSearch(queryStr);
    } catch (e) {
      return errorTurn(
        t0,
        { error: `Web search failed: ${e.message}`, latency_ms: pass1.latency_ms },
        [p1Stage, { name: "fetch_search", latency_ms: Date.now() - tFetch, error: e.message }]
      );
    }
    const fetchStage = { name: "fetch_search", latency_ms: Date.now() - tFetch, result_count: search?.results?.length || 0, provider: search?.provider };
    await io.logWebSearch(token, {
      session_id: sessionId,
      provider: search?.provider || "unknown",
      query_length: queryStr.length,
      requested_count: 10,
      result_count: search?.result_count ?? search?.results?.length ?? 0,
      latency_ms: search?.latency ?? fetchStage.latency_ms,
      success: true
    });
    return await secondPass(io, deps, t0, "web-search", search, [p1Stage, fetchStage], pass1, provider, modelId, context, sessionId, retain, route);
  }
  if (p1Parsed.type === "info_request" && p1Parsed.tool === "home_assistant") {
    const entities = req.provided_context?.ha_entities;
    if (!entities) {
      await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
      return finalize({ t0, parsed: p1Parsed, raw: pass1.raw, stages: [p1Stage], usage: pass1.raw.usage, latency: pass1.latency_ms, unsupported_tool: "home_assistant", sessionId, route });
    }
    await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
    const commandHint = p1Parsed.query?.command_hint || req.text;
    return await secondPass(io, deps, t0, "home-assistant", { entities, command_hint: commandHint }, [p1Stage], pass1, provider, modelId, context, sessionId, retain, route);
  }
  if (p1Parsed.type === "info_request" && p1Parsed.tool === "sports") {
    await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
    const sportsQuery = typeof p1Parsed.query === "object" && p1Parsed.query ? p1Parsed.query : { team: req.text };
    const tFetch = Date.now();
    let sports;
    try {
      sports = await io.runSports(sportsQuery);
    } catch (e) {
      return errorTurn(
        t0,
        { error: `Sports lookup failed: ${e.message}`, latency_ms: pass1.latency_ms },
        [p1Stage, { name: "fetch_sports", latency_ms: Date.now() - tFetch, error: e.message }]
      );
    }
    const fetchStage = { name: "fetch_sports", latency_ms: Date.now() - tFetch, result_count: sports?.games?.length || 0, provider: sports?.provider };
    await io.logSports(token, {
      session_id: sessionId,
      provider: sports?.provider || "unknown",
      query: JSON.stringify(sports?.query || sportsQuery || {}),
      result_count: sports?.games?.length || 0,
      latency_ms: sports?.latency ?? fetchStage.latency_ms,
      success: true
    });
    const synth = templateSports(sports, sportsQuery);
    if (synth.fallback) {
      return await secondPass(io, deps, t0, "sports", sports, [p1Stage, fetchStage], pass1, provider, modelId, context, sessionId, retain, route);
    }
    const parsed = { type: "response", voice: synth.voice, text: synth.text, action: null };
    const templatePass = {
      ok: true,
      latency_ms: 0,
      raw: { content: synth.voice, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: "template", provider: "template" }
    };
    await logPass(
      io,
      token,
      REQUEST_TYPE,
      req.endpoint_id,
      sessionId,
      "(sports template)",
      templatePass,
      retainFields(retain.serverPersist, retain.userText, synth.voice, synth.text)
    );
    return finalize({
      t0,
      parsed,
      raw: pass1.raw,
      stages: [p1Stage, fetchStage],
      usage: pass1.raw?.usage,
      latency: pass1.latency_ms,
      structured_data: synth.structured_data ?? void 0,
      retain,
      sessionId,
      route
    });
  }
  if (p1Parsed.type === "info_request" && p1Parsed.tool === "calendar_events") {
    const events = req.provided_context?.calendar_events;
    if (!events) {
      await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
      return finalize({ t0, parsed: p1Parsed, raw: pass1.raw, stages: [p1Stage], usage: pass1.raw.usage, latency: pass1.latency_ms, unsupported_tool: "calendar_events", sessionId, route });
    }
    await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
    return await secondPass(io, deps, t0, "calendar-events", { events }, [p1Stage], pass1, provider, modelId, context, sessionId, retain, route);
  }
  await logPass(io, token, REQUEST_TYPE, req.endpoint_id, sessionId, p1Prompt, pass1);
  return finalize({ t0, parsed: p1Parsed, raw: pass1.raw, stages: [p1Stage], usage: pass1.raw.usage, latency: pass1.latency_ms, unsupported_tool: p1Parsed.tool, sessionId, route });
}
function routeOf(parsed) {
  if (!parsed) return "direct";
  if (parsed.type === "response") return "direct";
  if (parsed.type === "action") return "action";
  if (parsed.type === "info_request") return parsed.tool || "unknown";
  return "direct";
}
async function secondPass(io, deps, t0, inquiryType, retrievedData, priorStages, pass1, provider, modelId, context, sessionId, retain, route) {
  const prompt = buildPrompt({ userRequest: deps.req.text, inquiryType, retrievedData, context });
  deps.onStage?.({ stage: "synthesizing", status: "Thinking\u2026", elapsed_ms: Date.now() - t0 });
  const pass2 = await io.callGateway({ provider, prompt, modelId });
  if (!pass2.ok || !pass2.raw) {
    return errorTurn(t0, pass2, [...priorStages, stageErr("pass2", pass2)]);
  }
  const parsed = parseContent(pass2.raw.content);
  await logPass(
    io,
    deps.token,
    REQUEST_TYPE,
    deps.req.endpoint_id,
    sessionId,
    prompt,
    pass2,
    retainFields(retain.serverPersist, retain.userText, responseTextOf(parsed, pass2.raw), parsed?.text ?? null)
  );
  const p2Stage = passStage("pass2", pass2, parsed?.type);
  const usage = sumUsage([pass1.raw?.usage, pass2.raw.usage]);
  return finalize({ t0, parsed, raw: pass2.raw, stages: [...priorStages, p2Stage], usage, latency: pass1.latency_ms + pass2.latency_ms, retain, sessionId, route });
}
function responseTextOf(parsed, raw) {
  return parsed?.voice || raw.content || "";
}
function finalize({ t0, parsed, raw, stages, usage, latency, unsupported_tool, retain, sessionId, route, structured_data }) {
  const type = parsed?.type || "response";
  const callerRetain = !!retain?.callerRetain && !unsupported_tool && (type === "response" || type === "action");
  return {
    ok: true,
    type,
    voice: parsed?.voice || raw.content || "",
    text: parsed?.text ?? null,
    action: parsed?.action ?? null,
    parsed_ok: !!parsed,
    raw_content: raw.content,
    usage: normalizeUsage(usage),
    model: raw.model || "",
    provider: raw.provider || "",
    latency_ms: latency,
    total_latency_ms: Date.now() - t0,
    unsupported_tool: unsupported_tool || void 0,
    route,
    stages,
    // Echo the session id (== ai_interactions.session_id) so callers can join the
    // HA-local transcript to the Supabase usage rows in the console (§17).
    conversation_id: sessionId,
    metadata: callerRetain ? { retain_transcript: true } : void 0,
    structured_data
  };
}
function noiseTurn(t0) {
  const msg = "Sorry, I didn't catch that.";
  return {
    ok: true,
    type: "response",
    voice: msg,
    text: null,
    action: null,
    parsed_ok: true,
    raw_content: msg,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: "",
    provider: "",
    latency_ms: 0,
    total_latency_ms: Date.now() - t0,
    route: "noise",
    stages: [{ name: "noise_shortcircuit", latency_ms: 0 }],
    metadata: { short_circuit: "noise" }
  };
}
function errorTurn(t0, result, stages) {
  return {
    ok: false,
    type: "error",
    voice: "",
    text: null,
    action: null,
    parsed_ok: false,
    raw_content: "",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: "",
    provider: "",
    latency_ms: result.latency_ms,
    total_latency_ms: Date.now() - t0,
    route: "error",
    stages,
    metadata: { error: result.error }
  };
}
function passStage(name, r, type) {
  return { name, latency_ms: r.latency_ms, model: r.raw?.model, provider: r.raw?.provider, usage: normalizeUsage(r.raw?.usage), type: type || "response" };
}
function stageErr(name, r) {
  return { name, latency_ms: r.latency_ms, error: r.error };
}
function sumUsage(usages) {
  const total = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  for (const u of usages) {
    if (!u) continue;
    total.input_tokens += u.input_tokens || 0;
    total.output_tokens += u.output_tokens || 0;
    total.total_tokens += u.total_tokens || 0;
  }
  return total;
}
function normalizeUsage(u) {
  return {
    input_tokens: u?.input_tokens || 0,
    output_tokens: u?.output_tokens || 0,
    total_tokens: u?.total_tokens || (u?.input_tokens || 0) + (u?.output_tokens || 0)
  };
}
function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const lines = history.slice(-4).map((h) => `${h.role === "user" ? "User" : "You"}: ${h.text || ""}`);
  return `Recent conversation:
${lines.join("\n")}
`;
}
async function logPass(io, token, requestType, endpointId, sessionId, prompt, pass, retainText = {}) {
  const usage = pass.raw?.usage || {};
  await io.logInteraction(token, {
    session_id: sessionId,
    request_type: requestType,
    request_length: prompt.length,
    model: pass.raw?.model || "unknown",
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0),
    api_latency_ms: pass.raw?.latency || 0,
    total_latency_ms: pass.latency_ms,
    success: true,
    endpoint_id: endpointId,
    // Transcript text (§17): present only on a terminal pass when serverPersist is on.
    ...retainText
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runOrchestration
});
module.exports.BRAIN_SOURCE_SHA = "88d54fb5906948955b07af4f61656ce2a1fb6d28";
