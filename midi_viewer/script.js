document.addEventListener("DOMContentLoaded", () => {
    const drawButton = document.getElementById("drawButton");
    drawButton.addEventListener("click", () => {
        const inputMidi = document.getElementById("inputMidi").files;
        if (inputMidi.hasOwnProperty("0")) {
            const file = inputMidi[0];
            console.log(file);
            const reader = new FileReader();

            reader.onload = (e) => {
                const byteArray = new Uint8Array(e.target.result);
                parseMidi(byteArray);
            };

            reader.readAsArrayBuffer(file);
        }
    });

    const playButton = document.getElementById("playButton");
    playButton.addEventListener("click", () => {
        togglePlayPause();
    });
});

// ---- グローバル状態 ----

// トラックごとの状態: { synth, hue, volume, visible, notes[] }
let trackSettings = [];
let currentAllNotes = []; // 描画用（全トラックのノートを保持）
let totalDuration = 0;
let animationFrameId = null;
let isSeeking = false;
let selectedNote = null; // 選択されたノート
let lastClickedTime = -1; // 最後にクリックした時刻

// テンポ・拍子・グリッド
let tempoMap = [];    // [{bpm, time}, ...] 時刻昇順
let timeSigMap = [];  // [{num, den, time}, ...] 時刻昇順
let gridLines = [];   // [{time, isMeasure, measureNumber, beatInMeasure, totalBeats, timeSig}, ...] 

// ---- MIDI パース ----

function parseMidi(midiByteArray) {
    const json = new Midi(midiByteArray).toJSON();
    console.log("変換されたJSON:", json);
    setupPianoRoll(json);
}

// ---- セットアップ ----

function setupPianoRoll(midiJson) {
    // 1. 前の状態をクリア
    Tone.Transport.stop();
    Tone.Transport.cancel();
    cancelAnimationFrame(animationFrameId);
    trackSettings.forEach(t => t.synth && t.synth.dispose());
    trackSettings = [];
    currentAllNotes = [];
    totalDuration = 0;
    tempoMap = [];
    timeSigMap = [];
    gridLines = [];
    selectedNote = null;
    lastClickedTime = -1;
    updateClickPosDisplay();
    
    // ズームをリセット
    zoomLevel = 1.0;
    speed = BASE_SPEED;
    const zoomEl = document.getElementById("zoomLevel");
    if (zoomEl) zoomEl.textContent = "100%";

    const playButton = document.getElementById("playButton");
    playButton.textContent = "再生";

    // テンポ・拍子マップを保存（時刻昇順で整列）
    tempoMap = (midiJson.header.tempos || [])
        .map(t => ({ bpm: t.bpm, time: t.time }))
        .sort((a, b) => a.time - b.time);
    timeSigMap = (midiJson.header.timeSignatures || [])
        .map(ts => ({ num: ts.timeSignature[0], den: ts.timeSignature[1], time: ts.time }))
        .sort((a, b) => a.time - b.time);

    // デフォルト（情報がない場合のフォールバック）
    if (tempoMap.length === 0) tempoMap = [{ bpm: 120, time: 0 }];
    if (timeSigMap.length === 0) timeSigMap = [{ num: 4, den: 4, time: 0 }];

    // ノートを持つトラックのみ対象
    const activeTracks = midiJson.tracks.filter(t => t.notes.length > 0);
    const trackCount = activeTracks.length;

    // 2. トラックごとにシンセ・設定を生成
    activeTracks.forEach((track, i) => {
        const hue = Math.round((i * 360) / Math.max(trackCount, 1)) % 360;
        const synth = new Tone.PolySynth(Tone.Synth).toDestination();
        synth.volume.value = 0;

        const trackNotes = [];

        track.notes.forEach(note => {
            Tone.Transport.schedule((time) => {
                const ts = trackSettings[i];
                if (!ts || !ts.visible) return;
                synth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
            }, note.time);

            const noteObj = { ...note, trackIndex: i };
            trackNotes.push(noteObj);
            currentAllNotes.push(noteObj);

            const noteEnd = note.time + note.duration;
            if (noteEnd > totalDuration) totalDuration = noteEnd;
        });

        trackSettings.push({
            synth,
            hue,
            volume: 0,
            visible: true,
            notes: trackNotes,
            name: track.name || `Track ${i + 1}`,
        });
    });

    if (currentAllNotes.length === 0) return;

    // 3. グリッド線を事前計算
    gridLines = computeGridLines();

    // 4. シークバーの最大値を設定
    const seekBar = document.getElementById("seekBar");
    seekBar.max = totalDuration;
    seekBar.value = 0;

    // 5. トラックコントロールパネルを生成
    buildTrackPanel();

    // 6. 初期フレームを描画
    Tone.Transport.seconds = 0;
    renderStaticFrame();
}

