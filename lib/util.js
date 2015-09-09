module.exports.getArgv = function (name) {
    for (var i = 0; i < process.argv.length; i++) {
        if (process.argv[i].indexOf('--' + name) !== -1) {
            var value = process.argv[i].split('=').pop();
            if (value !== process.argv[i]) {
                return value;
            }
            return true;
        }
    };
    return false;
}
