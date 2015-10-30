/**
 * @file agent入口，加载插件并执行
 * @author hefangshi@baidu.com
 * http://fis.baidu.com/
 * 2015/09/06
 */

var getArgv = require('./lib/util.js').getArgv;
var path = require('path');
var PLUGINS_DIR = path.join(__dirname, 'plugins');
var ROOT_PATH = getArgv('ROOT_PATH') || __dirname;
var RESTART_DELAY = 100;
var fs = require('fs');
var cp = require('child_process');
var pluginProcesses = {};

function start() {
    fs.readdir(PLUGINS_DIR, function (err, files) {
        if (err) {
            throw err;
        }
        for (var i = 0; i < files.length; i++) {
            runPlugin(files[i]);
        };
    });
}

function runPlugin(name) {
    var conf = loadConf(name)
    var pluginPath = path.join(PLUGINS_DIR, name, 'index.js');
    console.log('[yog2-agent] start plugin ' + name + ' with conf', conf);
    var process = cp.fork(pluginPath, conf, {
        silent: true
    });
    process.stdout.on('data', function (data) {
        console.log(data.toString());
    });
    process.stderr.on('data', function (data) {
        console.error(data.toString());
    });
    pluginProcesses[name] = process;
    process.on('close', function (code, signal) {
        console.warn('[yog2-agent] plugin ' + pluginPath + ' is exited with code ' + code + ' and signal ' + signal);
        setTimeout(function () {
            runPlugin(name);
        }, RESTART_DELAY);
    });
}

function loadConf(name) {
    try {
        var execConf = [];
        try {
            conf = require(path.join(ROOT_PATH, name + '.json'));
        }
        catch (e) {
            conf = require(path.join(ROOT_PATH, name + '.default.json'));
        }
        conf.root_path = ROOT_PATH;
        for (var key in conf) {
            if (conf.hasOwnProperty(key)) {
                var value = typeof conf[key] === "object" ? JSON.stringify(conf[key]) : conf[key];
                execConf.push('--' + key + '=' + value);
            };
        }
        return execConf;
    }
    catch (e) {
        return {};
    };
}


process.on('uncaughtException', function (err) {
    console.warn('[yog2-agent] agent crashed, killing all plugins\n', err.stack);
    for (var pluginName in pluginProcesses) {
        if (pluginProcesses.hasOwnProperty(pluginName)) {
            pluginProcesses[pluginName].removeAllListeners();
            pluginProcesses[pluginName].kill();
        }
    };
});

start();