// ---- テンポ・拍子ユーティリティ ----

/** 指定時刻のテンポを返す */
function getTempoAt(time) {
    let result = tempoMap[0];
    for (const t of tempoMap) {
        if (t.time <= time) result = t;
        else break;
    }
    return result;
}

/** 指定時刻の拍子を返す */
function getTimeSigAt(time) {
    let result = timeSigMap[0];
    for (const ts of timeSigMap) {
        if (ts.time <= time) result = ts;
        else break;
    }
    return result;
}

/** 全拍・小節線の時刻を事前計算する */
function computeGridLines() {
    const lines = [];
    let t = 0;
    let beatInMeasure = 0;
    let measureNumber = 1;
    let prevTs = null;

    while (t <= totalDuration + 4) {
        const ts = getTimeSigAt(t);
        const bpm = getTempoAt(t).bpm;

        // 拍子変化でカウントをリセット
        if (ts !== prevTs) {
            beatInMeasure = 0;
            prevTs = ts;
        }

        // 拍子の分子がそのまま1小節内のグリッド数になる（例: 4/4なら4、6/8なら6）
        const bpm_count = ts.num;
        const isMeasure = (beatInMeasure === 0);

        lines.push({
            time: t,
            isMeasure,
            measureNumber,          // 何小節目か（1始まり）
            beatInMeasure: beatInMeasure + 1, // 小節内拍番号（1始まり）
            totalBeats: bpm_count,  // 1小節の拍数
            timeSig: ts,            // 拍子情報
        });

        // 1拍の長さ(秒) = (60 / BPM) * (4 / 拍子の分母)
        // 例: BPM=120(四分音符=0.5秒) で 6/8拍子なら、1拍(八分音符)は 0.5 * (4/8) = 0.25秒
        const beatDuration = (60 / bpm) * (4 / ts.den);
        t += beatDuration;

        beatInMeasure = (beatInMeasure + 1) % bpm_count;
        if (beatInMeasure === 0) measureNumber++;
    }

    return lines;
}

/** 浮動小数をできる限り小さい整数/整数に変換する */
function getFractionStr(val, fixedDenom) {
    if (Math.abs(val) < 1e-3) return "0";
    if (Math.abs(val - 1) < 1e-3) return "1";
    
    // 指定された分母があり、かつ結果が整数に近ければそれに従う
    if (fixedDenom && fixedDenom > 0) {
        let n = Math.round(val * fixedDenom);
        if (Math.abs(val - n / fixedDenom) < 1e-3) {
            return `${n}/${fixedDenom}`;
        }
    }

    // そうでなければ最小の分母を探す
    for (let d = 2; d <= 128; d++) {
        let n = Math.round(val * d);
        if (n === 0 || n === d) continue;
        if (Math.abs(val - n / d) < 1e-3) {
            return `${n}/${d}`;
        }
    }
    return val.toFixed(2); // フォールバック
}

