// ============================================================
//  タイポグラフィパラメーター推論エンジン
//  LLM直接推論 + Embedding k-NN フォールバック
// ============================================================

const ImpressionModel = (() => {

    const PARAM_KEYS = [
        'lineHeight', 'letterSpacing', 'strokeW', 'lineCap',
        'contrast', 'anchorPoints', 'linearize', 'cornerRadius',
        'twist', 'roughen'
    ];

    const LINECAP_MAP = { 'round': 0, 'butt': 1, 'square': 2 };
    const LINECAP_INV = ['round', 'butt', 'square'];

    function encodeParams(p) {
        return {
            lineHeight: p.lineHeight ?? 1.3,
            letterSpacing: p.letterSpacing ?? 1.05,
            strokeW: p.strokeW ?? 2,
            lineCap: LINECAP_MAP[p.lineCap] ?? 0,
            contrast: p.contrast ?? 0,
            anchorPoints: p.anchorPoints ?? 0,
            linearize: p.linearize ?? 0,
            cornerRadius: p.cornerRadius ?? 0,
            twist: p.twist ?? 0,
            roughen: p.roughen ?? 0,
        };
    }

    // -------------------------------------------------------
    //  全サンプル統計情報
    // -------------------------------------------------------
    function computeStats(samples) {
        if (!samples || samples.length === 0) return null;
        const n = samples.length;
        const numKeys = ['lineHeight', 'letterSpacing', 'strokeW', 'contrast',
            'anchorPoints', 'cornerRadius', 'twist', 'roughen'];
        const stats = { n };

        for (const k of numKeys) {
            const vals = samples.map(s => {
                const v = s.params?.[k];
                return typeof v === 'number' ? v : null;
            }).filter(v => v !== null);
            if (vals.length === 0) continue;
            vals.sort((a, b) => a - b);
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
            const sd = Math.sqrt(variance);
            const median = vals.length % 2 === 0
                ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
                : vals[Math.floor(vals.length / 2)];
            const p10 = vals[Math.floor(vals.length * 0.1)];
            const p90 = vals[Math.floor(vals.length * 0.9)];
            stats[k] = {
                mean: +mean.toFixed(2),
                sd: +sd.toFixed(2),
                min: vals[0],
                max: vals[vals.length - 1],
                median: +median.toFixed(2),
                p10: +(p10 ?? vals[0]).toFixed(2),
                p90: +(p90 ?? vals[vals.length - 1]).toFixed(2),
            };
        }

        // lineCap 分布
        const capCounts = { round: 0, butt: 0, square: 0 };
        for (const s of samples) {
            const c = s.params?.lineCap || 'round';
            if (capCounts[c] !== undefined) capCounts[c]++;
        }
        stats.lineCap = capCounts;

        // linearize 割合
        const linOn = samples.filter(s => s.params?.linearize === 1).length;
        stats.linearize = { on: linOn, off: n - linOn, rate: +(linOn / n * 100).toFixed(0) };

        return stats;
    }

    function formatStatsForPrompt(stats) {
        if (!stats) return '';
        const lines = [`\n\n## ユーザーの全${stats.n}件の統計（パーソナライズ用）`];
        lines.push('各パラメーターの [平均 ± 標準偏差, 中央値, 10%-90%範囲]:');

        const numKeys = ['lineHeight', 'letterSpacing', 'strokeW', 'contrast',
            'anchorPoints', 'cornerRadius', 'twist', 'roughen'];
        const labels = {
            lineHeight: '行間', letterSpacing: '字間', strokeW: '線幅',
            contrast: 'コントラスト', anchorPoints: 'アンカーポイント',
            cornerRadius: '角丸', twist: 'ひねり', roughen: 'ラフ',
        };
        for (const k of numKeys) {
            const s = stats[k];
            if (!s) continue;
            lines.push(`- ${labels[k] || k}: ${s.mean}±${s.sd} (中央${s.median}, 10-90%: ${s.p10}〜${s.p90}, 範囲${s.min}〜${s.max})`);
        }

        const cap = stats.lineCap;
        lines.push(`- 端形状: round=${cap.round}, butt=${cap.butt}, square=${cap.square}`);
        lines.push(`- 直線化: ON=${stats.linearize.rate}% (${stats.linearize.on}/${stats.n})`);

        lines.push('');
        lines.push('→ ユーザーの好みの傾向として参考にしつつ、テキスト内容に応じて大胆に逸脱もすること');
        return lines.join('\n');
    }

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function clampParams(r) {
        r.lineHeight = clamp(r.lineHeight ?? 1.3, 1.0, 1.7);
        r.letterSpacing = clamp(r.letterSpacing ?? 1.05, 0.9, 1.35);
        r.strokeW = clamp(r.strokeW ?? 2, 0.1, 10);
        r.lineCap = ['round', 'butt', 'square'].includes(r.lineCap) ? r.lineCap : 'round';
        r.contrast = clamp(r.contrast ?? 0, -500, 500);
        r.anchorPoints = clamp(r.anchorPoints ?? 0, -30, 6);
        r.linearize = r.linearize ? 1 : 0;
        r.cornerRadius = clamp(r.cornerRadius ?? 0, 0, 40);
        r.twist = clamp(r.twist ?? 0, 0, 80);
        r.roughen = clamp(r.roughen ?? 0, 0, 50);
        return r;
    }

    // -------------------------------------------------------
    //  OpenAI API
    // -------------------------------------------------------
    const API_KEY_STORAGE = 'openai_api_key';
    const LLM_CACHE_KEY = 'llm_cache';
    const EMBED_CACHE_KEY = 'embedding_cache';
    const DISTILL_KEY = 'distilled_rules';

    function getApiKey() {
        return localStorage.getItem(API_KEY_STORAGE) || '';
    }
    function setApiKey(key) {
        localStorage.setItem(API_KEY_STORAGE, key.trim());
    }

    // -------------------------------------------------------
    //  蒸留 (Prompt Distillation)
    //  全サンプルをLLMに分析させてテキスト↔パラメーターの
    //  関係性ルールを言語化し、localStorage に保存
    // -------------------------------------------------------
    function loadDistilledRules() {
        try {
            const stored = JSON.parse(localStorage.getItem(DISTILL_KEY));
            if (stored && stored.rules && stored.sampleCount) return stored;
            return null;
        } catch { return null; }
    }

    function saveDistilledRules(data) {
        try { localStorage.setItem(DISTILL_KEY, JSON.stringify(data)); }
        catch { /* ignore */ }
    }

    function needsRedistill() {
        const stored = loadDistilledRules();
        if (!stored) return true;
        const currentCount = loadSamples().length;
        return currentCount >= stored.sampleCount + 20;
    }

    // -------------------------------------------------------
    //  k-NN構造解析（蒸留用）
    // -------------------------------------------------------
    function analyzeEmbeddingStructure(samples) {
        const withEmbed = samples.filter(s => s.embedding && s.embedding.length > 0);
        if (withEmbed.length < 5) return null;

        // --- 類似度行列を計算 ---
        const n = withEmbed.length;
        const simMatrix = [];
        for (let i = 0; i < n; i++) {
            simMatrix[i] = [];
            for (let j = 0; j < n; j++) {
                simMatrix[i][j] = i === j ? 1.0 : cosineSim(withEmbed[i].embedding, withEmbed[j].embedding);
            }
        }

        // --- 簡易クラスタリング（連結成分ベース、閾値 0.65） ---
        const CLUSTER_THRESH = 0.65;
        const visited = new Array(n).fill(false);
        const clusters = [];
        for (let i = 0; i < n; i++) {
            if (visited[i]) continue;
            const cluster = [i];
            visited[i] = true;
            const queue = [i];
            while (queue.length > 0) {
                const cur = queue.shift();
                for (let j = 0; j < n; j++) {
                    if (!visited[j] && simMatrix[cur][j] >= CLUSTER_THRESH) {
                        visited[j] = true;
                        cluster.push(j);
                        queue.push(j);
                    }
                }
            }
            if (cluster.length >= 2) clusters.push(cluster);
        }

        // クラスタごとの統計
        const numKeys = ['strokeW', 'contrast', 'anchorPoints', 'cornerRadius', 'twist', 'roughen'];
        const clusterSummaries = clusters.slice(0, 8).map((indices, ci) => {
            const texts = indices.slice(0, 5).map(i => `「${withEmbed[i].text}」`).join(', ');
            const more = indices.length > 5 ? ` 他${indices.length - 5}件` : '';
            const avgs = {};
            for (const k of numKeys) {
                const vals = indices.map(i => withEmbed[i].params?.[k]).filter(v => typeof v === 'number');
                avgs[k] = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '?';
            }
            const capCounts = { round: 0, butt: 0, square: 0 };
            indices.forEach(i => { const c = withEmbed[i].params?.lineCap; if (c) capCounts[c]++; });
            const topCap = Object.entries(capCounts).sort((a, b) => b[1] - a[1])[0][0];
            return `クラスタ${ci + 1}(${indices.length}件): ${texts}${more}\n` +
                `  → sW=${avgs.strokeW}, con=${avgs.contrast}, cr=${avgs.cornerRadius}, ` +
                `tw=${avgs.twist}, rg=${avgs.roughen}, cap=${topCap}`;
        });

        // --- 意味的に近いのにパラメータが大きく異なるペア ---
        const divergentPairs = [];
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (simMatrix[i][j] < 0.7) continue;
                const pi = encodeParams(withEmbed[i].params || {});
                const pj = encodeParams(withEmbed[j].params || {});
                let diff = 0;
                diff += Math.abs(pi.strokeW - pj.strokeW) / 10 * 3;
                diff += Math.abs(pi.contrast - pj.contrast) / 1000;
                diff += Math.abs(pi.twist - pj.twist) / 80;
                diff += Math.abs(pi.roughen - pj.roughen) / 50;
                diff += Math.abs(pi.cornerRadius - pj.cornerRadius) / 40;
                if (diff > 0.5) {
                    divergentPairs.push({
                        i, j, sim: simMatrix[i][j], diff,
                        textA: withEmbed[i].text, textB: withEmbed[j].text,
                        pA: withEmbed[i].params, pB: withEmbed[j].params
                    });
                }
            }
        }
        divergentPairs.sort((a, b) => b.diff - a.diff);
        const topDivergent = divergentPairs.slice(0, 6).map(d => {
            const pA = d.pA || {}, pB = d.pB || {};
            const diffs = [];
            if (Math.abs((pA.strokeW || 0) - (pB.strokeW || 0)) > 1) diffs.push(`sW:${pA.strokeW}→${pB.strokeW}`);
            if (Math.abs((pA.contrast || 0) - (pB.contrast || 0)) > 50) diffs.push(`con:${pA.contrast}→${pB.contrast}`);
            if (Math.abs((pA.twist || 0) - (pB.twist || 0)) > 5) diffs.push(`tw:${pA.twist}→${pB.twist}`);
            if (Math.abs((pA.roughen || 0) - (pB.roughen || 0)) > 5) diffs.push(`rg:${pA.roughen}→${pB.roughen}`);
            if (Math.abs((pA.cornerRadius || 0) - (pB.cornerRadius || 0)) > 5) diffs.push(`cr:${pA.cornerRadius}→${pB.cornerRadius}`);
            if (pA.lineCap !== pB.lineCap) diffs.push(`cap:${pA.lineCap}→${pB.lineCap}`);
            return `「${d.textA}」⇔「${d.textB}」(sim=${d.sim.toFixed(2)}) 差: ${diffs.join(', ')}`;
        });

        // --- k-NN予測の外れ値（LOO交差検証的） ---
        const outliers = [];
        for (let i = 0; i < n; i++) {
            const neighbors = [];
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                neighbors.push({ idx: j, sim: simMatrix[i][j] });
            }
            neighbors.sort((a, b) => b.sim - a.sim);
            const topN = neighbors.slice(0, 5).filter(nb => nb.sim >= 0.3);
            if (topN.length === 0) continue;

            const predicted = {};
            let wSum = 0;
            for (const k of numKeys) predicted[k] = 0;
            for (const nb of topN) {
                const w = nb.sim * nb.sim;
                const enc = encodeParams(withEmbed[nb.idx].params || {});
                for (const k of numKeys) predicted[k] += enc[k] * w;
                wSum += w;
            }
            if (wSum <= 0) continue;
            for (const k of numKeys) predicted[k] /= wSum;

            const actual = encodeParams(withEmbed[i].params || {});
            let totalErr = 0;
            const errs = {};
            for (const k of numKeys) {
                const range = k === 'contrast' ? 1000 : k === 'strokeW' ? 10 :
                    k === 'twist' ? 80 : k === 'roughen' ? 50 :
                    k === 'cornerRadius' ? 40 : k === 'anchorPoints' ? 36 : 1;
                const e = Math.abs(actual[k] - predicted[k]) / range;
                errs[k] = { actual: actual[k], predicted: predicted[k].toFixed(1), err: e };
                totalErr += e;
            }
            outliers.push({ idx: i, text: withEmbed[i].text, totalErr, errs, topSim: topN[0].sim });
        }
        outliers.sort((a, b) => b.totalErr - a.totalErr);
        const topOutliers = outliers.slice(0, 6).map(o => {
            const bigErrs = Object.entries(o.errs)
                .filter(([, v]) => v.err > 0.15)
                .map(([k, v]) => `${k}: 予測${v.predicted}→実際${v.actual}`)
                .join(', ');
            return `「${o.text}」(最近傍sim=${o.topSim.toFixed(2)}) ${bigErrs}`;
        });

        return {
            embeddedCount: n,
            clusterCount: clusters.length,
            clusterSummaries,
            divergentPairs: topDivergent,
            outliers: topOutliers,
        };
    }

    async function distillRules(onStatus) {
        const key = getApiKey();
        if (!key) return { error: 'APIキー未設定' };

        const samples = loadSamples();
        if (samples.length < 10) return { error: 'データが10件未満（蒸留には10件以上必要）' };

        if (onStatus) onStatus('⏳ 蒸留中… embedding構造を分析しています');

        // k-NN構造解析
        const structure = analyzeEmbeddingStructure(samples);

        if (onStatus) onStatus('⏳ 蒸留中… LLMで統合分析しています');

        const sampleLines = samples.map((s, i) => {
            const p = s.params || {};
            return `${i + 1}. 「${s.text}」→ sW=${p.strokeW}, cap=${p.lineCap}, con=${p.contrast}, ` +
                `ap=${p.anchorPoints}, lin=${p.linearize}, cr=${p.cornerRadius}, ` +
                `tw=${p.twist}, rg=${p.roughen}, lH=${p.lineHeight}, lS=${p.letterSpacing}`;
        }).join('\n');

        // k-NN構造情報をプロンプトに組み込む
        let structureSection = '';
        if (structure) {
            structureSection = `\n## k-NN embedding構造解析（コサイン類似度ベース）\n`;
            structureSection += `embedding付きサンプル: ${structure.embeddedCount}件, 検出クラスタ数: ${structure.clusterCount}\n`;

            if (structure.clusterSummaries.length > 0) {
                structureSection += `\n### 意味クラスタ（類似度≥0.65の連結成分）\n`;
                structureSection += structure.clusterSummaries.join('\n') + '\n';
                structureSection += '→ 各クラスタ内のパラメーター傾向に注目し、テーマ→パラメーターの法則を抽出せよ\n';
            }

            if (structure.divergentPairs.length > 0) {
                structureSection += `\n### 意味的に近いがパラメーターが異なるペア（ニュアンス境界）\n`;
                structureSection += structure.divergentPairs.join('\n') + '\n';
                structureSection += '→ これらは表面的には類似するが、ユーザーが質的に異なると判断した境界ケース。\n';
                structureSection += '   何がパラメーター分岐の決定因子かを特定せよ\n';
            }

            if (structure.outliers.length > 0) {
                structureSection += `\n### k-NN予測の外れ値（Leave-One-Out検証）\n`;
                structureSection += structure.outliers.join('\n') + '\n';
                structureSection += '→ k-NNが予測を大きく外すケース。LLMが補正すべきポイントを法則化せよ\n';
            }
        }

        const distillPrompt = `あなたはタイポグラフィ設計の分析専門家です。
以下はユーザーが様々なテキストに対して設定したストローク書体パラメーターの全記録と、
テキストembedding間の類似度に基づく構造分析結果です。

## パラメーター説明
- sW (strokeW, 0.1〜10): 線の太さ
- cap (lineCap): round=丸/butt=平/square=角
- con (contrast, -500〜500): 縦横太さ差（正=縦太、負=横太、0=均一）
- ap (anchorPoints, -30〜6): 負=簡略化、正=細分化
- lin (linearize, 0/1): 直線化
- cr (cornerRadius, 0〜40): 角の丸み
- tw (twist, 0〜80): ランダムひねり
- rg (roughen, 0〜50): ラフ質感
- lH (lineHeight, 1.0〜1.7): 行間
- lS (letterSpacing, 0.9〜1.35): 字間

## 全${samples.length}件のデータ
${sampleLines}
${structureSection}
## 分析指示
上記の**個別データとk-NN構造解析の両方**を統合し、テキストの特徴とパラメーター設定の関係性を
**網羅的かつ多角的に**分析してください。
特にk-NN構造解析が示す「クラスタ傾向」「ニュアンス境界」「予測外れ値」を重視し、
k-NNでは捉えきれないルールを明文化してください。

### 必須分析項目
1. **マクロ傾向（全体像）**
   - ユーザーの全体的な好み・デフォルト的な値域
   - 極端な値を使う条件と使わない条件

2. **クラスタ内法則**
   - 各意味クラスタが示すテーマ→パラメーター対応ルール
   - クラスタ間の差異が大きいパラメーターとその意味

3. **ニュアンス境界ルール**（divergentペアから抽出）
   - 意味的に近いテキストのパラメーター分岐の決定因子
   - k-NNが混同しやすいが質的に異なるケースの判別基準

4. **k-NN外れ値補正ルール**
   - k-NNが予測を外す条件のパターン化
   - 外れ値に共通する特徴（皮肉、反語、文体と内容の乖離など）

5. **感情・トーン → パラメーター対応**
   - 強さ/繊細さ/怒り/悲しみ/喜び/静寂/緊張/弛緩 等

6. **文体・レジスター → パラメーター対応**
   - 敬語/口語/文語/詩的/広告的 等の差
   - 漢字密度・文字種の影響

7. **パラメーター間の相互作用・共起パターン**
   - よく一緒に動くパラメーターの組
   - 排他的な組み合わせ

8. **ユーザー固有の癖・特徴**

### 出力ルール
- 箇条書きで簡潔に圧縮（冗長な説明不要）
- 推測や一般論ではなく**データとk-NN分析結果に基づく事実のみ**
- 可能な限り具体的な数値範囲で記述（例: 「sW 4〜7」）
- 2000字以内に凝縮すること`;

        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.15,
                    max_tokens: 2500,
                    messages: [{ role: 'user', content: distillPrompt }],
                }),
            });

            if (res.status === 429) {
                if (onStatus) onStatus('⏳ レート制限… 5秒後にリトライ');
                await new Promise(r => setTimeout(r, 5000));
                const retry = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`,
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        temperature: 0.15,
                        max_tokens: 2500,
                        messages: [{ role: 'user', content: distillPrompt }],
                    }),
                });
                if (!retry.ok) return { error: `API ${retry.status}` };
                const d = await retry.json();
                const rules = d.choices?.[0]?.message?.content || '';
                if (!rules.trim()) return { error: '空の応答' };
                const result = { rules, sampleCount: samples.length, timestamp: Date.now() };
                saveDistilledRules(result);
                localStorage.removeItem(LLM_CACHE_KEY);
                localStorage.removeItem(HYBRID_CACHE_KEY);
                return result;
            }

            if (!res.ok) return { error: `API ${res.status}` };

            const data = await res.json();
            const rules = data.choices?.[0]?.message?.content || '';
            console.log('Distilled rules:', rules);

            if (!rules.trim()) return { error: '空の応答' };

            const result = { rules, sampleCount: samples.length, timestamp: Date.now() };
            saveDistilledRules(result);
            localStorage.removeItem(LLM_CACHE_KEY);
            localStorage.removeItem(HYBRID_CACHE_KEY);
            return result;
        } catch (e) {
            console.warn('Distill error:', e);
            return { error: 'ネットワークエラー' };
        }
    }

    function getDistilledRulesForPrompt() {
        const stored = loadDistilledRules();
        if (!stored || !stored.rules) return '';
        return `\n\n## ユーザーの設計傾向（${stored.sampleCount}件の学習データから蒸留）\n${stored.rules}\n`;
    }

    // -------------------------------------------------------
    //  LLM 直接推論 (GPT-4o-mini)
    // -------------------------------------------------------
    const SYSTEM_PROMPT = `あなたはタイポグラフィの専門家です。
入力テキストを多角的に分析し、表示に最適なストローク書体パラメーターを推論してください。

## 分析すべき要素（すべて総合的に判断）
1. **モチーフ・題材の物性・質感**: カテゴリの一般印象ではなく、対象物固有の物理的質感を連想せよ
   - 同じ「自然」でも: 枝→細い・硬い・乾燥 / 若葉→柔らかい・薄い / 幹→太い・粗い / 岩→極太・角張る
   - 同じ「水」でも: 滝→力強い・太い / 霧→繊細・消えそう / 氷→硬い・鋭い / 波→うねり・動的
   - 同じ「木」でも: 割り箸→細く硬く直線的 / 大木→太く粗い / 桜→繊細で丸い
   - 「自然=柔らかい」「戦い=荒い」のような短絡的一般化は禁止。具体物の質感に忠実に
2. **感情・雰囲気**: 喜怒哀楽、緊張・弛緩、高揚・沈静
   - 怒り → 太くラフ / 悲しみ → 細く静か / 喜び → 丸く軽やか
3. **文体・語調**: 敬語、口語、文語、詩的、学術的、広告的
   - 敬語 → 端正にコントラスト / 口語 → 角丸でラフ / 詩 → 繊細+余白
4. **文字種の構成**: 漢字・ひらがな・カタカナ・英字の比率
   - 漢字密度高 → 太め、コントラスト / ひらがな中心 → 柔らかく / カタカナ → シャープ
5. **リズム・長さ**: 短文の凝縮感、長文の流れ、句読点のテンポ
6. **視覚的イメージ**: テキスト内容が喚起する視覚的質感（重い/軽い、粗い/滑らか、古い/新しい）
7. **ジャンル・用途の認識と「らしさ」**: テキストが特定の用途・媒体を想起させる場合、その文脈で慣習的に期待されるタイポグラフィを最優先する
   - ニュース速報・テロップ → 太く均一で高視認性（ゴシック的: sW高、con低、cr=0、twist/roughen=0）
   - 道路標識・警告 → 極太、直線的、装飾排除（sW高、lin=1、cap=butt/square）
   - 詩・俳句 → 繊細、余白重視（sW低、lH高、lS広め）
   - 広告コピー → キャッチーで個性的（パラメーター全域を活用）
   - 公文書・法律 → 端正、均質、装飾なし
   - 手書き風メモ → ラフ、角丸、twist/roughenあり
   - SNS → カジュアル、やや崩し
   - **テキスト内容の印象よりも「この文が使われる場面」の慣習的書体イメージを優先すること**

## パラメーター（JSON で出力）
- lineHeight (number, 1.0〜1.7): 行間倍率
- letterSpacing (number, 0.9〜1.35): 字間倍率
- strokeW (number, 0.1〜10): 線の太さ
- lineCap ("round"|"butt"|"square"): 端の形状。丸=柔らかい、平=ニュートラル・現代的・シャープ、角=硬い、真面目
- contrast (integer, -500〜500): カリグラフィ的縦横太さ差。正=縦太横細、負=逆、0=均一
- anchorPoints (number, -30〜6): 負=簡略化、正=細分化
- linearize (0 or 1): 1=直線化（角張る、手作り感、未来感、躍動感）
- cornerRadius (integer, 0〜40): 角の丸み
- twist (integer, 0〜80): ランダムひねり（グチャグチャ感）
- roughen (integer, 0〜50): ラフ（古さ、おどろおどろしさ、恐怖）

## 重要
- デフォルト値(strokeW:2, contrast:0等)に安易に寄せず、テキストの個性を大胆に表現すること
- 各パラメーターの範囲を広く使い、テキストごとに明確な差を出すこと

## 出力
"reasoning" (20字以内の日本語) と "params" を含むJSONのみ。コードブロック不要。`;

    function loadLLMCache() {
        try { return JSON.parse(localStorage.getItem(LLM_CACHE_KEY)) || {}; }
        catch { return {}; }
    }
    function saveLLMCache(cache) {
        const keys = Object.keys(cache);
        if (keys.length > 200) {
            for (const k of keys.slice(0, keys.length - 150)) delete cache[k];
        }
        try { localStorage.setItem(LLM_CACHE_KEY, JSON.stringify(cache)); }
        catch { /* ignore */ }
    }

    let _onStatus = null;

    async function predictByLLM(text, onStatus) {
        _onStatus = onStatus || null;
        const key = getApiKey();
        if (!key) return { error: 'APIキー未設定' };

        const normalized = text.trim();
        if (!normalized) return { error: '空テキスト' };

        const cache = loadLLMCache();
        if (cache[normalized]) return cache[normalized];

        const samples = loadSamples();
        let context = '';

        // 蒸留ルール（最優先のパーソナライズ情報）
        context += getDistilledRulesForPrompt();

        if (samples.length > 0) {
            // 全サンプルの統計情報
            const stats = computeStats(samples);
            context += formatStatsForPrompt(stats);

            // 代表的サンプル: 直近5件 + ランダム3件（重複排除）
            const recent = samples.slice(-5);
            const recentSet = new Set(recent.map(s => s.text));
            const others = samples.slice(0, -5).filter(s => !recentSet.has(s.text));
            const randomPicks = others.sort(() => Math.random() - 0.5).slice(0, 3);
            const examples = [...randomPicks, ...recent];

            context += '\n\n## ユーザーの設定例（直近＋ランダム抽出）\n';
            for (const s of examples) {
                context += `「${s.text}」→ ${JSON.stringify(s.params)}\n`;
            }
        }

        const reqBody = JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.4,
            max_tokens: 300,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + context },
                { role: 'user', content: normalized },
            ],
        });

        let res;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`,
                    },
                    body: reqBody,
                });
            } catch (e) {
                console.warn('LLM fetch error:', e);
                return { error: 'ネットワークエラー' };
            }

            if (res.status === 429) {
                const wait = (attempt + 1) * 3000;
                console.log(`Rate limited, retry in ${wait}ms (attempt ${attempt + 1}/3)`);
                if (_onStatus) _onStatus(`⏳ レート制限… ${Math.round(wait / 1000)}秒後にリトライ`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            break;
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.warn('LLM API error:', res.status, body);
            return { error: `API ${res.status}` };
        }

        let data;
        try { data = await res.json(); }
        catch (e) { return { error: 'レスポンス解析失敗' }; }

        let content = data.choices?.[0]?.message?.content || '';
        console.log('LLM raw response:', content);

        // JSON部分を抽出（コードブロック、前後の文章を除去）
        content = content.replace(/```json?\s*/g, '').replace(/```/g, '');
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('LLM: JSONが見つからない:', content);
            return { error: 'JSON解析失敗' };
        }

        let parsed;
        try { parsed = JSON.parse(jsonMatch[0]); }
        catch (e) {
            console.warn('LLM JSON parse failed:', jsonMatch[0], e);
            return { error: 'JSON構文エラー' };
        }

        // params がネストされている場合とフラットな場合の両方に対応
        let rawParams = parsed.params || parsed;
        if (rawParams.params) rawParams = rawParams.params;

        console.log('LLM parsed params:', JSON.stringify(rawParams));

        const result = {
            reasoning: parsed.reasoning || '',
            params: clampParams({ ...rawParams }),
        };

        console.log('LLM final result:', JSON.stringify(result.params));

        cache[normalized] = result;
        saveLLMCache(cache);
        return result;
    }

    // -------------------------------------------------------
    //  Embedding k-NN (フォールバック)
    // -------------------------------------------------------
    function loadEmbedCache() {
        try { return JSON.parse(localStorage.getItem(EMBED_CACHE_KEY)) || {}; }
        catch { return {}; }
    }
    function saveEmbedCache(cache) {
        try { localStorage.setItem(EMBED_CACHE_KEY, JSON.stringify(cache)); }
        catch { /* ignore */ }
    }

    async function getEmbedding(text) {
        const key = getApiKey();
        if (!key) return null;
        const normalized = text.trim();
        if (!normalized) return null;
        const cache = loadEmbedCache();
        if (cache[normalized]) return cache[normalized];
        try {
            const res = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({ model: 'text-embedding-3-small', input: normalized }),
            });
            if (!res.ok) return null;
            const data = await res.json();
            const vec = data.data[0].embedding;
            cache[normalized] = vec;
            saveEmbedCache(cache);
            return vec;
        } catch { return null; }
    }

    function cosineSim(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const d = Math.sqrt(na) * Math.sqrt(nb);
        return d > 0 ? dot / d : 0;
    }

    function predictByEmbedding(queryEmbed, samples, k = 5) {
        if (!queryEmbed || !samples || samples.length === 0) return null;
        const withEmbed = samples.filter(s => s.embedding && s.embedding.length > 0);
        if (withEmbed.length === 0) return null;
        const scored = withEmbed.map(s => ({ sample: s, sim: cosineSim(queryEmbed, s.embedding) }));
        scored.sort((a, b) => b.sim - a.sim);
        const valid = scored.slice(0, Math.min(k, scored.length)).filter(s => s.sim >= 0.3);
        if (valid.length === 0) return null;

        const result = {};
        let wSum = 0;
        for (const k of PARAM_KEYS) result[k] = 0;
        for (const { sample, sim } of valid) {
            const w = sim * sim;
            const enc = encodeParams(sample.params);
            for (const k of PARAM_KEYS) result[k] += enc[k] * w;
            wSum += w;
        }
        if (wSum <= 0) return null;
        for (const k of PARAM_KEYS) result[k] /= wSum;
        result.lineCap = LINECAP_INV[Math.round(clamp(result.lineCap, 0, 2))] || 'round';
        result.linearize = result.linearize > 0.5 ? 1 : 0;
        return { reasoning: `k-NN (${valid.length}件, sim=${valid[0].sim.toFixed(2)})`, params: clampParams(result) };
    }

    // -------------------------------------------------------
    //  ハイブリッド推論 (k-NN → LLM微調整)
    // -------------------------------------------------------
    const HYBRID_CACHE_KEY = 'hybrid_cache';

    function loadHybridCache() {
        try { return JSON.parse(localStorage.getItem(HYBRID_CACHE_KEY)) || {}; }
        catch { return {}; }
    }
    function saveHybridCache(cache) {
        const keys = Object.keys(cache);
        if (keys.length > 200) {
            for (const k of keys.slice(0, keys.length - 150)) delete cache[k];
        }
        try { localStorage.setItem(HYBRID_CACHE_KEY, JSON.stringify(cache)); }
        catch { /* ignore */ }
    }

    async function predictByHybrid(text, onStatus) {
        _onStatus = onStatus || null;
        const key = getApiKey();
        if (!key) return { error: 'APIキー未設定' };

        const normalized = text.trim();
        if (!normalized) return { error: '空テキスト' };

        const hCache = loadHybridCache();
        if (hCache[normalized]) return hCache[normalized];

        // ① embedding取得
        if (_onStatus) _onStatus('⏳ embedding取得中…');
        const queryEmbed = await getEmbedding(normalized);
        if (!queryEmbed) return { error: 'embedding取得失敗' };

        // ② 類似サンプルをk-NNで検索
        const samples = loadSamples();
        const withEmbed = samples.filter(s => s.embedding && s.embedding.length > 0);
        if (withEmbed.length === 0) return { error: 'embeddingデータなし' };

        const scored = withEmbed.map(s => ({
            sample: s,
            sim: cosineSim(queryEmbed, s.embedding)
        }));
        scored.sort((a, b) => b.sim - a.sim);
        const topK = scored.slice(0, Math.min(8, scored.length)).filter(s => s.sim >= 0.2);
        if (topK.length === 0) return { error: '類似テキストなし' };

        // ③ k-NN加重平均（参考値）
        const knnAvg = {};
        let wSum = 0;
        for (const pk of PARAM_KEYS) knnAvg[pk] = 0;
        for (const { sample, sim } of topK) {
            const w = sim * sim;
            const enc = encodeParams(sample.params);
            for (const pk of PARAM_KEYS) knnAvg[pk] += enc[pk] * w;
            wSum += w;
        }
        if (wSum > 0) {
            for (const pk of PARAM_KEYS) knnAvg[pk] /= wSum;
        }
        knnAvg.lineCap = LINECAP_INV[Math.round(clamp(knnAvg.lineCap, 0, 2))] || 'round';
        knnAvg.linearize = knnAvg.linearize > 0.5 ? 1 : 0;
        const knnParams = clampParams({ ...knnAvg });

        // ④ 蒸留ルール + 統計情報
        let context = getDistilledRulesForPrompt();
        const stats = computeStats(samples);
        context += formatStatsForPrompt(stats);

        // ⑤ 類似サンプルをfew-shotとして構築（類似度付き）
        context += '\n\n## 入力テキストに類似する学習データ（cosine類似度順）\n';
        for (const { sample, sim } of topK) {
            context += `[sim=${sim.toFixed(3)}]「${sample.text}」→ ${JSON.stringify(sample.params)}\n`;
        }

        // ⑥ k-NN参考値を渡す（LLMはニュアンス補完のみ）
        const topSim = topK[0].sim;
        context += `\n## k-NN推定結果（ベース値。最高類似度=${topSim.toFixed(3)}）\n`;
        context += JSON.stringify(knnParams) + '\n';

        // ⑥-b パラメータ一貫性スコア（topK内の分散を分析）
        const consistencyKeys = ['strokeW', 'contrast', 'cornerRadius', 'twist', 'roughen'];
        const consistencyInfo = {};
        let overallConsistency = 0;
        for (const ck of consistencyKeys) {
            const vals = topK.map(({ sample }) => {
                const v = sample.params?.[ck];
                return typeof v === 'number' ? v : 0;
            });
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
            const std = Math.sqrt(variance);
            const range = ck === 'contrast' ? 1000 : ck === 'strokeW' ? 10 :
                ck === 'twist' ? 80 : ck === 'roughen' ? 50 : ck === 'cornerRadius' ? 40 : 1;
            const normalizedStd = std / range;
            consistencyInfo[ck] = { mean: mean.toFixed(1), std: std.toFixed(2), consistent: normalizedStd < 0.08 };
            overallConsistency += normalizedStd < 0.08 ? 1 : 0;
        }
        const highConsistencyParams = Object.entries(consistencyInfo)
            .filter(([, v]) => v.consistent)
            .map(([k, v]) => `${k}=${v.mean}(σ=${v.std})`);
        const lowConsistencyParams = Object.entries(consistencyInfo)
            .filter(([, v]) => !v.consistent)
            .map(([k, v]) => `${k}(σ=${v.std})`);

        context += '\n## k-NN一貫性分析（類似サンプル間のパラメータ分散）\n';
        if (highConsistencyParams.length > 0) {
            context += `**高一貫性（ユーザーの明確な意図あり、変更禁止）**: ${highConsistencyParams.join(', ')}\n`;
        }
        if (lowConsistencyParams.length > 0) {
            context += `**低一貫性（LLM判断の余地あり）**: ${lowConsistencyParams.join(', ')}\n`;
        }
        const consensusLevel = overallConsistency >= 4 ? '極めて強い' :
            overallConsistency >= 3 ? '強い' : overallConsistency >= 2 ? '中程度' : '弱い';
        context += `全体の合意度: ${consensusLevel}（${overallConsistency}/${consistencyKeys.length}パラメータが一致）\n`;

        context += '\n## あなたの役割：k-NNが拾えないニュアンスの補完\n';
        context += 'k-NNはテキストの意味的類似度に基づく数値補間であり、以下が苦手である:\n';
        context += '- **皮肉・反語**: 表面的に穏やかでも内容が攻撃的な場合の質感の使い分け\n';
        context += '- **比喩・暗喩**: 直接的でないイメージの視覚的翻訳（例:「鉄の意志」→硬質だが金属ではない）\n';
        context += '- **文体と内容の乖離**: カジュアルな口調で重い内容を語る場合のバランス\n';
        context += '- **リズム・音韻**: 七五調、体言止め、反復等がもたらす視覚的テンポ感\n';
        context += '- **コンテキスト固有の質感**: 同じ「花」でも弔花と祝花では異なるニュアンス\n';
        context += '- **パラメーター間の意味的整合性**: 個々の値は近くても組み合わせとして不自然な場合の修正\n';
        context += '\n### 調整ルール\n';
        context += '- **まず上記の類似サンプルを観察し、ユーザーがそのモチーフにどのような物性・質感を見出しているかを推測せよ**\n';
        context += '- 類似サンプルが一貫して示すパラメーター傾向（例: 木関連が軒並み細い線）は、ユーザーの意図的な判断である。LLMの一般的カテゴリ印象（例:「自然=柔らかい」）よりも、k-NNが示すユーザーの実データを優先すること\n';
        context += '- **高一貫性パラメーターは絶対に変更するな**。類似サンプルの値が揃っているということは、ユーザーが明確な意図を持ってその値を選んでいる証拠である\n';
        context += '- 低一貫性パラメーターのみ、テキスト固有のニュアンスに基づいて調整してよい\n';
        context += '- k-NN推定値をベースとし、上記のニュアンス面のみ調整する\n';
        context += '- 数値の大幅な変更は避ける（strokeWで±1.5以内、contrastで±80以内が目安）\n';
        context += '- **慎重パラメーター**: cornerRadius, twist, roughen はk-NNの値を特に尊重すること。これらは視覚的変化が大きく、k-NN値が0ならば0のまま維持するのが原則。ON/OFFの判断はk-NNに委ね、LLMは既にONの場合の微調整のみ行う\n';
        context += '- lineCap もk-NNの選択を尊重し、強い根拠がない限り変更しない\n';
        context += `- 現在の最高類似度は${topSim.toFixed(3)}。`;
        if (topSim >= 0.7) {
            context += '高類似度のためk-NN値を強く信頼し、ニュアンス面のわずかな補正にとどめること\n';
        } else if (topSim >= 0.4) {
            context += '中程度の類似度。k-NN値を尊重しつつ、テキスト固有のニュアンスを反映すること\n';
        } else {
            context += '低類似度のためk-NN値の信頼性がやや低い。ただし高一貫性パラメーターは依然として尊重すること\n';
        }

        if (_onStatus) _onStatus('⏳ LLM微調整中…');

        // ⑦ LLM呼び出し
        const reqBody = JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            max_tokens: 300,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + context },
                { role: 'user', content: normalized },
            ],
        });

        let res;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`,
                    },
                    body: reqBody,
                });
            } catch (e) {
                return { error: 'ネットワークエラー' };
            }
            if (res.status === 429) {
                const wait = (attempt + 1) * 3000;
                if (_onStatus) _onStatus(`⏳ レート制限… ${Math.round(wait / 1000)}秒後にリトライ`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            break;
        }

        if (!res.ok) return { error: `API ${res.status}` };

        let data;
        try { data = await res.json(); }
        catch { return { error: 'レスポンス解析失敗' }; }

        let content = data.choices?.[0]?.message?.content || '';
        console.log('Hybrid LLM raw:', content);

        content = content.replace(/```json?\s*/g, '').replace(/```/g, '');
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { error: 'JSON解析失敗' };

        let parsed;
        try { parsed = JSON.parse(jsonMatch[0]); }
        catch { return { error: 'JSON構文エラー' }; }

        let rawParams = parsed.params || parsed;
        if (rawParams.params) rawParams = rawParams.params;

        const result = {
            reasoning: (parsed.reasoning || 'ハイブリッド推論') + ` (${topK.length}件, sim=${topK[0].sim.toFixed(2)})`,
            params: clampParams({ ...rawParams }),
        };

        console.log('Hybrid result:', JSON.stringify(result.params));

        hCache[normalized] = result;
        saveHybridCache(hCache);
        return result;
    }

    // -------------------------------------------------------
    //  データ永続化
    // -------------------------------------------------------
    const STORAGE_KEY = 'impression_samples_v2';

    function cleanupOldKeys() {
        for (const k of ['impression_samples', 'impression_samples_v1', 'impression_model', 'impression_model_v2']) {
            localStorage.removeItem(k);
        }
    }

    let _defaultSamplesLoaded = false;

    function loadSamples() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch { return []; }
    }

    async function ensureDefaultSamples() {
        if (_defaultSamplesLoaded) return;
        _defaultSamplesLoaded = true;
        const existing = loadSamples();
        if (existing.length > 0) return;
        try {
            const res = await fetch('data/default_samples.json');
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                saveSamples(data);
                console.log(`デフォルトデータ ${data.length}件をロードしました`);
            }
        } catch (e) {
            console.warn('デフォルトデータの読み込みに失敗:', e);
        }
    }
    function saveSamples(samples) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
            return true;
        } catch (e) {
            console.error('saveSamples failed (storage full?):', e);
            return false;
        }
    }

    function addSample(text, params, embedding) {
        const samples = loadSamples();
        samples.push({
            text: text || '',
            params: clampParams({ ...params }),
            embedding: embedding || null,
            timestamp: Date.now(),
        });
        if (!saveSamples(samples)) {
            // 容量不足: embeddingキャッシュを削除して再試行
            console.warn('Storage full, clearing caches and retrying...');
            localStorage.removeItem(EMBED_CACHE_KEY);
            localStorage.removeItem(LLM_CACHE_KEY);
            localStorage.removeItem(HYBRID_CACHE_KEY);
            if (!saveSamples(samples)) {
                // それでもダメならembeddingなしで保存
                samples[samples.length - 1].embedding = null;
                if (!saveSamples(samples)) {
                    alert('ストレージ容量が不足しています。「書出」でデータをバックアップ後、「消去」で容量を確保してください。');
                    return -1;
                }
            }
        }
        // 統計が変わるのでキャッシュを無効化
        localStorage.removeItem(LLM_CACHE_KEY);
        localStorage.removeItem(HYBRID_CACHE_KEY);
        return samples.length;
    }

    function exportSamples() {
        return JSON.stringify(loadSamples(), null, 2);
    }

    function importSamples(json) {
        try {
            const data = JSON.parse(json);
            if (!Array.isArray(data)) return false;
            saveSamples(loadSamples().concat(data));
            return true;
        } catch { return false; }
    }

    function clearSamples() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LLM_CACHE_KEY);
        localStorage.removeItem(EMBED_CACHE_KEY);
        localStorage.removeItem(HYBRID_CACHE_KEY);
        localStorage.removeItem(DISTILL_KEY);
    }

    // -------------------------------------------------------
    //  LLMによるサンプルテキスト生成
    // -------------------------------------------------------
    // テキスト生成用のカテゴリプール（毎回ランダムに選択）
    const TEXT_CATEGORIES = [
        // 用途・シチュエーション
        'ニュースの見出し', '天気予報', '料理レシピの一文', '商品パッケージの表記',
        '映画のキャッチコピー', '本の帯文', '看板・標識', '手紙の書き出し',
        'メールの件名', 'SNS投稿', 'ゲームの台詞', 'アニメの決め台詞',
        '歌の歌詞の一節', '結婚式のスピーチ', '卒業式の祝辞', '墓碑銘',
        '店のメニュー表記', '薬の注意書き', '法律条文風', '論文の一文',
        '日記の一節', '遺書の一節', 'ラブレター', '脅迫状風（フィクション）',
        '占いの結果', 'おみくじ', '格言・座右の銘', 'ことわざ風の創作',
        'スポーツ実況', 'オークションの出品文', 'バーゲンの広告', '求人広告',
        '不動産広告の売り文句', '美術展のタイトル', '展覧会の作品解説',
        '落書き・壁の殴り書き', '怪文書', '呪いの言葉', 'お経・祝詞',
        '死刑判決文', '戦時中のプロパガンダ', 'アングラ雑誌の煽り文句',
        '風俗店の看板', 'ホストクラブの名刺の肩書き', 'タトゥーに彫る一言',
        'デスメタルの曲名', 'アダルト作品のタイトル', '闇サイトの警告文',
        // モチーフ・題材
        '山岳・岩', '海・波・水', '火・炎', '風・空気', '森林・植物',
        '宇宙・星', '雨・雪', '動物', '昆虫', '魚・海洋生物',
        '都市・高層ビル', '廃墟', '古い町並み', '工場・機械', '電車・鉄道',
        '食べ物（和食）', '食べ物（洋菓子）', '酒・飲み物', '楽器・音楽',
        '戦闘・武器', '祭り', '葬儀', '誕生', '老い', '旅',
        '血・傷・痛み', '毒・薬物', '性愛・情欲', '拷問・処刑',
        '腐敗・朽ちるもの', '寄生虫・病原体', '死体・骸骨', '内臓・肉体',
        '売春・夜の街', '監獄・拘束', '自傷・自壊', '狂気・精神崩壊',
        // 感情・トーン
        '激しい怒り', '静かな悲しみ', '爆発的な喜び', '穏やかな幸福',
        '恐怖', '不安', '希望', '絶望', '郷愁', '退屈',
        '皮肉・風刺', 'ユーモア', '荘厳', '可愛らしさ', '不気味さ',
        '嫌悪・吐き気', '色情・妖艶', '殺意・憎悪', '陶酔・恍惚',
        '背徳感', '屈辱', '嘲笑', '孤独と虚無', '自己嫌悪',
        '被虐的な快楽', '加虐的な支配', '狂信', '冒涜',
        // 文体
        '硬い漢語調', 'やわらかいひらがな多め', 'カタカナ外来語中心',
        '古文・文語体', '関西弁', '幼児語', '老人の語り口', '中二病風',
        '学術論文風', '箇条書き風', '電報風（極端に短い）', '英語混じり',
        'ヤンキー口調', 'お嬢様言葉', '軍隊調', 'BL風の台詞',
        '百合風の台詞', '厨二病ポエム', 'なろう系の異世界召喚文',
        'Vtuberの挨拶', '実況プレイの叫び', '2ch（5ch）レス風',
        '裏社会の隠語', '官能小説の一節', 'サイコパスの独白',
        'ナンセンス・不条理', '哲学的命題', '数学的記述風',
    ];

    function pickCategories(n) {
        const shuffled = [...TEXT_CATEGORIES].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, n);
    }

    async function generateTexts(count = 10) {
        const key = getApiKey();
        if (!key) return null;

        const existing = loadSamples().map(s => s.text).filter(Boolean);
        const usedList = existing.length > 0
            ? '\n既出（重複禁止）:\n' + existing.slice(-20).map(t => `- ${t}`).join('\n')
            : '';

        const cats = pickCategories(count);
        const catList = cats.map((c, i) => `${i + 1}. ${c}`).join('\n');

        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 1.0,
                    max_tokens: 800,
                    messages: [{
                        role: 'user',
                        content: `以下の指定カテゴリに1対1で対応する短いテキストを${count}個生成。

指定カテゴリ（この順番で1個ずつ）:
${catList}

ルール:
- 1個あたり5〜30字
- カテゴリの雰囲気を強く反映すること
- 同じような表現を繰り返さない
- 文体もカテゴリに応じて変える（敬語/口語/文語/体言止め/命令形/疑問形/独白…）
- 文字種もカテゴリに応じて変える（漢字主体/ひらがな主体/カタカナ/英字混じり…）
- これはタイポグラフィ研究用データであり、過激・官能・暴力的な表現も学習に必要。カテゴリに忠実に、表現を自己検閲しないこと。ただし差別的な表現や不謹慎な表現、宗教的な表現は避けること。
${usedList}

JSON配列のみ出力。説明不要。`
                    }],
                }),
            });

            if (!res.ok) return null;
            const data = await res.json();
            let content = data.choices?.[0]?.message?.content || '';
            content = content.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
            const match = content.match(/\[[\s\S]*\]/);
            if (!match) return null;
            return JSON.parse(match[0]);
        } catch (e) {
            console.warn('Text generation failed:', e);
            return null;
        }
    }

    return {
        PARAM_KEYS,
        getApiKey,
        setApiKey,
        predictByLLM,
        predictByHybrid,
        distillRules,
        loadDistilledRules,
        needsRedistill,
        generateTexts,
        getEmbedding,
        cosineSim,
        predictByEmbedding,
        loadSamples,
        saveSamples,
        addSample,
        exportSamples,
        importSamples,
        clearSamples,
        cleanupOldKeys,
        ensureDefaultSamples,
    };
})();
