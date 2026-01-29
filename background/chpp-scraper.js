/**
 * @fileoverview CHPP API Scraper for Foxtrick
 * Fetches match data directly from Hattrick CHPP API (matchdetails 2.3)
 */

'use strict';

/* eslint-disable no-console */

// Ensure Foxtrick global exists (it should in background context)
var Foxtrick = Foxtrick || {};

const CHPPScraper = {

    /**
     * Fetch a single match using CHPP API
     * @param {Document} doc - Context document (usually background page's document, required for api.js)
     * @param {number} matchId 
     * @param {function(Object|null, string=):void} callback - format: (data, errorText)
     */
    fetchMatch: function (doc, matchId, callback) {
        const apiParams = [
            ['file', 'matchdetails'],
            ['version', '2.3'],
            ['matchId', matchId],
            ['matchEvents', 'true'], // Request detailed events
            ['sourceSystem', 'Hattrick']
        ];

        const options = { cache: 'default' }; // Use default caching logic

        Foxtrick.util.api.retrieve(doc, apiParams, options, (xml, errorText) => {
            if (errorText || !xml) {
                console.error(`CHPP Fetch Error for match ${matchId}:`, errorText);
                callback(null, errorText || 'Unknown API error');
                return;
            }

            try {
                const data = this.parseMatchXML(xml);
                callback(data, null);
            } catch (e) {
                console.error(`Error parsing CHPP XML for match ${matchId}:`, e);
                callback(null, `Parse error: ${e.message}`);
            }
        });
    },

    /**
     * Fetch multiple matches in parallel using batchRetrieve
     * @param {Document} doc 
     * @param {number[]} matchIds 
     * @param {Object} options 
     * @param {function(Object[], string[]):void} callback 
     */
    fetchMatches: function (doc, matchIds, options, callback) {
        // Prepare batch parameters
        const batchParams = matchIds.map(id => [
            ['file', 'matchdetails'],
            ['version', '2.3'],
            ['matchId', id],
            ['matchEvents', 'true'],
            ['sourceSystem', 'Hattrick']
        ]);

        const batchOptions = matchIds.map(() => ({ cache: 'default' }));

        Foxtrick.util.api.batchRetrieve(doc, batchParams, batchOptions, (xmls, errors) => {
            const results = [];
            const resultErrors = []; // Keep track of errors corresponding to input IDs

            // xmls and errors are arrays matching the input order
            // Note: api.js batchRetrieve implementation maps responses. 
            // Check api.js implementation: callback(responses, errors)

            for (let i = 0; i < matchIds.length; i++) {
                const xml = xmls[i];
                const err = errors[i];

                if (err || !xml) {
                    results.push(null);
                    resultErrors.push(err || 'Unknown Batch Error');
                    continue;
                }

                try {
                    const data = this.parseMatchXML(xml);
                    results.push(data);
                    resultErrors.push(null);
                } catch (e) {
                    results.push(null);
                    resultErrors.push(`Parse error: ${e.message}`);
                }
            }

            callback(results, resultErrors);
        });
    },

    /**
     * Parse the matchdetails XML into our JSON data structure
     * @param {Object} xml - The CHPPXML object (with ./node/text/num helpers)
     * @returns {Object} The parsed match data
     */
    parseMatchXML: function (xml) {
        const matchNode = xml.node('Match');
        const homeTeamNode = xml.node('HomeTeam', matchNode);
        const awayTeamNode = xml.node('AwayTeam', matchNode);
        const arenaNode = xml.node('Arena', matchNode);

        const matchId = xml.text('MatchID', matchNode);
        const homeTeamId = xml.text('HomeTeamID', homeTeamNode);
        const awayTeamId = xml.text('AwayTeamID', awayTeamNode);

        // Safe date extraction
        const matchDateObj = xml.time('MatchDate', matchNode);

        // Basic Info
        const data = {
            id: matchId,
            matchId: matchId,
            matchDate: matchDateObj ? matchDateObj.getTime() : null, // Safe null check
            matchType: xml.num('MatchType', matchNode),
            weather: xml.num('WeatherID', arenaNode) || 0,

            homeTeamId: homeTeamId,
            homeTeamName: xml.text('HomeTeamName', homeTeamNode),
            homeScore: xml.num('HomeGoals', matchNode),

            awayTeamId: awayTeamId,
            awayTeamName: xml.text('AwayTeamName', awayTeamNode),
            awayScore: xml.num('AwayGoals', matchNode),

            // Initialize fields that might be populated later
            events: [],
        };

        // --- Ratings ---
        // Helper to safely get rating
        const getRating = (node, tag) => xml.num(tag, node);

        // Home Ratings
        data.homeMidfield = getRating(homeTeamNode, 'RatingMidfield');
        data.homeRightDefense = getRating(homeTeamNode, 'RatingRightDef');
        data.homeCentralDefense = getRating(homeTeamNode, 'RatingMidDef');
        data.homeLeftDefense = getRating(homeTeamNode, 'RatingLeftDef');
        data.homeRightAttack = getRating(homeTeamNode, 'RatingRightAtt');
        data.homeCentralAttack = getRating(homeTeamNode, 'RatingMidAtt');
        data.homeLeftAttack = getRating(homeTeamNode, 'RatingLeftAtt');
        data.homeTactics = this.getTacticsName(xml.num('TacticType', homeTeamNode));
        data.homeTacticsLevel = xml.num('TacticSkill', homeTeamNode);

        // Away Ratings
        data.awayMidfield = getRating(awayTeamNode, 'RatingMidfield');
        data.awayRightDefense = getRating(awayTeamNode, 'RatingRightDef');
        data.awayCentralDefense = getRating(awayTeamNode, 'RatingMidDef');
        data.awayLeftDefense = getRating(awayTeamNode, 'RatingLeftDef');
        data.awayRightAttack = getRating(awayTeamNode, 'RatingRightAtt');
        data.awayCentralAttack = getRating(awayTeamNode, 'RatingMidAtt');
        data.awayLeftAttack = getRating(awayTeamNode, 'RatingLeftAtt');
        data.awayTactics = this.getTacticsName(xml.num('TacticType', awayTeamNode));
        data.awayTacticsLevel = xml.num('TacticSkill', awayTeamNode);

        // --- Parsing Events ---
        data.events = this.parseEventList(xml, homeTeamId, awayTeamId);

        return data;
    },

    /**
     * Parse the EventList from XML
     * @param {Object} xml 
     * @param {string} homeTeamId 
     * @param {string} awayTeamId 
     * @returns {Array<Object>}
     */
    parseEventList: function (xml, homeTeamId, awayTeamId) {
        const events = [];
        const eventListNode = xml.node('EventList');

        if (!eventListNode) return events;

        const eventNodes = eventListNode.getElementsByTagName('Event');

        // Helper for calculating RT ratio (simplified placeholders, calculation logic should be shared)
        // For now we just extract raw data. The existing scraper-controller.js calculates RT logic.
        // We might need to duplicate that logic or refactor it into a shared utility.
        // For Phase 1 of CHPP, let's extract raw event attributes.

        for (let i = 0; i < eventNodes.length; i++) {
            const ev = eventNodes[i];
            const eventType = xml.num('EventTypeID', ev); // Or EventKey? Usually TypeID in CHPP
            const eventKey = xml.text('EventKey', ev); // e.g. "1_1" ?

            // According to CHPP docs/examples commonly used IDs:
            // Uses EventTypeID usually. 

            const subjectTeamId = xml.text('SubjectTeamID', ev);
            const minute = xml.num('Minute', ev);

            const eventObj = {
                minute: minute,
                eventType: eventType,
                text: xml.text('EventText', ev),
                subjectTeamId: subjectTeamId,
                subjectPlayerId: xml.text('SubjectPlayerID', ev),
                objectPlayerId: xml.text('ObjectPlayerID', ev),
                // Determine if it's a home or away event
                isHome: (subjectTeamId === homeTeamId),
                // Placeholder for enhanced data (calculated later or here?)
                isSE: false,
                weather: 0 // Will be filled from match weather
            };

            // Apply SE Identification logic (Shared with main scraper if possible)
            // SE event types range generally (e.g. 100-199 usually SEs? check Foxtrick knowledge)
            // Based on scraper-controller:
            // SE_TYPES = [131, 132, 133, ..., 189 ?] 
            // Actually let's assume Foxtrick.util.matchEvent has definitions or we reuse the map.

            // Re-implementing simplified SE check from scraper-controller.js
            // 1xx are usually SEs.
            // Specifically special events in Hattrick are often in specific ranges.
            // Let's use the explicit list if we can import it, or just use the range logic.

            // Using the logic from scraper-controller.js:
            if (this.isSpecialEvent(eventType)) {
                eventObj.isSE = true;
            }

            events.push(eventObj);
        }

        return events;
    },

    /**
     * Map numeric tactics ID to name (English default, simplified)
     * @param {number} typeId 
     * @returns {string} provided name or "Normal"
     */
    getTacticsName: function (typeId) {
        // Mapping based on Foxtrick/Hattrick knowledge
        const TACTICS = {
            0: "Normal",
            1: "Pressing",
            2: "Counter-attacks",
            3: "Attack in the middle",
            4: "Attack on wings",
            7: "Play creatively",
            8: "Long shots"
        };
        return TACTICS[typeId] || "Normal";
    },

    /**
     * Check if event type is a Special Event
     * @param {number} typeId 
     */
    isSpecialEvent: function (typeId) {
        // Complete SE_TYPES list matching scraper-controller.js
        const SE_TYPES = [
            // 进球SE
            105, 106, 107, 108, 109, 115, 116, 117, 118, 119, 125, 135, 136, 137, 138, 139, 187, 190,
            // 失球SE
            205, 206, 207, 208, 209, 215, 216, 217, 218, 219, 225, 235, 236, 237, 239, 287, 288, 289, 290,
            // 天气/支援SE
            301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311
        ];
        return SE_TYPES.includes(typeId);
    }

};

// Expose to window/global
window.CHPPScraper = CHPPScraper;