/** 時刻を #小節 整数/整数 の文字列に変換する */
function formatPosition(time) {
    if (gridLines.length === 0) return "";
    let currentMeasure = gridLines[0];
    for (let i = 0; i < gridLines.length; i++) {
        if (gridLines[i].isMeasure) {
            if (gridLines[i].time <= time + 1e-3) {
                currentMeasure = gridLines[i];
            } else {
                break;
            }
        }
    }
    
    const bpm = getTempoAt(currentMeasure.time).bpm;
    const ts = currentMeasure.timeSig;
    const measureDuration = (60 / bpm) * (4 / ts.den) * currentMeasure.totalBeats;
    
    let offset = time - currentMeasure.time;
    let fraction = offset / measureDuration;
    if (fraction < 0) fraction = 0;
    
    // オフセット計算
    let actualM = currentMeasure.measureNumber;
    let b = fraction * currentMeasure.totalBeats;
    
    const offsetM = parseInt(document.getElementById("offsetMeasure")?.value) || 0;
    const offsetB = parseFloat(document.getElementById("offsetBeat")?.value) || 0;
    
    b += offsetB;
    let targetMeasure = currentMeasure;
    let tb = targetMeasure.totalBeats;

    // 拍オフセットによって小節をまたぐ場合の正規化
    while (b < 0) {
        actualM -= 1;
        let prev = gridLines.find(l => l.isMeasure && l.measureNumber === actualM);
        if (prev) {
            targetMeasure = prev;
            tb = targetMeasure.totalBeats;
        }
        b += tb;
    }
    while (b >= tb && tb > 0) {
        b -= tb;
        actualM += 1;
        let next = gridLines.find(l => l.isMeasure && l.measureNumber === actualM);
        if (next) {
            targetMeasure = next;
            tb = targetMeasure.totalBeats;
        }
    }
    
    let dispM = actualM + offsetM;
    fraction = b / tb;
    if (fraction < 0) fraction = 0;
    
    const fixedDenom = parseInt(document.getElementById("fixedDenom")?.value) || 0;
    let fracStr = getFractionStr(fraction, fixedDenom);
    
    if (fracStr === "0") return `#${dispM}`;
    return `#${dispM} ${fracStr}`;
}

/** クリック位置の表示を更新する */
function updateClickPosDisplay() {
    const infoClickPos = document.getElementById("infoClickPos");
    if (!infoClickPos) return;
    
    if (selectedNote) {
        const startPos = formatPosition(selectedNote.time);
        const endPos = formatPosition(selectedNote.time + selectedNote.duration);
        infoClickPos.textContent = `始: ${startPos} / 終: ${endPos}`;
    } else if (lastClickedTime >= 0) {
        infoClickPos.textContent = formatPosition(lastClickedTime);
    } else {
        infoClickPos.textContent = "—";
    }
}

// 設定が変更された時のハンドラ
function onSettingsChange() {
    updateClickPosDisplay();
    renderStaticFrame();
}

document.addEventListener("DOMContentLoaded", () => {
    const fd = document.getElementById("fixedDenom");
    const om = document.getElementById("offsetMeasure");
    const ob = document.getElementById("offsetBeat");
    if (fd) fd.addEventListener("input", onSettingsChange);
    if (om) om.addEventListener("input", onSettingsChange);
    if (ob) ob.addEventListener("input", onSettingsChange);
});

/** 情報バーのBPM・拍子表示を更新する */
function updateInfoBar(currentTime) {
    const tempo = getTempoAt(currentTime);
    const ts = getTimeSigAt(currentTime);
    const bpmEl = document.getElementById("infoBpm");
    const tsEl = document.getElementById("infoTimeSig");
    if (bpmEl) bpmEl.textContent = Math.round(tempo.bpm);
    if (tsEl) tsEl.textContent = `${ts.num}/${ts.den}`;
}

// ---- トラックパネル生成 ----

