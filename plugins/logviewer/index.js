var getArgv = require('../../lib/util.js').getArgv;
var PORT = getArgv('port');
PORT = parseInt(PORT.replace('$PORT', process.env.port || process.env.PORT), 10) + parseInt(getArgv('portOffset'), 10);
var LOGS = JSON.parse(getArgv('logs'));
var ROOT_PATH = getArgv('root_path');
var strftime = require('fast-strftime');
var ts = require('tail-stream');
var fs = require('fs');
var path = require('path');
var io = require('socket.io')(PORT);
var byline = require('byline');
var async = require('async');
console.log('[yog2-agent] logview server is listening to', PORT);

var logMap = LOGS.reduce(function (prev, current) {
    prev[current.name] = current;
    return prev;
}, {});

io.on('connection', function (socket) {
    var logStreams = [];

    console.log('[yog2-agent] logview client connected');

    socket.on('cat', function (message) {
        console.log('[yog2-agent] client request cat log');
        catLog(message.name, message.from, message.to, message.grep, message.excludeGrep, message.eventID, socket);
    });

    socket.on('tail', function (message) {
        console.log('[yog2-agent] client request tail log');
        var stream = tailNewestLog(message.name, message.grep, message.excludeGrep, message.eventID, socket);
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

function catLog(name, from, to, grep, excludeGrep, eventID, socket) {
    from = new Date(from);
    to = new Date(new Date(to) + 60 * 1000);
    var conf = logMap[name];
    var files = getFilesBetweenTime(conf.path, from, to);
    var fromPattern = strftime(conf.timePattern, from);
    var toPattern = strftime(conf.timePattern, to);
    var total = 0;
    var allDone = false;
    var content = '';
    async.eachSeries(files, function (file, cb) {
        if (allDone) {
            return cb && cb(null);
        }
        grepFile(file, fromPattern, toPattern, grep, excludeGrep, function (err, data) {
            if (err) {
                return cb && cb(null);
            }
            total += data.length;
            if (total > 5000) {
                allDone = true;
            }
            content += data.slice(0, 5000).join('\n');
            return cb && cb(null);
        });
    }, function (err) {
        console.log('[yog2-agent] grep log end');
        socket.emit(eventID, content);
    });
}

function grepFile(path, fromPattern, toPattern, grep, excludeGrep, cb) {
    var failed = false;
    var fileStream = fs.createReadStream(path);
    var stream = byline.createStream(fileStream);
    var lines = [];
    var r = new RegExp(grep);
    fileStream.on('error', function (error) {
        failed = true;
        stream.removeAllListeners();
        console.log('[yog2-agent] log', path, 'not found');
        return cb && cb(null, []);
    });
    stream.on('readable', function () {
        var line;
        while (null !== (line = stream.read())) {
            line = line.toString();
            var matched = !grep || r.test(line);
            if ((excludeGrep && !matched) || (!excludeGrep && matched)) {
                lines.push(line);
            }
        }
    });
    stream.on('end', function () {
        console.log('[yog2-agent] grep log', path);
        cb && cb(null, lines);
    });
}

function getFilesBetweenTime(filePath, from, to) {
    var files = [];
    var fromTimestamp = from.getTime();
    var toTimestamp = to.getTime();
    for (var i = fromTimestamp; i <= toTimestamp;) {
        var searchingFile = path.join(ROOT_PATH, strftime(filePath, new Date(i)));
        files.push(searchingFile);
        if (i === toTimestamp) {
            break;
        }
        i += 60 * 60 * 1000;
        if (i > toTimestamp) {
            i = toTimestamp;
        }
    };
    return files;
}

function tailNewestLog(name, grep, excludeGrep, eventID, socket) {
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
        stream.on('error', function (error) {
            stream.removeAllListeners();
            console.log('[yog2-agent] log', logPath, 'not found');
        });
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
