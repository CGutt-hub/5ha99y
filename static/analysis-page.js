// Open Data Analysis Page JavaScript
// Fetches and renders parquet files directly from GitHub repos

// Global variable for plot data (loaded from JSON)
let plotsData = [];

// Download functions for open data sharing
function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadPlotData(plotItem) {
    const filename = `${plotItem.repo_name}_${plotItem.file_path.replace(/\//g, '_')}`;
    downloadJSON(plotItem, filename);
}

function downloadParquetFile(plotItem) {
    const url = `https://raw.githubusercontent.com/CGutt-hub/${plotItem.repo_name}/main/${plotItem.file_path}`;
    const filename = plotItem.file_path.split('/').pop() || 'data.parquet';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Wait for hyparquet to be available (loaded as ES module in analysis.html)
async function waitForHyparquet() {
    if (window._hyparquetReady) return;
    console.log('[Analysis] Waiting for hyparquet to load...');
    await new Promise((resolve, reject) => {
        const start = Date.now();
        const check = setInterval(() => {
            if (window._hyparquetReady) { clearInterval(check); resolve(); }
            else if (Date.now() - start > 15000) { clearInterval(check); reject(new Error('hyparquet library failed to load after 15s. Check internet connection.')); }
        }, 100);
    });
}

// Parse an ArrayBuffer containing a parquet file into row objects using hyparquet
async function parseParquetBuffer(arrayBuffer) {
    await waitForHyparquet();
    // parquetReadObjects accepts ArrayBuffer directly and returns row objects
    const rows = await window.hyparquetReadObjects({ file: arrayBuffer, compressors: window.hyparquetCompressors });
    return rows;
}


// Simple fetch for raw.githubusercontent.com URLs (no LFS pointer handling needed)
async function fetchRawArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    return await response.arrayBuffer();
}

// Fetch and parse parquet file from GitHub repo using hyparquet
async function fetchParquetData(repoNameOrUrl, filePathOrSize = null) {
    console.log('[Analysis] fetchParquetData called:', { repoNameOrUrl, filePathOrSize });
    
    try {
        await waitForHyparquet();
        
        const url = typeof filePathOrSize === 'string'
            ? `https://raw.githubusercontent.com/CGutt-hub/${repoNameOrUrl}/main/${filePathOrSize}`
            : repoNameOrUrl;
        
        const fileSize = typeof filePathOrSize === 'number' ? filePathOrSize : 0;
        
        console.log('[Analysis] Fetching:', url);
        
        // Fetch file (no LFS pointer handling needed)
        const arrayBuffer = await fetchRawArrayBuffer(url);
        
        console.log('[Analysis] Parsing parquet file with hyparquet...');
        const parseStart = Date.now();
        const rows = await window.hyparquetReadObjects({ file: arrayBuffer, compressors: window.hyparquetCompressors });
        const parseTime = ((Date.now() - parseStart) / 1000).toFixed(1);
        console.log(`[Analysis] Parsed ${rows.length} rows in ${parseTime}s`);
        
        const sizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(2);
        console.log(`[Analysis] File size: ${sizeMB} MB`);
        
        return { rows, arrayBuffer };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Download timeout - file is too large or connection too slow.');
        }
        // Handle unsupported compression codecs and similar issues
        let msg = String(error && error.message || error);
        if (/unsupported compression codec|unsupported codec|ZSTD|Snappy|Brotli|LZ4|compression/i.test(msg)) {
            msg = 'This parquet file uses a compression codec (e.g. ZSTD, Snappy, Brotli, LZ4) that is not supported in browser-based readers. Please re-export the file with uncompressed or GZIP compression.';
        }
        console.error('Error fetching/parsing parquet:', error);
        throw new Error(msg);
    }
}

// Convert parquet data to Plotly format
// Handles AnalysisToolbox plot specification parquet files:
//   plot_type: 'bar' | 'grid'
//   x_data[0]: array of x-axis categories
//   y_data[0]: array of arrays (one per condition/series)
//   labels[0] or condition column: series names
//   y_var[0]: error bars (std dev)
//   ci_lower/ci_upper: confidence intervals
//   x_label/y_label: axis titles
async function parquetToPlotly(rowsOrBuffer, title = null) {
    let rows;

    // Handle arrayBuffer input (parse it first)
    if (rowsOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(rowsOrBuffer)) {
        const buf = rowsOrBuffer instanceof ArrayBuffer ? rowsOrBuffer : rowsOrBuffer.buffer;
        rows = await parseParquetBuffer(buf);
    } else {
        rows = rowsOrBuffer;
    }

    if (!rows || rows.length === 0) return null;

    const columns = Object.keys(rows[0]);
    console.log('[Analysis] parquetToPlotly - Columns:', columns);
    console.log('[Analysis] parquetToPlotly - First row:', rows[0]);

    // Vibrant color palette for the dark theme
    const COLORS = [
        '#c9a227', // gold (accent)
        '#4fc3f7', // sky blue
        '#ef5350', // coral red
        '#66bb6a', // green
        '#ab47bc', // purple
        '#ff7043', // orange
        '#26c6da', // teal
        '#ec407a', // pink
        '#8d6e63', // brown
        '#42a5f5', // blue
    ];

    // Detect AnalysisToolbox plot spec format (has x_data, y_data, plot_type)
    const isPlotSpec = columns.includes('x_data') && columns.includes('y_data') && columns.includes('plot_type');

    if (isPlotSpec) {
        return plotSpecToPlotly(rows, title, COLORS);
    }

    // Multi-row condition format (e.g. eeg_psd with 'condition' column, one row per condition)
    if (columns.includes('condition') && columns.includes('x_data') && columns.includes('y_data')) {
        return conditionRowsToPlotly(rows, title, COLORS);
    }

    // Flat table: no plot_type, no x_data/y_data — render as a data table, not a plot
    if (!columns.includes('x_data') && !columns.includes('y_data')) {
        return flatTableToPlotly(rows, title);
    }

    // Fallback: generic columnar data — plot all numeric columns
    return genericToPlotly(rows, title, COLORS);
}