function buildTrackPanel() {
    const container = document.getElementById("trackPanel");
    if (!container) return;
    container.innerHTML = "";

    trackSettings.forEach((ts, i) => {
        const row = document.createElement("div");
        row.className = "track-row";

        // 表示/非表示トグル
        const visBtn = document.createElement("button");
        visBtn.className = "track-btn track-btn--vis" + (ts.visible ? " track-btn--active" : "");
        visBtn.textContent = ts.visible ? "表示" : "非表示";
        visBtn.title = "表示/非表示";
        visBtn.addEventListener("click", () => {
            ts.visible = !ts.visible;
            visBtn.textContent = ts.visible ? "表示" : "非表示";
            visBtn.classList.toggle("track-btn--active", ts.visible);
            ts.synth.volume.value = ts.visible ? ts.volume : -Infinity;
            renderStaticFrame();
        });

        // トラック名ラベル
        const label = document.createElement("span");
        label.className = "track-label";
        label.textContent = ts.name;

        // 色ピッカー
        const colorSwatch = document.createElement("div");
        colorSwatch.className = "track-color-swatch";
        colorSwatch.style.background = hslString(ts.hue, 70, 55);
        colorSwatch.title = "色を変更";

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.className = "track-color-input";
        colorInput.value = hslToHex(ts.hue, 70, 55);
        colorInput.addEventListener("input", () => {
            const rgb = hexToRgb(colorInput.value);
            ts.hue = rgbToHue(rgb.r, rgb.g, rgb.b);
            colorSwatch.style.background = colorInput.value;
            renderStaticFrame();
        });

        const colorWrap = document.createElement("label");
        colorWrap.className = "track-color-wrap";
        colorWrap.title = "色を変更";
        colorWrap.appendChild(colorSwatch);
        colorWrap.appendChild(colorInput);

        // 音量スライダー
        const volWrap = document.createElement("div");
        volWrap.className = "track-vol-wrap";

        const volLabel = document.createElement("span");
        volLabel.className = "track-vol-label";
        volLabel.textContent = "音量";

        const volSlider = document.createElement("input");
        volSlider.type = "range";
        volSlider.className = "track-vol-slider";
        volSlider.min = -40;
        volSlider.max = 6;
        volSlider.step = 1;
        volSlider.value = ts.volume;
        volSlider.title = "音量 (dB)";

        const volValue = document.createElement("span");
        volValue.className = "track-vol-value";
        volValue.textContent = `${ts.volume} dB`;

        volSlider.addEventListener("input", () => {
            ts.volume = parseInt(volSlider.value);
            volValue.textContent = `${ts.volume} dB`;
            if (ts.visible) ts.synth.volume.value = ts.volume;
        });

        volWrap.appendChild(volLabel);
        volWrap.appendChild(volSlider);
        volWrap.appendChild(volValue);

        row.appendChild(visBtn);
        row.appendChild(colorWrap);
        row.appendChild(label);
        row.appendChild(volWrap);
        container.appendChild(row);
    });
}

// ---- 色ユーティリティ ----

function hslString(h, s, l) {
    return `hsl(${h}, ${s}%, ${l}%)`;
}

/** HSL → HEX */
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

/** HEX → RGB */
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

/** RGB → 色相(0-360) */
function rgbToHue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return Math.round(h * 360);
}

// ---- 描画 ----

const BASE_SPEED = 216; // 基準速度（ピクセル/秒）
const minMidi = 24;
const maxMidi = 108;
let zoomLevel = 1.0;    // 現在のズームレベル（1.0 = 100%）
let speed = BASE_SPEED; // zoomLevel に基づいて変動

/** ズームを factor 倍し、キャンバスを再描画する */
function applyZoom(factor) {
    zoomLevel = Math.max(0.1, Math.min(8.0, zoomLevel * factor));
    speed = BASE_SPEED * zoomLevel;
    const zoomEl = document.getElementById("zoomLevel");
    if (zoomEl) zoomEl.textContent = `${Math.round(zoomLevel * 100)}%`;
    renderStaticFrame();
}

/** ズームを指定レベルにリセットする */
function resetZoom(level = 1.0) {
    zoomLevel = level;
    speed = BASE_SPEED * zoomLevel;
    const zoomEl = document.getElementById("zoomLevel");
    if (zoomEl) zoomEl.textContent = `${Math.round(zoomLevel * 100)}%`;
    renderStaticFrame();
}

