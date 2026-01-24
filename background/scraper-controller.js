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
// Global scraper window ID to allow reuse
let scraperWindowId = null;

async function handleScrapeMatch(matchId, url, options) {
    const startTime = performance.now();
    console.log(`[TIMING] Match ${matchId}: Starting scraper request...`);

    return new Promise(async (resolve, reject) => {
        try {
            // Check if scraper window already exists and is valid
            if (scraperWindowId !== null) {
                try {
                    const window = await chrome.windows.get(scraperWindowId, { populate: true });
                    if (window) {
                        console.log(`[TIMING] Match ${matchId}: Reusing existing window ${scraperWindowId}`);
                        // Reuse existing window
                        return navigateAndScrape(window.id, window.tabs[0].id, matchId, url, options, resolve, reject, startTime);
                    }
                } catch (e) {
                    // Window might have been closed by user
                    scraperWindowId = null;
                }
            }

            console.log(`[TIMING] Match ${matchId}: Creating new scraper window...`);

            // Create new window if needed
            // Create a visible but unfocused window (normal size) to avoid API errors
            chrome.windows.create({
                url: 'about:blank', // Start blank, then navigate
                incognito: false,   // Use normal profile to share cookies
                focused: false,     // Don't steal focus
                width: 1024,
                height: 768
            }, (window) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (!window || !window.tabs || window.tabs.length === 0) {
                    reject(new Error('无法创建窗口'));
                    return;
                }

                scraperWindowId = window.id;
                console.log(`[TIMING] Match ${matchId}: New window created ${window.id}`);
                navigateAndScrape(window.id, window.tabs[0].id, matchId, url, options, resolve, reject, startTime);
            });

        } catch (error) {
            reject(error);
        }
    });
}

async function handleScrapeMatch_OLD(matchId, url, options) {
    const startTime = performance.now();
    console.log(`[TIMING] Match ${matchId}: Starting window scrape...`);

    return new Promise((resolve, reject) => {
        // Create an incognito window
        chrome.windows.create({
            url,
            incognito: true,
            focused: false,  // Don't steal focus
            state: 'minimized'  // Minimize to be less intrusive
        }, (window) => {
            const createTime = performance.now();
            console.log(`[TIMING] Match ${matchId}: Window created in ${(createTime - startTime).toFixed(0)}ms`);

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

                const loadTime = performance.now();
                console.log(`[TIMING] Match ${matchId}: Tab loaded in ${(loadTime - createTime).toFixed(0)}ms`);

                // Give page a moment to fully render (reduced for speed)
                await new Promise(r => setTimeout(r, 500));

                const waitTime = performance.now();
                console.log(`[TIMING] Match ${matchId}: Render wait finished in ${(waitTime - loadTime).toFixed(0)}ms`);

                try {
                    // Execute extraction script
                    const results = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: extractMatchData,
                        args: [matchId, options]
                    });

                    const extractTime = performance.now();
                    console.log(`[TIMING] Match ${matchId}: Script execution in ${(extractTime - waitTime).toFixed(0)}ms`);

                    clearTimeout(timeout);
                    resolved = true;

                    // Close the incognito window
                    await chrome.windows.remove(windowId);

                    const closeTime = performance.now();
                    console.log(`[TIMING] Match ${matchId}: Window closed. TOTAL = ${(closeTime - startTime).toFixed(0)}ms`);

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

/**
 * Helper to navigate existing tab and scrape
 */
function navigateAndScrape(windowId, tabId, matchId, url, options, resolve, reject, startTime) {
    let resolved = false;

    // Set timeout for the operation
    const timeout = setTimeout(() => {
        if (!resolved) {
            resolved = true;
            reject(new Error('抓取超时'));
            // Don't close window on timeout -> keep for next attempt
        }
    }, 30000);

    const onUpdated = async (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
            return;
        }

        chrome.tabs.onUpdated.removeListener(onUpdated);

        const loadTime = performance.now();
        console.log(`[TIMING] Match ${matchId}: Tab loaded in ${(loadTime - startTime).toFixed(0)}ms`);

        // Give page a moment to fully render
        await new Promise(r => setTimeout(r, 500));

        const waitTime = performance.now();

        try {
            if (resolved) return;

            // Execute extraction script
            let results = await chrome.scripting.executeScript({
                target: { tabId },
                func: extractMatchData,
                args: [matchId, options]
            });

            // RETRY LOGIC: If data is missing (e.g. homeTeamName is null), wait and retry once
            // This handles cases where page says 'complete' but DOM is still hydrating
            let data = results && results[0] ? results[0].result : null;

            if (!data || !data.homeTeamName) {
                console.log(`[TIMING] Match ${matchId}: Data incomplete, retrying in 1500ms...`);
                await new Promise(r => setTimeout(r, 1500));

                results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: extractMatchData,
                    args: [matchId, options]
                });
                data = results && results[0] ? results[0].result : null;
            }

            const extractTime = performance.now();
            console.log(`[TIMING] Match ${matchId}: Script execution in ${(extractTime - waitTime).toFixed(0)}ms`);
            console.log(`[TIMING] Match ${matchId}: TOTAL = ${(extractTime - startTime).toFixed(0)}ms`);

            clearTimeout(timeout);
            resolved = true;

            // DO NOT close window here - let it be reused!

            if (data) {
                resolve(data);
            } else {
                reject(new Error('无法提取数据'));
            }
        } catch (error) {
            if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                reject(error);
            }
        }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    console.log(`[TIMING] Match ${matchId}: Navigating tab to ${url}`);
    chrome.tabs.update(tabId, { url: url });
}

/**
 * Close the scraper window if it exists
 */
async function closeScraperWindow() {
    if (scraperWindowId !== null) {
        try {
            await chrome.windows.remove(scraperWindowId);
        } catch (e) {
            // Ignore error if window already closed
        }
        scraperWindowId = null;
    }
}

// Export for use as ES module
export const ScraperController = {
    handleScrapeMatch,
    closeScraperWindow
};
