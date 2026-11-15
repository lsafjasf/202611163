// 浏览器端轨迹导出：CSV（数据表）与 JSON（含参数、限值与触发记录）。
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(recorder) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadText(`pendulum-trajectory-${stamp}.csv`, recorder.toCSV(), 'text/csv;charset=utf-8');
}

export function exportJSON(recorder, config, trigger) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const meta = {
    exportedAt: new Date().toISOString(),
    config,
    trigger,
    sampleCount: recorder.count,
    continuity: recorder.verifyContinuity()
  };
  downloadText(`pendulum-session-${stamp}.json`, recorder.toJSON(meta), 'application/json');
}
