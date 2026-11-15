/* Node 无头验证：运行全部物理与行为场景，失败时进程退出码非零。 */
const path = require('path');
const verify = require(path.join(__dirname, '..', 'js', 'verify.js'));

const report = verify.runAll();
console.log('===== 二维翼型风洞：自动验证报告 =====');
for (const r of report.rows) {
  console.log((r.pass ? '[PASS] ' : '[FAIL] ') + r.name + ' — ' + r.detail);
  if (r.record) {
    const rc = r.record;
    console.log('       触发记录: 位置=(' + rc.position.x.toExponential(2) + ', ' +
      rc.position.y.toExponential(2) + ')m V=' + rc.V.toFixed(2) + 'm/s' +
      ' P=' + rc.P.toFixed(0) + 'Pa T=' + rc.T.toFixed(2) + 'K' +
      ' q=' + rc.q.toFixed(1) + 'Pa L=' + rc.lift.toFixed(2) + 'N');
  }
}
console.log('---------------------------------------');
console.log(report.passed + '/' + report.count + ' 项通过');
process.exit(report.pass ? 0 : 1);
