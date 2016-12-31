class IRAnalyzer {
    private sensitivity = 0;
    private buffer: Float32Array;
    private buflen: number;
    private zeroValue: number;

    constructor(private app: App) {
        this.buffer = new Float32Array(32768);
        this.buflen = 0;
    }

    addSamples(channel1: Float32Array, channel2: Float32Array) {
        if (!this.sensitivity) {
            this.adjustSensitivity(channel1);
            this.adjustSensitivity(channel2);
            return;
        }

        var inputs: Float32Array;
        if (this.hasSignal(channel1))
            inputs = channel1;
        else if (this.hasSignal(channel2))
            inputs = channel2;

        if (inputs) {
            for (var i = 0; i < inputs.length; i++)
                this.buffer[this.buflen + i] = inputs[i];
            this.buflen += inputs.length;
            if (this.buflen + inputs.length <= this.buffer.length)
                return;
        }
        if (this.buflen == 0)
            return;

        var samples = this.normalizeBuffer();
        const threshold = (0.5 + this.zeroValue) / 2;
        this.buflen = 0;
        if (samples.length == 0)
            return;

        var p = null;
        var timings = [];
        for (var i = 1; i < samples.length; i++) {
            if ((samples[i-1] < threshold && samples[i] >= threshold) ||
                (samples[i-1] >= threshold && samples[i] < threshold)) {
                if (p)
                    timings.push(i - p);
                p = i;
            }
        }
        this.app.update(samples, this.zeroValue, timings);
    }

    private hasSignal(samples: Float32Array): boolean {
        for (var i = 1; i < samples.length; i++) {
            if (Math.abs(samples[i-1] - samples[i]) >= this.sensitivity)
                return true;
        }
        return false;
    }

    private adjustSensitivity(samples: Float32Array) {
        var max = 0;
        for (var i = 1; i < samples.length; i++)
            max = Math.max(max, Math.abs(samples[i-1] - samples[i]));
        if (this.sensitivity < max * 10) {
            this.sensitivity = max * 10;
            console.log('sensitivity: ' + this.sensitivity);
        }
    }

    private normalizeBuffer(): Float32Array {
        var min = this.buffer[0];
        var max = this.buffer[0];
        for (var i = 1; i < this.buflen; i++) {
            min = Math.min(min, this.buffer[i]);
            max = Math.max(max, this.buffer[i]);
        }
        var start = 0, end = 0;
        for (var i = 1; i < this.buflen; i++) {
            var d = this.buffer[i] - this.buffer[i-1];
            if (Math.abs(d) > (max - min) / 3) {
                if (!start)
                    start = i - 1;
                end = i + 1;
            }
        }
        if (end == start)
            return new Float32Array(0);
        start = Math.max(start - 100, 0);
        end = Math.min(end + 100, this.buflen);
        console.log([min, max, start, end]);
        var a = new Float32Array(end - start);
        for (var i = 0; i < end - start; i++) {
            a[i] = (this.buffer[start + i] - min) / (max - min);
        }
        this.zeroValue = -min / (max - min);
        return a;
    }
}

enum Format { NEC, AEHA, SONY };

class IRCodeParser {
    private unitLength: number;
    private format: Format;
    private bits: number[];

    constructor(timings: number[]) {
        this.determineUnitLength(timings);
        var i = this.format == Format.SONY ? 1 : 2;
        this.bits = this.parseData(timings, i);
    }

    dump() {
        var lines: string[] = [];
        lines.push('format: ' + ['NEC', 'AEHA', 'SONY'][this.format]);

        var customer: string;
        var bits: number[];
        switch (this.format) {
        case Format.NEC:
            customer = this.toHex(this.bits.slice(0, 16));
            bits = this.bits.slice(16);
            break;
        case Format.AEHA:
            customer = this.toHex(this.bits.slice(0, 16));
            // TODO: parity check
            bits = this.bits.slice(16);
            break;
        }
        lines.push('customer ID: ' + customer);
        lines.push('data:');
        while (bits && bits.length > 0) {
            var byte = bits.slice(0, 8);
            lines.push('  ' + byte.join('') + ' ' + this.toHex(byte));
            bits = bits.slice(8);
        }
        return lines.join('\n');
    }