function drawFrame(currentTime) {
    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');
    const hitLineY = canvas.height - 108;
    const noteWidth = canvas.width / (maxMidi - minMidi + 1);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ---- グリッド線（拍・小節線）----
    const labelFontSize = Math.round(canvas.height * 0.016);
    ctx.font = `bold ${labelFontSize}px monospace`;
    ctx.textBaseline = 'bottom';

    gridLines.forEach(line => {
        const y = hitLineY - (line.time - currentTime) * speed;
        if (y < -2 || y > canvas.height + 2) return;

        if (line.isMeasure) {
            // 小節線: 白め・少し太い
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.lineWidth = 1.5;
        } else {
            // 拍線: 薄い
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
            ctx.lineWidth = 0.8;
        }
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();

        // 小節線の左端上に小節番号を描画
        if (line.isMeasure) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            const offsetM = parseInt(document.getElementById("offsetMeasure")?.value) || 0;
            ctx.fillText(`#${line.measureNumber + offsetM}`, 6, y - 3);
        }
    });

    // ---- 判定ライン ----
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitLineY);
    ctx.lineTo(canvas.width, hitLineY);
    ctx.stroke();

    // ---- ノート描画 ----
    currentAllNotes.forEach(note => {
        const ts = trackSettings[note.trackIndex];
        if (!ts || !ts.visible) return; // 非表示トラックはスキップ

        const x = (note.midi - minMidi) * noteWidth;
        const y = hitLineY - (note.time - currentTime) * speed;
        const height = note.duration * speed;

        if (y + height < 0 || y - height > canvas.height) return;

        const isActive = currentTime >= note.time && currentTime <= (note.time + note.duration);
        ctx.fillStyle = isActive
            ? `hsl(${ts.hue}, 100%, 70%)`
            : `hsl(${ts.hue}, 60%, 40%)`;

        ctx.beginPath();
        ctx.roundRect(x + 1, y - height, noteWidth - 2, height, 3);
        ctx.fill();
    });

    // ---- 選択ノートの点線描画 ----
    if (selectedNote !== null) {
        const ts = trackSettings[selectedNote.trackIndex];
        if (ts && ts.visible) {
            const yStart = hitLineY - (selectedNote.time - currentTime) * speed;
            const yEnd = hitLineY - (selectedNote.time + selectedNote.duration - currentTime) * speed;
            
            ctx.save();
            ctx.strokeStyle = `hsl(${ts.hue}, 100%, 70%)`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]); // 点線パターンの設定
            
            // 始点の横線
            if (yStart >= 0 && yStart <= canvas.height) {
                ctx.beginPath();
                ctx.moveTo(0, yStart);
                ctx.lineTo(canvas.width, yStart);
                ctx.stroke();
            }
            
            // 終点の横線
            if (yEnd >= 0 && yEnd <= canvas.height) {
                ctx.beginPath();
                ctx.moveTo(0, yEnd);
                ctx.lineTo(canvas.width, yEnd);
                ctx.stroke();
            }
            
            ctx.restore();
        }
    }

    // ---- 情報バー更新 ----
    if (gridLines.length > 0) {
        updateInfoBar(currentTime);
    }
}

function renderStaticFrame() {
    if (currentAllNotes.length === 0) return;
    drawFrame(Tone.Transport.seconds);
    updateSeekBar();
}

function renderLoop() {
    if (Tone.Transport.state !== "started") return;

    drawFrame(Tone.Transport.seconds);
    updateSeekBar();

    if (Tone.Transport.seconds >= totalDuration) {
        Tone.Transport.stop();
        document.getElementById("playButton").textContent = "再生";
        renderStaticFrame();
        return;
    }

    animationFrameId = requestAnimationFrame(renderLoop);
}

// ---- 再生 / 一時停止 ----

function togglePlayPause() {
    const playButton = document.getElementById("playButton");
    if (Tone.Transport.state === "started") {
        Tone.Transport.pause();
        playButton.textContent = "再生";
        renderStaticFrame();
    } else {
        Tone.start().then(() => {
            Tone.Transport.start();
            playButton.textContent = "一時停止";
            renderLoop();
        });
    }
}

