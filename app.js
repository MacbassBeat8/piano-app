document.addEventListener('DOMContentLoaded', () => {
    const NOTES_PER_BAR = 8;          // 1小節 = 8音 (8分音符ベース)
    const TOTAL_BARS = 32;            // 総小節数 = 32小節
    const TOTAL_STEPS = TOTAL_BARS * NOTES_PER_BAR; // 256ステップ
    const STEP_WIDTH = 28;            // 1ステップあたりのピクセル幅
    const ROW_HEIGHT = 20;            // 1音あたりの高さ (px)

    const PITCHES = [];
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (let midi = 96; midi >= 60; midi--) {
        const octave = Math.floor(midi / 12) - 1;
        const name = noteNames[midi % 12];
        PITCHES.push(`${name}${octave}`);
    }

    let state = {
        bpm: 120,
        notes: []
    };

    let isPlaying = false;
    let currentStep = 0;
    let playbackTimer = null;
    let audioCtx = null;

    let isDrawingNote = false;
    let drawStartStep = 0;
    let drawPitch = '';
    let currentDrawStep = 0;
    let tempNoteElement = null;

    const keyboardContainer = document.getElementById('keyboard-container');
    const keyboardScrollSync = document.getElementById('keyboard-scroll-sync');
    const rollScrollContainer = document.getElementById('roll-scroll-container');
    const barNumbersContainer = document.getElementById('bar-numbers-container');
    const gridCanvasArea = document.getElementById('grid-canvas-area');
    const playhead = document.getElementById('playhead');
    
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');
    const bpmInput = document.getElementById('bpm-input');
    const metronomeTypeSelect = document.getElementById('metronome-type-select');
    const exportJsonBtn = document.getElementById('export-json-btn');
    const importJsonInput = document.getElementById('import-json-input');
    const exportWavBtn = document.getElementById('export-wav-btn');

    function init() {
        buildKeyboard();
        buildTimelineHeader();
        buildGridBackground();
        renderNotes();
        setupEventListeners();
    }

    function buildKeyboard() {
        keyboardContainer.innerHTML = '';
        // CSS Gridを使用して累積誤差（ズレ）を完全に防止する
        keyboardContainer.style.display = 'grid';
        keyboardContainer.style.gridTemplateRows = `repeat(${PITCHES.length}, ${ROW_HEIGHT}px)`;
        keyboardContainer.style.height = `${PITCHES.length * ROW_HEIGHT}px`;

        PITCHES.forEach(pitch => {
            const keyDiv = document.createElement('div');
            const isSharp = pitch.includes('#');
            keyDiv.className = `px-2 flex items-center text-[10px] font-mono border-b border-slate-700 box-border select-none cursor-pointer ${isSharp ? 'key-black' : 'key-white'}`;
            keyDiv.style.height = `${ROW_HEIGHT}px`;
            keyDiv.textContent = pitch;
            keyDiv.addEventListener('mousedown', () => playTone(pitch, 0.3));
            keyboardContainer.appendChild(keyDiv);
        });
    }

    function buildTimelineHeader() {
        barNumbersContainer.innerHTML = '';
        barNumbersContainer.style.width = `${TOTAL_STEPS * STEP_WIDTH}px`;

        for (let bar = 1; bar <= TOTAL_BARS; bar++) {
            const barDiv = document.createElement('div');
            barDiv.style.width = `${NOTES_PER_BAR * STEP_WIDTH}px`;
            barDiv.className = 'border-r border-slate-600 text-xs text-slate-400 px-1 font-mono flex items-center h-full select-none';
            barDiv.textContent = `${bar}`;
            barNumbersContainer.appendChild(barDiv);
        }
    }

    function buildGridBackground() {
        gridCanvasArea.innerHTML = '';
        const totalWidth = TOTAL_STEPS * STEP_WIDTH;
        const totalHeight = PITCHES.length * ROW_HEIGHT;

        gridCanvasArea.style.width = `${totalWidth}px`;
        gridCanvasArea.style.height = `${totalHeight}px`;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', totalWidth);
        svg.setAttribute('height', totalHeight);
        svg.setAttribute('class', 'absolute inset-0 pointer-events-none');

        PITCHES.forEach((_, index) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', 0);
            line.setAttribute('y1', (index + 1) * ROW_HEIGHT);
            line.setAttribute('x2', totalWidth);
            line.setAttribute('y2', (index + 1) * ROW_HEIGHT);
            line.setAttribute('stroke', '#1e293b');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        });

        for (let step = 0; step <= TOTAL_STEPS; step++) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const x = step * STEP_WIDTH;
            line.setAttribute('x1', x);
            line.setAttribute('y1', 0);
            line.setAttribute('x2', x);
            line.setAttribute('y2', totalHeight);

            if (step > 0 && step % 64 === 0) {
                line.setAttribute('stroke', '#94a3b8');
                line.setAttribute('stroke-width', '2.5');
            } else if (step % 8 === 0) {
                line.setAttribute('stroke', '#475569');
                line.setAttribute('stroke-width', '1.5');
            } else if (step % 2 === 0) {
                line.setAttribute('stroke', '#334155');
                line.setAttribute('stroke-width', '1');
            } else {
                line.setAttribute('stroke', '#1e293b');
                line.setAttribute('stroke-width', '1');
            }
            svg.appendChild(line);
        }

        gridCanvasArea.appendChild(svg);
    }

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function pitchToFreq(pitch) {
        const noteNames = {'C':0, 'C#':1, 'D':2, 'D#':3, 'E':4, 'F':5, 'F#':6, 'G':7, 'G#':8, 'A':9, 'A#':10, 'B':11};
        const name = pitch.slice(0, -1);
        const octave = parseInt(pitch.slice(-1), 10);
        const semitoneFromC0 = octave * 12 + noteNames[name];
        return 440 * Math.pow(2, (semitoneFromC0 - 69) / 12);
    }

    function playToneOnContext(ctx, pitch, time, durationSec) {
        const freq = pitchToFreq(pitch);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.4, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + Math.max(durationSec, 0.1));

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(time);
        osc.stop(time + Math.max(durationSec, 0.1));
    }

    function playMetronomeClickOnContext(ctx, time, isBarStart, type) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        if (type === 'wood') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(isBarStart ? 800 : 600, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.15, time + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
        } else if (type === 'hat') {
            const bufferSize = ctx.sampleRate * 0.03;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 7000;

            gain.gain.setValueAtTime(isBarStart ? 0.25 : 0.15, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            noise.start(time);
            return;
        } else {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(isBarStart ? 1000 : 800, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.2, time + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        }

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(time);
        osc.stop(time + 0.05);
    }

    function playTone(pitch, durationSec = 0.5) {
        const ctx = getAudioContext();
        playToneOnContext(ctx, pitch, ctx.currentTime, durationSec);
    }

    function renderNotes() {
        const existingNotes = gridCanvasArea.querySelectorAll('.note-block');
        existingNotes.forEach(el => el.remove());

        state.notes.forEach((note, index) => {
            const pitchIndex = PITCHES.indexOf(note.pitch);
            if (pitchIndex === -1) return;

            const noteDiv = document.createElement('div');
            noteDiv.className = 'note-block';
            noteDiv.style.left = `${note.startStep * STEP_WIDTH}px`;
            noteDiv.style.top = `${pitchIndex * ROW_HEIGHT + 1}px`;
            noteDiv.style.width = `${note.duration * STEP_WIDTH - 2}px`;
            noteDiv.style.height = `${ROW_HEIGHT - 2}px`;

            noteDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                state.notes.splice(index, 1);
                renderNotes();
            });

            noteDiv.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                playTone(note.pitch, 0.4 * note.duration);
            });

            gridCanvasArea.appendChild(noteDiv);
        });
    }

    gridCanvasArea.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('note-block') || e.target.closest('.note-block')) return;
        if (e.target !== gridCanvasArea && e.target.tagName !== 'svg' && !e.target.closest('svg')) return;

        const rect = gridCanvasArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const step = Math.floor(x / STEP_WIDTH);
        const pitchIndex = Math.floor(y / ROW_HEIGHT);

        if (step >= 0 && step < TOTAL_STEPS && pitchIndex >= 0 && pitchIndex < PITCHES.length) {
            isDrawingNote = true;
            drawStartStep = step;
            currentDrawStep = step;
            drawPitch = PITCHES[pitchIndex];

            tempNoteElement = document.createElement('div');
            tempNoteElement.className = 'note-block opacity-70 border-dashed pointer-events-none';
            tempNoteElement.style.left = `${drawStartStep * STEP_WIDTH}px`;
            tempNoteElement.style.top = `${pitchIndex * ROW_HEIGHT + 1}px`;
            tempNoteElement.style.width = `${STEP_WIDTH - 2}px`;
            tempNoteElement.style.height = `${ROW_HEIGHT - 2}px`;
            gridCanvasArea.appendChild(tempNoteElement);
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDrawingNote || !tempNoteElement) return;

        const rect = gridCanvasArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const step = Math.floor(x / STEP_WIDTH);

        const clampedStep = Math.max(drawStartStep, Math.min(step, TOTAL_STEPS - 1));
        const duration = (clampedStep - drawStartStep) + 1;

        tempNoteElement.style.width = `${duration * STEP_WIDTH - 2}px`;
        currentDrawStep = clampedStep;
    });

    window.addEventListener('mouseup', () => {
        if (!isDrawingNote) return;
        isDrawingNote = false;

        if (tempNoteElement) {
            tempNoteElement.remove();
            tempNoteElement = null;
        }

        const duration = (currentDrawStep - drawStartStep) + 1;

        state.notes.push({
            pitch: drawPitch,
            startStep: drawStartStep,
            duration: duration
        });

        const stepDurationSec = 30 / (parseInt(bpmInput.value, 10) || 120);
        playTone(drawPitch, stepDurationSec * duration);
        renderNotes();
    });

    function getStepInterval() {
        const bpm = parseInt(bpmInput.value, 10) || 120;
        state.bpm = bpm;
        return 30000 / bpm;
    }

    function startPlayback() {
        if (isPlaying) return;
        const ctx = getAudioContext();
        isPlaying = true;
        playBtn.classList.add('ring-2', 'ring-white');

        playhead.classList.remove('hidden');
        let intervalMs = getStepInterval();
        const metroType = metronomeTypeSelect.value;

        playbackTimer = setInterval(() => {
            if (currentStep % 2 === 0) {
                const isBarStart = (currentStep % NOTES_PER_BAR === 0);
                playMetronomeClickOnContext(ctx, ctx.currentTime, isBarStart, metroType);
            }

            const notesToPlay = state.notes.filter(n => n.startStep === currentStep);
            notesToPlay.forEach(n => {
                const noteDurationSec = (intervalMs / 1000) * n.duration;
                playTone(n.pitch, noteDurationSec);
            });

            playhead.style.left = `${currentStep * STEP_WIDTH}px`;

            const headLeft = currentStep * STEP_WIDTH;
            if (headLeft < rollScrollContainer.scrollLeft || headLeft > rollScrollContainer.scrollLeft + rollScrollContainer.clientWidth - 100) {
                rollScrollContainer.scrollLeft = Math.max(0, headLeft - 100);
            }

            currentStep++;
            if (currentStep >= TOTAL_STEPS) {
                stopPlayback();
            }
        }, intervalMs);
    }

    function stopPlayback() {
        isPlaying = false;
        clearInterval(playbackTimer);
        playbackTimer = null;
        currentStep = 0;
        playBtn.classList.remove('ring-2', 'ring-white');
        playhead.classList.add('hidden');
        playhead.style.left = '0px';
    }

    async function exportWav() {
        const bpm = parseInt(bpmInput.value, 10) || 120;
        state.bpm = bpm;
        const stepTimeSec = 30 / bpm; 
        const totalDurationSec = TOTAL_STEPS * stepTimeSec + 2.0;
        const metroType = metronomeTypeSelect.value;

        const sampleRate = 44100;
        const offlineCtx = new OfflineAudioContext(1, sampleRate * totalDurationSec, sampleRate);

        for (let step = 0; step < TOTAL_STEPS; step++) {
            if (step % 2 === 0) {
                const startTime = step * stepTimeSec;
                const isBarStart = (step % NOTES_PER_BAR === 0);
                playMetronomeClickOnContext(offlineCtx, startTime, isBarStart, metroType);
            }
        }

        state.notes.forEach(note => {
            const startTime = note.startStep * stepTimeSec;
            const durationSec = (note.duration * stepTimeSec) + 0.5;
            playToneOnContext(offlineCtx, note.pitch, startTime, durationSec);
        });

        exportWavBtn.textContent = "生成中...";
        exportWavBtn.disabled = true;

        try {
            const renderedBuffer = await offlineCtx.startRendering();
            const wavBlob = bufferToWav(renderedBuffer);
            
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'music.wav';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("WAV出力エラー:", err);
            alert("WAV出力に失敗しました。");
        } finally {
            exportWavBtn.textContent = "WAV出力";
            exportWavBtn.disabled = false;
        }
    }

    function bufferToWav(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        const samples = buffer.getChannelData(0);
        
        const bufferLength = samples.length;
        const blockAlign = (numOfChan * bitDepth) / 8;
        const byteRate = sampleRate * blockAlign;
        const dataSize = bufferLength * blockAlign;
        const chunkSize = 36 + dataSize;

        const arrayBuffer = new ArrayBuffer(8 + chunkSize);
        const view = new DataView(arrayBuffer);

        let offset = 0;
        function writeString(str) {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset++, str.charCodeAt(i));
            }
        }

        writeString('RIFF');
        view.setUint32(offset, chunkSize, true); offset += 4;
        writeString('WAVE');

        writeString('fmt ');
        view.setUint32(offset, 16, true); offset += 4;
        view.setUint16(offset, format, true); offset += 2;
        view.setUint16(offset, numOfChan, true); offset += 2;
        view.setUint32(offset, sampleRate, true); offset += 4;
        view.setUint32(offset, byteRate, true); offset += 4;
        view.setUint16(offset, blockAlign, true); offset += 2;
        view.setUint16(offset, bitDepth, true); offset += 2;

        writeString('data');
        view.setUint32(offset, dataSize, true); offset += 4;

        for (let i = 0; i < bufferLength; i++) {
            let sample = Math.max(-1, Math.min(1, samples[i]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767);
            view.setInt16(offset, sample, true);
            offset += 2;
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    function setupEventListeners() {
        playBtn.addEventListener('click', () => {
            if (isPlaying) {
                stopPlayback();
            } else {
                startPlayback();
            }
        });

        stopBtn.addEventListener('click', stopPlayback);

        clearBtn.addEventListener('click', () => {
            if (confirm("すべてのノートを削除しますか？")) {
                stopPlayback();
                state.notes = [];
                renderNotes();
            }
        });

        bpmInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val)) val = 120;
            if (val < 40) val = 40;
            if (val > 240) val = 240;
            bpmInput.value = val;
            state.bpm = val;
        });

        exportJsonBtn.addEventListener('click', () => {
            state.bpm = parseInt(bpmInput.value, 10) || 120;
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
            const a = document.createElement('a');
            a.href = dataStr;
            a.download = "piano_roll_song.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

        importJsonInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const loadedData = JSON.parse(event.target.result);
                    if (loadedData && Array.isArray(loadedData.notes)) {
                        stopPlayback();
                        state.notes = loadedData.notes;
                        if (loadedData.bpm) {
                            bpmInput.value = loadedData.bpm;
                            state.bpm = loadedData.bpm;
                        }
                        renderNotes();
                        alert("JSONファイルを読み込みました！");
                    } else {
                        alert("無効なJSONフォーマットです。");
                    }
                } catch (err) {
                    console.error(err);
                    alert("JSONの解析に失敗しました。");
                }
                importJsonInput.value = '';
            };
            reader.readAsText(file);
        });

        exportWavBtn.addEventListener('click', exportWav);

        rollScrollContainer.addEventListener('scroll', () => {
            keyboardScrollSync.scrollTop = rollScrollContainer.scrollTop;
        });
    }

    init();
});