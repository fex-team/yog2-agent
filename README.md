# yog2-agent
YOG2 Agent，目前包含日志清理与日志线上查看功能

## Usage

### 安装

```
npm i yog2-agent --save
```

### 配置

所有配置均需放置在YOG2 Project根目录下

#### 日志清理配置

```
{
    "cron": "0 * * * *",
    "logs": [{
        "name": "app",
        "path": "log/yog/yog.log.%Y%m%d%H",
        "reserveDays": 7
    }, {
        "name": "access",
        "path": "log/access/access.log.%Y%m%d%H",
        "reserveDays": 7
    }, {
        "name": "app-wf",
        "path": "log/yog/yog.log.wf.%Y%m%d%H",
        "reserveDays": 7
    }, {
        "name": "pm2-stdout",
        "path": "pm2/logs/yog-out.log",
        "autoRotate": true,
        "rotatePath": "pm2/logs/yog-out.log.%Y%m%d%H",
        "reserveDays": 7
    }, {
        "name": "pm2-stderr",
        "path": "pm2/logs/yog-error.log",
        "autoRotate": true,
        "rotatePath": "pm2/logs/yog-error.log.%Y%m%d%H",
        "reserveDays": 7
    }]
}
```

##### 配置项

- `cron` 日志清理的检查时间
- `logs` 日志清理对象列表
- `logs[n].name` 日志名称
- `logs[n].path` 日志路径，支持时间变量`%Y%m%d%H`
- `logs[n].reserveDays` 保留日志的天数
- `logs[n].autoRotate` 是否自动切分日志
- `logs[n].rotatePath` 切分路径，支持时间变量`%Y%m%d%H`

#### 日志浏览配置

{
    "port": "$PORT",
    "portOffset": 1,
    "logs": [{
        "name": "app",
        "path": "log/yog/yog.log.%Y%m%d%H"
    }, {
        "name": "access",
        "path": "log/access/access.log.%Y%m%d%H"
    }, {
        "name": "app-wf",
        "path": "log/yog/yog.log.wf.%Y%m%d%H"
    }, {
        "name": "pm2-stdout",
        "path": "pm2/logs/yog-out.log"
    }, {
        "name": "pm2-stderr",
        "path": "pm2/logs/yog-error.log"
    }, {
        "name": "pm2-stdout-history",
        "path": "pm2/logs/yog-out.log.%Y%m%d%H"
    }, {
        "name": "pm2-stderr-history",
        "path": "pm2/logs/yog-error.log.%Y%m%d%H"
    }]
}

##### 配置项

- `port` 端口号，支持从环境变量获取
- `portOffset` 端口号偏移，用于接收服务的端口号后，使用经过偏移的端口提供服务，避免端口冲突
- `logs` 可供浏览的日志列表
- `logs[n].name` 日志名称
- `logs[n].path` 日志路径，支持时间变量`%Y%m%d%H`

### 启动

node node_modules/yog2-agent/index.js --ROOT_PATH=[YOG2 Project的根目录]

建议使用 PM2 一类的管理工具启动

## 在线日志浏览接口

在线日志浏览使用 websocket 接口提供服务

### 前端接口库示例

```
function LogViewer(ws, url, opts) {
    var socket = ws(url, {
        'force new connection': true
    });
    socket.on('list', function (data) {
        opts.onList && opts.onList(data);
    });
    socket.on('connect_error', function (data) {
        socket.disconnect();
        opts.onConnectError && opts.onConnectError();
    });
    socket.on('connect', function () {
        socket.emit('list');
    });
    socket.on('notfound', function (data) {
        opts.onError && opts.onError({
            logName: data.name,
            cmd: data.cmd
        });
    });
    return {
        close: function () {
            socket.disconnect();
        },
        tailLog: function (name, grep, excludeGrep, cb) {
            var eventID = name + '#tail';
            var opts = {
                name: name,
                eventID: eventID,
                grep: grep,
                excludeGrep: excludeGrep
            };
            socket.emit('tail', opts);
            socket.on(eventID, cb);
            return {
                end: function () {
                    socket.emit('endtail', opts);
                    socket.off(eventID, cb);
                }
            };
        },
        catLog: function (name, from, to, grep, excludeGrep, cb) {
            var eventID = name + '#' + from.getTime() + '#' + to.getTime();
            opts.name = name;
            opts.from = from;
            opts.to = to;
            opts.grep = grep;
            opts.excludeGrep = excludeGrep;
            opts.eventID = eventID;
            socket.emit('cat', opts);
            socket.once(eventID, cb);
        }
    };
}
```