// ---- シークバー ----

function updateSeekBar() {
    if (isSeeking) return;
    const seekBar = document.getElementById("seekBar");
    seekBar.value = Tone.Transport.seconds;
}

document.addEventListener("DOMContentLoaded", () => {
    const seekBar = document.getElementById("seekBar");

    seekBar.addEventListener("mousedown", () => { isSeeking = true; });

    seekBar.addEventListener("input", () => {
        const seekTime = parseFloat(seekBar.value);
        Tone.Transport.seconds = seekTime;
        renderStaticFrame();
    });

    const onSeekEnd = () => {
        isSeeking = false;
        if (Tone.Transport.state === "started") renderLoop();
    };
    seekBar.addEventListener("mouseup", onSeekEnd);
    seekBar.addEventListener("touchend", onSeekEnd);
});

// ---- ズームボタン ----

document.addEventListener("DOMContentLoaded", () => {
    const zoomIn = document.getElementById("zoomIn");
    const zoomOut = document.getElementById("zoomOut");
    const zoomReset = document.getElementById("zoomReset");
    if (zoomIn) zoomIn.addEventListener("click", () => applyZoom(1.25));
    if (zoomOut) zoomOut.addEventListener("click", () => applyZoom(1 / 1.25));
    if (zoomReset) zoomReset.addEventListener("click", () => resetZoom(1.0));
});

// ---- スクロール: Ctrl → ズーム / 通常 → シーク ----

document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("drawCanvas");

    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (currentAllNotes.length === 0) return;

        if (e.ctrlKey || e.metaKey) {
            // Ctrl+スクロール: ズーム（上スクロール = 拡大）
            const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
            applyZoom(factor);
        } else {
            // 通常スクロール: 時刻シーク
            const delta = e.deltaY * 0.003;
            let newTime = Tone.Transport.seconds + delta;
            newTime = Math.max(0, Math.min(totalDuration, newTime));
            Tone.Transport.seconds = newTime;
            renderStaticFrame();
        }
    }, { passive: false });
});

// ---- キャンバスクリックによる位置表示 ----

document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("drawCanvas");

    canvas.addEventListener("click", (e) => {
        if (gridLines.length === 0) return;

        // CSS座標 → キャンバス座標に変換（表示サイズとcanvas解像度の差を補正）
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        // Y座標 → 時刻に変換: y = hitLineY - (noteTime - currentTime) * speed
        const hitLineY = canvas.height - 108;
        const clickedTime = Tone.Transport.seconds + (hitLineY - canvasY) / speed;
        
        // X座標 → MIDIノート番号に変換
        const noteWidth = canvas.width / (maxMidi - minMidi + 1);
        const clickedMidi = minMidi + Math.floor(canvasX / noteWidth);

        let clickedNote = null;
        const timePadding = 3 / speed; // 3ピクセル分の時間的余裕

        for (let note of currentAllNotes) {
            const ts = trackSettings[note.trackIndex];
            if (!ts || !ts.visible) continue;
            
            if (note.midi === clickedMidi) {
                // クリックされた時間がノートの鳴っている期間内か判定
                if (clickedTime >= note.time - timePadding && clickedTime <= note.time + note.duration + timePadding) {
                    clickedNote = note;
                    break;
                }
            }
        }

        selectedNote = clickedNote;
        lastClickedTime = clickedTime;
        
        updateClickPosDisplay();
        renderStaticFrame();
    });
});

// ---- トラックパネルの折りたたみ ----

document.addEventListener("DOMContentLoaded", () => {
    const header = document.getElementById("trackPanelHeader");
    const panel = document.getElementById("trackPanel");
    const icon = document.getElementById("trackPanelToggleIcon");
    
    if (header && panel && icon) {
        header.addEventListener("click", () => {
            panel.classList.toggle("collapsed");
            icon.classList.toggle("collapsed");
        });
    }
});