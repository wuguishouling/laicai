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

/**
 * Find an existing Hattrick tab where Foxtrick is authorized
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findHattrickTab() {
    const tabs = await chrome.tabs.query({ url: '*://*.hattrick.org/*' });
    return tabs.length > 0 ? tabs[0] : null;
}

async function handleScrapeMatch(matchId, url, options) {
    const startTime = performance.now();
    console.log(`[TIMING] Match ${matchId}: Starting scraper request...`);

    // CHPP Mode: Use existing Hattrick tab (no new window needed)
    if (options.useChppApi) {
        console.log(`[TIMING] Match ${matchId}: CHPP mode - finding existing Hattrick tab...`);

        const existingTab = await findHattrickTab();
        if (!existingTab) {
            return Promise.reject(new Error('未找到已打开的 Hattrick 页面。请先在浏览器中打开 hattrick.org 并登录。'));
        }

        console.log(`[TIMING] Match ${matchId}: Using existing tab ${existingTab.id}`);

        return new Promise(async (resolve, reject) => {
            try {
                // Inject CHPP scraper code
                await chrome.scripting.executeScript({
                    target: { tabId: existingTab.id },
                    files: ['background/chpp-scraper.js']
                });

                // Run CHPP Scraper
                const results = await chrome.scripting.executeScript({
                    target: { tabId: existingTab.id },
                    func: runChppScraperInTab,
                    args: [matchId]
                });

                const data = results && results[0] ? results[0].result : null;
                const endTime = performance.now();
                console.log(`[TIMING] Match ${matchId}: CHPP completed in ${(endTime - startTime).toFixed(0)}ms`);

                if (data && !data.error) {
                    resolve(data);
                } else {
                    reject(new Error(data?.error || '无法获取数据'));
                }
            } catch (error) {
                console.error(`[CHPP] Error for match ${matchId}:`, error);
                reject(error);
            }
        });
    }

    // DOM Scraping Mode: Use window-based approach
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
        weather: null,  // 新增天气字段
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

        // Fallback: 查找所有球队链接
        if (!data.homeTeamId || !data.awayTeamId) {
            const teamLinks = document.querySelectorAll('a[href*="TeamID="]');
            const foundTeamIds = [];
            teamLinks.forEach(link => {
                const match = link.href.match(/TeamID=(\d+)/i);
                if (match && !foundTeamIds.includes(match[1])) {
                    foundTeamIds.push(match[1]);
                }
            });
            if (foundTeamIds.length >= 2) {
                if (!data.homeTeamId) data.homeTeamId = parseInt(foundTeamIds[0]);
                if (!data.awayTeamId) data.awayTeamId = parseInt(foundTeamIds[1]);
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
        // 方法1: 通过class选择器
        if (mainBody) {
            if (mainBody.querySelector('.matchLeague')) data.matchType = 'League';
            else if (mainBody.querySelector('.matchFriendly')) data.matchType = 'Friendly';
            else if (mainBody.querySelector('[class*="matchCup"]')) data.matchType = 'Cup';
            else if (mainBody.querySelector('.matchQualification')) data.matchType = 'Qualification';
        }
        // 方法2: 通过页面内容判断
        if (!data.matchType || data.matchType === 'Other') {
            const pageText = document.body.textContent || '';
            if (pageText.includes('联赛') || pageText.includes('League') || pageText.includes('Division')) {
                data.matchType = 'League';
            } else if (pageText.includes('友谊赛') || pageText.includes('Friendly')) {
                data.matchType = 'Friendly';
            } else if (pageText.includes('杯赛') || pageText.includes('Cup')) {
                data.matchType = 'Cup';
            } else {
                data.matchType = 'Other';
            }
        }

        // === WEATHER (从事件中提取) ===
        // eventType 30=rainy, 31=cloudy, 32=fair, 33=sunny (36-39为HTO天气)
        const weatherEvents = document.querySelectorAll('[eventtype^="30"], [eventtype^="31"], [eventtype^="32"], [eventtype^="33"], [data-eventtype^="30"], [data-eventtype^="31"], [data-eventtype^="32"], [data-eventtype^="33"]');
        if (weatherEvents.length > 0) {
            const weatherEl = weatherEvents[0];
            const weatherType = weatherEl.getAttribute('eventtype') || weatherEl.getAttribute('data-eventtype') || '';
            const weatherNum = parseInt(weatherType.match(/\d+/)?.[0] || '0');
            switch (weatherNum) {
                case 30: case 36: data.weather = 'rainy'; break;
                case 31: case 37: data.weather = 'cloudy'; break;
                case 32: case 38: data.weather = 'fair'; break;
                case 33: case 39: data.weather = 'sunny'; break;
            }
        }

        // === RATINGS TABLE ===
        if (options.includeRatings) {
            // 尝试多个可能的选择器 (htbox-table是Hattrick新版页面结构)
            let ratingsTable = null;

            // 方法1: 新版Hattrick使用htbox-table
            const htboxTables = document.querySelectorAll('table.htbox-table');
            for (const table of htboxTables) {
                if (table.textContent.includes('Midfield') || table.textContent.includes('中场')) {
                    ratingsTable = table;
                    break;
                }
            }

            // 方法2: 旧版选择器
            if (!ratingsTable) {
                ratingsTable = document.querySelector('.teamMatchRatingsTable table');
            }
            if (!ratingsTable) {
                ratingsTable = document.querySelector('table.ratingsTable');
            }

            // 方法3: 通过内容查找任何包含评级的表格
            if (!ratingsTable) {
                const tables = document.querySelectorAll('table');
                for (const table of tables) {
                    if (table.textContent.includes('Midfield') || table.textContent.includes('中场')) {
                        ratingsTable = table;
                        break;
                    }
                }
            }

            if (ratingsTable) {
                const rows = ratingsTable.querySelectorAll('tr');

                // Rows 1-7 contain ratings, columns 3-4 contain numeric values (0-indexed)
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
                    if (ratingMapping[i]) {
                        // 方法1: 尝试固定列索引 (Foxtrick方式)
                        const HOME_IDX = 3, AWAY_IDX = 4;
                        if (cells.length > AWAY_IDX) {
                            const homeVal = parseFloat(cells[HOME_IDX].textContent.trim().replace(',', '.'));
                            const awayVal = parseFloat(cells[AWAY_IDX].textContent.trim().replace(',', '.'));
                            if (!isNaN(homeVal)) data[ratingMapping[i][0]] = homeVal;
                            if (!isNaN(awayVal)) data[ratingMapping[i][1]] = awayVal;
                        }

                        // 方法2: 如果方法1失败，查找所有数字单元格
                        if (data[ratingMapping[i][0]] === null || data[ratingMapping[i][1]] === null) {
                            const numericCells = Array.from(cells).filter(cell => {
                                const text = cell.textContent.trim();
                                // 匹配数字格式: 12, 12.5, 12,5 等
                                return /^\d+([.,]\d+)?$/.test(text);
                            });
                            if (numericCells.length >= 2) {
                                const homeVal = parseFloat(numericCells[0].textContent.trim().replace(',', '.'));
                                const awayVal = parseFloat(numericCells[1].textContent.trim().replace(',', '.'));
                                if (!isNaN(homeVal) && data[ratingMapping[i][0]] === null) {
                                    data[ratingMapping[i][0]] = homeVal;
                                }
                                if (!isNaN(awayVal) && data[ratingMapping[i][1]] === null) {
                                    data[ratingMapping[i][1]] = awayVal;
                                }
                            }
                        }
                    }
                }

                // Extract tactics from later rows
                for (let i = 8; i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length === 0) continue;

                    const headerCell = cells[0];
                    const headerText = headerCell.textContent.toLowerCase();

                    // Tactics type row - 保存到备用变量（表格显示的是等级描述，不是战术类型）
                    // 实际战术类型从事件中提取（eventType 33x）
                    if (headerText.includes('战术') || headerText.includes('tactic')) {
                        // 表格中的战术数据不可靠，跳过
                        // 战术类型将从事件文本中提取
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

        // === SE类型列表 ===
        const SE_TYPES = [
            // 进球SE
            105, 106, 107, 108, 109, 115, 116, 117, 118, 119, 125, 135, 136, 137, 138, 139, 187, 190,
            // 失球SE
            205, 206, 207, 208, 209, 215, 216, 217, 218, 219, 225, 235, 236, 237, 239, 287, 288, 289, 290,
            // 天气/支援SE
            301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311
        ];

        // 进攻类事件（需要计算RT）
        const ATTACK_EVENTS = [
            // 100-190系列（进球）
            100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
            110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
            120, 121, 122, 123, 124, 125,
            130, 131, 132, 133, 134, 135, 136, 137, 138, 139,
            140, 141, 142, 143,
            150, 151, 152, 153, 154,
            160, 161, 162, 163, 164,
            170, 171, 172, 173, 174,
            180, 181, 182, 183, 184, 185, 186, 187, 190,
            // 200-290系列（失球）
            200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
            210, 211, 212, 213, 214, 215, 216, 217, 218, 219,
            220, 221, 222, 223, 224, 225,
            230, 231, 232, 233, 234, 235, 236, 237, 239,
            240, 241, 242, 243,
            250, 251, 252, 253, 254,
            260, 261, 262, 263, 264,
            270, 271, 272, 273, 274,
            280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290
        ];

        // 进攻方向映射
        function getAttackDirection(eventTypeNum) {
            const suffix = eventTypeNum % 10;
            switch (suffix) {
                case 0: return 'set_piece';
                case 1: return 'center';
                case 2: return 'left';
                case 3: return 'right';
                case 4: return 'penalty';
                case 5: case 6: case 7: case 8: case 9: return 'special';
                default: return null;
            }
        }

        // RT计算公式 (Foxtrick.Predict.attack)
        function calculateScoringChance(ratio) {
            return Math.tanh(6.9 * (ratio - 0.51)) * 0.455 + 0.46;
        }

        // 获取对应方向的攻防评级
        function getRatingsForDirection(direction, isHomeAttack, data) {
            let attackRating, defenseRating;
            if (isHomeAttack) {
                switch (direction) {
                    case 'left':
                        attackRating = data.homeLeftAttack;
                        defenseRating = data.awayRightDefense;
                        break;
                    case 'right':
                        attackRating = data.homeRightAttack;
                        defenseRating = data.awayLeftDefense;
                        break;
                    case 'center':
                    default:
                        attackRating = data.homeMiddleAttack;
                        defenseRating = data.awayMiddleDefense;
                        break;
                }
            } else {
                switch (direction) {
                    case 'left':
                        attackRating = data.awayLeftAttack;
                        defenseRating = data.homeRightDefense;
                        break;
                    case 'right':
                        attackRating = data.awayRightAttack;
                        defenseRating = data.homeLeftDefense;
                        break;
                    case 'center':
                    default:
                        attackRating = data.awayMiddleAttack;
                        defenseRating = data.homeMiddleDefense;
                        break;
                }
            }
            return { attackRating, defenseRating };
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
                    const eventTypeNum = parseInt(eventType.match(/\d+/)?.[0] || '0');

                    // Get minute from .matchMinute element
                    const minuteEl = evnt.querySelector('.matchMinute span, .matchMinute');
                    const minute = minuteEl ? minuteEl.textContent.trim() : '';

                    // Get event text from ht-matchevent element
                    const textEl = evnt.querySelector('ht-matchevent');
                    const text = textEl ? textEl.textContent.trim() : evnt.textContent.trim();

                    // Determine if home or away event
                    const isHome = evnt.classList.contains('live-bubble-home');
                    const isAway = evnt.classList.contains('live-bubble-away');

                    // SE识别
                    const isSE = SE_TYPES.includes(eventTypeNum);

                    // 构建事件对象
                    const eventObj = {
                        minute: minute,
                        eventType: eventType,
                        text: text.substring(0, 1000),
                        isHome: isHome,
                        isAway: isAway,
                        isSE: isSE
                    };

                    // 对进攻类事件添加RT计算
                    if (ATTACK_EVENTS.includes(eventTypeNum)) {
                        const direction = getAttackDirection(eventTypeNum);
                        eventObj.attackDirection = direction;

                        // 计算RT比例
                        const isHomeAttack = isHome || !isAway;
                        const ratings = getRatingsForDirection(direction, isHomeAttack, data);

                        if (ratings.attackRating && ratings.defenseRating) {
                            eventObj.attackRating = ratings.attackRating;
                            eventObj.defenseRating = ratings.defenseRating;
                            eventObj.ratio = ratings.attackRating / (ratings.attackRating + ratings.defenseRating);
                            eventObj.scoringChance = calculateScoringChance(eventObj.ratio);
                        }
                    }

                    events.push(eventObj);
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
                        const eventTypeNum = parseInt(eventType.match(/\d+/)?.[0] || '0');
                        const text = evnt.textContent.trim();
                        const minuteMatch = text.match(/^(\d+)['′]/);
                        const minute = minuteMatch ? minuteMatch[1] : '';
                        const isHome = evnt.classList.contains('liveHomeEvent');
                        const isSE = SE_TYPES.includes(eventTypeNum);

                        const eventObj = {
                            minute: minute,
                            eventType: eventType,
                            text: text.substring(0, 1000),
                            isHome: isHome,
                            isAway: !isHome,
                            isSE: isSE
                        };

                        // 对进攻类事件添加RT计算
                        if (ATTACK_EVENTS.includes(eventTypeNum)) {
                            const direction = getAttackDirection(eventTypeNum);
                            eventObj.attackDirection = direction;

                            const ratings = getRatingsForDirection(direction, isHome, data);
                            if (ratings.attackRating && ratings.defenseRating) {
                                eventObj.attackRating = ratings.attackRating;
                                eventObj.defenseRating = ratings.defenseRating;
                                eventObj.ratio = ratings.attackRating / (ratings.attackRating + ratings.defenseRating);
                                eventObj.scoringChance = calculateScoringChance(eventObj.ratio);
                            }
                        }

                        events.push(eventObj);
                    });
                }
            }

            data.events = events.length > 0 ? events : null;

            // === 从战术事件（33x）中提取战术类型和等级 ===
            const TACTICS_EVENT_TYPES = [330, 331, 332, 333, 334, 335, 336, 337, 338, 339];

            // 战术类型关键词映射
            const TACTICS_KEYWORDS = {
                // 中文
                '全场压迫': 'Pressing', '压迫': 'Pressing',
                '中路进攻': 'Attack in Middle', '中路': 'Attack in Middle',
                '边路进攻': 'Attack on Wings', '边路': 'Attack on Wings',
                '防守': 'Play Defensively',
                '创造力': 'Play Creatively', '创造性': 'Play Creatively',
                '长传': 'Long Shots',
                '反击': 'Counter-Attacks',
                // 英文
                'pressing': 'Pressing',
                'middle': 'Attack in Middle',
                'wings': 'Attack on Wings',
                'defensive': 'Play Defensively',
                'creativ': 'Play Creatively',
                'long shot': 'Long Shots',
                'counter': 'Counter-Attacks'
            };

            if (events && events.length > 0) {
                for (const ev of events) {
                    const eventTypeNum = parseInt((ev.eventType || '').match(/\d+/)?.[0] || '0');

                    // 检查是否为战术事件
                    if (TACTICS_EVENT_TYPES.includes(eventTypeNum)) {
                        const text = ev.text || '';
                        const isHomeEvent = ev.isHome;
                        const isAwayEvent = ev.isAway;

                        // 提取战术类型
                        let foundTactics = null;
                        const lowerText = text.toLowerCase();
                        for (const [keyword, tacticsType] of Object.entries(TACTICS_KEYWORDS)) {
                            if (lowerText.includes(keyword.toLowerCase())) {
                                foundTactics = tacticsType;
                                break;
                            }
                        }

                        // 提取战术等级（从括号中的数字）
                        // 匹配模式如: (22), (15), (12)
                        const levelMatch = text.match(/\((\d+)\)/);
                        const level = levelMatch ? parseInt(levelMatch[1]) : null;

                        // 根据isHome/isAway分配
                        if (foundTactics) {
                            if (isHomeEvent && !data.homeTactics) {
                                data.homeTactics = foundTactics;
                                if (level) data.homeTacticsLevel = level;
                            } else if (isAwayEvent && !data.awayTactics) {
                                data.awayTactics = foundTactics;
                                if (level) data.awayTacticsLevel = level;
                            } else if (!isHomeEvent && !isAwayEvent) {
                                // 中性事件，尝试从文本判断
                                // 检查事件文本中是否包含主队或客队名
                                if (!data.homeTactics) {
                                    data.homeTactics = foundTactics;
                                    if (level) data.homeTacticsLevel = level;
                                } else if (!data.awayTactics) {
                                    data.awayTactics = foundTactics;
                                    if (level) data.awayTacticsLevel = level;
                                }
                            }
                        }
                    }
                }
            }
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
            let results;
            let data;

            if (options.useChppApi) {
                console.log(`[TIMING] Match ${matchId}: Using CHPP API Scraper...`);
                // Inject CHPP scraper code
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['background/chpp-scraper.js']
                });

                // Run CHPP Scraper
                results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: runChppScraperInTab,
                    args: [matchId]
                });
                data = results && results[0] ? results[0].result : null;

                if (!data) {
                    // Possible loading issue or API delay?
                    // CHPP API usually doesn't need DOM wait, but if API call failed in script
                    console.log(`[TIMING] Match ${matchId}: CHPP Fetch failed or returned null.`);
                }

            } else {
                // DOM Scraping
                results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: extractMatchData,
                    args: [matchId, options]
                });

                data = results && results[0] ? results[0].result : null;

                // RETRY LOGIC for DOM scraping: If data is missing (e.g. homeTeamName is null), wait and retry once
                // This handles cases where page says 'complete' but DOM is still hydrating
                if (!data || (!data.homeTeamName && !data.error)) {
                    console.log(`[TIMING] Match ${matchId}: Data incomplete, retrying in 1500ms...`);
                    await new Promise(r => setTimeout(r, 1500));

                    results = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: extractMatchData,
                        args: [matchId, options]
                    });
                    data = results && results[0] ? results[0].result : null;
                }
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

/**
 * Run CHPP Scraper in the tab context
 * requires chpp-scraper.js to be injected first
 * @param {number} matchId
 */
