/**
 * Match Data Verification Script
 * 自动化验证抓取数据的正确性
 */

// SE类型列表
const SE_TYPES = [
    105, 106, 107, 108, 109, 115, 116, 117, 118, 119, 125, 135, 136, 137, 138, 139, 187, 190,
    205, 206, 207, 208, 209, 215, 216, 217, 218, 219, 225, 235, 236, 237, 239, 287, 288, 289, 290,
    301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311
];

// 进攻类事件
const ATTACK_EVENTS = [
    100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
    120, 121, 122, 123, 124, 125,
    130, 131, 132, 133, 134, 135, 136, 137, 138, 139,
    140, 141, 142, 143,
    150, 151, 152, 153, 154, 160, 161, 162, 163, 164,
    170, 171, 172, 173, 174, 180, 181, 182, 183, 184, 185, 186, 187, 190,
    200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
    210, 211, 212, 213, 214, 215, 216, 217, 218, 219,
    220, 221, 222, 223, 224, 225,
    230, 231, 232, 233, 234, 235, 236, 237, 239,
    240, 241, 242, 243, 250, 251, 252, 253, 254,
    260, 261, 262, 263, 264, 270, 271, 272, 273, 274,
    280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290
];

/**
 * 验证单场比赛数据
 * @param {Object} matchData - 比赛数据
 * @returns {Object} - { valid: boolean, errors: string[], stats: Object }
 */
function verifyMatchData(matchData) {
    const errors = [];
    const stats = {
        totalEvents: 0,
        seEvents: 0,
        attackEvents: 0,
        eventsWithRT: 0
    };

    // 1. 基础数据完整性检查
    if (!matchData.matchId) errors.push("缺少matchId");
    if (!matchData.homeTeamName) errors.push("缺少主队名称");
    if (matchData.homeGoals === null) errors.push("缺少主队比分");
    if (matchData.awayGoals === null) errors.push("缺少客队比分");

    // 检查评级数据
    const ratingFields = [
        'homeMidfield', 'awayMidfield',
        'homeRightDefense', 'homeMiddleDefense', 'homeLeftDefense',
        'awayRightDefense', 'awayMiddleDefense', 'awayLeftDefense',
        'homeRightAttack', 'homeMiddleAttack', 'homeLeftAttack',
        'awayRightAttack', 'awayMiddleAttack', 'awayLeftAttack'
    ];
    const missingRatings = ratingFields.filter(f => matchData[f] === null);
    if (missingRatings.length > 0) {
        errors.push(`缺少评级: ${missingRatings.join(', ')}`);
    }

    // 2. 事件数据验证
    if (!matchData.events || matchData.events.length === 0) {
        errors.push("无事件数据");
    } else {
        stats.totalEvents = matchData.events.length;

        matchData.events.forEach((event, i) => {
            const eventTypeNum = parseInt((event.eventType || '').match(/\d+/)?.[0] || '0');

            // 2.1 SE标记检查
            const expectedIsSE = SE_TYPES.includes(eventTypeNum);
            if (event.isSE !== expectedIsSE) {
                errors.push(`事件${i} isSE标记错误: eventType=${eventTypeNum}, 实际=${event.isSE}, 预期=${expectedIsSE}`);
            }
            if (event.isSE) stats.seEvents++;

            // 2.2 进攻事件RT计算验证
            if (ATTACK_EVENTS.includes(eventTypeNum)) {
                stats.attackEvents++;

                // 检查是否有RT数据
                if (event.attackRating && event.defenseRating) {
                    stats.eventsWithRT++;

                    // 验证ratio计算
                    const expectedRatio = event.attackRating / (event.attackRating + event.defenseRating);
                    if (Math.abs(event.ratio - expectedRatio) > 0.001) {
                        errors.push(`事件${i} ratio计算错误: 实际=${event.ratio}, 预期=${expectedRatio.toFixed(4)}`);
                    }

                    // 验证scoringChance计算
                    const expectedChance = Math.tanh(6.9 * (expectedRatio - 0.51)) * 0.455 + 0.46;
                    if (Math.abs(event.scoringChance - expectedChance) > 0.001) {
                        errors.push(`事件${i} scoringChance计算错误: 实际=${event.scoringChance}, 预期=${expectedChance.toFixed(4)}`);
                    }
                }

                // 2.3 进攻方向检查
                const suffix = eventTypeNum % 10;
                const directionMap = { 0: 'set_piece', 1: 'center', 2: 'left', 3: 'right', 4: 'penalty' };
                const expectedDir = directionMap[suffix] || 'special';
                if (event.attackDirection && event.attackDirection !== expectedDir) {
                    errors.push(`事件${i} 方向错误: 实际=${event.attackDirection}, 预期=${expectedDir}`);
                }
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors: errors,
        stats: stats
    };
}

/**
 * 批量验证多场比赛
 * @param {Array} matches - 比赛数据数组
 * @returns {Object} - 验证结果汇总
 */
function verifyMatches(matches) {
    const results = {
        total: matches.length,
        valid: 0,
        invalid: 0,
        errors: [],
        totalStats: {
            totalEvents: 0,
            seEvents: 0,
            attackEvents: 0,
            eventsWithRT: 0
        }
    };

    matches.forEach((match, idx) => {
        const result = verifyMatchData(match);
        if (result.valid) {
            results.valid++;
        } else {
            results.invalid++;
            results.errors.push({
                matchId: match.matchId,
                index: idx,
                errors: result.errors
            });
        }

        // 累计统计
        results.totalStats.totalEvents += result.stats.totalEvents;
        results.totalStats.seEvents += result.stats.seEvents;
        results.totalStats.attackEvents += result.stats.attackEvents;
        results.totalStats.eventsWithRT += result.stats.eventsWithRT;
    });

    return results;
}

/**
 * 打印验证报告
 * @param {Object} results - 验证结果
 */
function printReport(results) {
    console.log('\n========== 验证报告 ==========');
    console.log(`总比赛数: ${results.total}`);
    console.log(`✅ 通过: ${results.valid}`);
    console.log(`❌ 失败: ${results.invalid}`);
    console.log('\n--- 统计 ---');
    console.log(`总事件数: ${results.totalStats.totalEvents}`);
    console.log(`SE事件数: ${results.totalStats.seEvents}`);
    console.log(`进攻事件: ${results.totalStats.attackEvents}`);
    console.log(`带RT计算: ${results.totalStats.eventsWithRT}`);

    if (results.errors.length > 0) {
        console.log('\n--- 错误详情 ---');
        results.errors.forEach(err => {
            console.log(`\n比赛 ${err.matchId}:`);
            err.errors.forEach(e => console.log(`  - ${e}`));
        });
    }
    console.log('\n==============================');
}

// 导出函数（用于浏览器或Node.js环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { verifyMatchData, verifyMatches, printReport };
}

// 使用示例
// const matches = JSON.parse(localStorage.getItem('scrapedMatches') || '[]');
// const results = verifyMatches(matches);
// printReport(results);
