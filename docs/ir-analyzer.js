var IRAnalyzer = (function () {
    function IRAnalyzer(app) {
        this.app = app;
        this.sensitivity = 0;
        this.buffer = new Float32Array(32768);
        this.buflen = 0;
    }
    IRAnalyzer.prototype.addSamples = function (channel1, channel2) {
        if (!this.sensitivity) {
            this.adjustSensitivity(channel1);
            this.adjustSensitivity(channel2);
            return;
        }
        var inputs;
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
        var threshold = (0.5 + this.zeroValue) / 2;
        this.buflen = 0;
        if (samples.length == 0)
            return;
        var p = null;
        var timings = [];
        for (var i = 1; i < samples.length; i++) {
            if ((samples[i - 1] < threshold && samples[i] >= threshold) ||
                (samples[i - 1] >= threshold && samples[i] < threshold)) {
                if (p)
                    timings.push(i - p);
                p = i;
            }
        }
        this.app.update(samples, this.zeroValue, timings);
    };
    IRAnalyzer.prototype.hasSignal = function (samples) {
        for (var i = 1; i < samples.length; i++) {
            if (Math.abs(samples[i - 1] - samples[i]) >= this.sensitivity)
                return true;
        }
        return false;
    };
    IRAnalyzer.prototype.adjustSensitivity = function (samples) {
        var max = 0;
        for (var i = 1; i < samples.length; i++)
            max = Math.max(max, Math.abs(samples[i - 1] - samples[i]));
        if (this.sensitivity < max * 10) {
            this.sensitivity = max * 10;
            console.log('sensitivity: ' + this.sensitivity);
        }
    };
    IRAnalyzer.prototype.normalizeBuffer = function () {
        var min = this.buffer[0];
        var max = this.buffer[0];
        for (var i = 1; i < this.buflen; i++) {
            min = Math.min(min, this.buffer[i]);
            max = Math.max(max, this.buffer[i]);
        }
        var start = 0, end = 0;
        for (var i = 1; i < this.buflen; i++) {
            var d = this.buffer[i] - this.buffer[i - 1];
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
    };
    return IRAnalyzer;
}());
var Format;
(function (Format) {
    Format[Format["NEC"] = 0] = "NEC";
    Format[Format["AEHA"] = 1] = "AEHA";
    Format[Format["SONY"] = 2] = "SONY";
})(Format || (Format = {}));
;
var IRCodeParser = (function () {
    function IRCodeParser(timings) {
        this.determineUnitLength(timings);
        var i = this.format == Format.SONY ? 1 : 2;
        this.bits = this.parseData(timings, i);
    }
    IRCodeParser.prototype.dump = function () {
        var lines = [];
        lines.push('format: ' + ['NEC', 'AEHA', 'SONY'][this.format]);
        var customer;
        var bits;
        switch (this.format) {
            case Format.NEC:
                customer = this.toHex(this.bits.slice(0, 16));
                bits = this.bits.slice(16);
                break;
            case Format.AEHA:
                customer = this.toHex(this.bits.slice(0, 16));
                bits = this.bits.slice(16);
                break;
            case Format.SONY:
                bits = this.bits;
                break;
        }
        if (customer)
            lines.push('customer ID: ' + customer);
        lines.push('data:');
        while (bits && bits.length > 0) {
            var byte = bits.slice(0, 8);
            lines.push('  ' + rightpad(byte.join(''), 9, ' ') + this.toHex(byte));
            bits = bits.slice(8);
        }
        return lines.join('\n');
    };
    IRCodeParser.prototype.determineUnitLength = function (data) {
        var leaderRatio = data[0] / data[1];
        if (leaderRatio > 1.9 && leaderRatio < 2.1) {
            var leaderSize = (data[0] + data[1]) / data[2];
            if (leaderSize > 20 && leaderSize < 28) {
                this.format = Format.NEC;
                this.unitLength = (data[0] + data[1]) / 24;
            }
            else if (leaderSize > 10 && leaderSize < 14) {
                this.format = Format.AEHA;
                this.unitLength = (data[0] + data[1]) / 12;
            }
        }
        else if (leaderRatio > 3.6 && leaderRatio < 4.4) {
            this.format = Format.SONY;
            this.unitLength = data[0] / 4;
        }
        if (!this.unitLength)
            throw 'cannot find frame leader';
        console.log('T = ' + this.unitLength);
    };
    IRCodeParser.prototype.toUnits = function (t) {
        return Math.round(t / this.unitLength);
    };
    IRCodeParser.prototype.parseData = function (data, start) {
        var bitOnLength = this.format == Format.SONY ? 2 : 3;
        var bits = [];
        for (var i = start; i < data.length - 1; i += 2) {
            if (this.toUnits(data[i]) != 1)
                break;
            else if (this.toUnits(data[i + 1]) == 1)
                bits.push(0);
            else if (this.toUnits(data[i + 1]) == bitOnLength)
                bits.push(1);
            else
                break;
        }
        return bits;
    };
    IRCodeParser.prototype.toHex = function (bits) {
        var r = 0;
        for (var i = 0; i < bits.length; i++) {
            if (bits[i])
                r |= (1 << i);
        }
        return leftpad(r.toString(16), Math.ceil(bits.length / 4), '0');
    };
    return IRCodeParser;
}());
var View = (function () {
    function View() {
    }
    View.prototype.updateJson = function (timings, sampleRate) {
        var scaled = timings.map(function (t) { return Math.round(t * 2e6 / sampleRate); });
        var json = JSON.stringify({ format: 'raw', freq: 38, data: scaled });
        document.getElementById('irkit-json').innerText = json;
    };
    View.prototype.updateDuration = function (durationMs) {
        document.getElementById('duration').innerText = Math.round(durationMs) + '';
    };
    View.prototype.updateParsed = function (s) {
        document.getElementById('parsed').innerText = s;
    };
    View.prototype.visualize = function (samples, zeroValue) {
        var canvas = document.getElementById('visualizer');
        var cw = canvas.width, ch = canvas.height;
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
    };
    return View;
}());
var App = (function () {
    function App() {
        var _this = this;
        var startButton = document.getElementById('start');
        startButton.addEventListener('click', function () {
            startButton.style.display = 'none';
            _this.start();
        });
    }
    App.prototype.start = function () {
        var _this = this;
        this.view = new View();
        this.audioContext = new AudioContext();
        this.analyzer = new IRAnalyzer(this);
        this.node = this.audioContext.createScriptProcessor(16384, 2, 1);
        this.node.onaudioprocess = this.onaudioprocess.bind(this);
        var audioConstraint = { optional: [{ echoCancellation: false }] };
        navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint }).then(function (stream) {
            var input = _this.audioContext.createMediaStreamSource(stream);
            input.connect(_this.node);
            _this.node.connect(_this.audioContext.destination);
        }, function (err) { throw err; });
    };
    App.prototype.update = function (samples, zeroValue, timings) {
        this.view.updateJson(timings, this.audioContext.sampleRate);
        this.view.updateDuration(samples.length / this.audioContext.sampleRate * 1000);
        this.view.visualize(samples, zeroValue);
        try {
            var parser = new IRCodeParser(timings);
            this.view.updateParsed(parser.dump());
        }
        catch (e) {
            this.view.updateParsed(e);
        }
    };
    App.prototype.onaudioprocess = function (event) {
        this.analyzer.addSamples(event.inputBuffer.getChannelData(0), event.inputBuffer.getChannelData(1));
    };
    return App;
}());
function leftpad(str, len, ch) {
    return (Array(len).join(ch) + str).slice(-len);
}
function rightpad(str, len, ch) {
    return (str + Array(len).join(ch)).slice(0, len);
}
var app = new App();
