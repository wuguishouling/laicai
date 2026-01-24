/**
 * csv-exporter.js
 * CSV export utility for match data (standalone, no Foxtrick dependency)
 * @author Foxtrick Scraper
 */

'use strict';

// Create standalone CSVExporter object
const CSVExporter = {

    /**
     * Escape a value for CSV format
     * @param {any} value - Value to escape
     * @returns {string} Escaped CSV value
     */
    escapeValue: function (value) {
        if (value === null || value === undefined) {
            return '';
        }

        let str = String(value);

        // If value contains comma, newline, or quote, wrap in quotes
        if (str.includes(',') || str.includes('\n') || str.includes('"') || str.includes('\r')) {
            // Escape quotes by doubling them
            str = str.replace(/"/g, '""');
            return '"' + str + '"';
        }

        return str;
    },

    /**
     * Convert array of objects to CSV string
     * @param {Object[]} data - Array of data objects
     * @param {string[]} [columns] - Optional column order
     * @param {Object} [columnLabels] - Optional column label mapping
     * @returns {string} CSV formatted string
     */
    toCSV: function (data, columns, columnLabels) {
        if (!data || data.length === 0) {
            return '';
        }

        // Get columns from first object if not provided
        if (!columns) {
            columns = Object.keys(data[0]);
        }

        // Build header row
        let headers = columns.map(col => {
            let label = columnLabels && columnLabels[col] ? columnLabels[col] : col;
            return this.escapeValue(label);
        });

        let rows = [headers.join(',')];

        // Build data rows
        data.forEach(item => {
            let row = columns.map(col => {
                let value = item[col];

                // Handle nested objects/arrays by converting to JSON
                if (typeof value === 'object' && value !== null) {
                    value = JSON.stringify(value);
                }

                return this.escapeValue(value);
            });
            rows.push(row.join(','));
        });

        return rows.join('\r\n');
    },

    /**
     * Generate column definitions for match data
     * @returns {{columns: string[], labels: Object}}
     */
    getMatchDataColumns: function () {
        return {
            columns: [
                'matchId',
                'matchDate',
                'homeTeamId',
                'homeTeamName',
                'awayTeamId',
                'awayTeamName',
                'homeGoals',
                'awayGoals',
                'matchType',
                'homeMidfield',
                'awayMidfield',
                'homeRightDefense',
                'homeMiddleDefense',
                'homeLeftDefense',
                'awayRightDefense',
                'awayMiddleDefense',
                'awayLeftDefense',
                'homeRightAttack',
                'homeMiddleAttack',
                'homeLeftAttack',
                'awayRightAttack',
                'awayMiddleAttack',
                'awayLeftAttack',
                'homeTactics',
                'homeTacticsLevel',
                'awayTactics',
                'awayTacticsLevel',
                'timelineRatings',
                'events'
            ],
            labels: {
                matchId: 'Match ID',
                matchDate: '比赛日期',
                homeTeamId: '主队ID',
                homeTeamName: '主队名称',
                awayTeamId: '客队ID',
                awayTeamName: '客队名称',
                homeGoals: '主队进球',
                awayGoals: '客队进球',
                matchType: '比赛类型',
                homeMidfield: '主队中场',
                awayMidfield: '客队中场',
                homeRightDefense: '主队右防',
                homeMiddleDefense: '主队中防',
                homeLeftDefense: '主队左防',
                awayRightDefense: '客队右防',
                awayMiddleDefense: '客队中防',
                awayLeftDefense: '客队左防',
                homeRightAttack: '主队右攻',
                homeMiddleAttack: '主队中攻',
                homeLeftAttack: '主队左攻',
                awayRightAttack: '客队右攻',
                awayMiddleAttack: '客队中攻',
                awayLeftAttack: '客队左攻',
                homeTactics: '主队战术',
                homeTacticsLevel: '主队战术等级',
                awayTactics: '客队战术',
                awayTacticsLevel: '客队战术等级',
                timelineRatings: '时间线评级',
                events: '比赛事件'
            }
        };
    },

    /**
     * Download CSV data as a file
     * @param {string} csvContent - CSV string content
     * @param {string} filename - Filename without extension
     */
    download: function (csvContent, filename) {
        // Add BOM for Excel UTF-8 compatibility
        const BOM = '\uFEFF';
        const fullContent = BOM + csvContent;

        // Try using chrome.downloads API first (more reliable in extension context)
        if (typeof chrome !== 'undefined' && chrome.downloads) {
            const blob = new Blob([fullContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            chrome.downloads.download({
                url: url,
                filename: filename + '.csv',
                saveAs: true
            }, (downloadId) => {
                // Clean up blob URL after a delay
                setTimeout(() => URL.revokeObjectURL(url), 10000);

                if (chrome.runtime.lastError) {
                    console.error('Download error:', chrome.runtime.lastError);
                    // Fallback to link method
                    this.downloadViaLink(fullContent, filename);
                }
            });
        } else {
            // Fallback for non-extension contexts
            this.downloadViaLink(fullContent, filename);
        }
    },

    /**
     * Fallback download method using data URI (more reliable in extension context)
     * @param {string} content - File content
     * @param {string} filename - Filename without extension
     */
    downloadViaLink: function (content, filename) {
        // Use data URI instead of blob URL for better extension compatibility
        const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
        const link = document.createElement('a');

        link.setAttribute('href', dataUri);
        link.setAttribute('download', filename + '.csv');
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /**
     * Export match data to CSV and trigger download
     * @param {Object[]} matchData - Array of match data objects
     * @param {string} [filename] - Optional filename
     * @returns {boolean} - Whether export was successful
     */
    exportMatchData: function (matchData, filename) {
        if (!matchData || matchData.length === 0) {
            console.warn('No data to export');
            return false;
        }

        const { columns, labels } = this.getMatchDataColumns();
        const csvContent = this.toCSV(matchData, columns, labels);

        if (!filename) {
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
            filename = 'hattrick_matches_' + dateStr;
        }

        this.download(csvContent, filename);
        return true;
    }
};

// Make it globally available
window.CSVExporter = CSVExporter;
