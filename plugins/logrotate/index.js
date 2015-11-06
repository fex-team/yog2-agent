var schedule = require('node-schedule');
var getArgv = require('../../lib/util.js').getArgv;
var path = require('path');
var fs = require('fs');
var LOGS = JSON.parse(getArgv('logs'));
var ROOT_PATH = getArgv('root_path');
var CRON = getArgv('cron') || '0 * * * *';
var strftime = require('fast-strftime');
var async = require('async');

// run logrotate on every hour
var j = schedule.scheduleJob(CRON, function () {
    console.log('[yog2-agent] start clean logs');
    rotateLogs(LOGS, function () {
        cleanLogs(LOGS);
    });
});

/**
 * 自动切分LOG，会按照小时切分LOG
 * 
 * @param  {[type]}   confs [description]
 * @param  {Function} done  [description]
 * @return {[type]}         [description]
 */
function rotateLogs(confs, done) {
    async.map(confs, function (logConf, cb) {
        var filePath = path.join(ROOT_PATH, logConf.path);
        if (!logConf.autoRotate) {
            return cb && cb(null);
        }
        console.log('[yog2-agent] start rotate ' + logConf.name);
        fs.readFile(filePath, function (err, buffer) {
            // 保存文件至一个小时前的LOG中
            if (err) {
                console.error('[yog2-agent] read log failed', err.message);
                return cb && cb(null);
            }
            var newLogFilePath = createLogFileByDate(logConf.rotatePath, new Date((new Date()).getTime() - 1 * 60 * 60 * 1000));
            fs.stat(newLogFilePath, function (err) {
                if (!err) {
                    console.log('[yog2-agent] rotate destination', newLogFilePath, 'is exist, skiped');
                    return cb && cb(null);
                }
                fs.writeFile(newLogFilePath, buffer, function (err) {
                    if (err) {
                        console.error('[yog2-agent] write log failed', err.message);
                        return cb && cb(null);
                    }
                    console.log('[yog2-agent] rotate file ' + logConf.name, 'to', newLogFilePath);
                    buffer = null;
                    fs.truncate(filePath, 0, function (err) {
                        cb && cb(null);
                    });
                });
            });
        });
    }, function (err) {
        if (err) {
            console.warn('[yog2-agent] rotate logs end with err', err.stack);
        }
        else {
            console.log('[yog2-agent] rotate logs end');
        }
        done && done();
    });
}

function cleanLogs(confs) {
    async.map(confs, function (logConf, cb) {
        var pattern = logConf.autoRotate ? logConf.rotatePath : logConf.path;
        console.log('[yog2-agent] start clean ' + logConf.name, 'with pattern', pattern);
        getTargetLogs(pattern, logConf.reserveDays, function (err, data) {
            async.map(data || [], fs.unlink, cb);
        });
    }, function (err) {
        if (err) {
            console.warn('[yog2-agent] clean logs end with err', err.stack);
        }
        else {
            console.log('[yog2-agent] clean logs end');
        }
    });
}

/**
 * 获取所有应该被删除的LOG
 *
 * 此处为了实现方便并且性能优异，使用了一个不健全的策略进行检测
 * 获取所有文件列表后，根据保留时间将应保留文件的第一个文件插入文件列表后排序，将之前的文件全部删除
 * 如果日志的时间变量没有完整的按照日期设置，那么很可能会导致排序错误进而导致删除了错误的文件
 * 
 * @param  {[type]}   pathPattern [description]
 * @param  {[type]}   reserveDays [description]
 * @param  {Function} cb          [description]
 * @return {[type]}               [description]
 */
function getTargetLogs(pathPattern, reserveDays, cb) {
    var timePattern = pathPattern.replace(/%Y|%m|%d|%H/g, '\\d+') + '$';
    var r = new RegExp(timePattern);
    var logDirPath = path.join(ROOT_PATH, path.dirname(pathPattern));
    var today = new Date();
    var reserveDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - reserveDays, 0, 0, 0);
    fs.readdir(logDirPath, function (err, files) {
        if (err) {
            return cb && cb(null);
        }
        var logs = [];
        for (var i = 0; i < files.length; i++) {
            var logPath = path.join(logDirPath, files[i]);
            if (r.test(logPath)) {
                logs.push(logPath);
            }
        };
        var firstReserveLogName = path.join(ROOT_PATH, createLogFileByDate(pathPattern, reserveDate));
        var index = logs.indexOf(firstReserveLogName);
        if (index === -1) {
            logs.push(firstReserveLogName);
        }
        logs = logs.sort();
        index = logs.indexOf(firstReserveLogName);
        cb && cb(null, logs.slice(0, index));
    });
}

function createLogFileByDate(pattern, date) {
    return strftime(pattern, date);
}
