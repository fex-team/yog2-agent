var getArgv = require('../../lib/util.js').getArgv;
var PORT = getArgv('port');
PORT = parseInt(PORT.replace('$PORT', process.env.port), 10) + parseInt(getArgv('portOffset'), 10);
var LOGS = JSON.parse(getArgv('logs'));
var ROOT_PATH = getArgv('root_path');
var strftime = require('fast-strftime');
var ts = require('tail-stream');
var fs = require('fs');
var path = require('path');
var io = require('socket.io')(PORT);
var byline = require('byline');
require('socket.io-stream')(io);
console.log('[yog2-agent] logview server is listening to', PORT);

var logMap = LOGS.reduce(function (prev, current) {
    prev[current.name] = current;
    return prev;
}, {});

io.on('connection', function (socket) {
    var logStreams = [];

    console.log('[yog2-agent] logview client connected');

    socket.on('cat', function (message) {
        console.log('[yog2-agent] client request log');
        catLog(message.name, message.from, message.to, message.grep, message.excludeGrep, socket);
    });

    socket.on('tail', function (message) {
        console.log('[yog2-agent] client request log');
        var stream = tailNewestLog(message.name, message.grep, message.excludeGrep, socket);
        if (!stream) {
            socket.emit('notfound', {
                cmd: 'tail',
                name: message.name
            });
        }
        else {
            logStreams.push(stream);
        }
    });

    socket.emit('list', LOGS.map(function (conf) {
        return conf.name;
    }));

    socket.on('disconnect', function () {
        console.log('[yog2-agent] logview client disconnected, close all logs');
        logStreams.forEach(function (stream) {
            stream.end();
        });
    });
});

function catLog(name, from, to, grep, socket) {

}

function tailNewestLog(name, grep, excludeGrep, socket) {
    var now = new Date();
    var conf = logMap[name];
    var logPath = path.join(ROOT_PATH, strftime(conf.path, now));
    var stream;
    var r = new RegExp(grep);
    try {
        stream = ts.createReadStream(logPath, {
            beginAt: 'end',
            onMove: 'end',
            detectTruncate: true,
            onTruncate: 'reset',
            endOnError: true
        });
        var eventID = name + '#tail';
        console.log('[yog2-agent] open log', logPath, 'with tail');
        var prevChunk = '';
        stream.on('data', function (data) {
            var chunk = data.toString();
            var lines = chunk.split('\n');
            lines[0] = prevChunk + lines[0];
            if (lines[lines.length - 1] !== '' && lines[lines.length - 1] !== '\n') {
                // 说明结尾内容不是完整的一行
                prevChunk = lines.pop();
            }
            var content = lines.reduce(function (prev, now) {
                var matched = !grep || r.test(now);
                if ((excludeGrep && !matched) || (!excludeGrep && matched)) {
                    prev += now + '\n';
                }
                return prev;
            }, '');
            if (content !== '') {
                socket.emit(eventID, content);
            }
        });
        return stream;
    }
    catch (e) {
        console.log('[yog2-agent] log', logPath, 'not found');
        return null;
    }
}
