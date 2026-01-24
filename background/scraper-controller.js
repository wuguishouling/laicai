/**
 * scraper-controller.js
 * Background script module for handling match data scraping
 * Uses incognito windows to bypass Cloudflare
 * @author Foxtrick Scraper
 */

'use strict';

/**
 * Scrape a match by opening it in an incognito window to bypass Cloudflare
 * @param {number} matchId 
 * @param {string} url 
 * @param {Object} options 
 * @returns {Promise<Object>}
 */
async function handleScrapeMatch(matchId, url, options) {
    return new Promise((resolve, reject) => {
        // Create an incognito window
        chrome.windows.create({
            url,
            incognito: true,
            focused: false,  // Don't steal focus
            state: 'minimized'  // Minimize to be less intrusive
        }, (window) => {
            if (chrome.runtime.lastError) {
                // Check if incognito is not allowed
                const errorMsg = chrome.runtime.lastError.message;
                if (errorMsg.includes('incognito')) {
                    reject(new Error('请在扩展设置中启用"在无痕模式下允许"'));
                } else {
                    reject(new Error(errorMsg));
                }
                return;
            }

            if (!window || !window.tabs || window.tabs.length === 0) {
                reject(new Error('无法创建无痕窗口'));
                return;
            }

            const tabId = window.tabs[0].id;
            const windowId = window.id;
            let resolved = false;

            // Set timeout for the operation
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    chrome.windows.remove(windowId).catch(() => { });
                    reject(new Error('抓取超时'));
                }
            }, 30000); // 30 second timeout

            // Wait for tab to complete loading
            const onUpdated = async (updatedTabId, changeInfo) => {
                if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
                    return;
                }

                chrome.tabs.onUpdated.removeListener(onUpdated);

                // Give page a moment to fully render (reduced for speed)
                await new Promise(r => setTimeout(r, 500));

                try {
                    // Execute extraction script
                    const results = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: extractMatchData,
                        args: [matchId, options]
                    });

                    clearTimeout(timeout);
                    resolved = true;

                    // Close the incognito window
                    await chrome.windows.remove(windowId);

                    if (results && results[0] && results[0].result) {
                        resolve(results[0].result);
                    } else {
                        reject(new Error('无法提取数据'));
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    resolved = true;
                    chrome.windows.remove(windowId).catch(() => { });
                    reject(error);
                }
            };

            chrome.tabs.onUpdated.addListener(onUpdated);
        });
    });
}

/**
 * This function runs in the context of the match page
 * Extracts match data from the DOM using Foxtrick-compatible selectors
 * @param {number} matchId
 * @param {Object} options
 * @returns {Object}
 */
