// ============================================================
//  M+ Stroke Sketch – パラメトリック描画
// ============================================================

const sketch1 = (p) => {
    let strokeData = null;
    let font = null;
    let textArea;

    const PADDING = 40;
    const LATIN_SCALE = 1.25;
    const LATIN_Y_OFFSET = 0.05;
    const LATIN_SPACING = 0.8;

    function isLatin(ch) {
        const c = ch.charCodeAt(0);
        return c <= 0x024F || (c >= 0xFF01 && c <= 0xFF5E && /[A-Za-z0-9]/.test(String.fromCharCode(c - 0xFEE0)));
    }

    // ----------------------------------------------------------
    //  preload / setup / resize
    // ----------------------------------------------------------
    p.preload = () => {
        font = p.loadFont('fonts/MPLUS1p-Regular.ttf');
        p.httpGet('data/mplus_strokes.json', 'json', false, (d) => { strokeData = d; });
    };

    p.setup = () => {
        let c = document.getElementById('canvas-container');
        let canvas = p.createCanvas(c.clientWidth, c.clientHeight);
        canvas.parent('canvas-container');
        textArea = document.getElementById('text-input');

        new ResizeObserver(() => {
            p.resizeCanvas(c.clientWidth, c.clientHeight);
        }).observe(c);
    };

    p.windowResized = () => {
        let c = document.getElementById('canvas-container');
        p.resizeCanvas(c.clientWidth, c.clientHeight);
    };

    // ----------------------------------------------------------
    //  パラメーター読み取り
    // ----------------------------------------------------------
    function readParams() {
        const v = (id, def) => {
            let el = document.getElementById(id);
            return el ? parseFloat(el.value) : def;
        };
        const chk = (id) => {
            let el = document.getElementById(id);
            return el ? el.checked : false;
        };
        let ap = v('p-anchorPoints', 0);
        let fontSize = v('p-fontSize', 50);
        return {
            fontSize: fontSize,
            lineHeight: fontSize * v('p-lineHeight', 1.3),
            charW: fontSize * v('p-letterSpacing', 1.05),
            direction: (document.getElementById('p-direction') || {}).value || 'h',
            scaleX: v('p-scaleX', 100) / 100,
            scaleY: v('p-scaleY', 100) / 100,
            strokeW: v('p-strokeW', 2),
            lineCap: (document.getElementById('p-lineCap') || {}).value || 'round',
            contrast: v('p-contrast', 0) / 100,
            addPoints: ap > 0 ? Math.round(ap) : 0,
            simplify: ap < 0 ? Math.abs(ap) : 0,
            linearize: v('p-linearize', 0) ? 1 : 0,
            cornerRadius: v('p-cornerRadius', 0),
            twist: chk('p-twist-on') ? v('p-twist', 0) : 0,
            roughen: chk('p-roughen-on') ? v('p-roughen', 0) : 0,
        };
    }

    // ----------------------------------------------------------
    //  draw
    // ----------------------------------------------------------
    p.draw = () => {
        p.background(255);

        let txt = textArea ? textArea.value : '';
        if (!txt) return;

        let params = readParams();
        let baseFontSize = params.fontSize;
        let ctx = p.drawingContext;
        let vertical = params.direction === 'v';

        // テキスト量に応じてフォントサイズを自動拡大（baseFontSizeが下限）
        let fontSize = calcAutoFontSize(txt, baseFontSize, params, vertical);
        let lhRatio = params.lineHeight / baseFontSize;
        let cwRatio = params.charW / baseFontSize;
        let lineH = fontSize * lhRatio;
        let charW = fontSize * cwRatio;
        let sw = params.strokeW * (fontSize / baseFontSize);

        if (vertical) {
            // --- 縦組: 上から下、右から左 ---
            let maxChars = Math.max(1, Math.floor((p.height - PADDING * 2) / (charW * params.scaleY)));
            let lines = wrapText(txt, maxChars);
            let blockW = lines.length * lineH * params.scaleX;
            let startX = p.width - PADDING - lineH * params.scaleX / 2;
            let sy = PADDING + charW * params.scaleY / 2;

            for (let li = 0; li < lines.length; li++) {
                let line = lines[li];
                let cx = startX - li * lineH * params.scaleX;

                for (let ci = 0; ci < line.length; ci++) {
                    let ch = line[ci];
                    let latin = isLatin(ch);
                    let cy = sy + ci * charW * params.scaleY;
                    let chSize = latin ? fontSize * LATIN_SCALE : fontSize;
                    let seed = ch.charCodeAt(0) * 7919 + ci * 173 + li * 59;

                    if (strokeData && strokeData[ch]) {
                        drawChar(ctx, strokeData[ch], cx, cy, chSize, sw, '#1a1a1a', params, seed);
                    } else if (font && font.font) {
                        drawOutlineChar(ctx, font.font, ch, cx, cy, chSize, sw, '#1a1a1a', params, seed);
                    }
                }
            }
        } else {
            // --- 横組: 中央揃え、上から下 ---
            let maxChars = Math.max(1, Math.floor((p.width - PADDING * 2) / (charW * params.scaleX)));
            let lines = wrapText(txt, maxChars);
            let blockH = lines.length * lineH * params.scaleY;
            let startY = (p.height - blockH) / 2 + lineH * params.scaleY / 2;

            for (let li = 0; li < lines.length; li++) {
                let line = lines[li];
                let cy = startY + li * lineH * params.scaleY;

                let lineW = 0;
                for (let ci = 0; ci < line.length; ci++) {
                    lineW += isLatin(line[ci]) ? charW * LATIN_SPACING * params.scaleX : charW * params.scaleX;
                }
                let curX = (p.width - lineW) / 2;

                for (let ci = 0; ci < line.length; ci++) {
                    let ch = line[ci];
                    let latin = isLatin(ch);
                    let cw = latin ? charW * LATIN_SPACING : charW;
                    let cx = curX + cw * params.scaleX / 2;
                    let chY = latin ? cy + fontSize * LATIN_Y_OFFSET : cy;
                    let chSize = latin ? fontSize * LATIN_SCALE : fontSize;
                    let seed = ch.charCodeAt(0) * 7919 + ci * 173 + li * 59;

                    if (strokeData && strokeData[ch]) {
                        drawChar(ctx, strokeData[ch], cx, chY, chSize, sw, '#1a1a1a', params, seed);
                    } else if (font && font.font) {
                        drawOutlineChar(ctx, font.font, ch, cx, chY, chSize, sw, '#1a1a1a', params, seed);
                    }
                    curX += cw * params.scaleX;
                }
            }
        }
    };

    function calcAutoFontSize(txt, baseFontSize, params, vertical) {
        let lhRatio = params.lineHeight / baseFontSize;
        let cwRatio = params.charW / baseFontSize;
        let availW = p.width - PADDING * 2;
        let availH = p.height - PADDING * 2;

        let rawLines = txt.split('\n');
        let maxLineLen = 0;
        let numLines = rawLines.length;
        for (let line of rawLines) {
            if (line.length > maxLineLen) maxLineLen = line.length;
        }
        if (maxLineLen === 0) return baseFontSize;

        let fit;
        if (vertical) {
            let fsByCol = availH / (maxLineLen * cwRatio * params.scaleY);
            let fsByRows = availW / (numLines * lhRatio * params.scaleX);
            fit = Math.min(fsByCol, fsByRows);
        } else {
            let fsByRow = availW / (maxLineLen * cwRatio * params.scaleX);
            let fsByHeight = availH / (numLines * lhRatio * params.scaleY);
            fit = Math.min(fsByRow, fsByHeight);
        }
        // 80%に抑えて余白を確保
        return Math.max(baseFontSize, Math.floor(fit * 0.8));
    }

    function wrapText(txt, max) {
        let out = [];
        for (let raw of txt.split('\n')) {
            if (!raw.length) { out.push(''); continue; }
            for (let i = 0; i < raw.length; i += max) out.push(raw.slice(i, i + max));
        }
        return out;
    }

    // ===========================================================
    //  描画
    // ===========================================================

    function drawChar(ctx, elements, cx, cy, size, sw, color, params, seed) {
        let scale = size / 100;
        let ox = cx - size * params.scaleX / 2;
        let oy = cy - size * params.scaleY / 2;
        let sxS = scale * params.scaleX;
        let syS = scale * params.scaleY;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineJoin = 'round';
        ctx.lineCap = params.lineCap;
        ctx.lineWidth = sw;

        // --- カリグラフィペン: Canvas 変換で楕円ブラシを実現 ---
        // 正: 縦線太・横線細  負: 横線太・縦線細
        if (params.contrast !== 0) {
            let c = Math.abs(params.contrast);
            let m = 1 + c;
            if (params.contrast > 0) {
                ctx.scale(m, 1);
                ox /= m; sxS /= m;
            } else {
                ctx.scale(1, m);
                oy /= m; syS /= m;
            }
        }

        for (let ei = 0; ei < elements.length; ei++) {
            let cmds = elementToCommands(elements[ei]);
            cmds = applyPathTransforms(cmds, params, seed + ei * 311);
            renderCommands(ctx, cmds, ox, oy, sxS, syS);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawOutlineChar(ctx, otFont, ch, cx, cy, size, sw, color, params, seed) {
        let sc = size / otFont.unitsPerEm;
        let glyph = otFont.charToGlyph(ch);
        if (!glyph || glyph.index === 0) return;

        let advW = (glyph.advanceWidth || otFont.unitsPerEm) * sc;
        let ascent = otFont.ascender * sc;
        let ox = cx - advW * params.scaleX / 2;
        let oy = cy - size * params.scaleY / 2 + ascent * params.scaleY;
        let sxS = params.scaleX;
        let syS = params.scaleY;
        let path = otFont.getPath(ch, 0, 0, size);

        let cmds = opentypeToCommands(path.commands);
        cmds = applyPathTransforms(cmds, params, seed);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = sw * 0.4;
        ctx.lineJoin = 'round';
        ctx.lineCap = params.lineCap;

        if (params.contrast !== 0) {
            let c = Math.abs(params.contrast);
            let m = 1 + c;
            if (params.contrast > 0) {
                ctx.scale(m, 1);
                ox /= m; sxS /= m;
            } else {
                ctx.scale(1, m);
                oy /= m; syS /= m;
            }
        }

        renderCommands(ctx, cmds, ox, oy, sxS, syS);
        ctx.stroke();
        ctx.restore();
    }

    // ===========================================================
    //  コマンド変換
    // ===========================================================

    function elementToCommands(el) {
        if (el.t === 'L') {
            return [
                { type: 'M', x: el.x1, y: el.y1 },
                { type: 'L', x: el.x2, y: el.y2 },
            ];
        }
        return parseSvgPath(el.d);
    }

    function opentypeToCommands(otCmds) {
        return otCmds.map(c => {
            switch (c.type) {
                case 'M': return { type: 'M', x: c.x, y: c.y };
                case 'L': return { type: 'L', x: c.x, y: c.y };
                case 'Q': return { type: 'Q', x1: c.x1, y1: c.y1, x: c.x, y: c.y };
                case 'C': return { type: 'C', x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: c.x, y: c.y };
                case 'Z': return { type: 'Z' };
                default: return { type: c.type };
            }
        });
    }

    // ----------------------------------------------------------
    //  SVG path → 絶対座標コマンド配列
    // ----------------------------------------------------------
    function parseSvgPath(d) {
        const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
        if (!tokens) return [];
        let out = [], i = 0;
        let cx = 0, cy = 0, sx = 0, sy = 0, lastCmd = '', lcx = 0, lcy = 0;
        const n = () => parseFloat(tokens[i++]);

        while (i < tokens.length) {
            let cmd = tokens[i];
            if (/[A-Za-z]/.test(cmd)) i++; else cmd = lastCmd;

            switch (cmd) {
                case 'M': cx = n(); cy = n(); out.push({ type: 'M', x: cx, y: cy }); sx = cx; sy = cy; lastCmd = 'L'; break;
                case 'm': cx += n(); cy += n(); out.push({ type: 'M', x: cx, y: cy }); sx = cx; sy = cy; lastCmd = 'l'; break;
                case 'L': cx = n(); cy = n(); out.push({ type: 'L', x: cx, y: cy }); lastCmd = 'L'; break;
                case 'l': cx += n(); cy += n(); out.push({ type: 'L', x: cx, y: cy }); lastCmd = 'l'; break;
                case 'H': cx = n(); out.push({ type: 'L', x: cx, y: cy }); lastCmd = 'H'; break;
                case 'h': cx += n(); out.push({ type: 'L', x: cx, y: cy }); lastCmd = 'h'; break;
                case 'V': cy = n(); out.push({ type: 'L', x: cx, y: cy }); lastCmd = 'V'; break;
                case 'v': cy += n(); out.push({ type: 'L', x: cx, y: cy }); lastCmd = 'v'; break;
                case 'C': {
                    let x1 = n(), y1 = n(), x2 = n(), y2 = n(); cx = n(); cy = n();
                    out.push({ type: 'C', x1, y1, x2, y2, x: cx, y: cy }); lcx = x2; lcy = y2; lastCmd = 'C'; break;
                }
                case 'c': {
                    let dx1 = n(), dy1 = n(), dx2 = n(), dy2 = n(), dx = n(), dy = n();
                    let x1 = cx + dx1, y1 = cy + dy1, x2 = cx + dx2, y2 = cy + dy2; cx += dx; cy += dy;
                    out.push({ type: 'C', x1, y1, x2, y2, x: cx, y: cy }); lcx = x2; lcy = y2; lastCmd = 'c'; break;
                }
                case 'S': {
                    let cpx = 2 * cx - lcx, cpy = 2 * cy - lcy, x2 = n(), y2 = n(); cx = n(); cy = n();
                    out.push({ type: 'C', x1: cpx, y1: cpy, x2, y2, x: cx, y: cy }); lcx = x2; lcy = y2; lastCmd = 'S'; break;
                }
                case 's': {
                    let cpx = 2 * cx - lcx, cpy = 2 * cy - lcy, dx2 = n(), dy2 = n(), dx = n(), dy = n();
                    let x2 = cx + dx2, y2 = cy + dy2; cx += dx; cy += dy;
                    out.push({ type: 'C', x1: cpx, y1: cpy, x2, y2, x: cx, y: cy }); lcx = x2; lcy = y2; lastCmd = 's'; break;
                }
                case 'Q': {
                    let x1 = n(), y1 = n(); cx = n(); cy = n();
                    out.push({ type: 'Q', x1, y1, x: cx, y: cy }); lcx = x1; lcy = y1; lastCmd = 'Q'; break;
                }
                case 'q': {
                    let dx1 = n(), dy1 = n(), dx = n(), dy = n();
                    let x1 = cx + dx1, y1 = cy + dy1; cx += dx; cy += dy;
                    out.push({ type: 'Q', x1, y1, x: cx, y: cy }); lcx = x1; lcy = y1; lastCmd = 'q'; break;
                }
                case 'T': {
                    lcx = 2 * cx - lcx; lcy = 2 * cy - lcy; cx = n(); cy = n();
                    out.push({ type: 'Q', x1: lcx, y1: lcy, x: cx, y: cy }); lastCmd = 'T'; break;
                }
                case 't': {
                    lcx = 2 * cx - lcx; lcy = 2 * cy - lcy; cx += n(); cy += n();
                    out.push({ type: 'Q', x1: lcx, y1: lcy, x: cx, y: cy }); lastCmd = 't'; break;
                }
                case 'Z': case 'z':
                    out.push({ type: 'Z' }); cx = sx; cy = sy; lastCmd = 'Z'; break;
                default: i++; break;
            }
        }
        return out;
    }

    // ===========================================================
    //  パス変形パイプライン
    // ===========================================================

    function applyPathTransforms(cmds, params, seed) {
        if (params.addPoints > 0) cmds = addAnchorPoints(cmds, params.addPoints);
        if (params.linearize > 0) cmds = linearize(cmds, params.linearize);
        if (params.simplify > 0) cmds = simplifyPath(cmds, params.simplify);
        if (params.cornerRadius > 0) cmds = roundCorners(cmds, params.cornerRadius);
        if (params.twist > 0) cmds = twist(cmds, params.twist, seed);
        if (params.roughen > 0) cmds = roughen(cmds, params.roughen, seed);
        return cmds;
    }

    // --- アンカーポイント追加 (De Casteljau 分割) ---
    function addAnchorPoints(cmds, times) {
        for (let t = 0; t < times; t++) {
            let out = [], px = 0, py = 0;
            for (let c of cmds) {
                if (c.type === 'C') {
                    let sub = subdivCubic(px, py, c.x1, c.y1, c.x2, c.y2, c.x, c.y);
                    out.push(sub[0], sub[1]);
                    px = c.x; py = c.y;
                } else if (c.type === 'Q') {
                    let sub = subdivQuad(px, py, c.x1, c.y1, c.x, c.y);
                    out.push(sub[0], sub[1]);
                    px = c.x; py = c.y;
                } else if (c.type === 'L') {
                    let mx = (px + c.x) / 2, my = (py + c.y) / 2;
                    out.push({ type: 'L', x: mx, y: my });
                    out.push({ type: 'L', x: c.x, y: c.y });
                    px = c.x; py = c.y;
                } else {
                    out.push(c);
                    if (c.x !== undefined) { px = c.x; py = c.y; }
                }
            }
            cmds = out;
        }
        return cmds;
    }

    function subdivCubic(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
        let q0x = (p0x + p1x) / 2, q0y = (p0y + p1y) / 2;
        let qmx = (p1x + p2x) / 2, qmy = (p1y + p2y) / 2;
        let q2x = (p2x + p3x) / 2, q2y = (p2y + p3y) / 2;
        let r0x = (q0x + qmx) / 2, r0y = (q0y + qmy) / 2;
        let r1x = (qmx + q2x) / 2, r1y = (qmy + q2y) / 2;
        let sx = (r0x + r1x) / 2, sy = (r0y + r1y) / 2;
        return [
            { type: 'C', x1: q0x, y1: q0y, x2: r0x, y2: r0y, x: sx, y: sy },
            { type: 'C', x1: r1x, y1: r1y, x2: q2x, y2: q2y, x: p3x, y: p3y },
        ];
    }

    function subdivQuad(p0x, p0y, p1x, p1y, p2x, p2y) {
        let q0x = (p0x + p1x) / 2, q0y = (p0y + p1y) / 2;
        let q1x = (p1x + p2x) / 2, q1y = (p1y + p2y) / 2;
        let mx = (q0x + q1x) / 2, my = (q0y + q1y) / 2;
        return [
            { type: 'Q', x1: q0x, y1: q0y, x: mx, y: my },
            { type: 'Q', x1: q1x, y1: q1y, x: p2x, y: p2y },
        ];
    }

    // --- 単純化 (Douglas-Peucker + ベジエ曲線フィッティング) ---
    function simplifyPath(cmds, tolerance) {
        let hasCurves = cmds.some(c => c.type === 'C' || c.type === 'Q');
        let work = hasCurves ? linearize(cmds, 30) : cmds;

        let subPaths = splitSubPaths(work);
        let out = [];
        for (let sub of subPaths) {
            let pts = [];
            for (let c of sub) {
                if (c.x !== undefined) pts.push({ x: c.x, y: c.y });
            }
            if (pts.length < 3) { out.push(...sub); continue; }

            let keyIdx = dpIndices(pts, tolerance);
            out.push({ type: 'M', x: pts[keyIdx[0]].x, y: pts[keyIdx[0]].y });

            for (let k = 0; k < keyIdx.length - 1; k++) {
                let seg = pts.slice(keyIdx[k], keyIdx[k + 1] + 1);
                if (seg.length <= 2) {
                    out.push({ type: 'L', x: seg[seg.length - 1].x, y: seg[seg.length - 1].y });
                } else {
                    let cp = fitCubicBezier(seg);
                    out.push({
                        type: 'C',
                        x1: cp.x1, y1: cp.y1,
                        x2: cp.x2, y2: cp.y2,
                        x: seg[seg.length - 1].x, y: seg[seg.length - 1].y
                    });
                }
            }
        }
        return out;
    }

    function splitSubPaths(cmds) {
        let subs = [], cur = [];
        for (let c of cmds) {
            if (c.type === 'M' && cur.length > 0) { subs.push(cur); cur = []; }
            cur.push(c);
        }
        if (cur.length) subs.push(cur);
        return subs;
    }

    function dpIndices(pts, eps) {
        let set = new Set([0, pts.length - 1]);
        _dpCollect(pts, 0, pts.length - 1, eps, set);
        return [...set].sort((a, b) => a - b);
    }

    function _dpCollect(pts, lo, hi, eps, set) {
        if (hi - lo <= 1) return;
        let dmax = 0, idx = lo;
        let a = pts[lo], b = pts[hi];
        for (let i = lo + 1; i < hi; i++) {
            let d = perpDist(pts[i], a, b);
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax > eps) {
            set.add(idx);
            _dpCollect(pts, lo, idx, eps, set);
            _dpCollect(pts, idx, hi, eps, set);
        }
    }

    function perpDist(p, a, b) {
        let dx = b.x - a.x, dy = b.y - a.y;
        let len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
        return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    }

    function fitCubicBezier(pts) {
        let n = pts.length;
        let p0 = pts[0], p3 = pts[n - 1];

        let chords = [0];
        let total = 0;
        for (let i = 1; i < n; i++) {
            let dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
            total += Math.sqrt(dx * dx + dy * dy);
            chords.push(total);
        }
        if (total < 1e-10) {
            return { x1: p0.x, y1: p0.y, x2: p3.x, y2: p3.y };
        }
        let t = chords.map(c => c / total);

        let C11 = 0, C12 = 0, C22 = 0;
        let A1x = 0, A1y = 0, A2x = 0, A2y = 0;

        for (let i = 1; i < n - 1; i++) {
            let ti = t[i], u = 1 - ti;
            let b1 = 3 * u * u * ti;
            let b2 = 3 * u * ti * ti;
            let rx = pts[i].x - u * u * u * p0.x - ti * ti * ti * p3.x;
            let ry = pts[i].y - u * u * u * p0.y - ti * ti * ti * p3.y;
            C11 += b1 * b1;
            C12 += b1 * b2;
            C22 += b2 * b2;
            A1x += b1 * rx; A1y += b1 * ry;
            A2x += b2 * rx; A2y += b2 * ry;
        }

        let det = C11 * C22 - C12 * C12;
        if (Math.abs(det) < 1e-10) {
            return {
                x1: p0.x + (p3.x - p0.x) / 3,
                y1: p0.y + (p3.y - p0.y) / 3,
                x2: p0.x + 2 * (p3.x - p0.x) / 3,
                y2: p0.y + 2 * (p3.y - p0.y) / 3,
            };
        }

        return {
            x1: (C22 * A1x - C12 * A2x) / det,
            y1: (C22 * A1y - C12 * A2y) / det,
            x2: (C11 * A2x - C12 * A1x) / det,
            y2: (C11 * A2y - C12 * A1y) / det,
        };
    }

    // --- 直線化 ---
    function linearize(cmds, n) {
        let out = [], px = 0, py = 0;
        for (let c of cmds) {
            if (c.type === 'C' && n > 0) {
                for (let t = 1; t <= n; t++) {
                    let tt = t / n, u = 1 - tt;
                    out.push({
                        type: 'L',
                        x: u * u * u * px + 3 * u * u * tt * c.x1 + 3 * u * tt * tt * c.x2 + tt * tt * tt * c.x,
                        y: u * u * u * py + 3 * u * u * tt * c.y1 + 3 * u * tt * tt * c.y2 + tt * tt * tt * c.y
                    });
                }
                px = c.x; py = c.y;
            } else if (c.type === 'Q' && n > 0) {
                for (let t = 1; t <= n; t++) {
                    let tt = t / n, u = 1 - tt;
                    out.push({
                        type: 'L',
                        x: u * u * px + 2 * u * tt * c.x1 + tt * tt * c.x,
                        y: u * u * py + 2 * u * tt * c.y1 + tt * tt * c.y
                    });
                }
                px = c.x; py = c.y;
            } else {
                out.push(c);
                if (c.x !== undefined) { px = c.x; py = c.y; }
            }
        }
        return out;
    }

    // --- 角丸め ---
    function roundCorners(cmds, radius) {
        let out = [];
        for (let i = 0; i < cmds.length; i++) {
            let curr = cmds[i], next = cmds[i + 1];
            if (curr.type === 'L' && next && next.type === 'L') {
                let prev = getPrevPoint(cmds, i);
                if (!prev) { out.push(curr); continue; }
                let dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
                let len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                let dx2 = next.x - curr.x, dy2 = next.y - curr.y;
                let len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                if (len1 < 0.01 || len2 < 0.01) { out.push(curr); continue; }
                let r = Math.min(radius, len1 * 0.4, len2 * 0.4);
                out.push({ type: 'L', x: curr.x - dx1 / len1 * r, y: curr.y - dy1 / len1 * r });
                out.push({
                    type: 'Q', x1: curr.x, y1: curr.y,
                    x: curr.x + dx2 / len2 * r, y: curr.y + dy2 / len2 * r
                });
            } else {
                out.push(curr);
            }
        }
        return out;
    }

    function getPrevPoint(cmds, idx) {
        for (let i = idx - 1; i >= 0; i--) {
            if (cmds[i].x !== undefined) return cmds[i];
        }
        return null;
    }

    // --- ランダム・ひねり ---
    function twist(cmds, amount, seed) {
        let out = [], k = 0;
        for (let c of cmds) {
            let nc = { ...c };
            if (nc.type !== 'Z' && nc.type !== 'M') {
                if (nc.x !== undefined) { nc.x += rnd(seed, k++) * amount; nc.y += rnd(seed, k++) * amount; }
                if (nc.x1 !== undefined) { nc.x1 += rnd(seed, k++) * amount; nc.y1 += rnd(seed, k++) * amount; }
                if (nc.x2 !== undefined) { nc.x2 += rnd(seed, k++) * amount; nc.y2 += rnd(seed, k++) * amount; }
            }
            out.push(nc);
        }
        return out;
    }

    // --- ラフ ---
    function roughen(cmds, amount, seed) {
        let out = [], k = 0, px = 0, py = 0;
        for (let c of cmds) {
            if (c.type === 'L') {
                let dx = c.x - px, dy = c.y - py, len = Math.sqrt(dx * dx + dy * dy);
                let segs = Math.max(2, Math.round(len / 8));
                for (let s = 1; s <= segs; s++) {
                    let t = s / segs, nx = px + dx * t, ny = py + dy * t;
                    if (s < segs) { nx += rnd(seed, k++) * amount; ny += rnd(seed, k++) * amount; }
                    out.push({ type: 'L', x: nx, y: ny });
                }
                px = c.x; py = c.y;
            } else if (c.type === 'C') {
                out.push({
                    type: 'C',
                    x1: c.x1 + rnd(seed, k++) * amount, y1: c.y1 + rnd(seed, k++) * amount,
                    x2: c.x2 + rnd(seed, k++) * amount, y2: c.y2 + rnd(seed, k++) * amount,
                    x: c.x + rnd(seed, k++) * amount * 0.3, y: c.y + rnd(seed, k++) * amount * 0.3
                });
                px = c.x; py = c.y;
            } else if (c.type === 'Q') {
                out.push({
                    type: 'Q',
                    x1: c.x1 + rnd(seed, k++) * amount, y1: c.y1 + rnd(seed, k++) * amount,
                    x: c.x + rnd(seed, k++) * amount * 0.3, y: c.y + rnd(seed, k++) * amount * 0.3
                });
                px = c.x; py = c.y;
            } else {
                out.push(c);
                if (c.x !== undefined) { px = c.x; py = c.y; }
            }
        }
        return out;
    }

    function rnd(seed, idx) {
        let x = Math.sin(seed + idx * 127.1 + 311.7) * 43758.5453;
        return (x - Math.floor(x)) - 0.5;
    }

    // ===========================================================
    //  Canvas 描画
    // ===========================================================

    function renderCommands(ctx, cmds, ox, oy, sx, sy) {
        ctx.beginPath();
        for (let c of cmds) {
            switch (c.type) {
                case 'M': ctx.moveTo(ox + c.x * sx, oy + c.y * sy); break;
                case 'L': ctx.lineTo(ox + c.x * sx, oy + c.y * sy); break;
                case 'Q':
                    ctx.quadraticCurveTo(ox + c.x1 * sx, oy + c.y1 * sy, ox + c.x * sx, oy + c.y * sy); break;
                case 'C':
                    ctx.bezierCurveTo(ox + c.x1 * sx, oy + c.y1 * sy, ox + c.x2 * sx, oy + c.y2 * sy, ox + c.x * sx, oy + c.y * sy); break;
                case 'Z': ctx.closePath(); break;
            }
        }
    }
};

currentSketch = new p5(sketch1);
