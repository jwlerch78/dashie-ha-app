/* ============================================================
   PersonalityPromptBuilder
   ------------------------------------------------------------
   Verbatim port of webapp's
     /js/ai/prompts/personality-prompt-builder.js
   converted from ESM to IIFE. Same prefix/suffix string output
   so the prompts sent to ai-gateway from the Console match the
   tablet byte-for-byte for the same personality row.

   The source of truth is the webapp file. If that changes, this
   needs to be re-synced.
   ============================================================ */

(function () {
    function addFamilyNotes(suffix, familyNotes) {
        if (familyNotes && familyNotes.trim()) {
            suffix += `\n\nFamily-specific notes: ${familyNotes.trim()}`;
        }
        return suffix;
    }

    function formatList(items) {
        if (!items || items.length === 0) return '';
        if (items.length === 1) return items[0];
        if (items.length === 2) return `${items[0]} and ${items[1]}`;
        const allButLast = items.slice(0, -1).join(', ');
        const last = items[items.length - 1];
        return `${allButLast}, and ${last}`;
    }

    function hasStructuredFields(personality) {
        if (!personality) return false;
        return !!(
            personality.personality_overview ||
            personality.similar_persona ||
            (personality.adjectives && personality.adjectives.length > 0) ||
            (personality.topics && personality.topics.length > 0) ||
            (personality.example_phrases && personality.example_phrases.length > 0)
        );
    }

    function buildPersonalityPrompt(personality) {
        if (!personality) {
            return { responsePrefix: '', responseSuffix: '' };
        }
        if (!hasStructuredFields(personality)) {
            return {
                responsePrefix: '',
                responseSuffix: addFamilyNotes('', personality.family_notes),
            };
        }

        let prefix = '';
        let suffix = '';

        if (personality.personality_overview) {
            const overview = personality.personality_overview.trim();
            const name = personality.name || 'this character';
            prefix += `Embody this character, ${name}: ${overview}`;
            if (!prefix.endsWith('.') && !prefix.endsWith('!') && !prefix.endsWith('?')) {
                prefix += '.';
            }
            prefix += '\n\n';
        }

        if (personality.similar_persona) {
            prefix += `Channel a personality similar to ${personality.similar_persona}.\n\n`;
        }

        if (personality.adjectives && personality.adjectives.length > 0) {
            const adjectiveList = formatList(personality.adjectives);
            prefix += `Be ${adjectiveList} in your responses.\n\n`;
        }

        if (personality.topics && personality.topics.length > 0) {
            const topicList = formatList(personality.topics);
            prefix += `Topics you naturally reference: ${topicList}.\n\n`;
        }

        if (personality.example_phrases && personality.example_phrases.length > 0) {
            suffix += '\n\nUse phrases like:\n';
            personality.example_phrases.forEach(phrase => {
                const cleanPhrase = phrase.trim().replace(/^["']|["']$/g, '');
                suffix += `- "${cleanPhrase}"\n`;
            });
        }

        suffix = addFamilyNotes(suffix, personality.family_notes);
        suffix += '\n\nVARY YOUR RESPONSES - don\'t start every response the same way. Mix up your openings.';

        return { responsePrefix: prefix.trim(), responseSuffix: suffix };
    }

    window.PersonalityPromptBuilder = { buildPersonalityPrompt, hasStructuredFields };
})();
