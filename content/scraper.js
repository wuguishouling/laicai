/**
 * scraper.js
 * Main UI controller for the Hattrick Match Data Scraper
 * @author Foxtrick Scraper
 */

'use strict';

(function () {

    // ==================== State Management ====================

    const state = {
        mode: 'range',          // 'range' or 'list'
        matchIds: [],           // Array of match IDs to scrape
        isRunning: false,
        isPaused: false,
        currentIndex: 0,
        totalMatches: 0,
        completedMatches: 0,
        failedMatches: [],
        collectedData: [],
        startTime: null,
        interval: 2000,         // Default 2 seconds
        options: {
            includeEvents: true,
            includeTimeline: true,
            includeRatings: true,
            useChppApi: false
        }
    };

    // Storage key for persisting data
    const STORAGE_KEY = 'foxtrick_scraper_data';
    const STORAGE_STATE_KEY = 'foxtrick_scraper_state';

    // ==================== DOM Elements ====================

    let elements = {};

    function initElements() {
        elements = {
            // Tabs
            tabBtns: document.querySelectorAll('.tab-btn'),
            rangePanel: document.getElementById('range-panel'),
            listPanel: document.getElementById('list-panel'),

            // Inputs
            startId: document.getElementById('start-id'),
            endId: document.getElementById('end-id'),
            idList: document.getElementById('id-list'),
            rangeCount: document.getElementById('range-count'),
            listCount: document.getElementById('list-count'),
            intervalInput: document.getElementById('interval'),

            // Options
            optEvents: document.getElementById('opt-events'),
            optTimeline: document.getElementById('opt-timeline'),
            optRatings: document.getElementById('opt-ratings'),
            optUseChpp: document.getElementById('opt-use-chpp'),

            // Buttons
            btnStart: document.getElementById('btn-start'),
            btnPause: document.getElementById('btn-pause'),
            btnExport: document.getElementById('btn-export'),
            btnClear: document.getElementById('btn-clear'),
            btnRetryFailed: document.getElementById('btn-retry-failed'),

            // Progress
            progressSection: document.getElementById('progress-section'),
            progressBar: document.getElementById('progress-bar'),
            progressText: document.getElementById('progress-text'),
            statCompleted: document.getElementById('stat-completed'),
            statElapsed: document.getElementById('stat-elapsed'),
            statRemaining: document.getElementById('stat-remaining'),
            statusMessage: document.getElementById('status-message'),

            // Errors
            errorsSection: document.getElementById('errors-section'),
            errorsList: document.getElementById('errors-list'),

            // Preview
            previewSection: document.getElementById('preview-section'),
            previewCount: document.getElementById('preview-count'),
            previewTbody: document.getElementById('preview-tbody')
        };
    }

    // ==================== UI Functions ====================

    function switchTab(mode) {
        state.mode = mode;

        elements.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        elements.rangePanel.classList.toggle('hidden', mode !== 'range');
        elements.listPanel.classList.toggle('hidden', mode !== 'list');

        updateMatchCount();
    }

    function updateMatchCount() {
        if (state.mode === 'range') {
            const start = parseInt(elements.startId.value) || 0;
            const end = parseInt(elements.endId.value) || 0;
            const count = end >= start ? end - start + 1 : 0;
            elements.rangeCount.textContent = `共 ${count} 场比赛`;
        } else {
            const ids = parseIdList(elements.idList.value);
            elements.listCount.textContent = `共 ${ids.length} 场比赛`;
        }
    }

    function parseIdList(text) {
        if (!text) return [];

        return text
            .split(/[,\n\r]+/)
            .map(s => s.trim())
            .filter(s => s)
            .map(s => parseInt(s))
            .filter(n => !isNaN(n) && n > 0);
    }

    function getMatchIdsFromInput() {
        if (state.mode === 'range') {
            const start = parseInt(elements.startId.value) || 0;
            const end = parseInt(elements.endId.value) || 0;

            if (start <= 0 || end <= 0 || end < start) {
                alert('请输入有效的比赛ID范围');
                return null;
            }

            const ids = [];
            for (let i = start; i <= end; i++) {
                ids.push(i);
            }
            return ids;
        } else {
            const ids = parseIdList(elements.idList.value);
            if (ids.length === 0) {
                alert('请输入至少一个有效的比赛ID');
                return null;
            }
            return ids;
        }
    }

    function updateProgress() {
        const percent = state.totalMatches > 0
            ? Math.round((state.completedMatches / state.totalMatches) * 100)
            : 0;

        elements.progressBar.style.width = percent + '%';
        elements.progressText.textContent = percent + '%';
        elements.statCompleted.textContent = `${state.completedMatches} / ${state.totalMatches}`;

        // Calculate elapsed time
        if (state.startTime) {
            const elapsed = Date.now() - state.startTime;
            elements.statElapsed.textContent = formatTime(elapsed);

            // Estimate remaining time
            if (state.completedMatches > 0) {
                const avgTime = elapsed / state.completedMatches;
                const remaining = avgTime * (state.totalMatches - state.completedMatches);
                elements.statRemaining.textContent = formatTime(remaining);
            }
        }
    }

    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    function setStatus(message) {
        elements.statusMessage.textContent = message;
    }

    function showError(matchId, error) {
        state.failedMatches.push({ matchId, error: error.message || String(error) });

        elements.errorsSection.classList.remove('hidden');

        const errorItem = document.createElement('div');
        errorItem.className = 'error-item';
        errorItem.innerHTML = `
            <span>Match ID: ${matchId}</span>
            <span>${error.message || error}</span>
        `;
        elements.errorsList.appendChild(errorItem);
    }

    function updatePreview() {
        elements.previewSection.classList.toggle('hidden', state.collectedData.length === 0);
        elements.previewCount.textContent = `(${state.collectedData.length} 条)`;

        // Show last 10 entries
        const recent = state.collectedData.slice(-10);
        elements.previewTbody.innerHTML = '';

        recent.forEach(match => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${match.matchId}</td>
                <td>${match.matchDate || '-'}</td>
                <td>${match.homeTeamName || '-'}</td>
                <td>${match.homeGoals ?? '-'} : ${match.awayGoals ?? '-'}</td>
                <td>${match.awayTeamName || '-'}</td>
                <td>${match.matchType || '-'}</td>
            `;
            elements.previewTbody.appendChild(row);
        });

        // Enable export button if we have data
        elements.btnExport.disabled = state.collectedData.length === 0;
    }

    function setButtonStates(running, paused) {
        elements.btnStart.disabled = running && !paused;
        elements.btnStart.querySelector('.btn-icon').textContent = paused ? '▶' : '▶';
        elements.btnStart.childNodes[1].textContent = paused ? ' 继续抓取' : ' 开始抓取';

        elements.btnPause.disabled = !running || paused;
        elements.btnExport.disabled = state.collectedData.length === 0;
    }

    // ==================== Data Storage ====================

    async function saveState() {
        try {
            const stateToSave = {
                matchIds: state.matchIds,
                currentIndex: state.currentIndex,
                completedMatches: state.completedMatches,
                failedMatches: state.failedMatches,
                options: state.options,
                interval: state.interval
            };
            await chrome.storage.local.set({ [STORAGE_STATE_KEY]: stateToSave });
        } catch (e) {
            console.error('Failed to save state:', e);
        }
    }

    async function saveData() {
        try {
            await chrome.storage.local.set({ [STORAGE_KEY]: state.collectedData });
        } catch (e) {
            console.error('Failed to save data:', e);
        }
    }

    async function loadSavedData() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEY, STORAGE_STATE_KEY]);

            if (result[STORAGE_KEY]) {
                state.collectedData = result[STORAGE_KEY];
                updatePreview();
            }

            if (result[STORAGE_STATE_KEY]) {
                const savedState = result[STORAGE_STATE_KEY];
                // Only restore if there's incomplete work
                if (savedState.currentIndex < savedState.matchIds?.length) {
                    const resume = confirm(
                        `发现未完成的抓取任务 (${savedState.currentIndex}/${savedState.matchIds.length})。\n是否继续？`
                    );
                    if (resume) {
                        state.matchIds = savedState.matchIds;
                        state.currentIndex = savedState.currentIndex;
                        state.completedMatches = savedState.completedMatches || 0;
                        state.failedMatches = savedState.failedMatches || [];
                        state.options = savedState.options || state.options;
                        // Restore checkbox states from saved options
                        if (elements.optUseChpp && state.options.useChppApi !== undefined) {
                            elements.optUseChpp.checked = state.options.useChppApi;
                        }
                        if (elements.optEvents && state.options.includeEvents !== undefined) {
                            elements.optEvents.checked = state.options.includeEvents;
                        }
                        state.interval = savedState.interval || state.interval;
                        state.totalMatches = state.matchIds.length;

                        elements.progressSection.classList.remove('hidden');
                        updateProgress();
                        setButtonStates(false, true);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load saved data:', e);
        }
    }

    async function clearAllData() {
        console.log('[DEBUG] clearAllData called - executing clear...');

        state.collectedData = [];
        state.failedMatches = [];
        state.matchIds = [];
        state.currentIndex = 0;
        state.completedMatches = 0;
        state.totalMatches = 0;
        state.isRunning = false;
        state.isPaused = false;

        await chrome.storage.local.remove([STORAGE_KEY, STORAGE_STATE_KEY]);

        elements.progressSection.classList.add('hidden');
        elements.errorsSection.classList.add('hidden');
        elements.errorsList.innerHTML = '';
        elements.previewSection.classList.add('hidden');
        elements.previewTbody.innerHTML = '';
        elements.previewCount.textContent = '(0 条)';

        // Also hide export container
        const exportContainer = document.getElementById('export-data-container');
        if (exportContainer) {
            exportContainer.style.display = 'none';
        }
        const exportTextarea = document.getElementById('export-data-textarea');
        if (exportTextarea) {
            exportTextarea.value = '';
        }

        setButtonStates(false, false);
        setStatus('准备就绪');

        alert('数据已清除！');
    }

    // ==================== Scraping Logic ====================

    async function startScraping() {
        // If paused, resume
        if (state.isPaused) {
            state.isPaused = false;
            state.isRunning = true;
            setButtonStates(true, false);
            processNextMatch();
            return;
        }

        // Get match IDs
        const ids = getMatchIdsFromInput();
        if (!ids) return;

        // Get options
        state.options.includeEvents = elements.optEvents.checked;
        state.options.includeTimeline = elements.optTimeline.checked;
        state.options.includeRatings = elements.optRatings.checked;
        state.options.useChppApi = elements.optUseChpp.checked;
        state.interval = parseFloat(elements.intervalInput.value) * 1000 || 2000;

        // Initialize state
        state.matchIds = ids;
        state.totalMatches = ids.length;
        state.currentIndex = 0;
        state.completedMatches = 0;
        state.failedMatches = [];
        state.isRunning = true;
        state.isPaused = false;
        state.startTime = Date.now();

        // Show progress section
        elements.progressSection.classList.remove('hidden');
        elements.errorsSection.classList.add('hidden');
        elements.errorsList.innerHTML = '';

        setButtonStates(true, false);
        updateProgress();

        // Save state and start processing
        await saveState();
        processNextMatch();
    }

    function pauseScraping() {
        state.isPaused = true;
        state.isRunning = false;
        setButtonStates(true, true);
        setStatus('已暂停');
        saveState();
    }

    async function processNextMatch() {
        if (!state.isRunning || state.isPaused) {
            return;
        }

        if (state.currentIndex >= state.matchIds.length) {
            // Done!
            state.isRunning = false;
            setButtonStates(false, false);
            setStatus(`完成！共抓取 ${state.completedMatches} 场比赛`);
            await saveData();
            await chrome.storage.local.remove(STORAGE_STATE_KEY);
            return;
        }

        const matchId = state.matchIds[state.currentIndex];
        setStatus(`正在抓取 matchID=${matchId}...`);

        try {
            const matchData = await scrapeMatch(matchId);
            state.collectedData.push(matchData);
            state.completedMatches++;
            updatePreview();

            // Save every 10 matches
            if (state.completedMatches % 10 === 0) {
                await saveData();
            }
        } catch (error) {
            console.error(`Failed to scrape match ${matchId}:`, error);
            showError(matchId, error);
        }

        state.currentIndex++;
        updateProgress();
        await saveState();

        // Schedule next match with delay
        setTimeout(() => processNextMatch(), state.interval);
    }

    async function scrapeMatch(matchId) {
        const url = `https://www.hattrick.org/zh/Club/Matches/Match.aspx?matchID=${matchId}`;

        // Use background script to fetch and parse the page
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    type: 'SCRAPE_MATCH',
                    matchId: matchId,
                    url: url,
                    options: state.options
                },
                response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.error) {
                        reject(new Error(response.error));
                    } else if (response && response.data) {
                        resolve(response.data);
                    } else {
                        reject(new Error('未知错误'));
                    }
                }
            );
        });
    }

    async function retryFailed() {
        if (state.failedMatches.length === 0) return;

        const failedIds = state.failedMatches.map(f => f.matchId);
        state.failedMatches = [];
        elements.errorsList.innerHTML = '';
        elements.errorsSection.classList.add('hidden');

        // Add failed IDs back to queue
        state.matchIds = failedIds;
        state.totalMatches = failedIds.length;
        state.currentIndex = 0;
        state.completedMatches = 0;
        state.isRunning = true;
        state.isPaused = false;
        state.startTime = Date.now();

        setButtonStates(true, false);
        updateProgress();
        processNextMatch();
    }

    function exportData() {
        if (state.collectedData.length === 0) {
            alert('没有数据可导出');
            return;
        }

        // Build CSV manually
        const headers = ['matchId', 'matchDate', 'homeTeamName', 'homeGoals', 'awayGoals', 'awayTeamName', 'matchType', 'events'];
        const rows = [headers.join(',')];

        state.collectedData.forEach(match => {
            const eventsStr = match.events ? JSON.stringify(match.events).replace(/"/g, '""') : '';
            const row = [
                match.matchId || '',
                match.matchDate || '',
                (match.homeTeamName || '').replace(/,/g, ' '),
                match.homeGoals ?? '',
                match.awayGoals ?? '',
                (match.awayTeamName || '').replace(/,/g, ' '),
                match.matchType || '',
                '"' + eventsStr + '"'
            ];
            rows.push(row.join(','));
        });

        const csvContent = '\uFEFF' + rows.join('\r\n'); // BOM for Excel
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = 'hattrick_matches_' + dateStr + '.csv';

        // Send to background worker for download
        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            content: csvContent,
            filename: filename,
            mimeType: 'text/csv;charset=utf-8'
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Download error:', chrome.runtime.lastError);
                alert('下载失败: ' + chrome.runtime.lastError.message);
            } else if (response && response.error) {
                console.error('Download error:', response.error);
                alert('下载失败: ' + response.error);
            } else {
                console.log('CSV 下载成功');
            }
        });
    }

    // Export as JSON - copy to clipboard
    function copyJsonToClipboard() {
        if (state.collectedData.length === 0) {
            alert('没有数据可复制');
            return;
        }

        const jsonStr = JSON.stringify(state.collectedData, null, 2);
        navigator.clipboard.writeText(jsonStr).then(() => {
            alert('JSON 数据已复制到剪贴板！');
        }).catch(err => {
            console.error('复制失败:', err);
            // Fallback: show in console
            console.log('=== Match Data JSON ===');
            console.log(jsonStr);
            alert('复制失败，数据已输出到控制台 (F12 查看)');
        });
    }

    // Export as JSON file via background worker
    function exportJsonFile() {
        if (state.collectedData.length === 0) {
            alert('没有数据可导出');
            return;
        }

        const jsonStr = JSON.stringify(state.collectedData, null, 2);
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = 'hattrick_matches_' + dateStr + '.json';

        // Send to background worker for download
        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            content: jsonStr,
            filename: filename,
            mimeType: 'application/json'
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Download error:', chrome.runtime.lastError);
                alert('下载失败: ' + chrome.runtime.lastError.message);
            } else if (response && response.error) {
                console.error('Download error:', response.error);
                alert('下载失败: ' + response.error);
            } else {
                console.log('下载成功, ID:', response?.downloadId);
            }
        });
    }

    // Export as CSV file via background worker
    function exportCsvFile() {
        if (state.collectedData.length === 0) {
            alert('没有数据可导出');
            return;
        }

        // Build CSV manually
        const headers = ['matchId', 'matchDate', 'homeTeamName', 'homeGoals', 'awayGoals', 'awayTeamName', 'matchType', 'events'];
        const rows = [headers.join(',')];

        state.collectedData.forEach(match => {
            const eventsStr = match.events ? JSON.stringify(match.events).replace(/"/g, '""') : '';
            const row = [
                match.matchId || '',
                match.matchDate || '',
                (match.homeTeamName || '').replace(/,/g, ' '),
                match.homeGoals ?? '',
                match.awayGoals ?? '',
                (match.awayTeamName || '').replace(/,/g, ' '),
                match.matchType || '',
                '"' + eventsStr + '"'
            ];
            rows.push(row.join(','));
        });

        const csvContent = '\uFEFF' + rows.join('\r\n'); // BOM for Excel
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = 'hattrick_matches_' + dateStr + '.csv';

        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            content: csvContent,
            filename: filename,
            mimeType: 'text/csv;charset=utf-8'
        }, (response) => {
            if (chrome.runtime.lastError || (response && response.error)) {
                alert('下载失败');
            }
        });
    }

    // Make functions globally accessible for console debugging
    window.scraperDebug = {
        getData: () => state.collectedData,
        copyJson: copyJsonToClipboard,
        exportJson: exportJsonFile,
        exportCsv: exportCsvFile
    };

    // ==================== Event Listeners ====================

    function initEventListeners() {
        // Tab switching
        elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.mode));
        });

        // Input changes for count update
        elements.startId.addEventListener('input', updateMatchCount);
        elements.endId.addEventListener('input', updateMatchCount);
        elements.idList.addEventListener('input', updateMatchCount);

        // Button clicks
        elements.btnStart.addEventListener('click', startScraping);
        elements.btnPause.addEventListener('click', pauseScraping);
        elements.btnExport.addEventListener('click', exportData);
        elements.btnClear.addEventListener('click', clearAllData);
        elements.btnRetryFailed.addEventListener('click', retryFailed);

        // New data export buttons
        const btnShowJson = document.getElementById('btn-show-json');
        const btnCopyData = document.getElementById('btn-copy-data');
        const exportContainer = document.getElementById('export-data-container');
        const exportTextarea = document.getElementById('export-data-textarea');

        // Save file directly using File System Access API
        const btnSaveFile = document.getElementById('btn-save-file');
        if (btnSaveFile) {
            btnSaveFile.addEventListener('click', async () => {
                if (state.collectedData.length === 0) {
                    alert('没有数据可保存');
                    return;
                }

                try {
                    const jsonStr = JSON.stringify(state.collectedData, null, 2);
                    const now = new Date();
                    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

                    // Check if File System Access API is available
                    if (typeof window.showSaveFilePicker === 'function') {
                        const handle = await window.showSaveFilePicker({
                            suggestedName: `hattrick_matches_${dateStr}.json`,
                            types: [{
                                description: 'JSON Files',
                                accept: { 'application/json': ['.json'] }
                            }]
                        });
                        const writable = await handle.createWritable();
                        await writable.write(jsonStr);
                        await writable.close();
                        alert('文件保存成功！');
                    } else {
                        // Fallback: create download link
                        const blob = new Blob([jsonStr], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `hattrick_matches_${dateStr}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        console.error('Save error:', e);
                        alert('保存失败: ' + e.message);
                    }
                }
            });
        }

        if (btnShowJson) {
            btnShowJson.addEventListener('click', () => {
                if (state.collectedData.length === 0) {
                    alert('没有数据可显示');
                    return;
                }
                const jsonStr = JSON.stringify(state.collectedData, null, 2);
                exportTextarea.value = jsonStr;
                exportContainer.style.display = 'block';
                exportTextarea.focus();
                exportTextarea.select();
            });
        }

        if (btnCopyData) {
            btnCopyData.addEventListener('click', () => {
                if (state.collectedData.length === 0) {
                    alert('没有数据可复制');
                    return;
                }
                const jsonStr = JSON.stringify(state.collectedData, null, 2);

                // Show in textarea first
                exportTextarea.value = jsonStr;
                exportContainer.style.display = 'block';

                // Select all and try to copy
                exportTextarea.focus();
                exportTextarea.select();

                try {
                    document.execCommand('copy');
                    alert('已复制到剪贴板！请打开记事本粘贴保存');
                } catch (e) {
                    alert('请手动按 Ctrl+A 全选，然后 Ctrl+C 复制');
                }
            });
        }
    }

    // ==================== Initialization ====================

    async function init() {
        initElements();
        initEventListeners();
        await loadSavedData();

        console.log('Hattrick Match Data Scraper initialized');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
