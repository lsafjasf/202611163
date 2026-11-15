const icon = (paths, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths}</svg>`;

export const icons = {
  wave: icon(
    '<path d="M3 15c3.2 0 3.2-3 6.4-3s3.2 3 6.4 3 3.2-3 5.2-3M3 19c3.2 0 3.2-2 6.4-2s3.2 2 6.4 2 3.2-2 5.2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    21,
  ),
  dashboard: icon(
    '<rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.5"/>',
  ),
  chart: icon(
    '<path d="M4 19V5m0 14h16M7 15l3.6-4.3 3 2.2L19 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  layers: icon(
    '<path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" stroke-width="1.5"/><path d="m3.5 12 8.5 4.7 8.5-4.7M3.5 16l8.5 4.7 8.5-4.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  shield: icon(
    '<path d="M12 3 5 6v5c0 4.5 2.8 7.6 7 9.4 4.2-1.8 7-4.9 7-9.4V6l-7-3Z" stroke="currentColor" stroke-width="1.5"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  download: icon(
    '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    14,
  ),
  sound: icon(
    '<path d="M5 10v4h3l4 3V7L8 10H5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 9.5c1.2.6 1.9 1.5 1.9 2.5s-.7 1.9-1.9 2.5M17.5 7.5c2.7 1.3 4.2 3 4.2 4.5s-1.5 3.2-4.2 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    15,
  ),
  soundOff: icon(
    '<path d="M5 10v4h3l4 3V7L8 10H5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m16 10 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    15,
  ),
  filter: icon(
    '<path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    14,
  ),
  play: icon(
    '<path d="m9 7 8 5-8 5V7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    11,
  ),
  reset: icon(
    '<path d="M5 8V4m0 0h4M5 4l2.6 2.6A7 7 0 1 1 5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    11,
  ),
  alert: icon(
    '<path d="M12 4 3.8 19h16.4L12 4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v4.5m0 2.5v.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    14,
  ),
  check: icon(
    '<path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    12,
  ),
  info: icon(
    '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.4"/><path d="M12 11v5m0-8v.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    10,
  ),
};

const navItems = [
  ["dashboard", "调度总览", "dashboard", true],
  ["trend", "水文过程线", "chart"],
  ["profiles", "坝体剖面", "layers"],
  ["quality", "数据质量", "shield"],
];

const metricCard = ({
  id,
  label,
  badge,
  unit,
  accent,
  wash,
  footId,
  sparkId,
}) => `
  <article class="metric-card" style="--accent:${accent};--accent-wash:${wash}">
    <div class="metric-top">
      <span class="metric-label">${label}</span>
      <span class="metric-badge">${badge}</span>
    </div>
    <div class="metric-value"><span id="${id}">—</span><small>${unit}</small></div>
    <div class="metric-bottom">
      <div class="metric-foot" id="${footId}">正在计算</div>
      <svg class="sparkline" id="${sparkId}" viewBox="0 0 70 25" aria-hidden="true"></svg>
    </div>
  </article>