function runChppScraperInTab(matchId) {
    return new Promise((resolve, reject) => {
        // Debug environment
        console.log('[CHPP-INJECT] Checking environment...');
        if (typeof Foxtrick === 'undefined') {
            console.error('[CHPP-INJECT] FATAL: Foxtrick global object is missing!');
            resolve({ error: 'Foxtrick 插件未在此页面加载，请刷新 Hattrick 页面重试' });
            return;
        }

        if (!window.CHPPScraper) {
            console.error('[CHPP-INJECT] FATAL: CHPPScraper module missing!');
            resolve({ error: 'CHPPScraper 模块注入失败' });
            return;
        }

        // Run fetch
        console.log(`[CHPP-INJECT] Starting fetch for match ${matchId}...`);
        try {
            window.CHPPScraper.fetchMatch(document, matchId, (data, error) => {
                if (error) {
                    console.error("[CHPP-INJECT] Fetch error:", error);
                    // Ensure error is a string for transport
                    const errorMsg = error.message || error.toString();
                    resolve({ error: errorMsg });
                } else {
                    console.log("[CHPP-INJECT] Fetch success");
                    resolve(data);
                }
            });
        } catch (e) {
            console.error("[CHPP-INJECT] Exception calling fetchMatch:", e);
            resolve({ error: '调用异常: ' + e.message });
        }
    });
}

// Export for use as ES module
export const ScraperController = {
    handleScrapeMatch,
    closeScraperWindow
};
