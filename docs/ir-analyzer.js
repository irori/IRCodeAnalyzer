var sensitivity = 0.005;
var IRAnalyzer = (function () {
    function IRAnalyzer(app) {
        this.app = app;
        this.buffer = new Float32Array(32768);
        this.buflen = 0;
    }
    IRAnalyzer.prototype.addSamples = function (channel1, channel2) {
        var inputs;
        if (this.hasSignal(channel1))
            inputs = channel1;
        else if (this.hasSignal(channel2))
            inputs = channel2;
        if (inputs) {
            for (var i = 0; i < inputs.length; i++)
                this.buffer[this.buflen + i] = inputs[i];
            this.buflen += inputs.length;
            return;
        }
        if (this.buflen == 0)
            return;
        var threshold = 0.5;
        var samples = this.normalizeBuffer();
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
            if (Math.abs(samples[i - 1] - samples[i]) >= sensitivity)
                return true;
        }
        return false;
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
        var i = this.parseLeader(timings);
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
        }
        lines.push('customer ID: ' + customer);
        lines.push('data:');
        while (bits && bits.length > 0) {
            var byte = bits.slice(0, 8);
            lines.push('  ' + byte.join('') + ' ' + this.toHex(byte));
            bits = bits.slice(8);
        }
        return lines.join('\n');
    };
    IRCodeParser.prototype.determineUnitLength = function (data) {
        var h = {};
        for (var i = 0; i < data.length; i++) {
            h[data[i]] = (h[data[i]] || 0) + 1;
        }
        var max = 0, maxIndex;
        for (var j in h) {
            if (h[j] > max) {
                max = h[j];
                maxIndex = j;
            }
        }
        this.unitLength = parseInt(maxIndex);
        console.log('T = ' + this.unitLength);
    };
    IRCodeParser.prototype.toUnits = function (t) {
        return Math.round(t / this.unitLength);
    };
    IRCodeParser.prototype.parseLeader = function (data) {
        for (var i = 1; i < data.length; i++) {
            if (this.toUnits(data[i - 1]) == 16 && this.toUnits(data[i]) == 8) {
                this.format = Format.NEC;
                return i + 1;
            }
            if (this.toUnits(data[i - 1]) == 8 && this.toUnits(data[i]) == 4) {
                this.format = Format.AEHA;
                return i + 1;
            }
            if (this.toUnits(data[i - 1]) == 4 && this.toUnits(data[i]) == 1) {
                this.format = Format.SONY;
                return i;
            }
        }
        throw 'cannot find frame leader';
    };
    IRCodeParser.prototype.parseData = function (data, start) {
        var bits = [];
        for (var i = start; i < data.length - 1; i += 2) {
            if (this.toUnits(data[i]) != 1)
                bits.push(-1);
            else if (this.toUnits(data[i + 1]) == 1)
                bits.push(0);
            else if (this.toUnits(data[i + 1]) == 3)
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
        var w = bits.length / 4;
        return (Array(w).join('0') + r.toString(16)).slice(-w);
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
    }
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
var app = new App();