`;

export function renderShell() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">${icons.wave}</div>
        <div>
          <p class="brand-name">青岚水库</p>
          <p class="brand-sub">Qinglan Hydro</p>
        </div>
      </div>
      <div class="sidebar-section-label">调度工作台</div>
      <nav class="nav" aria-label="主导航">
        ${navItems
          .map(
            ([key, label, iconName, active]) => `
          <button class="nav-item ${active ? "active" : ""}" data-nav="${key}">
            <span class="nav-icon">${icons[iconName]}</span>${label}
          </button>`,
          )
          .join("")}
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="system-card">
        <div class="system-title"><span class="pulse-dot"></span>水情数据链路正常</div>
        <div class="system-meta"><span>遥测站点</span><strong>12 / 12</strong></div>
        <div class="system-meta"><span>最近同步</span><strong>07:45:18</strong></div>
        <div class="system-meta"><span>计算引擎</span><strong>Edge v2.6</strong></div>
      </div>
      <div class="operator">
        <div class="avatar">HJ</div>
        <div>
          <div class="operator-name">值班调度员</div>
          <div class="operator-role">青岚水库 · 中控室</div>
        </div>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <div class="eyebrow">RESERVOIR OPERATIONS</div>
          <h1 class="page-title">入库 · 出库 · 水位联动推演</h1>
          <p class="page-subtitle">拖动闸门开度，观察下游流量与坝前水位的延迟响应</p>
        </div>
        <div class="top-actions">
          <div class="live-pill"><span class="pulse-dot"></span>数据已同步</div>
          <button class="icon-button audio-button" id="audioToggle" aria-pressed="false" title="开启水声反馈" aria-label="开启水声反馈">${icons.soundOff}</button>
          <button class="secondary-button" id="exportQualityBtn">${icons.download}质量摘要</button>
          <button class="primary-button" id="exportBtn">${icons.download}导出当前视图</button>
        </div>
      </header>

      <section class="filter-strip" aria-label="当前筛选条件">
        <div class="filter-heading">${icons.filter}当前筛选</div>
        <div class="filter-group">
          <span class="filter-label">数据样例</span>
          <div class="segmented" id="datasetTabs">
            <button data-dataset="normal" class="active"><span class="dataset-dot normal"></span>正常</button>
            <button data-dataset="missing"><span class="dataset-dot missing"></span>缺失</button>
            <button data-dataset="duplicate"><span class="dataset-dot duplicate"></span>重复</button>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">时间窗口</span>
          <div class="segmented" id="windowTabs">
            <button data-window="6h">近 6h</button>
            <button data-window="12h">近 12h</button>
            <button data-window="24h" class="active">近 24h</button>
            <button data-window="all">全部</button>
          </div>
        </div>
        <div class="filter-meta">
          <div class="meta-item">数据版本 <strong id="versionText">—</strong></div>
          <div class="meta-item">
            <button class="caliber-trigger" type="button">统计口径</button>
            <div class="caliber-tooltip">按小时对齐；流量单位 m³/s，水位单位 m；首末时刻均包含；均值与峰值基于清洗后的有效记录计算，缺失值线性插补，越界值按异常处理后插补。</div>
          </div>
        </div>
      </section>

      <section class="metric-grid" aria-label="窗口统计">
        ${metricCard({
          id: "meanInflow",
          label: "平均入库流量",
          badge: "窗口均值",
          unit: "m³/s",
          accent: "#1b8b8b",
          wash: "#e7f5f3",
          footId: "inflowFoot",
          sparkId: "inflowSpark",
        })}
        ${metricCard({
          id: "meanOutflow",
          label: "平均出库流量",
          badge: "窗口均值",
          unit: "m³/s",
          accent: "#e5a044",
          wash: "#fff5e5",
          footId: "outflowFoot",
          sparkId: "outflowSpark",
        })}
        ${metricCard({
          id: "maxLevel",
          label: "最高坝前水位",
          badge: "窗口峰值",
          unit: "m",
          accent: "#3568cd",
          wash: "#edf2ff",
          footId: "levelFoot",
          sparkId: "levelSpark",
        })}
        ${metricCard({
          id: "maxDownstream",
          label: "下游流量峰值",
          badge: "安全约束",
          unit: "m³/s",
          accent: "#d8594b",
          wash: "#fff0ed",
          footId: "downstreamFoot",
          sparkId: "downstreamSpark",
        })}
      </section>

      <section class="primary-grid">
        <article class="panel chart-panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">水文过程线</h2>
              <p class="panel-subtitle">入库、出库与坝前水位 · 双轴联动</p>
            </div>
            <div class="chart-head-right">
              <div class="legend">
                <span class="legend-item"><i class="legend-line"></i>入库</span>
                <span class="legend-item"><i class="legend-line" style="--legend:#e5a044"></i>出库</span>
                <span class="legend-item"><i class="legend-line level"></i>水位</span>
              </div>
              <span class="panel-tag" id="chartWindowTag">近 24 小时</span>
            </div>
          </div>
          <div class="chart-wrap">
            <canvas id="hydroChart" aria-label="水库入库、出库与水位过程线"></canvas>
            <div class="chart-tooltip" id="chartTooltip"></div>
          </div>
          <div class="chart-footer">
            <span><strong>统计口径</strong> · 小时对齐 · 首末时刻均包含</span>
            <span class="forecast-key"><i class="forecast-swatch"></i><span id="forecastNote">闸门调整后显示 6h 延迟推演</span></span>
          </div>
        </article>

        <article class="panel gate-panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">闸门联动控制</h2>
              <p class="panel-subtitle">坝体剖面 · 实时开度 · 延迟响应</p>
            </div>
            <div class="gate-head-actions">
              <span class="status-chip" id="gateStatus"><span class="pulse-dot"></span>平稳</span>
            </div>
          </div>
          <div class="alarm-banner" id="alarmBanner">
            <span class="alarm-icon">${icons.check}</span>
            <span id="alarmText"><strong>约束正常。</strong> 当前推演未触及水位或下游流量阈值。</span>
          </div>
          <div class="dam-wrap">
            <canvas id="damChart" aria-label="水库坝体剖面及闸门开度"></canvas>
          </div>
          <div class="gate-control">
            <div class="gate-control-head">
              <span class="gate-control-label">闸门目标开度</span>
              <span class="gate-value"><span id="gateValue">—</span><small>%</small></span>
            </div>
            <div class="slider-row">
              <span class="slider-limit">0</span>
              <input class="gate-slider" id="gateSlider" type="range" min="0" max="100" step="0.5" value="42" aria-label="闸门目标开度" />
              <span class="slider-limit">100</span>
            </div>
          </div>
          <div class="preview-strip">
            <div class="preview-item">
              <div class="preview-label">3h 后水位</div>
              <div class="preview-value" id="previewLevel">—</div>
            </div>
            <div class="preview-item">
              <div class="preview-label">下游峰值</div>
              <div class="preview-value" id="previewDownstream">—</div>
            </div>
            <div class="preview-item">
              <div class="preview-label">基准开度</div>
              <div class="preview-value" id="baselineGateText">—</div>
            </div>
          </div>
        </article>
      </section>

      <section class="lower-grid">
        <article class="panel detail-panel">
          <div class="small-head">
            <div>
              <h2 class="small-title">窗口数据明细</h2>
              <div class="small-subtitle" id="detailWindowLabel">正在载入清洗结果</div>
            </div>
            <span class="sync-chip">与图形同步</span>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>时刻</th><th>入库</th><th>出库</th><th>水位</th><th>下游</th><th>开度</th><th>状态</th>
                </tr>
              </thead>
              <tbody id="dataTableBody"></tbody>
            </table>
          </div>
          <div class="detail-foot">
            <span id="detailFoot">展示最新记录，完整记录随导出文件提供</span>
            <span><strong id="detailCount">0</strong> 条清洗后记录</span>
          </div>
        </article>

        <article class="panel quality-panel">
          <div class="small-head">
            <div>
              <h2 class="small-title">数据质量摘要</h2>
              <div class="small-subtitle">原始计数 → 清洗 → 可用记录</div>
            </div>
            <span class="sync-chip" id="qualityRawTag">原始 —</span>
          </div>
          <div class="quality-body">
            <div class="quality-grid">
              <div class="quality-cell"><div class="quality-number" id="qualityDedup">0</div><div class="quality-label">重复记录</div></div>
              <div class="quality-cell"><div class="quality-number warn" id="qualityMissing">0</div><div class="quality-label">缺失字段</div></div>
              <div class="quality-cell"><div class="quality-number danger" id="qualityAnomaly">0</div><div class="quality-label">异常数值</div></div>
            </div>
            <div class="quality-progress">
              <div class="quality-progress-head"><span>有效数据占比</span><strong id="qualityCompleteness">—</strong></div>
              <div class="progress-track">
                <span class="progress-clean" id="qualityBarClean"></span>
                <span class="progress-missing" id="qualityBarMissing"></span>
                <span class="progress-anomaly" id="qualityBarAnomaly"></span>
              </div>
            </div>
            <div class="quality-rule">
              ${icons.info}
              <span>同一时刻保留最后上报；缺失值按相邻有效记录线性插补；越界值退出统计后插补。清洗后 <strong id="qualityClean">0</strong> 条记录参与计算。</span>
            </div>
            <div class="check-row">
              <span class="check-status ok" id="checkStatus">一致性校验</span>
              <span class="check-detail" id="checkDetail">运行中</span>
            </div>
          </div>
        </article>

        <article class="panel history-panel">
          <div class="small-head">
            <div>
              <h2 class="small-title">调度调整记录</h2>
              <div class="small-subtitle">可回放 · 状态可恢复</div>
            </div>
            <div class="history-head-actions">
              <button class="text-button" id="resetInitialBtn" type="button">${icons.reset}恢复初始</button>
            </div>
          </div>
          <div class="history-list" id="historyList"></div>
        </article>
      </section>
    </main>
    <div class="toast-stack" id="toastStack" aria-live="polite"></div>
  `;
}