// AnalysisToolbox plot spec: single row contains full plot definition
function plotSpecToPlotly(rows, title, COLORS) {
    // May have multiple rows (e.g., per-condition) or a single row with nested arrays
    const row0 = rows[0];
    const plotType = row0.plot_type || 'bar';
    const xData = Array.isArray(row0.x_data) ? row0.x_data : [row0.x_data];
    const yDataNested = Array.isArray(row0.y_data) ? row0.y_data : [[row0.y_data]];
    const yVarNested = row0.y_var ? (Array.isArray(row0.y_var) ? row0.y_var : [[row0.y_var]]) : null;
    const ciLower = row0.ci_lower ? (Array.isArray(row0.ci_lower) ? row0.ci_lower : null) : null;
    const ciUpper = row0.ci_upper ? (Array.isArray(row0.ci_upper) ? row0.ci_upper : null) : null;

    // Get series labels
    let seriesLabels = null;
    if (row0.labels && Array.isArray(row0.labels)) {
        seriesLabels = row0.labels;
    }
    // For multi-row data, use condition column or row index
    if (!seriesLabels && rows.length > 1 && rows[0].condition) {
        seriesLabels = rows.map(r => r.condition);
    }

    const xLabels = xData;
    const xAxisTitle = row0.x_label || '';
    const yAxisTitle = row0.y_label || '';

    // Determine if y_data is nested (array of series arrays) or flat
    let seriesData;
    if (yDataNested.length > 0 && Array.isArray(yDataNested[0]) && Array.isArray(yDataNested[0][0])) {
        // Double nested: y_data = [[[s1_vals], [s2_vals]]] — unwrap one layer
        seriesData = yDataNested[0];
    } else if (yDataNested.length > 0 && Array.isArray(yDataNested[0])) {
        // Each element is a series: [[s1_vals], [s2_vals], ...]
        seriesData = yDataNested;
    } else {
        seriesData = [yDataNested];
    }

    let varData = null;
    if (yVarNested) {
        if (yVarNested.length > 0 && Array.isArray(yVarNested[0]) && Array.isArray(yVarNested[0][0])) {
            varData = yVarNested[0];
        } else if (yVarNested.length > 0 && Array.isArray(yVarNested[0])) {
            varData = yVarNested;
        } else if (yVarNested.length > 0 && typeof yVarNested[0] === 'number') {
            // Flat array (single-series): wrap into nested form to match seriesData structure
            varData = [yVarNested];
        }
    }

    // --- Table: short-circuit before the series loop ---
    if (plotType === 'table') {
        // x_data = column headers, y_data = [[col0_vals], [col1_vals], ...] (column-major)
        const colHeaders = xData;
        // seriesData is already column-major: each element is one column's values
        const colData = seriesData;
        const cs2 = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
        const bgColor2   = cs2 ? (cs2.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
        const textColor2 = cs2 ? (cs2.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
        const headerBg   = cs2 ? (cs2.getPropertyValue('--bg-tertiary').trim() || '#242424') : '#242424';
        const borderCol  = cs2 ? (cs2.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';
        return {
            data: [{
                type: 'table',
                header: {
                    values: colHeaders,
                    align: 'left',
                    fill: { color: headerBg },
                    font: { color: textColor2, size: 12, family: "'JetBrains Mono', monospace" },
                    line: { color: borderCol, width: 1 },
                },
                cells: {
                    values: colData,
                    align: 'left',
                    fill: { color: bgColor2 },
                    font: { color: textColor2, size: 11, family: "'JetBrains Mono', monospace" },
                    line: { color: borderCol, width: 1 },
                },
            }],
            layout: {
                title: { text: title || 'ANOVA Results', font: { color: textColor2, size: 16 } },
                paper_bgcolor: bgColor2, plot_bgcolor: bgColor2,
                font: { color: textColor2, family: "'JetBrains Mono', monospace" },
                margin: { t: 60, b: 30, l: 20, r: 20 },
            },
        };
    }

    // --- Heatmap: short-circuit before the series loop ---
    if (plotType === 'heatmap') {
        const varNames = xData;  // x_data = variable names for both axes
        // y_data is a 2D list stored as a nested array; unwrap one level if needed
        let zMatrix = seriesData;
        if (zMatrix.length > 0 && !Array.isArray(zMatrix[0])) zMatrix = [zMatrix];

        const cs2 = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
        const bgColor2  = cs2 ? (cs2.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
        const textColor2 = cs2 ? (cs2.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
        const gridColor2 = cs2 ? (cs2.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

        return {
            data: [{
                type: 'heatmap',
                x: varNames, y: varNames, z: zMatrix,
                colorscale: 'RdBu', reversescale: true,
                zmin: -1, zmax: 1,
                colorbar: { title: 'r', tickfont: { color: textColor2 }, titlefont: { color: textColor2 } },
            }],
            layout: {
                title: { text: title || 'Correlation Heatmap', font: { color: textColor2, size: 16 } },
                xaxis: { tickfont: { color: textColor2, size: 11 }, gridcolor: gridColor2, linecolor: gridColor2 },
                yaxis: { tickfont: { color: textColor2, size: 11 }, gridcolor: gridColor2, linecolor: gridColor2, autorange: 'reversed' },
                paper_bgcolor: bgColor2, plot_bgcolor: bgColor2,
                font: { color: textColor2, family: "'JetBrains Mono', monospace" },
                margin: { t: 60, b: 120, l: 120, r: 30 },
            },
        };
    }

    const traces = [];
    for (let s = 0; s < seriesData.length; s++) {
        const yVals = seriesData[s];
        const label = seriesLabels ? (seriesLabels[s] || `Series ${s + 1}`) : `Series ${s + 1}`;
        const color = COLORS[s % COLORS.length];

        if (plotType === 'line') {
            // Line trace
            traces.push({
                x: xLabels, y: yVals, name: label,
                type: 'scatter', mode: 'lines',
                line: { color: color, width: 2 },
            });
            // Shaded variance band
            const vVals = varData && varData[s] ? varData[s] : null;
            if (vVals && vVals.some(v => v > 0)) {
                const upper = yVals.map((v, i) => v + (vVals[i] || 0));
                const lower = yVals.map((v, i) => v - (vVals[i] || 0));
                traces.push({
                    x: [...xLabels, ...[...xLabels].reverse()],
                    y: [...upper, ...lower.reverse()],
                    name: `${label} ±var`,
                    type: 'scatter', mode: 'lines', fill: 'toself',
                    fillcolor: color.replace(')', ', 0.15)').replace('rgb', 'rgba'),
                    line: { color: 'transparent' },
                    showlegend: false, hoverinfo: 'skip',
                });
            }
        } else {
            const trace = {
                x: xLabels, y: yVals, name: label,
                type: 'bar',
                marker: { color: color, line: { color: color, width: 1 }, opacity: 0.85 },
            };
            // Add error bars from y_var or ci bounds
            if (varData && varData[s]) {
                const errVals = varData[s];
                if (errVals.some(v => v > 0)) {
                    trace.error_y = { type: 'data', array: errVals, visible: true, color: '#aaa', thickness: 1.5, width: 4 };
                }
            } else if (ciLower && ciUpper && ciLower[s] && ciUpper[s]) {
                trace.error_y = {
                    type: 'data',
                    array: yVals.map((v, i) => (ciUpper[s][i] || 0) - v),
                    arrayminus: yVals.map((v, i) => v - (ciLower[s][i] || 0)),
                    visible: true, color: '#aaa', thickness: 1.5, width: 4,
                };
            }
            traces.push(trace);
        }
    }

    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const bgColor = cs ? (cs.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const gridColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

    const layout = {
        title: { text: title || yAxisTitle || 'Analysis Result', font: { color: textColor, size: 16 } },
        xaxis: {
            title: { text: xAxisTitle, font: { color: textColor } },
            tickfont: { color: textColor, size: 11 },
            gridcolor: gridColor,
            linecolor: gridColor,
        },
        yaxis: {
            title: { text: yAxisTitle, font: { color: textColor } },
            tickfont: { color: textColor, size: 11 },
            ...(plotType !== 'line' ? { tickangle: -45 } : {}),
            gridcolor: gridColor,
            linecolor: gridColor,
        },
        ...(plotType !== 'line' ? { barmode: 'group', bargap: 0.2, bargroupgap: 0.1 } : {}),
        paper_bgcolor: bgColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: "'JetBrains Mono', monospace" },
        legend: {
            font: { color: textColor, size: 11 },
            bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'closest',
        margin: { t: 60, b: computeBottomMargin(xLabels), l: 70, r: 30 },
    };

    return { data: traces, layout };
}

// Compute bottom margin based on the longest x-axis tick label
function computeBottomMargin(xLabels) {
    if (!xLabels || xLabels.length === 0) return 80;
    const maxLen = Math.max(...xLabels.map(l => String(l).length));
    if (maxLen <= 8) return 80;
    if (maxLen <= 15) return 120;
    if (maxLen <= 25) return 160;
    return 200;
}

// Multi-row condition format: one row per condition, each with x_data and y_data
function conditionRowsToPlotly(rows, title, COLORS) {
    const xAxisTitle = rows[0].x_label || '';
    const yAxisTitle = rows[0].y_label || '';
    const plotType = rows[0].plot_type || 'bar';

    const traces = [];
    rows.forEach((row, i) => {
        const xData = Array.isArray(row.x_data) ? row.x_data : [row.x_data];
        const yData = Array.isArray(row.y_data) ? row.y_data : [row.y_data];
        const label = row.condition || `Series ${i + 1}`;
        const color = COLORS[i % COLORS.length];

        if (plotType === 'line') {
            traces.push({
                x: xData, y: yData, name: label,
                type: 'scatter', mode: 'lines',
                line: { color: color, width: 2 },
            });
            const vVals = row.y_var ? (Array.isArray(row.y_var) ? row.y_var : [row.y_var]) : null;
            if (vVals && vVals.some(v => v > 0)) {
                const upper = yData.map((v, j) => v + (vVals[j] || 0));
                const lower = yData.map((v, j) => v - (vVals[j] || 0));
                traces.push({
                    x: [...xData, ...[...xData].reverse()],
                    y: [...upper, ...lower.reverse()],
                    name: `${label} ±var`,
                    type: 'scatter', mode: 'lines', fill: 'toself',
                    fillcolor: color.replace(')', ', 0.15)').replace('rgb', 'rgba'),
                    line: { color: 'transparent' },
                    showlegend: false, hoverinfo: 'skip',
                });
            }
        } else {
            const trace = {
                x: xData, y: yData, name: label,
                type: 'bar',
                marker: { color: color, opacity: 0.85 },
            };
            if (row.y_var) {
                const errVals = Array.isArray(row.y_var) ? row.y_var : [row.y_var];
                if (errVals.some(v => v > 0)) {
                    trace.error_y = { type: 'data', array: errVals, visible: true, color: '#aaa', thickness: 1.5, width: 4 };
                }
            }
            if (row.ci_lower && row.ci_upper) {
                const cl = Array.isArray(row.ci_lower) ? row.ci_lower : [row.ci_lower];
                const cu = Array.isArray(row.ci_upper) ? row.ci_upper : [row.ci_upper];
                trace.error_y = {
                    type: 'data',
                    array: yData.map((v, j) => (cu[j] || 0) - v),
                    arrayminus: yData.map((v, j) => v - (cl[j] || 0)),
                    visible: true, color: '#aaa', thickness: 1.5, width: 4,
                };
            }
            traces.push(trace);
        }
    });

    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const bgColor = cs ? (cs.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const gridColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

    return {
        data: traces,
        layout: {
            title: { text: title || yAxisTitle || 'Analysis Result', font: { color: textColor, size: 16 } },
            xaxis: { title: { text: xAxisTitle, font: { color: textColor } }, tickfont: { color: textColor }, ...(plotType !== 'line' ? { tickangle: -45 } : {}), gridcolor: gridColor, linecolor: gridColor },
            yaxis: { title: { text: yAxisTitle, font: { color: textColor } }, tickfont: { color: textColor }, gridcolor: gridColor, linecolor: gridColor },
            ...(plotType !== 'line' ? { barmode: 'group', bargap: 0.2, bargroupgap: 0.1 } : {}),
            paper_bgcolor: bgColor, plot_bgcolor: bgColor,
            font: { color: textColor, family: "'JetBrains Mono', monospace" },
            legend: { font: { color: textColor, size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
            hovermode: 'closest', margin: { t: 60, b: computeBottomMargin(rows.map(r => Array.isArray(r.x_data) ? r.x_data : [r.x_data]).flat()), l: 70, r: 30 },
        },
    };
}

// Fallback: generic columnar data — plot all numeric columns vs first column
function flatTableToPlotly(rows, title) {
    const columns = Object.keys(rows[0]);
    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const headerBg = cs ? (cs.getPropertyValue('--bg-elevated').trim() || '#242424') : '#242424';
    const cellBg   = cs ? (cs.getPropertyValue('--bg-tertiary').trim() || '#1c1c1c') : '#1c1c1c';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const borderColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';
    return {
        data: [{
            type: 'table',
            header: { values: columns, align: 'left', fill: { color: headerBg }, font: { color: textColor, size: 12 }, line: { color: borderColor, width: 1 } },
            cells:  { values: columns.map(c => rows.map(r => r[c])), align: 'left', fill: { color: cellBg }, font: { color: textColor, size: 11 }, line: { color: borderColor, width: 1 } },
        }],
        layout: { title: { text: title || 'Table', font: { color: textColor, size: 16 } }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { t: 50, l: 10, r: 10, b: 10 } },
        title: title || 'Table',
    };
}

function genericToPlotly(rows, title, COLORS) {
    const columns = Object.keys(rows[0]);
    const xCol = columns[0];
    const numericCols = columns.slice(1).filter(c => {
        const v = rows[0][c];
        return typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v)));
    });

    if (numericCols.length === 0) return null;

    const traces = numericCols.map((col, i) => ({
        x: rows.map(r => r[xCol]),
        y: rows.map(r => typeof r[col] === 'number' ? r[col] : parseFloat(r[col])),
        name: col,
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: COLORS[i % COLORS.length], width: 2 },
        marker: { color: COLORS[i % COLORS.length], size: 5 },
    }));

    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const bgColor = cs ? (cs.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const gridColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

    return {
        data: traces,
        layout: {
            title: { text: title || `${numericCols.join(', ')} vs ${xCol}`, font: { color: textColor, size: 16 } },
            xaxis: { title: { text: xCol, font: { color: textColor } }, tickfont: { color: textColor }, tickangle: -45, gridcolor: gridColor, linecolor: gridColor },
            yaxis: { tickfont: { color: textColor }, gridcolor: gridColor, linecolor: gridColor },
            paper_bgcolor: bgColor, plot_bgcolor: bgColor,
            font: { color: textColor, family: "'JetBrains Mono', monospace" },
            legend: { font: { color: textColor, size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
            hovermode: 'closest', margin: { t: 60, b: computeBottomMargin(rows.map(r => r[xCol])), l: 70, r: 30 },
        },
    };
}

async function findParquetFile(plotItem) {
    // Try to find associated parquet file by checking common patterns
    const basePath = plotItem.file_path.replace(/\.json$/, '').replace(/[_-]?(plot|figure|viz|visual|chart|graph)s?/i, '');
    const dirPath = plotItem.file_path.substring(0, plotItem.file_path.lastIndexOf('/'));
    
    const possiblePaths = [
        basePath + '.parquet',
        basePath + '_data.parquet',
        dirPath + '/data.parquet',
        dirPath + '/processed_data.parquet',
        'data.parquet',
        'processed_data.parquet'
    ];
    
    // Try to fetch each possible parquet file
    for (const path of possiblePaths) {
        try {
            const url = `https://raw.githubusercontent.com/CGutt-hub/${plotItem.repo_name}/main/${path}`;
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                return { data: arrayBuffer, filename: path.split('/').pop() };
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

async function downloadPlotPDFA(plotItem, plotIndex) {
    try {
        // Wait for pdf-lib to load
        if (typeof PDFLib === 'undefined') {
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (typeof PDFLib !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });
        }
        
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        
        // Convert plot to grayscale image
        const plotContainer = document.getElementById(`plot-container-${plotIndex}`);
        const plotImageDataUrl = await Plotly.toImage(plotContainer, {
            format: 'png',
            width: 1200,
            height: 800
        });
        
        // Convert to grayscale
        const img = new Image();
        img.src = plotImageDataUrl;
        await new Promise(resolve => img.onload = resolve);
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Convert to grayscale
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
        const grayscaleImageUrl = canvas.toDataURL('image/png');
        
        // Create PDF document
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([842, 595]); // A4 landscape in points
        const { width, height } = page.getSize();
        
        // Embed font
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        
        // Add title
        page.drawText(plotItem.file_path, {
            x: 50,
            y: height - 50,
            size: 16,
            font: fontBold,
            color: rgb(0, 0, 0)
        });
        
        // Add repository info
        page.drawText(`Repository: ${plotItem.repo_name}`, {
            x: 50,
            y: height - 75,
            size: 10,
            font: font,
            color: rgb(0.3, 0.3, 0.3)
        });
        
        page.drawText(`Updated: ${new Date(plotItem.updated).toLocaleString()}`, {
            x: 50,
            y: height - 90,
            size: 10,
            font: font,
            color: rgb(0.3, 0.3, 0.3)
        });
        
        // Embed grayscale plot image
        const imageBytes = await fetch(grayscaleImageUrl).then(res => res.arrayBuffer());
        const pngImage = await pdfDoc.embedPng(imageBytes);
        const imgDims = pngImage.scale(0.6);
        
        page.drawImage(pngImage, {
            x: 50,
            y: 100,
            width: imgDims.width,
            height: imgDims.height
        });
        
        // Try to fetch and embed parquet file as attachment
        const parquetFile = await findParquetFile(plotItem);
        if (parquetFile) {
            // Attach parquet file to PDF
            await pdfDoc.attach(parquetFile.data, parquetFile.filename, {
                mimeType: 'application/octet-stream',
                description: 'Source data in Apache Parquet format',
                creationDate: new Date(plotItem.updated),
                modificationDate: new Date(plotItem.updated)
            });
            
            // Add note about attachment
            page.drawText('Source data attached as: ' + parquetFile.filename, {
                x: 50,
                y: 70,
                size: 9,
                font: font,
                color: rgb(0, 0.5, 0)
            });
        } else {
            // Add note about no attachment
            page.drawText('No source parquet file found', {
                x: 50,
                y: 70,
                size: 9,
                font: font,
                color: rgb(0.7, 0.3, 0)
            });
        }
        
        // Set PDF metadata
        pdfDoc.setTitle(plotItem.file_path);
        pdfDoc.setAuthor('Çağatay Özcan Jagiello Gutt');
        pdfDoc.setSubject(`Research data from ${plotItem.repo_name}`);
        pdfDoc.setKeywords(['research', 'open data', 'analysis']);
        pdfDoc.setCreator('Open Data - 5ha99y');
        pdfDoc.setProducer('pdf-lib (https://pdf-lib.js.org)');
        
        // Save PDF
        const pdfBytes = await pdfDoc.save();
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const pdfFilename = `${plotItem.repo_name.replace(/\//g, '_')}_${plotItem.file_path.replace(/\//g, '_').replace('.json', '')}.pdf`;
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pdfBlob);
        a.download = pdfFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        
        if (parquetFile) {
            alert('Downloaded PDF/A with embedded parquet data attachment');
        } else {
            alert('Downloaded PDF (no source parquet file found)');
        }
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert(`Error generating PDF: ${error.message}`);
    }
}

// Export plot data as CSV
async function exportPlotAsCSV(url, displayName) {
    try {
        const { rows } = await fetchParquetData(url);
        if (!rows || rows.length === 0) {
            console.error('[Analysis] No data to export as CSV');
            return;
        }

        // Convert rows to CSV
        const headers = Object.keys(rows[0]);
        const csvRows = [];
        csvRows.push(headers.join(','));
        
        for (const row of rows) {
            const values = headers.map(header => {
                const val = row[header];
                // Escape quotes and wrap in quotes if needed
                if (typeof val === 'string' && val.includes(',')) {
                    return `"${val.replace(/\"/g, '""')}"`;
                }
                return val;
            });
            csvRows.push(values.join(','));
        }
        
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv' });
        const csvUrl = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = csvUrl;
        a.download = `${displayName.replace('.parquet', '')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(csvUrl);
    } catch (error) {
        console.error('[Analysis] Error exporting CSV:', error);
    }
}

// Helper function to load external scripts
async function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}


// Initialize analysis page - dynamically discovers *_results folders from GitHub repos
async function initAnalysisPage(githubRepos) {
    const emptyState = document.getElementById('empty-state');
    const plotDisplays = document.getElementById('plot-displays');
    if (!emptyState || !plotDisplays) return;

    if (!githubRepos || githubRepos.length === 0) {
        emptyState.innerHTML = '<h2>No Repositories Found</h2><p>Could not load repository list.</p>';
        return;
    }

    emptyState.innerHTML = `
        <div style="text-align:center">
            <div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>
            <p style="color:var(--text-secondary)">Scanning repositories for analysis results�</p>
        </div>`;

    const analysisRepos = await discoverAnalysisData(githubRepos);

    if (analysisRepos.length === 0) {
        emptyState.innerHTML = '<h2>No Analysis Results Found</h2><p>No <code>*_results</code> folders found in any repository.</p>';
        return;
    }

    loadReposFromData(analysisRepos, emptyState);
}

// Use GitHub Git Trees API (one call per repo) to discover *_results folders
async function discoverAnalysisData(githubRepos) {
    const OWNER = 'CGutt-hub';
    const found = [];
    // Process in batches of 3 to stay well within unauthenticated rate limits
    for (let i = 0; i < githubRepos.length; i += 3) {
        const batch = githubRepos.slice(i, i + 3);
        const results = await Promise.all(batch.map(repo => discoverRepoResults(repo, OWNER)));
        for (const r of results) { if (r) found.push(r); }
    }
    return found;
}

// Scan one repo for *_results folders using the recursive Git Trees API
async function discoverRepoResults(repo, owner) {
    const repoName = repo.name;
    try {
        const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/HEAD?recursive=1`;
        const resp = await fetch(treeUrl);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data.truncated) console.warn(`[Analysis] Tree truncated for ${repoName} � some files may be missing`);

        // Keep only blobs inside any *_results/ folder with a displayable extension
        const resultFiles = (data.tree || []).filter(item =>
            item.type === 'blob' &&
            /^[^/]+_results\//.test(item.path) &&
            (item.path.endsWith('.parquet') || item.path.endsWith('.log'))
        );

        if (resultFiles.length === 0) return null;

        const resultsDir = resultFiles[0].path.split('/')[0]; // e.g. "EV_results"
        const updated = repo.updated || new Date().toISOString();
        const folders = {};

        for (const item of resultFiles) {
            const parts = item.path.split('/');
            const filename = parts[parts.length - 1];
            const folderPath = parts.slice(1, -1).join('/');
            if (!folders[folderPath]) folders[folderPath] = [];
            folders[folderPath].push({
                name: filename,
                url: `https://raw.githubusercontent.com/${owner}/${repoName}/main/${item.path}`,
                size: item.size || 0,
                folderPath,
                updated
            });
        }

        // Find all pipeline_trace.txt files, keyed by their parent subfolder
        // e.g. EV_results/study/.bin/pipeline_trace.txt  →  key = "study"
        // e.g. EV_results/.bin/pipeline_trace.txt         →  key = "" (root)
        const traceUrls = {}; // subfolderKey -> raw URL
        for (const item of (data.tree || [])) {
            if (item.type !== 'blob') continue;
            if (!item.path.startsWith(resultsDir + '/')) continue;
            if (!item.path.endsWith('pipeline_trace.txt')) continue;
            // path after resultsDir: e.g. "study/.bin/pipeline_trace.txt"
            const rel = item.path.slice(resultsDir.length + 1); // "study/.bin/pipeline_trace.txt"
            const binIdx = rel.lastIndexOf('/.bin/');
            const subKey = binIdx >= 0 ? rel.slice(0, binIdx) : ''; // "study" or ""
            traceUrls[subKey] = `https://raw.githubusercontent.com/${owner}/${repoName}/main/${item.path}`;
        }

        // Legacy: single top-level traceUrl for backward compat
        const traceUrl = Object.values(traceUrls)[0] || null;

        return {
            name: repoName,
            owner,
            description: repo.readme || repo.description || '',
            resultsDir,
            folders,
            traceUrl,
            traceUrls
        };
    } catch (err) {
        console.warn(`[Analysis] Could not scan ${repoName}:`, err.message);
        return null;
    }
}

// Build a proper tree structure from flat folder-path -> files map
// traceUrls: { subfolderKey -> url } e.g. { "study": "https://..." }
function buildFolderTree(folders, traceUrls) {
    const root = { children: {}, files: folders[''] || [], traceUrl: traceUrls?.[''] || null };
    for (const [folderPath, files] of Object.entries(folders)) {
        if (folderPath === '') continue;
        const parts = folderPath.split('/');
        let node = root;
        let pathSoFar = '';
        for (const part of parts) {
            pathSoFar = pathSoFar ? pathSoFar + '/' + part : part;
            if (!node.children[part]) {
                node.children[part] = {
                    children: {}, files: [],
                    traceUrl: traceUrls?.[pathSoFar] || null
                };
            }
            node = node.children[part];
        }
        node.files = node.files.concat(files);
    }
    return root;
}

function countTreeFiles(node) {
    let count = node.files.length;
    for (const child of Object.values(node.children)) count += countTreeFiles(child);
    return count;
}

// Detect table-type result files by name pattern (anova, correlation, t-test, etc.)
function isTableFile(name) {
    return /(_anova|_condprof|_correl|_ttest|_effectsize|_descriptive|_regression|_ols|_lgcrct|_quest|_contrast|_zscore|_sentinel)[\._ ]/i.test(name)
        || /(_summary|_stats|_results)[^/]*\.parquet$/i.test(name);
}

function renderFileItem(file) {
    if (!file.name.endsWith('.parquet') && !file.name.endsWith('.log')) return '';
    const sizeKB = (file.size / 1024).toFixed(1);
    const displayName = file.name.replace(/_/g, '_<wbr>').replace(/\./g, '<wbr>.');
    const folderLabel = (file.folderPath || '').replace(/'/g, "\\'");
    const isLog = /\.log\.parquet$/i.test(file.name) || file.name.endsWith('.log');
    const isTable = !isLog && isTableFile(file.name);
    const urlSafe = file.url.replace(/'/g, "\\'");
    const nameSafe = file.name.replace(/'/g, "\\'");
    const sizeSpan = `<span style="color:var(--text-muted,#999);font-size:0.8em;margin-left:5px">(${sizeKB}KB)</span>`;
    if (isLog) {
        return `<div class="tree-item" onclick="loadLogFile('${urlSafe}','${nameSafe}','${folderLabel}')" data-filename="${file.name.toLowerCase()}">?? ${displayName}${sizeSpan}</div>`;
    }
    if (isTable) {
        return `<div class="tree-item" onclick="loadLogFile('${urlSafe}','${nameSafe}','${folderLabel}')" data-filename="${file.name.toLowerCase()}">?? ${displayName}${sizeSpan}</div>`;
    }
    return `<div class="tree-item" onclick="loadPlotFile('${urlSafe}','${nameSafe}','${folderLabel}')" data-filename="${file.name.toLowerCase()}">?? ${displayName}${sizeSpan}</div>`;
}

function renderTreeNode(node) {
    let html = '';
    node.files.forEach(file => { html += renderFileItem(file); });
    Object.keys(node.children).sort().forEach(name => {
        const child = node.children[name];
        const count = countTreeFiles(child);
        html += `<div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false"><span class="tree-folder-icon">▶</span><span>${name}</span><span style="color:var(--text-muted,#999);font-size:0.85em;margin-left:5px">(${count})</span></div><div class="tree-folder-content" style="display:none;margin-left:10px">`;
        html += renderTreeNode(child);
        // Pipeline button at this subfolder level (sibling of participant folders)
        if (child.traceUrl) {
            const urlSafe = child.traceUrl.replace(/'/g, "\\'");
            html += `<div class="tree-item" onclick="loadPipelineViz('${urlSafe}','${name}')" style="font-style:italic;color:#4fc3f7;font-size:0.82rem;cursor:pointer">📊 Pipeline</div>`;
        }
        html += '</div>';
    });
    return html;
}

function renderFileTree(structure, append = false) {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;
    const { repoName, repoOwner, description, folders } = structure;

    window._repoDescriptions = window._repoDescriptions || {};
    window._repoDescriptions[repoOwner + '/' + repoName] = description || '';

    const tree = buildFolderTree(folders, structure.traceUrls || {});
    const totalFiles = countTreeFiles(tree);

    let html = `<div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false" data-repo-owner="${repoOwner}" data-repo-name="${repoName}"><span class="tree-folder-icon">▶</span><span>${repoName}</span><span style="color:var(--text-muted,#999);font-size:0.85em;margin-left:5px">(${totalFiles})</span></div><div class="tree-folder-content" style="display:none;margin-left:10px">`;
    html += renderTreeNode(tree);
    html += `<div class="tree-item" onclick="showRepoInfo('${repoOwner}','${repoName}')" style="font-style:italic;color:var(--accent-primary,#c9a227);font-size:0.82rem;cursor:pointer">📖 README</div></div>`;

    fileTree.innerHTML = append ? fileTree.innerHTML + html : html;

    const allFiles = Object.values(folders).flat();
    if (!window.analysisData) window.analysisData = { repos: [], allFiles: [] };
    if (append) {
        window.analysisData.repos.push(structure);
        window.analysisData.allFiles = window.analysisData.allFiles.concat(allFiles);
    } else {
        window.analysisData = { repos: [structure], allFiles };
    }
    // Reveal the right sidebar toggle once data is available
    const tog = document.getElementById('trace-toggle');
    if (tog) tog.style.display = '';
}

function loadReposFromData(analysisRepos, emptyState) {
    let loadedCount = 0;
    for (const repoConfig of analysisRepos) {
        const structure = {
            repoName: repoConfig.name,
            repoOwner: repoConfig.owner,
            description: repoConfig.description || '',
            resultsDir: repoConfig.resultsDir,
            folders: repoConfig.folders,
            traceUrl: repoConfig.traceUrl || null
        };
        if (!structure.folders || !Object.values(structure.folders).some(f => f.length > 0)) continue;
        renderFileTree(structure, loadedCount > 0);
        if (loadedCount === 0) emptyState.style.display = 'none';
        fetchPipelineTrace(`${structure.repoOwner}/${structure.repoName}`, structure.resultsDir);
        loadedCount++;
    }
    if (loadedCount === 0) {
        emptyState.innerHTML = `<h2>No Plot Data Found</h2><p>Found ${analysisRepos.length} repo(s) but none have displayable files.</p>`;
    } else {
        const searchInput = document.getElementById('search-box');
        if (searchInput && !searchInput.hasAttribute('data-initialized')) {
            searchInput.setAttribute('data-initialized', 'true');
            searchInput.addEventListener('input', e => filterFileTree(e.target.value));
        }
    }
}

// Toggle folder expand/collapse
function toggleFolder(el) {
    const expanded = el.getAttribute('data-expanded') === 'true';
    el.setAttribute('data-expanded', String(!expanded));
    const icon = el.querySelector('.tree-folder-icon');
    if (icon) icon.style.transform = expanded ? '' : 'rotate(90deg)';
    const content = el.nextElementSibling;
    if (content) content.style.display = expanded ? 'none' : 'block';
}

// Filter sidebar file tree by search query
function filterFileTree(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('#file-tree .tree-item').forEach(item => {
        const fn = item.getAttribute('data-filename') || '';
        item.style.display = (!q || fn.includes(q)) ? '' : 'none';
    });
}

// Show repo README in main panel
function showRepoInfo(owner, repoName) {
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState = document.getElementById('empty-state');
    if (!plotDisplays) return;
    document.querySelectorAll('#file-tree .tree-item').forEach(i => i.classList.remove('active'));
    if (emptyState) emptyState.style.display = 'none';
    const key = owner + '/' + repoName;
    const description = (window._repoDescriptions && window._repoDescriptions[key]) || '';
    plotDisplays.innerHTML = `
        <div class="plot-header">
            <h2><a href="https://github.com/${owner}/${repoName}" target="_blank" rel="noopener">${repoName}</a></h2>
            <div class="plot-meta">Repository: <a href="https://github.com/${owner}/${repoName}" target="_blank" rel="noopener">github.com/${owner}/${repoName}</a></div>
        </div>
        <div class="rendered-markdown" style="margin-top:1.5rem">${description ? (typeof marked !== 'undefined' ? marked.parse(description) : '<pre>' + description + '</pre>') : '<p style="color:var(--text-secondary)">No README available.</p>'}</div>
    `;
}

// Load and render a parquet plot/table file
async function loadPlotFile(url, displayName, folderLabel) {
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState = document.getElementById('empty-state');
    if (!plotDisplays) return;

    document.querySelectorAll('#file-tree .tree-item').forEach(i => i.classList.remove('active'));
    const active = document.querySelector(`#file-tree .tree-item[data-filename="${displayName.toLowerCase()}"]`);
    if (active) active.classList.add('active');
    if (emptyState) emptyState.style.display = 'none';

    const cid = 'plot-main';
    plotDisplays.innerHTML = `
        <div class="export-bar">
            <span class="plot-download-label">Download:</span>
            <button class="export-btn" onclick="window._directDownload('${url}','${displayName}')">? Parquet</button>
            <button class="export-btn csv" onclick="exportPlotAsCSV('${url}','${displayName}')">? CSV</button>
            <button class="export-btn png" onclick="exportPlotAsPNG('${cid}','${displayName}')">? PNG</button>
            <button class="export-btn pdf" onclick="exportPlotAsPDF('${cid}','${displayName}')">? PDF</button>
        </div>
        <div id="${cid}" class="plot-container">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)">
                <div style="text-align:center"><div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Loading�</div>
            </div>
        </div>`;

    try {
        const { rows } = await fetchParquetData(url);
        const plotSpec = await parquetToPlotly(rows, displayName.replace(/\.parquet$/i, ''));
        if (!plotSpec) {
            document.getElementById(cid).innerHTML = '<p style="padding:2rem;color:var(--text-secondary)">No renderable data in this file.</p>';
            return;
        }
        await Plotly.newPlot(cid, plotSpec.data, plotSpec.layout, { responsive: true, displayModeBar: true });
        if (typeof resizeAnalysisLayout === 'function') resizeAnalysisLayout();
        Plotly.Plots.resize(document.getElementById(cid));
    } catch (err) {
        document.getElementById(cid).innerHTML = `<div style="padding:2rem;color:#ef5350"><strong>Error:</strong> ${err.message}</div>`;
    }
}

// Load and render a log parquet file as a flat table
async function loadLogFile(url, displayName, folderLabel) {
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState = document.getElementById('empty-state');
    if (!plotDisplays) return;

    document.querySelectorAll('#file-tree .tree-item').forEach(i => i.classList.remove('active'));
    const active = document.querySelector(`#file-tree .tree-item[data-filename="${displayName.toLowerCase()}"]`);
    if (active) active.classList.add('active');
    if (emptyState) emptyState.style.display = 'none';

    const cid = 'log-main';
    plotDisplays.innerHTML = `
        <div class="export-bar">
            <span class="plot-download-label">Download:</span>
            <button class="export-btn" onclick="window._directDownload('${url}','${displayName}')">? Parquet</button>
            <button class="export-btn csv" onclick="exportPlotAsCSV('${url}','${displayName}')">? CSV</button>
            <button class="export-btn png" onclick="exportPlotAsPNG('${cid}','${displayName}')">? PNG</button>
            <button class="export-btn pdf" onclick="exportPlotAsPDF('${cid}','${displayName}')">? PDF</button>
        </div>
        <div id="${cid}" class="plot-container">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)">
                <div style="text-align:center"><div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Loading�</div>
            </div>
        </div>`;

    try {
        const { rows } = await fetchParquetData(url);
        const plotSpec = flatTableToPlotly(rows, displayName.replace(/\.parquet$/i, ''));
        if (!plotSpec) {
            document.getElementById(cid).innerHTML = '<p style="padding:2rem;color:var(--text-secondary)">No data in log file.</p>';
            return;
        }
        Plotly.newPlot(cid, plotSpec.data, plotSpec.layout, { responsive: true });
    } catch (err) {
        document.getElementById(cid).innerHTML = `<div style="padding:2rem;color:#ef5350"><strong>Error:</strong> ${err.message}</div>`;
    }
}

// Pipeline trace - fetches on demand, no API rate limit (uses raw.githubusercontent.com)
async function fetchPipelineTrace(repoPath, resultsDir) {
    // Loaded lazily when user clicks a pipeline trace file; no-op at init
}

// Map filename fragments to pipeline step names
const STEP_PATTERNS = [
    [/bootstrap/i, 'bootstrap'],
    [/ingest/i, 'ingestor'],
    [/file_finder/i, 'file_finder'],
    [/condprof|condition_profile/i, 'condition_profile_processor'],
    [/concat|concatenat/i, 'concatenating_processor'],
    [/epoch/i, 'epoching_processor'],
    [/filter/i, 'filtering_processor'],
    [/label|binner/i, 'label_binner'],
    [/pivot/i, 'pivot_processor'],
    [/reject/i, 'rejection_processor'],
    [/psd|spectrum/i, 'psd_analyzer'],
    [/fai|asym/i, 'asymmetry_analyzer'],
    [/anova/i, 'anova_analyzer'],
    [/ttest|t_test/i, 'ttest_analyzer'],
    [/correl/i, 'correl_analyzer'],
    [/effectsize|effect_size/i, 'effectsize_analyzer'],
    [/descriptive/i, 'descriptive_analyzer'],
    [/bootstrap/i, 'bootstrap_analyzer'],
    [/plv/i, 'plv_analyzer'],
    [/phase/i, 'phase_analyzer'],
    [/amplitude/i, 'amplitude_analyzer'],
    [/interval/i, 'interval_analyzer'],
    [/group/i, 'group_analyzer'],
    [/relative/i, 'relative_analyzer'],
    [/zscore/i, 'zscore_analyzer'],
    [/quest/i, 'quest_analyzer'],
    [/lgcrct/i, 'lgcrct_loso_analyzer'],
    [/lmm|mixed/i, 'lmm'],
];

function guessStepFromFilename(filename) {
    const base = filename.replace(/\.parquet$/i, '').replace(/\.log$/i, '');
    for (const [pat, step] of STEP_PATTERNS) {
        if (pat.test(base)) return step;
    }
    return null;
}

// Parse Nextflow trace TSV and return ordered unique process list with status
function parseTraceFile(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t');
    const idxProcess = headers.indexOf('process');
    const idxStatus  = headers.indexOf('status');
    if (idxProcess < 0) return [];
    const seen = new Map(); // process -> {count, failed}
    for (const line of lines.slice(1)) {
        const cols = line.split('\t');
        const proc = cols[idxProcess];
        const status = idxStatus >= 0 ? cols[idxStatus] : 'COMPLETED';
        if (!proc) continue;
        if (!seen.has(proc)) seen.set(proc, { count: 0, failed: 0 });
        seen.get(proc).count++;
        if (status && status !== 'COMPLETED') seen.get(proc).failed++;
    }
    return Array.from(seen.entries()).map(([name, s]) => ({ name, ...s }));
}

// toggleTraceSidebar is defined in analysis.html (needs resizeAnalysisLayout in same scope)

// ─── Right Sidebar: 3-level Pipeline Navigator ────────────────────────────
// Level 0: Repo list   →   Level 1: Pipeline steps   →   Level 2: File list

const _nav = { stack: [], traceCache: {} };

// Entry point: open sidebar at repos level (or jump to steps for a specific repo)
function openPipelineNav(repoName) {
    _nav.stack = repoName ? [{ view: 'steps', repo: repoName }] : [];
    toggleTraceSidebar(true);
    _renderNav();
}

function _navBack() {
    _nav.stack.pop();
    _renderNav();
}

async function _renderNav() {
    const content = document.getElementById('trace-content');
    if (!content) return;
    const state = _nav.stack.length ? _nav.stack[_nav.stack.length - 1] : { view: 'repos' };
    const hasBack = _nav.stack.length > 0;
    const backBtn = hasBack
        ? `<button onclick="_navBack()" style="background:none;border:none;color:#4fc3f7;cursor:pointer;font-size:0.8rem;padding:0;margin-bottom:0.8rem;display:flex;align-items:center;gap:4px"><span style="font-size:1em">←</span> Back</button>`
        : '';

    switch (state.view) {
        case 'repos':  _renderReposView(content, backBtn);                     break;
        case 'steps':  await _renderStepsView(content, state.repo, backBtn);   break;
        case 'files':  _renderFilesView(content, state.repo, state.step, backBtn); break;
    }
}

function _navStyles() {
    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    return {
        textPrimary: cs?.getPropertyValue('--text-primary').trim()   || '#e8e8e8',
        textSec:     cs?.getPropertyValue('--text-secondary').trim() || '#999',
        bgElev:      cs?.getPropertyValue('--bg-elevated').trim()    || '#1c1c1c',
        bgTert:      cs?.getPropertyValue('--bg-tertiary').trim()    || '#181818',
        border:      cs?.getPropertyValue('--border-primary').trim() || '#2a2a2a',
        accent:      cs?.getPropertyValue('--accent-primary').trim() || '#c9a227',
    };
}

// Level 0 — Repos
function _renderReposView(content, backBtn) {
    const st = _navStyles();
    const repos = window.analysisData?.repos || [];
    if (!repos.length) {
        content.innerHTML = `<div style="padding:1rem">${backBtn}<p style="color:${st.textSec};font-size:0.82rem">No repos loaded yet.</p></div>`;
        return;
    }
    const items = repos.map(r => {
        const hasTrace = !!r.traceUrl;
        const rSafe = r.repoName.replace(/'/g, "\\'");
        return `<div onclick="_nav.stack.push({view:'steps',repo:'${rSafe}'});_renderNav()" style="
            padding:10px 12px;border:1px solid ${st.border};border-radius:6px;margin-bottom:6px;
            cursor:pointer;background:${st.bgElev};transition:border-color 0.2s;"
            onmouseover="this.style.borderColor='${st.accent}'" onmouseout="this.style.borderColor='${st.border}'">
            <div style="color:${st.textPrimary};font-size:0.85rem;font-weight:600">${r.repoName}</div>
            <div style="color:${st.textSec};font-size:0.72rem;margin-top:2px">
                ${Object.values(r.folders).flat().length} files
                ${hasTrace ? '· <span style="color:#4fc3f7">🔗 trace available</span>' : ''}
            </div>
        </div>`;
    }).join('');
    content.innerHTML = `<div style="padding:1rem">
        ${backBtn}
        <p style="color:${st.textSec};font-size:0.72rem;margin:0 0 0.8rem 0">Select a dataset to browse its pipeline steps.</p>
        ${items}
    </div>`;
}

// Level 1 — Pipeline steps
async function _renderStepsView(content, repoName, backBtn) {
    const st = _navStyles();
    const repo = (window.analysisData?.repos || []).find(r => r.repoName === repoName);

    // Show loading
    content.innerHTML = `<div style="padding:1rem">${backBtn}<p style="color:${st.textSec};font-size:0.82rem">Loading pipeline…</p></div>`;

    // Fetch or use cached trace
    if (!_nav.traceCache[repoName]) {
        if (repo?.traceUrl) {
            try {
                const resp = await fetch(repo.traceUrl);
                const text = resp.ok ? await resp.text() : '';
                _nav.traceCache[repoName] = parseTraceFile(text);
            } catch { _nav.traceCache[repoName] = []; }
        } else {
            _nav.traceCache[repoName] = [];
        }
    }
    const steps = _nav.traceCache[repoName];

    const traceBtn = repo?.traceUrl
        ? `<button onclick="window._directDownload('${repo.traceUrl.replace(/'/g,\"\\'\")  }','pipeline_trace.txt')" class="export-btn" style="font-size:0.7rem;padding:3px 8px" onmouseover="this.style.borderColor='#4fc3f7';this.style.color='#4fc3f7'" onmouseout="this.style.borderColor='';this.style.color=''">⤓ trace.txt</button>`
        : '';

    if (!steps.length) {
        content.innerHTML = `<div style="padding:1rem">${backBtn}<p style="color:${st.textSec};font-size:0.82rem">No trace data available for <strong>${repoName}</strong>.</p>${traceBtn}</div>`;
        return;
    }

    const stepItems = steps.map((s, i) => {
        const color  = s.failed > 0 ? '#ef5350' : '#2ecc71';
        const label  = s.name.replace(/_/g, '_<wbr>');
        const isLast = i === steps.length - 1;
        // Count matching files for this step
        const allFiles = Object.values(repo?.folders || {}).flat();
        const matchCount = allFiles.filter(f => guessStepFromFilename(f.name) === s.name).length;
        const sSafe = s.name.replace(/'/g, "\\'");
        const rSafe = repoName.replace(/'/g, "\\'");
        const clickable = matchCount > 0;
        return `<div style="display:flex;align-items:flex-start;gap:5px;margin-bottom:5px">
            <div onclick="${clickable ? `_nav.stack.push({view:'files',repo:'${rSafe}',step:'${sSafe}'});_renderNav()` : ''}" style="
                flex:1;padding:7px 10px;border:1.5px solid ${st.border};border-radius:6px;
                background:${st.bgElev};font-size:0.75rem;font-family:var(--font-mono);
                color:${clickable ? st.textPrimary : st.textSec};
                cursor:${clickable ? 'pointer' : 'default'};
                transition:border-color 0.2s,color 0.2s;"
                onmouseover="${clickable ? `this.style.borderColor='${st.accent}'` : ''}"
                onmouseout="${clickable ? `this.style.borderColor='${st.border}'` : ''}"
                title="${s.count} task(s)${s.failed ? ` — ${s.failed} failed` : ''}${matchCount ? ` — ${matchCount} output file(s)` : ''}">
                <span style="color:${color};margin-right:4px">●</span>${label}
                ${matchCount ? `<span style="float:right;font-size:0.68em;color:#4fc3f7;opacity:0.85">${matchCount} files</span>` : ''}
            </div>
            ${!isLast ? `<span style="color:${st.textSec};padding-top:7px;font-size:0.85em">↓</span>` : ''}
        </div>`;
    }).join('');

    content.innerHTML = `<div style="padding:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem">
            <div>${backBtn}<span style="color:${st.textPrimary};font-size:0.88rem;font-weight:600">${repoName}</span></div>
            ${traceBtn}
        </div>
        <p style="color:${st.textSec};font-size:0.72rem;margin:0 0 0.8rem 0">
            ● green=ok · red=failed · click a step to see its output files
        </p>
        ${stepItems}
    </div>`;
}

// Level 2 — Files matching a step
function _renderFilesView(content, repoName, stepName, backBtn) {
    const st = _navStyles();
    const repo = (window.analysisData?.repos || []).find(r => r.repoName === repoName);
    const allFiles = Object.values(repo?.folders || {}).flat();
    const matching = allFiles.filter(f => guessStepFromFilename(f.name) === stepName);

    // Group by participant (first path segment of folderPath)
    const byPart = {};
    for (const f of matching) {
        const part = f.folderPath ? f.folderPath.split('/')[0] : '—';
        if (!byPart[part]) byPart[part] = [];
        byPart[part].push(f);
    }

    if (!matching.length) {
        content.innerHTML = `<div style="padding:1rem">${backBtn}<p style="color:${st.textSec};font-size:0.82rem">No output files found for <strong>${stepName}</strong>.</p></div>`;
        return;
    }

    const groups = Object.entries(byPart).map(([part, files]) => {
        const fileItems = files.map(f => {
            const urlSafe = f.url.replace(/'/g, "\\'");
            const nameSafe = f.name.replace(/'/g, "\\'");
            const isLog = /\.log\.parquet$/i.test(f.name) || isTableFile(f.name);
            const icon = isLog ? '📋' : '📊';
            const sizeKB = (f.size / 1024).toFixed(1);
            return `<div onclick="${isLog ? `loadLogFile` : `loadPlotFile`}('${urlSafe}','${nameSafe}','${part}');toggleTraceSidebar(false)" style="
                padding:5px 8px;cursor:pointer;border-radius:4px;
                font-size:0.75rem;font-family:var(--font-mono);color:${st.textSec};
                transition:background 0.15s;word-break:break-all;"
                onmouseover="this.style.background='${st.bgTert}';this.style.color='${st.textPrimary}'"
                onmouseout="this.style.background='';this.style.color='${st.textSec}'">
                ${icon} ${f.name}
                <span style="opacity:0.5;font-size:0.68em;margin-left:4px">${sizeKB}KB</span>
            </div>`;
        }).join('');
        return `<div style="margin-bottom:10px">
            <div style="font-size:0.72rem;color:${st.accent};font-weight:600;padding:3px 0;border-bottom:1px solid ${st.border};margin-bottom:4px">${part}</div>
            ${fileItems}
        </div>`;
    }).join('');

    content.innerHTML = `<div style="padding:1rem">
        ${backBtn}
        <div style="color:${st.textPrimary};font-size:0.85rem;font-weight:600;margin-bottom:0.2rem">${stepName.replace(/_/g,' ')}</div>
        <p style="color:${st.textSec};font-size:0.72rem;margin:0 0 0.8rem 0">${matching.length} output file(s) across ${Object.keys(byPart).length} participant(s) · click to load</p>
        ${groups}
    </div>`;
}

// Load and render a Nextflow pipeline trace as an interactive Plotly timeline
async function loadPipelineViz(traceUrl, repoName) {
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState   = document.getElementById('empty-state');
    if (!plotDisplays) return;
    document.querySelectorAll('#file-tree .tree-item').forEach(i => i.classList.remove('active'));
    if (emptyState) emptyState.style.display = 'none';

    const cid = 'pipeline-viz';
    const urlSafe = traceUrl.replace(/'/g, "\\'");
    const nameSafe = 'pipeline_trace.txt';
    plotDisplays.innerHTML = `
        <div class="export-bar">
            <span class="plot-download-label">Download:</span>
            <button class="export-btn" onclick="window._directDownload('${urlSafe}','${nameSafe}')">⤓ .txt</button>
            <button class="export-btn png" onclick="exportPlotAsPNG('${cid}','${repoName}_pipeline')">⤓ PNG</button>
            <button class="export-btn pdf" onclick="exportPlotAsPDF('${cid}','${repoName}_pipeline')">⤓ PDF</button>
        </div>
        <div id="${cid}" class="plot-container">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)">
                <div style="text-align:center"><div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Loading pipeline trace…</div>
            </div>
        </div>`;

    try {
        const resp = await fetch(traceUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();

        // Parse TSV
        const lines = text.trim().split('\n');
        const headers = lines[0].split('\t');
        const idx = h => headers.indexOf(h);
        const tasks = lines.slice(1).map(l => {
            const c = l.split('\t');
            return {
                id:       c[idx('task_id')],
                process:  c[idx('process')],
                tag:      c[idx('tag')],
                status:   c[idx('status')]   || 'COMPLETED',
                duration: c[idx('realtime')] || '',
                start:    c[idx('start')]    || '',
                complete: c[idx('complete')] || '',
            };
        }).filter(t => t.process);

        // Assign numeric x (task order) and y (process name → index)
        const processOrder = [...new Set(tasks.map(t => t.process))];
        const processIndex = Object.fromEntries(processOrder.map((p, i) => [p, i]));

        const colorMap = { COMPLETED: '#2ecc71', FAILED: '#ef5350', CACHED: '#4fc3f7' };
        const colors = tasks.map(t => colorMap[t.status] || '#999');
        const xs     = tasks.map((_, i) => i);
        const ys     = tasks.map(t => processIndex[t.process]);
        const texts  = tasks.map(t =>
            `<b>${t.process}</b><br>tag: ${t.tag}<br>status: ${t.status}<br>duration: ${t.duration}<br>start: ${t.start}`);

        const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
        const bgColor   = cs?.getPropertyValue('--bg-secondary').trim()  || '#161616';
        const textColor = cs?.getPropertyValue('--text-primary').trim()  || '#e8e8e8';
        const gridColor = cs?.getPropertyValue('--border-primary').trim()|| '#2a2a2a';

        const trace = {
            x: xs, y: ys,
            mode: 'markers',
            type: 'scatter',
            marker: { color: colors, size: 8, opacity: 0.85,
                line: { color: gridColor, width: 0.5 } },
            text: texts,
            hovertemplate: '%{text}<extra></extra>',
        };

        const layout = {
            title: { text: `${repoName} — Pipeline Execution (${tasks.length} tasks)`,
                     font: { color: textColor, size: 15 } },
            xaxis: { title: { text: 'Task sequence', font: { color: textColor } },
                     tickfont: { color: textColor }, gridcolor: gridColor, linecolor: gridColor },
            yaxis: {
                tickvals: processOrder.map((_, i) => i),
                ticktext: processOrder,
                tickfont: { color: textColor, size: 10 },
                gridcolor: gridColor, linecolor: gridColor,
                automargin: true,
            },
            paper_bgcolor: bgColor, plot_bgcolor: bgColor,
            font: { color: textColor, family: "'JetBrains Mono', monospace" },
            hovermode: 'closest',
            margin: { t: 60, b: 60, l: 220, r: 30 },
        };

        await Plotly.newPlot(cid, [trace], layout, { responsive: true, displayModeBar: true });
        if (typeof resizeAnalysisLayout === 'function') resizeAnalysisLayout();
        Plotly.Plots.resize(document.getElementById(cid));
    } catch (err) {
        document.getElementById(cid).innerHTML =
            `<div style="padding:2rem;color:#ef5350"><strong>Error:</strong> ${err.message}</div>`;
    }
}

// Load and render a Nextflow pipeline trace as an interactive Plotly timeline
async function loadPipelineViz(traceUrl, repoName) {
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState   = document.getElementById('empty-state');
    if (!plotDisplays) return;
    document.querySelectorAll('#file-tree .tree-item').forEach(i => i.classList.remove('active'));
    if (emptyState) emptyState.style.display = 'none';

    const cid = 'pipeline-viz';
    const urlSafe  = traceUrl.replace(/'/g, "\\'");
    const nameSafe = (repoName || 'pipeline').replace(/'/g, "\\'");
    plotDisplays.innerHTML = `
        <div class="export-bar">
            <span class="plot-download-label">Download:</span>
            <button class="export-btn" onclick="window._directDownload('${urlSafe}','pipeline_trace.txt')">⤓ .txt</button>
            <button class="export-btn png" onclick="exportPlotAsPNG('${cid}','${nameSafe}_pipeline')">⤓ PNG</button>
            <button class="export-btn pdf" onclick="exportPlotAsPDF('${cid}','${nameSafe}_pipeline')">⤓ PDF</button>
        </div>
        <div id="${cid}" class="plot-container">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)">
                <div style="text-align:center"><div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Loading pipeline trace…</div>
            </div>
        </div>`;

    try {
        const resp = await fetch(traceUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();

        const lines   = text.trim().split('\n');
        const headers = lines[0].split('\t');
        const idx = h => headers.indexOf(h);
        const tasks = lines.slice(1).map(l => {
            const c = l.split('\t');
            return {
                process:  c[idx('process')],
                tag:      c[idx('tag')]      || '',
                status:   c[idx('status')]   || 'COMPLETED',
                duration: c[idx('realtime')] || '',
                start:    c[idx('start')]    || '',
            };
        }).filter(t => t.process);



        // Build unique ordered process sequence (deduplicated, order-preserving)
        const processOrder = [...new Set(tasks.map(t => t.process))];
        const taskCounts   = Object.fromEntries(
            processOrder.map(p => [p, tasks.filter(t => t.process === p).length])
        );
        const failCounts   = Object.fromEntries(
            processOrder.map(p => [p, tasks.filter(t => t.process === p && t.status !== 'COMPLETED').length])
        );

        // Layout: vertical chain — each node at y = index, x = 0, arrow to next
        const n = processOrder.length;\n        const nodeX = processOrder.map(() => 0);\n        const nodeY = processOrder.map((_, i) => n - 1 - i); // top = first step\n\n        const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;\n        const bgColor   = cs?.getPropertyValue('--bg-secondary').trim()  || '#161616';\n        const textColor = cs?.getPropertyValue('--text-primary').trim()  || '#e8e8e8';\n        const gridColor = cs?.getPropertyValue('--border-primary').trim()|| '#2a2a2a';\n        const textSec   = cs?.getPropertyValue('--text-secondary').trim()|| '#999';\n\n        // Arrow lines between consecutive steps\n        const arrowTraces = [];\n        for (let i = 0; i < n - 1; i++) {\n            arrowTraces.push({\n                x: [0, 0], y: [nodeY[i], nodeY[i + 1]],\n                mode: 'lines',\n                type: 'scatter',\n                line: { color: textSec, width: 1.5 },\n                showlegend: false,\n                hoverinfo: 'skip',\n            });\n        }\n\n        // Node markers\n        const nodeColors = processOrder.map(p => failCounts[p] > 0 ? '#ef5350' : '#2ecc71');\n        const nodeHovers = processOrder.map(p =>\n            `<b>${p}</b><br>Tasks: ${taskCounts[p]}${failCounts[p] ? `<br><span style="color:#ef5350">Failed: ${failCounts[p]}</span>` : ''}`);\n\n        const plotSpec = {\n            data: [\n                ...arrowTraces,\n                {\n                    x: nodeX, y: nodeY,\n                    mode: 'markers+text',\n                    type: 'scatter',\n                    marker: { color: nodeColors, size: 14,\n                              line: { color: bgColor, width: 2 } },\n                    text: processOrder.map(p => `  ${p.replace(/_/g, ' ')}  ×${taskCounts[p]}`),\n                    textposition: 'middle right',\n                    textfont: { color: textColor, size: 11, family: \"'JetBrains Mono', monospace\" },\n                    hovertext: nodeHovers,\n                    hovertemplate: '%{hovertext}<extra></extra>',\n                    showlegend: false,\n                },\n            ],\n            layout: {\n                title: { text: `${repoName} — Pipeline Structure (${n} steps)`,\n                         font: { color: textColor, size: 15 } },\n                xaxis: { visible: false, range: [-0.5, 4] },\n                yaxis: { visible: false, range: [-1, n] },\n                paper_bgcolor: bgColor, plot_bgcolor: bgColor,\n                font: { color: textColor, family: \"'JetBrains Mono', monospace\" },\n                hovermode: 'closest',\n                margin: { t: 60, b: 20, l: 20, r: 20 },\n            },\n        };

        await Plotly.newPlot(cid, plotSpec.data, plotSpec.layout, { responsive: true, displayModeBar: true });
        if (typeof resizeAnalysisLayout === 'function') resizeAnalysisLayout();
        Plotly.Plots.resize(document.getElementById(cid));
    } catch (err) {
        document.getElementById(cid).innerHTML =
            `<div style="padding:2rem;color:#ef5350"><strong>Error:</strong> ${err.message}</div>`;
    }
}

// Highlight the pipeline step that produced the currently loaded file (called from loadPlotFile/loadLogFile)
function highlightPipelineStep(filename) {
    const guess = guessStepFromFilename(filename);
    if (!guess || !document.getElementById('trace-sidebar')?.classList.contains('open')) return;
    document.querySelectorAll('#trace-content div[title]').forEach(el => {
        const title = el.getAttribute('title') || '';
        const isMatch = title.includes('task') && el.textContent.includes(guess.split('_')[0]);
        el.style.borderColor = isMatch ? '#c9a227' : '';
    });
}

// Export plot as PNG using Plotly
function exportPlotAsPNG(containerId, displayName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    Plotly.downloadImage(el, {
        format: 'png',
        width: 1400,
        height: 800,
        filename: displayName.replace(/\.parquet$/i, '')
    });
}

// Export plot as PDF using Plotly toImage + pdf-lib
async function exportPlotAsPDF(containerId, displayName) {
    const el = document.getElementById(containerId);
    if (!el) { alert('Plot not rendered yet.'); return; }
    try {
        if (typeof PDFLib === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
        const { PDFDocument, rgb } = PDFLib;
        const imgData = await Plotly.toImage(el, { format: 'png', width: 1400, height: 800 });
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([1400 * 0.75, 800 * 0.75]); // pt
        const pngBytes = await fetch(imgData).then(r => r.arrayBuffer());
        const pngImg = await pdfDoc.embedPng(pngBytes);
        page.drawImage(pngImg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = displayName.replace(/\.parquet$/i, '') + '.pdf';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch (err) {
        alert('PDF export failed: ' + err.message);
    }
}

// Direct download helper
window._directDownload = function(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};
