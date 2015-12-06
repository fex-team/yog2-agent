'use strict';

var schedule = require('node-schedule');
var path = require('path');
var fs = require('fs-extra');
var strftime = require('fast-strftime');
var async = require('async');

var ONE_DAY = 24 * 60 * 60 * 1000;
var ONE_HOUR = 1 * 60 * 60 * 1000;

/* eslint-disable no-console */

function LogRotate(conf) {
    this.logs = conf.logs;
    this.rootPath = conf.rootPath;
    this.cron = conf.cron || '0 * * * *';
}

LogRotate.prototype.start = function () {
    var me = this;
    schedule.scheduleJob(me.cron, function () {
        console.log('[yog2-logrotate] start clean logs');
        me.rotateLogs(me.logs, function () {
            me.cleanLogs(me.logs);
        });
    });
};


/**
 * 自动切分LOG，会按照小时切分LOG
 *
 * @param  {[type]}   confs [description]
 * @param  {Function} done  [description]
 * @return {[type]}         [description]
 */
LogRotate.prototype.rotateLogs = function (confs, done) {
    var me = this;
    async.map(confs, function (logConf, cb) {
            var filePath = path.join(me.rootPath, logConf.path);
            if (!logConf.autoRotate) {
                return cb && cb(null);
            }
            console.log('[yog2-logrotate] start rotate ' + logConf.name);
            var newLogFilePath = createLogFileByDate(logConf.rotatePath, new Date(Date.now() - ONE_HOUR));
            newLogFilePath = path.join(me.rootPath, newLogFilePath);

            fs.stat(newLogFilePath, function (err) {
                if (!err) {
                    console.log('[yog2-logrotate] rotate', logConf.name, 'destination', newLogFilePath, 'is exist, skiped');
                    return cb && cb(null);
                }
                fs.copy(filePath, newLogFilePath, {
                    clobber: false
                }, function (err) {
                    if (err) {
                        console.error('[yog2-logrotate] roate', logConf.name, 'failed,', err.message);
                        return cb && cb(null);
                    }
                    console.log('[yog2-logrotate] rotate file ' + logConf.name, 'to', newLogFilePath);
                    fs.truncate(filePath, 0, function (err) {
                        if (err) {
                            console.error('[yog2-logrotate] truncate origin log failed,', err.message);
                        }
                        cb && cb(null);
                    });
                });
            });
        },
        function (err) {
            if (err) {
                console.warn('[yog2-logrotate] rotate logs end with err', err.stack);
            }
            else {
                console.log('[yog2-logrotate] rotate logs end');
            }
            done && done();
        });
};

LogRotate.prototype.cleanLogs = function (confs) {
    var me = this;
    async.map(confs, function (logConf, cb) {
        var pattern = logConf.autoRotate ? logConf.rotatePath : logConf.path;
        console.log('[yog2-logrotate] start clean ' + logConf.name, 'with pattern', pattern);
        me.getTargetLogs(pattern, logConf.reserveDays, function (err, data) {
            async.map(data || [], fs.unlink, cb);
        });
    }, function (err) {
        if (err) {
            console.warn('[yog2-logrotate] clean logs end with err', err.stack);
        }
        else {
            console.log('[yog2-logrotate] clean logs end');
        }
    });
};

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
LogRotate.prototype.getTargetLogs = function (pathPattern, reserveDays, cb) {
    var me = this;
    var timePattern = pathPattern.replace(/%Y|%m|%d|%H/g, '\\d+') + '$';
    var r = new RegExp(timePattern);
    var logDirPath = path.join(me.rootPath, path.dirname(pathPattern));
    var now = new Date();
    var reserveDate = new Date(now - ONE_DAY);
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
        }
        var firstReserveLogName = path.join(me.rootPath, createLogFileByDate(pathPattern, reserveDate));
        var index = logs.indexOf(firstReserveLogName);
        if (index === -1) {
            logs.push(firstReserveLogName);
        }
        logs = logs.sort();
        index = logs.indexOf(firstReserveLogName);
        cb && cb(null, logs.slice(0, index));
    });
};

function createLogFileByDate(pattern, date) {
    return strftime(pattern, date);
}

module.exports = LogRotate;
