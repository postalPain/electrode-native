exports.command = 'compat <command>'
exports.desc = 'Commands related to binary compatibility checking of the miniapp'
exports.builder = function (yargs) {
  return yargs.commandDir('compat')
}
exports.handler = function (argv) {}