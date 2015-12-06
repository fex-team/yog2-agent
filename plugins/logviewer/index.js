'use strict';

var strftime = require('fast-strftime');
var ts = require('tail-stream');
var fs = require('fs');
var path = require('path');
var byline = require('byline');
var async = require('async');

/* eslint-disable no-console */

function LogViewer(conf) {
    this.logs = conf.logs;
    this.logMap = conf.logs.reduce(function (prev, current) {
        prev[current.name] = current;
        return prev;
    }, {});
    var port = conf.port;
    this.rootPath = conf.rootPath;
    this.port = parseInt(port.replace('$PORT', process.env.port || process.env.PORT), 10) + conf.portOffset;
}

LogViewer.prototype.start = function () {
    var io = require('socket.io')(this.port);
    console.log('[yog2-logviewer] logview server is listening to', this.port);
    this.io = io;
    this.bindListener();
};

LogViewer.prototype.bindListener = function () {
    var me = this;
    this.io.on('connection', function (socket) {
        var logStreams = {};

        console.log('[yog2-logviewer] logview client connected');

        socket.on('cat', function (message) {
            console.log('[yog2-logviewer] client request cat log');
            me.catLog(message, socket);
        });

        socket.on('endtail', function (message) {
            console.log('[yog2-logviewer] client end tail log');
            logStreams[message.name] && logStreams[message.name].end && logStreams[message.name].end();
            logStreams[message.name] = null;
        });

        socket.on('tail', function (message) {
            console.log('[yog2-logviewer] client request tail log');
            var stream = me.tailNewestLog(message, socket);
            if (!stream) {
                socket.emit('notfound', {
                    cmd: 'tail',
                    name: message.name
                });
            }
            else {
                logStreams[message.name] = stream;
            }
        });

        socket.emit('list', me.logs.map(function (conf) {
            return conf.name;
        }));

        socket.on('disconnect', function () {
            console.log('[yog2-logviewer] logview client disconnected, close all logs');
            for (var name in logStreams) {
                if (logStreams.hasOwnProperty(name)) {
                    logStreams[name] && logStreams[name].end && logStreams[name].end();
                }
            }
        });
    });
};

LogViewer.prototype.tailNewestLog = function (msg, socket) {
    var now = new Date();
    var conf = this.logMap[msg.name];
    var logPath = path.join(this.rootPath, strftime(conf.path, now));
    var stream;
    var r = safeRegExp(msg.grep);
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
            console.log('[yog2-logviewer] log', logPath, 'not found');
        });
        console.log('[yog2-logviewer] open log', logPath, 'with tail');
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
                var matched = !msg.grep || r.test(now);
                if ((msg.excludeGrep && !matched) || (!msg.excludeGrep && matched)) {
                    prev += now + '\n';
                }
                return prev;
            }, '');
            if (content !== '') {
                socket.emit(msg.eventID, content);
            }
        });
        return stream;
    }
    catch (e) {
        console.log('[yog2-logviewer] log', logPath, 'not found');
        return null;
    }
};

LogViewer.prototype.catLog = function (msg, socket) {
    var me = this;
    var from = new Date(msg.from);
    var to = new Date(msg.to);
    var maxLen = Math.max(msg.maxLen, 5000) || 500;
    var conf = this.logMap[msg.name];
    var files = getFilesBetweenTime(this.rootPath, conf.path, from, to);
    var fromPattern = strftime(conf.timePattern, from);
    var toPattern = strftime(conf.timePattern, to);
    var total = 0;
    var allDone = false;
    var content = '';
    async.eachSeries(files, function (file, cb) {
        if (allDone) {
            return cb && cb(null);
        }
        grepFile(file, fromPattern, toPattern, msg.grep, msg.excludeGrep, maxLen, function (err, data) {
            if (err) {
                return cb && cb(null);
            }
            total += data.length;
            if (total > maxLen) {
                allDone = true;
            }
            content += data.slice(0, maxLen).join('\n');
            return cb && cb(null);
        });
    }, function (err) {
        console.log('[yog2-logviewer] grep log end with err', err);
        socket.emit(me.eventID, content);
    });
};

function safeRegExp(s) {
    if (!s) {
        return null;
    }
    return new RegExp(s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
}

function grepFile(path, fromPattern, toPattern, grep, excludeGrep, maxLen, cb) {
    var fileStream = fs.createReadStream(path);
    var stream = byline.createStream(fileStream);
    var lines = [];
    var r = safeRegExp(grep);
    var count = 0;
    fileStream.on('error', function (error) {
        stream.removeAllListeners();
        console.log('[yog2-logviewer] log', path, 'not found');
        return cb && cb(null, []);
    });
    stream.on('readable', function () {
        var line;
        while (null !== (line = stream.read())) {
            count++;
            line = line.toString();
            var matched = !grep || r.test(line);
            if ((excludeGrep && !matched) || (!excludeGrep && matched)) {
                lines.push(line);
            }
            if (count >= maxLen) {
                fileStream.end();
            }
        }
    });
    stream.on('end', function () {
        console.log('[yog2-logviewer] grep log', path);
        cb && cb(null, lines);
    });
}

function getFilesBetweenTime(rootPath, filePath, from, to) {
    var files = [];
    var fromTimestamp = from.getTime();
    var toTimestamp = to.getTime();
    for (var i = fromTimestamp; i <= toTimestamp;) {
        var searchingFile = path.join(rootPath, strftime(filePath, new Date(i)));
        files.push(searchingFile);
        if (i === toTimestamp) {
            break;
        }
        i += 60 * 60 * 1000;
        if (i > toTimestamp) {
            i = toTimestamp;
        }
    }
    return files;
}

module.exports = LogViewer;
