// ============================================================
//  ルールベース日本語テキスト印象分析 (4軸)
//  weight(重量感), softness(柔剛), dynamism(動静), elaborate(装飾性)
//  フォールバック兼オーバーレイ表示用
// ============================================================

const ImpressionAnalyzer = (() => {

    // 軸: weight(力強い+/繊細-), softness(ソフト+/シャープ-),
    //     dynamism(躍動的+/静謐-), elaborate(装飾的+/簡素-)

    // -------------------------------------------------------
    //  キーワード辞書
    // -------------------------------------------------------
    const KEYWORDS = [
        // 重量感 (weight): 力強い+ / 繊細-
        { w: /戦|闘|力|強|勝|怒|叫|撃|破壊|爆|激|猛|嵐|雷|炎|鋼|鉄|魂|覚悟|重|厚|巨|大/, s: { weight: 1.5 } },
        { w: /優|美|繊細|儚|静|花|風|光|透|淡|微|柔|夢|泡|霞|露|薄|軽|細/, s: { weight: -1.5 } },

        // 柔剛 (softness): ソフト+ / シャープ-
        { w: /ふわ|もこ|やわ|ゆる|ぷに|とろ|まろ|ほん|ぬく|あたた|やさ|丸|円|雲|綿|羽/, s: { softness: 1.5 } },
        { w: /規則|法|制度|鋭|刃|石|岩|金属|氷|角|直線|幾何|鋼|硬|厳|尖/, s: { softness: -1.5 } },

        // 動静 (dynamism): 躍動的+ / 静謐-
        { w: /走|飛|跳|踊|動|速|急|衝|突|爆発|疾|駆|暴|奔|風|波|炎|熱|叫/, s: { dynamism: 1.5 } },
        { w: /静|穏|安|眠|休|黙|沈|凪|止|寂|閑|落ち着|佇|瞑|禅|沈黙/, s: { dynamism: -1.5 } },

        // 装飾性 (elaborate): 装飾的+ / 簡素-
        { w: /華|飾|彩|艶|絢|豪|麗|優美|壮|典|格|品|雅|洗練|美麗|絢爛/, s: { elaborate: 1.5 } },
        { w: /素|朴|質素|簡|潔|無|空|白|淡|地味|控|慎|抑|ミニマル/, s: { elaborate: -1.5 } },

        // 複合的な印象語
        { w: /宣言|革命|正義|自由|誓/, s: { weight: 1, dynamism: 0.5 } },
        { w: /ほのぼの|のんびり|まったり|ゆったり/, s: { weight: -1, softness: 1, dynamism: -1 } },
        { w: /おしゃれ|スタイリッシュ|クール|モダン/, s: { softness: -0.5, elaborate: 0.5 } },
        { w: /レトロ|ヴィンテージ|クラシック|アンティーク/, s: { elaborate: 1.5, dynamism: -0.5 } },
        { w: /拝啓|敬具|御|貴|謹|候|殿|各位|弊社/, s: { weight: 0.5, softness: -0.5, elaborate: 0.5 } },
        { w: /やば|まじ|うける|わら|ぴえん|草|笑|ww|ｗ/, s: { weight: -0.5, softness: 0.5, dynamism: 0.5, elaborate: -1 } },
    ];

    // -------------------------------------------------------
    //  文体分析
    // -------------------------------------------------------
    function analyzeStyle(text) {
        const scores = { weight: 0, softness: 0, dynamism: 0, elaborate: 0 };
        if (!text || text.length === 0) return scores;

        const len = text.length;

        // --- 文字種比率 ---
        let kanjiCount = 0, hiraCount = 0, kataCount = 0, latinCount = 0;
        for (const ch of text) {
            const code = ch.codePointAt(0);
            if (code >= 0x4E00 && code <= 0x9FFF) kanjiCount++;
            else if (code >= 0x3040 && code <= 0x309F) hiraCount++;
            else if (code >= 0x30A0 && code <= 0x30FF) kataCount++;
            else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A) ||
                     (code >= 0xFF21 && code <= 0xFF3A) || (code >= 0xFF41 && code <= 0xFF5A)) latinCount++;
        }

        const kanjiRatio = kanjiCount / len;
        const kataRatio  = kataCount / len;
        const hiraRatio  = hiraCount / len;

        // 漢字が多い → 重い、シャープ、装飾的
        if (kanjiRatio > 0.4) {
            scores.weight    += 0.8;
            scores.softness  -= 0.5;
            scores.elaborate += 0.5;
        } else if (kanjiRatio < 0.15) {
            scores.weight -= 0.5;
        }

        // ひらがなが多い → 軽い、ソフト
        if (hiraRatio > 0.6) {
            scores.weight   -= 0.8;
            scores.softness += 1.0;
        }

        // カタカナが多い → シャープ、動的
        if (kataRatio > 0.3) {
            scores.softness -= 0.8;
            scores.dynamism += 0.5;
        }

        // --- 文末表現 ---
        const sentences = text.split(/[。．.\n]+/).filter(s => s.trim());

        // --- 文長 ---
        const avgLen = sentences.length > 0 ? len / sentences.length : len;
        if (avgLen > 40) {
            scores.weight    += 0.3;
            scores.elaborate += 0.5;
        } else if (avgLen < 8) {
            scores.weight    -= 0.3;
            scores.dynamism  += 0.3;
            scores.elaborate -= 0.3;
        }

        // --- 感嘆符・繰り返し ---
        const excl = (text.match(/[！!]{1,}/g) || []).length;
        if (excl > 1) { scores.weight += 0.3; scores.dynamism += 0.5; }

        // 「w」「草」の多用
        const wCount = (text.match(/[wｗ]{2,}|草/g) || []).length;
        if (wCount > 0) { scores.weight -= 0.5; scores.elaborate -= 0.8; scores.dynamism += 0.3; }

        return scores;
    }

    // -------------------------------------------------------
    //  キーワードマッチング
    // -------------------------------------------------------
    function analyzeKeywords(text) {
        const scores = { weight: 0, softness: 0, dynamism: 0, elaborate: 0 };
        if (!text) return scores;

        for (const entry of KEYWORDS) {
            const matches = text.match(entry.w);
            if (matches) {
                const w = Math.min(matches.length, 3);
                for (const [axis, val] of Object.entries(entry.s)) {
                    scores[axis] += val * w * 0.5;
                }
            }
        }
        return scores;
    }

    // -------------------------------------------------------
    //  統合: テキスト → 印象スコア (-2 ~ +2)
    // -------------------------------------------------------
    function analyze(text) {
        const kw = analyzeKeywords(text);
        const st = analyzeStyle(text);

        const result = {};
        for (const axis of ['weight', 'softness', 'dynamism', 'elaborate']) {
            const raw = kw[axis] + st[axis];
            result[axis] = Math.max(-2, Math.min(2, Math.round(raw * 4) / 4));
        }
        return result;
    }

    return { analyze, analyzeKeywords, analyzeStyle };
})();