    private determineUnitLength(data: number[]) {
        var leaderRatio = data[0] / data[1];
        if (leaderRatio > 1.9 && leaderRatio < 2.1) {
            var leaderSize = (data[0] + data[1]) / data[2];
            if (leaderSize > 22 && leaderSize < 26) {
                this.format = Format.NEC;
                this.unitLength = (data[0] + data[1]) / 24;
            } else if (leaderSize > 10 && leaderSize < 14) {
                this.format = Format.AEHA;
                this.unitLength = (data[0] + data[1]) / 12;
            }
        } else if (leaderRatio > 3.8 && leaderRatio < 4.2) {
            this.format = Format.SONY;
            this.unitLength =  data[0] / 4;
        }
        if (!this.unitLength)
            throw 'cannot find frame leader';
        console.log('T = ' + this.unitLength);
    }

    private toUnits(t: number) {
        return Math.round(t / this.unitLength);
    }

    private parseData(data: number[], start: number) {
        var bits: number[] = [];
        for (var i = start; i < data.length - 1; i += 2) {
            if (this.toUnits(data[i]) != 1)
                bits.push(-1);
            else if (this.toUnits(data[i+1]) == 1)
                bits.push(0);
            else if (this.toUnits(data[i+1]) == 3)
                bits.push(1);
            else
                break;
        }
        return bits;
    }

    private toHex(bits: number[]): string {
        var r = 0;
        for (var i = 0; i < bits.length; i++) {
            if (bits[i])
                r |= (1 << i);
        }
        var w = Math.ceil(bits.length / 4);
        return (Array(w).join('0') + r.toString(16)).slice(-w);
    }
}

class View {
    updateJson(timings: number[], sampleRate: number) {
        var scaled = timings.map((t) => Math.round(t * 2e6 / sampleRate));
        var json = JSON.stringify({format:'raw', freq:38, data: scaled});
        document.getElementById('irkit-json').innerText = json;
    }

    updateDuration(durationMs: number) {
        document.getElementById('duration').innerText = Math.round(durationMs) + '';
    }

    updateParsed(s: string) {
        document.getElementById('parsed').innerText = s;
    }

    visualize(samples: Float32Array, zeroValue: number) {
        var canvas = <HTMLCanvasElement>document.getElementById('visualizer');
        const cw = canvas.width, ch = canvas.height;
        var ctx = (canvas).getContext('2d');
        ctx.clearRect(0, 0, cw, ch);
        ctx.beginPath();
        ctx.strokeStyle = 'gray';
        ctx.moveTo(0, zeroValue * ch);
        ctx.lineTo(cw, zeroValue * ch);
        ctx.stroke();

        ctx.strokeStyle = 'lime';
        ctx.beginPath();
        ctx.moveTo(0, samples[0] * ch);
        for (var i = 0; i < samples.length; i++) {
            var x = i / samples.length * cw;
            var y = samples[i] * ch;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

class App {
    private view: View;
    private audioContext: AudioContext;
    private node: ScriptProcessorNode;
    private analyzer: IRAnalyzer;

    constructor() {
        this.view = new View();
        this.audioContext = new AudioContext();
        this.analyzer = new IRAnalyzer(this);
        this.node = this.audioContext.createScriptProcessor(16384, 2, 1);
        this.node.onaudioprocess = this.onaudioprocess.bind(this);

        // Turn of audio processing and enable stereo input in Chrome
        // (https://crbug.com/453876#c11).
        // Unfortunately Firefox does not support stereo input
        // (https://bugzilla.mozilla.org/show_bug.cgi?id=971528).
        var audioConstraint = {optional: [{ echoCancellation: false }]};

        navigator.mediaDevices.getUserMedia({video:false, audio:<any>audioConstraint}).then((stream) => {
            var input = this.audioContext.createMediaStreamSource(stream);
            input.connect(this.node);
            this.node.connect(this.audioContext.destination);
        }, (err) => { throw err; });
    }

    update(samples: Float32Array, zeroValue: number, timings: number[]) {
        this.view.updateJson(timings, this.audioContext.sampleRate);
        this.view.updateDuration(samples.length / this.audioContext.sampleRate * 1000);
        this.view.visualize(samples, zeroValue);
        try {
            var parser = new IRCodeParser(timings);
            this.view.updateParsed(parser.dump());
        } catch (e) {
            this.view.updateParsed(e);
        }
    }

    private onaudioprocess(event: AudioProcessingEvent) {
        this.analyzer.addSamples(event.inputBuffer.getChannelData(0),
                                 event.inputBuffer.getChannelData(1));
    }
}

var app = new App();