function extractMatchData(matchId, options) {
    const data = {
        matchId: matchId,
        matchDate: null,
        homeTeamId: null,
        homeTeamName: null,
        awayTeamId: null,
        awayTeamName: null,
        homeGoals: null,
        awayGoals: null,
        matchType: null,
        homeMidfield: null,
        awayMidfield: null,
        homeRightDefense: null,
        homeMiddleDefense: null,
        homeLeftDefense: null,
        awayRightDefense: null,
        awayMiddleDefense: null,
        awayLeftDefense: null,
        homeRightAttack: null,
        homeMiddleAttack: null,
        homeLeftAttack: null,
        awayRightAttack: null,
        awayMiddleAttack: null,
        awayLeftAttack: null,
        homeTactics: null,
        homeTacticsLevel: null,
        awayTactics: null,
        awayTacticsLevel: null,
        timelineRatings: null,
        events: null
    };

    try {
        // === TEAM NAMES ===
        // Primary selector: #mainBody h1 .hometeam / .awayteam
        const mainBody = document.getElementById('mainBody');
        const h1 = mainBody ? mainBody.querySelector('h1') : null;

        if (h1) {
            const homeTeamEl = h1.querySelector('.hometeam');
            const awayTeamEl = h1.querySelector('.awayteam');

            if (homeTeamEl) {
                data.homeTeamName = homeTeamEl.textContent.trim();
                // Extract team ID from href
                const homeHref = homeTeamEl.href || homeTeamEl.getAttribute('href') || '';
                const homeIdMatch = homeHref.match(/TeamID=(\d+)/i);
                if (homeIdMatch) data.homeTeamId = parseInt(homeIdMatch[1]);
            }

            if (awayTeamEl) {
                data.awayTeamName = awayTeamEl.textContent.trim();
                const awayHref = awayTeamEl.href || awayTeamEl.getAttribute('href') || '';
                const awayIdMatch = awayHref.match(/TeamID=(\d+)/i);
                if (awayIdMatch) data.awayTeamId = parseInt(awayIdMatch[1]);
            }
        }

        // Fallback: live-scoreboard-teamname
        if (!data.homeTeamName) {
            const liveTeams = document.querySelectorAll('.live-scoreboard-teamname');
            if (liveTeams.length >= 2) {
                data.homeTeamName = liveTeams[0].textContent.trim();
                data.awayTeamName = liveTeams[1].textContent.trim();
            }
        }

        // === SCORE ===
        // Primary selector: span.live-scoreboard-score
        const liveScoreboardScore = document.querySelector('span.live-scoreboard-score');
        if (liveScoreboardScore) {
            const scoreText = liveScoreboardScore.textContent.trim();
            const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
            if (scoreMatch) {
                data.homeGoals = parseInt(scoreMatch[1]);
                data.awayGoals = parseInt(scoreMatch[2]);
            }
        }

        // Fallback: #mainBody h1 [class="notByLine"]
        if (data.homeGoals === null && h1) {
            const scoreEl = h1.querySelector('[class="notByLine"]');
            if (scoreEl) {
                const scoreText = scoreEl.textContent.trim();
                const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
                if (scoreMatch) {
                    data.homeGoals = parseInt(scoreMatch[1]);
                    data.awayGoals = parseInt(scoreMatch[2]);
                }
            }
        }

        // === MATCH DATE ===
        // Primary selector: .matchinfo span.shy.smallText
        const dateEl = document.querySelector('.matchinfo span.shy.smallText');
        if (dateEl) {
            data.matchDate = dateEl.textContent.trim();
        }

        // Fallback: .date class
        if (!data.matchDate) {
            const fallbackDateEl = document.querySelector('.date');
            if (fallbackDateEl) {
                data.matchDate = fallbackDateEl.textContent.trim();
            }
        }

        // === MATCH TYPE ===
        if (mainBody) {
            if (mainBody.querySelector('.matchLeague')) data.matchType = 'League';
            else if (mainBody.querySelector('.matchFriendly')) data.matchType = 'Friendly';
            else if (mainBody.querySelector('[class*="matchCup"]')) data.matchType = 'Cup';
            else if (mainBody.querySelector('.matchQualification')) data.matchType = 'Qualification';
            else data.matchType = 'Other';
        }

        // === RATINGS TABLE ===
        if (options.includeRatings) {
            const ratingsTable = document.querySelector('.teamMatchRatingsTable table');
            if (ratingsTable) {
                const rows = ratingsTable.querySelectorAll('tr');

                // Rows 1-7 contain numeric ratings
                const ratingMapping = [
                    null,  // Row 0 is header
                    ['homeMidfield', 'awayMidfield'],
                    ['homeRightDefense', 'awayRightDefense'],
                    ['homeMiddleDefense', 'awayMiddleDefense'],
                    ['homeLeftDefense', 'awayLeftDefense'],
                    ['homeRightAttack', 'awayRightAttack'],
                    ['homeMiddleAttack', 'awayMiddleAttack'],
                    ['homeLeftAttack', 'awayLeftAttack']
                ];

                for (let i = 1; i <= 7 && i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length >= 2 && ratingMapping[i]) {
                        // Find numeric cells (usually the last two)
                        const numericCells = Array.from(cells).filter(cell => {
                            const text = cell.textContent.trim();
                            return /^\d+([,.]\d+)?$/.test(text);
                        });

                        if (numericCells.length >= 2) {
                            const homeVal = parseFloat(numericCells[0].textContent.replace(',', '.'));
                            const awayVal = parseFloat(numericCells[1].textContent.replace(',', '.'));
                            data[ratingMapping[i][0]] = homeVal;
                            data[ratingMapping[i][1]] = awayVal;
                        } else if (cells.length >= 4) {
                            // Fallback: use last two cells
                            const homeVal = parseFloat(cells[cells.length - 2].textContent.replace(',', '.'));
                            const awayVal = parseFloat(cells[cells.length - 1].textContent.replace(',', '.'));
                            if (!isNaN(homeVal)) data[ratingMapping[i][0]] = homeVal;
                            if (!isNaN(awayVal)) data[ratingMapping[i][1]] = awayVal;
                        }
                    }
                }

                // Extract tactics from later rows
                for (let i = 8; i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length === 0) continue;

                    const headerCell = cells[0];
                    const headerText = headerCell.textContent.toLowerCase();

                    // Tactics type row
                    if (headerText.includes('战术') || headerText.includes('tactic')) {
                        if (cells.length >= 3) {
                            data.homeTactics = cells[1].textContent.trim();
                            data.awayTactics = cells[2].textContent.trim();
                        }
                    }

                    // Tactics level row
                    if (headerText.includes('技能') || headerText.includes('skill') || headerText.includes('等级') || headerText.includes('level')) {
                        const numericCells = Array.from(cells).slice(1).filter(cell => {
                            return /^\d+([,.]\d+)?$/.test(cell.textContent.trim());
                        });
                        if (numericCells.length >= 2) {
                            data.homeTacticsLevel = parseFloat(numericCells[0].textContent.replace(',', '.'));
                            data.awayTacticsLevel = parseFloat(numericCells[1].textContent.replace(',', '.'));
                        }
                    }
                }
            }
        }

        // === MATCH EVENTS ===
        if (options.includeEvents) {
            const events = [];

            // Primary selector: ht-events-list with .live-bubble-container events
            const eventsContainer = document.querySelector('ht-events-list');

            if (eventsContainer) {
                const eventElements = eventsContainer.querySelectorAll('.live-bubble-container');

                eventElements.forEach(evnt => {
                    // Get event type from eventtype attribute
                    const eventType = evnt.getAttribute('eventtype') || '';

                    // Get minute from .matchMinute element
                    const minuteEl = evnt.querySelector('.matchMinute span, .matchMinute');
                    const minute = minuteEl ? minuteEl.textContent.trim() : '';

                    // Get event text from ht-matchevent element
                    const textEl = evnt.querySelector('ht-matchevent');
                    const text = textEl ? textEl.textContent.trim() : evnt.textContent.trim();

                    // Determine if home or away event
                    const isHome = evnt.classList.contains('live-bubble-home');
                    const isAway = evnt.classList.contains('live-bubble-away');

                    events.push({
                        minute: minute,
                        eventType: eventType,
                        text: text.substring(0, 1000),
                        isHome: isHome,
                        isAway: isAway
                    });
                });
            }

            // Fallback: try old selector #matchReport .matchevent
            if (events.length === 0) {
                const matchReport = document.getElementById('matchReport');
                if (matchReport) {
                    const eventElements = matchReport.querySelectorAll('.matchevent');
                    eventElements.forEach(evnt => {
                        const eventSpan = evnt.querySelector('span[data-eventtype]');
                        const eventType = eventSpan ? eventSpan.getAttribute('data-eventtype') : '';
                        const text = evnt.textContent.trim();
                        const minuteMatch = text.match(/^(\d+)['′]/);
                        const minute = minuteMatch ? minuteMatch[1] : '';

                        events.push({
                            minute: minute,
                            eventType: eventType,
                            text: text.substring(0, 1000),
                            isHome: evnt.classList.contains('liveHomeEvent')
                        });
                    });
                }
            }

            data.events = events.length > 0 ? events : null;
        }

        // === TIMELINE RATINGS ===
        if (options.includeTimeline) {
            const timelineRatings = [];

            // Hidden inputs containing timeline data
            const timeInputs = document.querySelectorAll('input[id$="_time"]');
            const homeRatingsInputs = document.querySelectorAll('input[id$="_playerRatingsHome"]');
            const awayRatingsInputs = document.querySelectorAll('input[id$="_playerRatingsAway"]');

            timeInputs.forEach((timeInput, idx) => {
                const timeValue = timeInput.value || '';
                const timeMatch = timeValue.match(/^(\d+)/);
                const minute = timeMatch ? parseInt(timeMatch[1]) : idx;

                const entry = { minute };

                if (homeRatingsInputs[idx]) {
                    try {
                        const homeData = JSON.parse(homeRatingsInputs[idx].value);
                        entry.homeRatings = homeData;
                    } catch (e) { /* ignore parse errors */ }
                }

                if (awayRatingsInputs[idx]) {
                    try {
                        const awayData = JSON.parse(awayRatingsInputs[idx].value);
                        entry.awayRatings = awayData;
                    } catch (e) { /* ignore parse errors */ }
                }

                if (entry.homeRatings || entry.awayRatings) {
                    timelineRatings.push(entry);
                }
            });

            data.timelineRatings = timelineRatings.length > 0 ? timelineRatings : null;
        }

    } catch (error) {
        console.error('Error extracting match data:', error);
        data.extractionError = error.message;
    }

    return data;
}

// Export for use as ES module
export const ScraperController = {
    handleScrapeMatch
};
