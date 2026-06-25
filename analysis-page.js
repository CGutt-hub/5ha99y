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
    if (window.hyparquetReadObjects) return;
    console.log('[Analysis] Waiting for hyparquet to load...');
    await new Promise((resolve, reject) => {
        const start = Date.now();
        const check = setInterval(() => {
            if (window.hyparquetReadObjects) { clearInterval(check); resolve(); }
            else if (Date.now() - start > 15000) { clearInterval(check); reject(new Error('hyparquet library failed to load after 15s. Check internet connection.')); }
        }, 100);
    });
}

// Parse an ArrayBuffer containing a parquet file into row objects using hyparquet
async function parseParquetBuffer(arrayBuffer) {
    await waitForHyparquet();
    // parquetReadObjects accepts ArrayBuffer directly and returns row objects
    const rows = await window.hyparquetReadObjects({ file: arrayBuffer });
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
        const rows = await window.hyparquetReadObjects({ file: arrayBuffer });
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

// Export plot data as XLS using SheetJS
async function exportPlotAsXLS(url, displayName) {
    try {
        const { rows } = await fetchParquetData(url);
        if (!rows || rows.length === 0) {
            console.error('[Analysis] No data to export as XLS');
            return;
        }

        // Load SheetJS library dynamically
        if (!window.XLSX) {
            await loadScript('https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js');
        }

        // Convert rows to worksheet
        const worksheet = window.XLSX.utils.json_to_sheet(rows);
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        
        // Export to XLS
        const xlsData = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([xlsData], { type: 'application/octet-stream' });
        const xlsUrl = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = xlsUrl;
        a.download = `${displayName.replace('.parquet', '')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(xlsUrl);
    } catch (error) {
        console.error('[Analysis] Error exporting XLS:', error);
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

// Initialize page: data is already loaded via window.plotsData
// Discover all repos with analysis results
// Check GitHub API rate limit and return remaining calls
async function checkRateLimit() {
    try {
        const response = await fetch('https://api.github.com/rate_limit');
        if (response.ok) {
            const data = await response.json();
            const core = data.rate || data.resources?.core;
            if (core) {
                const resetDate = new Date(core.reset * 1000);
                return { remaining: core.remaining, limit: core.limit, reset: resetDate };
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

// Fetch the full Git tree for a repo in a single API call (replaces multiple contents API calls)
async function fetchRepoTree(owner, repo) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                const rateInfo = await checkRateLimit();
                if (rateInfo && rateInfo.remaining === 0) {
                    throw new Error(`RATE_LIMIT:${rateInfo.reset.toISOString()}`);
                }
            }
            return null;
        }
        const data = await response.json();
        return data.tree || null; // Array of {path, type: 'blob'|'tree', size, ...}
    } catch (error) {
        if (error.message.startsWith('RATE_LIMIT:')) throw error;
        console.error('[Analysis] Error fetching tree for', repo, error);
        return null;
    }
}

async function discoverAnalysisRepos(username) {
    console.log('[Analysis] Discovering repos for user:', username);
    
    try {
        // Fetch all public repos for the user (1 API call)
        const reposUrl = `https://api.github.com/users/${username}/repos?per_page=100`;
        const response = await fetch(reposUrl);
        
        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                const rateInfo = await checkRateLimit();
                if (rateInfo && rateInfo.remaining === 0) {
                    throw new Error(`RATE_LIMIT:${rateInfo.reset.toISOString()}`);
                }
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        const repos = await response.json();
        console.log('[Analysis] Found', repos.length, 'total repos');
        
        const analysisRepos = [];
        
        // Fetch full tree for each repo (1 API call per repo instead of N)
        for (const repo of repos) {
            const tree = await fetchRepoTree(username, repo.name);
            if (!tree) continue;
            
            // Find all directories ending with _results
            const resultsDirs = new Set();
            for (const item of tree) {
                const parts = item.path.split('/');
                if (parts.length >= 1 && parts[0].endsWith('_results')) {
                    resultsDirs.add(parts[0]);
                }
            }
            
            if (resultsDirs.size > 0) {
                console.log('[Analysis] Found analysis repo:', repo.name, 'with folders:', [...resultsDirs]);
                
                for (const dir of resultsDirs) {
                    // Build a nested folder structure from all files under this results dir
                    const folders = {};
                    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const prefix = new RegExp(`^${escaped}/`);
                    for (const item of tree) {
                        if (item.type !== 'blob') continue;
                        if (!prefix.test(item.path)) continue;
                        // Get relative path within results dir
                        const relPath = item.path.replace(prefix, '');
                        const parts = relPath.split('/');
                        // Skip dotfiles and files inside dot-directories (e.g. .bin/)
                        if (parts.some(p => p.startsWith('.'))) continue;
                        const fileName = parts.pop();
                        const folderPath = parts.join('/');
                        if (!folders[folderPath]) folders[folderPath] = [];
                        folders[folderPath].push({
                            name: fileName,
                            path: item.path,
                            size: item.size || 0,
                            folderPath: folderPath,
                            url: `https://raw.githubusercontent.com/${username}/${repo.name}/main/${item.path}`
                        });
                    }
                    
                    analysisRepos.push({
                        owner: username,
                        name: repo.name,
                        description: repo.description || '',
                        resultsDir: dir,
                        folders: folders
                    });
                }
            }
        }
        
        console.log('[Analysis] Discovered', analysisRepos.length, 'analysis repos');
        return analysisRepos;
        
    } catch (error) {
        if (error.message.startsWith('RATE_LIMIT:')) throw error;
        console.error('[Analysis] Error discovering repos:', error);
        return [];
    }
}

// Build a proper tree structure from flat folder-path → files map
function buildFolderTree(folders) {
    const root = { children: {}, files: folders[''] || [] };
    for (const [folderPath, files] of Object.entries(folders)) {
        if (folderPath === '') continue;
        const parts = folderPath.split('/');
        let node = root;
        for (const part of parts) {
            if (!node.children[part]) node.children[part] = { children: {}, files: [] };
            node = node.children[part];
        }
        node.files = node.files.concat(files);
    }
    return root;
}

// Count all files recursively in a tree node
function countTreeFiles(node) {
    let count = node.files.length;
    for (const child of Object.values(node.children)) count += countTreeFiles(child);
    return count;
}

// Render a single file item in the sidebar tree
function renderFileItem(file) {
    if (!file.name.endsWith('.parquet')) return '';
    const sizeKB = (file.size / 1024).toFixed(1);
    const displayName = file.name.replace(/_/g, '_<wbr>').replace(/\./g, '<wbr>.');
    const folderLabel = (file.folderPath || '').replace(/'/g, "\\'");
    const isLog = /\.log\.parquet$/i.test(file.name);
    if (isLog) {
        return `
            <div class="tree-item" onclick="loadLogFile('${file.url}', '${file.name}', '${folderLabel}')" data-filename="${file.name.toLowerCase()}">
                📄 ${displayName}
                <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">(${sizeKB}KB)</span>
            </div>
        `;
    }
    return `
        <div class="tree-item" onclick="loadPlotFile('${file.url}', '${file.name}', '${folderLabel}')" data-filename="${file.name.toLowerCase()}">
            📊 ${displayName}
            <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">(${sizeKB}KB)</span>
        </div>
    `;
}

// Recursively render a tree node into sidebar HTML
function renderTreeNode(node) {
    let html = '';
    // Render files at this level
    node.files.forEach(file => { html += renderFileItem(file); });
    // Render child folders
    const childNames = Object.keys(node.children).sort();
    childNames.forEach(name => {
        const child = node.children[name];
        const count = countTreeFiles(child);
        html += `
            <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
                <span class="tree-folder-icon">▶</span>
                <span>${name}</span>
                <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${count})</span>
            </div>
            <div class="tree-folder-content" style="margin-left: 10px;">
        `;
        html += renderTreeNode(child);
        html += '</div>';
    });
    return html;
}

// Render file tree in sidebar
function renderFileTree(structure, append = false) {
    console.log('[Analysis] Rendering file tree for:', structure.repoName, 'append:', append);
    
    const fileTree = document.getElementById('file-tree');
    const { repoName, repoOwner, description, folders } = structure;
    
    // Store description for lookup by showRepoInfo
    window._repoDescriptions = window._repoDescriptions || {};
    window._repoDescriptions[repoOwner + '/' + repoName] = description || '';

    const tree = buildFolderTree(folders);
    const totalFiles = countTreeFiles(tree);

    // Build tree HTML
    let html = `
        <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false" data-repo-owner="${repoOwner}" data-repo-name="${repoName}">
            <span class="tree-folder-icon">▶</span>
            <span>${repoName}</span>
            <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${totalFiles})</span>
        </div>
        <div class="tree-folder-content" style="margin-left: 10px;">
    `;

    html += renderTreeNode(tree);

    // README as last item
    html += `
            <div class="tree-item" onclick="showRepoInfo('${repoOwner}', '${repoName}')" style="font-style: italic; color: var(--accent-primary, #c9a227); font-size: 0.82rem; cursor: pointer;">
                📖 README
            </div>
        </div>
    `;
    
    // Either replace or append
    if (append) {
        fileTree.innerHTML += html;
    } else {
        fileTree.innerHTML = html;
    }
    
    // Flatten all files for size lookup in loadPlotFile
    const allFiles = [];
    for (const files of Object.values(folders)) {
        allFiles.push(...files);
    }

    // Store globally for search and pipeline trace (extend if appending)
    if (!window.analysisData) {
        window.analysisData = { repos: [], allFiles: [] };
    }
    if (append) {
        window.analysisData.repos = window.analysisData.repos || [];
        window.analysisData.repos.push(structure);
        window.analysisData.allFiles = (window.analysisData.allFiles || []).concat(allFiles);
    } else {
        window.analysisData = { repos: [structure], allFiles: allFiles };
    }
    
    console.log('[Analysis] File tree rendered successfully');
}

// Render repos from discovery data (used by both fresh fetch and cache)
function loadReposFromData(analysisRepos, emptyState) {
    let loadedCount = 0;
    for (const repoConfig of analysisRepos) {
        const structure = {
            repoName: repoConfig.name,
            repoOwner: repoConfig.owner,
            description: repoConfig.description || '',
            resultsDir: repoConfig.resultsDir,
            folders: repoConfig.folders
        };
        
        const hasFiles = structure.folders && Object.values(structure.folders).some(f => f.length > 0);
        if (!hasFiles) continue;
        
        renderFileTree(structure, loadedCount > 0);
        
        if (loadedCount === 0) {
            emptyState.style.display = 'none';
        }
        
        // Pipeline trace uses raw.githubusercontent.com (not API, no rate limit)
        fetchPipelineTrace(`${structure.repoOwner}/${structure.repoName}`, structure.resultsDir);
        
        loadedCount++;
    }
    
    if (loadedCount === 0) {
        emptyState.innerHTML = `
            <h2>No Plot Data Found</h2>
            <p>Found ${analysisRepos.length} result folder(s) but none contain displayable files.</p>
        `;
    } else {
        const searchInput = document.getElementById('search-box');
        if (searchInput && !searchInput.hasAttribute('data-initialized')) {
            searchInput.setAttribute('data-initialized', 'true');
            searchInput.addEventListener('input', (e) => {
                filterFileTree(e.target.value);
            });
        }
    }
}

async function initAnalysisPage() {
    console.log('[Analysis] Initializing page - discovering repos...');
    
    const emptyState = document.getElementById('empty-state');
    const CACHE_KEY = 'analysis_repos_cache_v2';
    const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    
    // Try sessionStorage cache first to avoid unnecessary API calls
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL && data.length > 0) {
                console.log('[Analysis] Using cached discovery data (' + data.length + ' repos)');
                loadReposFromData(data, emptyState);
                return;
            }
        }
    } catch (e) { /* cache miss, proceed with API */ }
    
    // Show loading state
    emptyState.innerHTML = `
        <h2>Discovering Analysis Repositories...</h2>
        <p>Scanning GitHub for repositories with analysis results</p>
        <div class="spinner" style="width: 40px; height: 40px; border: 4px solid var(--border-primary, #ddd); border-top: 4px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto;"></div>
    `;
    
    try {
        // Fetch GitHub username from our own data
        const baseUrl = (window.SITE_BASE_URL || '').replace(/\/$/, '') + '/';
        let username = 'CGutt-hub';
        try {
            const githubDataResponse = await fetch(baseUrl + 'data/github.json');
            if (githubDataResponse.ok) {
                const githubData = await githubDataResponse.json();
                if (githubData.repos && githubData.repos[0]) {
                    username = githubData.repos[0].url.split('/')[3] || username;
                }
            }
        } catch (e) {
            console.warn('[Analysis] Could not load github.json, using fallback username');
        }
        
        console.log('[Analysis] GitHub username:', username);
        
        // Discover all repos with *_results folders (uses Git Trees API: 1 call per repo)
        const analysisRepos = await discoverAnalysisRepos(username);
        
        if (analysisRepos.length === 0) {
            // Check if rate limiting is the cause
            const rateInfo = await checkRateLimit();
            if (rateInfo && rateInfo.remaining === 0) {
                const resetMin = Math.ceil((rateInfo.reset - new Date()) / 60000);
                emptyState.innerHTML = `
                    <h2>GitHub API Rate Limit Reached</h2>
                    <p>The unauthenticated GitHub API allows 60 requests per hour.</p>
                    <p style="color: var(--text-secondary); margin-top: 10px;">Rate limit resets in <strong>${resetMin > 0 ? resetMin : '< 1'} minute(s)</strong> (at ${rateInfo.reset.toLocaleTimeString()}).</p>
                    <p style="color: var(--text-muted); font-size: 0.85em; margin-top: 15px;">Please wait and refresh the page afterward.</p>
                `;
            } else {
                emptyState.innerHTML = `
                    <h2>No Analysis Results Found</h2>
                    <p>No repositories with <code>*_results/*/plots/*.parquet</code> structure found for <strong>${username}</strong>.</p>
                    <p style="color: var(--text-muted); font-size: 0.85em; margin-top: 15px;">Check console for details or try refreshing.</p>
                `;
            }
            return;
        }
        
        console.log('[Analysis] Found', analysisRepos.length, 'analysis repos');
        
        // Cache successful discovery in sessionStorage
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: analysisRepos, timestamp: Date.now() }));
        } catch (e) { /* storage full or unavailable */ }
        
        loadReposFromData(analysisRepos, emptyState);
        
    } catch (error) {
        console.error('[Analysis] Error initializing page:', error);
        
        if (error.message.startsWith('RATE_LIMIT:')) {
            const resetDate = new Date(error.message.split(':').slice(1).join(':'));
            const resetMin = Math.ceil((resetDate - new Date()) / 60000);
            emptyState.innerHTML = `
                <h2>GitHub API Rate Limit Reached</h2>
                <p>The unauthenticated GitHub API allows 60 requests per hour.</p>
                <p style="color: var(--text-secondary); margin-top: 10px;">Rate limit resets in <strong>${resetMin > 0 ? resetMin : '< 1'} minute(s)</strong> (at ${resetDate.toLocaleTimeString()}).</p>
                <p style="color: var(--text-muted); font-size: 0.85em; margin-top: 15px;">Please wait and refresh the page afterward.</p>
            `;
        } else {
            emptyState.innerHTML = `
                <h2>Error Loading Data</h2>
                <p>Could not discover analysis repositories: ${error.message}</p>
                <p style="color: var(--text-secondary); font-size: 0.9em;">Check the console for details or try refreshing.</p>
            `;
        }
    }
}

// Start when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalysisPage);
} else {
    initAnalysisPage();
}

// Pipeline zoom/pan state and controls
var _pipelineState = { scale: 1, panX: 0, panY: 0 };
var _pipelineStateL2 = { scale: 1, panX: 0, panY: 0 };

function _getPipelineEls(level) {
    var suffix = level === 'l2' ? '-l2' : '';
    return {
        inner: document.getElementById('pipeline-zoom-inner' + suffix),
        container: document.getElementById('pipeline-zoom-container' + suffix),
        state: level === 'l2' ? _pipelineStateL2 : _pipelineState
    };
}

function _applyPipelineTransform(inner, state) {
    inner.style.transform = 'translate(' + state.panX + 'px,' + state.panY + 'px) scale(' + state.scale + ')';
}

function pipelineZoom(dir, level) {
    var els = _getPipelineEls(level);
    if (!els.inner) return;
    var s = els.state;
    if (dir === 0) { s.scale = 1; s.panX = 0; s.panY = 0; }
    else { s.scale = Math.min(5, Math.max(0.3, s.scale + dir * 0.25)); }
    _applyPipelineTransform(els.inner, s);
}

// Mouse-wheel zoom on pipeline containers
document.addEventListener('wheel', function(e) {
    var container = document.getElementById('pipeline-zoom-container');
    var containerL2 = document.getElementById('pipeline-zoom-container-l2');
    var level = null;
    if (container && container.contains(e.target)) level = 'l1';
    else if (containerL2 && containerL2.contains(e.target)) level = 'l2';
    if (!level) return;
    e.preventDefault();
    pipelineZoom(e.deltaY < 0 ? 1 : -1, level === 'l2' ? 'l2' : undefined);
}, { passive: false });

// Drag-to-pan on pipeline containers
(function() {
    var dragging = false, dragLevel = null, startX = 0, startY = 0, startPanX = 0, startPanY = 0;

    document.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        var container = document.getElementById('pipeline-zoom-container');
        var containerL2 = document.getElementById('pipeline-zoom-container-l2');
        var level = null;
        if (container && container.contains(e.target)) level = 'l1';
        else if (containerL2 && containerL2.contains(e.target)) level = 'l2';
        if (!level) return;
        dragging = true;
        dragLevel = level === 'l2' ? 'l2' : undefined;
        var s = _getPipelineEls(dragLevel).state;
        startX = e.clientX; startY = e.clientY;
        startPanX = s.panX; startPanY = s.panY;
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var els = _getPipelineEls(dragLevel);
        if (!els.inner) return;
        var s = els.state;
        s.panX = startPanX + (e.clientX - startX);
        s.panY = startPanY + (e.clientY - startY);
        _applyPipelineTransform(els.inner, s);
    });

    document.addEventListener('mouseup', function() {
        dragging = false;
    });
})();

// Toggle project info panel and lazy-load README
function showRepoInfo(owner, repoName) {
    var description = (window._repoDescriptions || {})[owner + '/' + repoName] || '';
    var plotDisplays = document.getElementById('plot-displays');
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    // Generate pipeline tree HTML if available — resolve correct repo
    var repoPath = owner + '/' + repoName;

    // --- Pipeline/Results Tree Section ---
    function buildResultsTreeBox() {
        const files = (window.analysisData && window.analysisData.allFiles) || [];
        // Build tree: level (l1/l2/root) > participant > files
        const tree = {};
        files.forEach(f => {
            const pathParts = f.path ? f.path.split('/') : [];
            let lvl = null, participant = null;
            if (pathParts.length >= 4 && /^l[12]$/.test(pathParts[1])) {
                lvl = pathParts[1];
                participant = pathParts[2];
            } else {
                participant = pathParts[1];
            }
            const lvlKey = lvl || 'root';
            if (!tree[lvlKey]) tree[lvlKey] = {};
            if (!tree[lvlKey][participant]) tree[lvlKey][participant] = [];
            tree[lvlKey][participant].push(f.filename || f.path);
        });
        // Render as interactive collapsible tree
        function renderTree(obj, depth = 0) {
            const container = document.createElement('div');
            for (const key in obj) {
                const value = obj[key];
                if (Array.isArray(value)) {
                    // Folder with file leaves
                    const folder = document.createElement('div');
                    folder.style.marginLeft = (depth * 18) + 'px';
                    folder.style.padding = '4px 8px';
                    folder.style.cursor = 'pointer';
                    folder.style.fontWeight = 'bold';
                    folder.style.userSelect = 'none';
                    folder.style.display = 'flex';
                    folder.style.alignItems = 'center';
                    folder.style.gap = '6px';
                    folder.style.borderRadius = '4px';
                    folder.dataset.expanded = 'false';
                    const icon = document.createElement('span');
                    icon.textContent = '\u25B6';
                    icon.style.display = 'inline-block';
                    icon.style.width = '14px';
                    icon.style.fontSize = '10px';
                    icon.style.transition = 'transform 0.2s';
                    folder.appendChild(icon);
                    const label = document.createElement('span');
                    label.textContent = key + '/';
                    folder.appendChild(label);
                    const count = document.createElement('span');
                    count.textContent = '(' + value.length + ')';
                    count.style.color = 'var(--text-muted, #999)';
                    count.style.fontSize = '0.85em';
                    count.style.marginLeft = '4px';
                    folder.appendChild(count);
                    const filesList = document.createElement('div');
                    filesList.style.display = 'none';
                    filesList.style.marginLeft = ((depth + 1) * 18) + 'px';
                    value.forEach(f => {
                        const item = document.createElement('div');
                        item.textContent = f;
                        item.style.padding = '2px 8px';
                        item.style.fontSize = '0.85em';
                        item.style.color = 'var(--text-secondary, #aaa)';
                        filesList.appendChild(item);
                    });
                    folder.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const expanded = folder.dataset.expanded === 'true';
                        folder.dataset.expanded = expanded ? 'false' : 'true';
                        icon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(90deg)';
                        filesList.style.display = expanded ? 'none' : 'block';
                    });
                    folder.addEventListener('mouseenter', function() { folder.style.background = 'var(--bg-tertiary, #333)'; });
                    folder.addEventListener('mouseleave', function() { folder.style.background = ''; });
                    container.appendChild(folder);
                    container.appendChild(filesList);
                } else if (typeof value === 'object') {
                    // Nested folder
                    const folder = document.createElement('div');
                    folder.style.marginLeft = (depth * 18) + 'px';
                    folder.style.padding = '4px 8px';
                    folder.style.cursor = 'pointer';
                    folder.style.fontWeight = 'bold';
                    folder.style.userSelect = 'none';
                    folder.style.display = 'flex';
                    folder.style.alignItems = 'center';
                    folder.style.gap = '6px';
                    folder.style.borderRadius = '4px';
                    folder.style.marginTop = '4px';
                    folder.dataset.expanded = 'false';
                    const icon = document.createElement('span');
                    icon.textContent = '\u25B6';
                    icon.style.display = 'inline-block';
                    icon.style.width = '14px';
                    icon.style.fontSize = '10px';
                    icon.style.transition = 'transform 0.2s';
                    folder.appendChild(icon);
                    const label = document.createElement('span');
                    label.textContent = key + '/';
                    folder.appendChild(label);
                    const childCount = Object.keys(value).length;
                    const count = document.createElement('span');
                    count.textContent = '(' + childCount + ')';
                    count.style.color = 'var(--text-muted, #999)';
                    count.style.fontSize = '0.85em';
                    count.style.marginLeft = '4px';
                    folder.appendChild(count);
                    const childContainer = renderTree(value, depth + 1);
                    childContainer.style.display = 'none';
                    folder.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const expanded = folder.dataset.expanded === 'true';
                        folder.dataset.expanded = expanded ? 'false' : 'true';
                        icon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(90deg)';
                        childContainer.style.display = expanded ? 'none' : 'block';
                    });
                    folder.addEventListener('mouseenter', function() { folder.style.background = 'var(--bg-tertiary, #333)'; });
                    folder.addEventListener('mouseleave', function() { folder.style.background = ''; });
                    container.appendChild(folder);
                    container.appendChild(childContainer);
                }
            }
            return container;
        }
        const box = document.createElement('div');
        box.style.margin = '25px 0';
        box.style.background = 'var(--bg-primary, #222)';
        box.style.color = 'var(--text-primary, #e8e8e8)';
        box.style.padding = '16px';
        box.style.borderRadius = '8px';
        box.style.overflowX = 'auto';
        box.style.fontFamily = 'var(--font-mono, monospace)';
        box.style.fontSize = '1em';
        const title = document.createElement('div');
        title.textContent = 'Pipeline/Results Tree';
        title.style.fontWeight = 'bold';
        title.style.fontSize = '1.1em';
        title.style.marginBottom = '10px';
        box.appendChild(title);
        // Download button
        const dlBtn = document.createElement('button');
        dlBtn.textContent = 'Download Tree JSON';
        dlBtn.style.marginBottom = '10px';
        dlBtn.style.marginLeft = '10px';
        dlBtn.style.padding = '4px 10px';
        dlBtn.style.fontSize = '0.95em';
        dlBtn.style.borderRadius = '4px';
        dlBtn.style.border = '1px solid var(--border-primary, #444)';
        dlBtn.style.background = 'var(--bg-tertiary, #333)';
        dlBtn.style.color = 'var(--text-primary, #e8e8e8)';
        dlBtn.onclick = () => {
            const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pipeline_tree.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        box.appendChild(dlBtn);
        box.appendChild(renderTree(tree));
        return box;
    }

    plotDisplays.innerHTML = '';
    const mainDiv = document.createElement('div');
    mainDiv.className = 'plot-display active';
    mainDiv.id = 'current-plot';
    // Header
    const headerDiv = document.createElement('div');
    headerDiv.style.marginBottom = '20px';
    headerDiv.innerHTML = `<div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 4px;">${repoName}</div>${description ? '<div style="font-size: 0.9rem; color: var(--text-secondary, #aaa); margin-bottom: 16px;">' + description.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' : ''}`;
    mainDiv.appendChild(headerDiv);
    // README
    const readmeDiv = document.createElement('div');
    readmeDiv.id = 'repo-readme';
    readmeDiv.style.padding = '20px';
    readmeDiv.style.background = 'var(--bg-secondary, #161616)';
    readmeDiv.style.border = '1px solid var(--border-primary, #2a2a2a)';
    readmeDiv.style.borderRadius = '8px';
    readmeDiv.style.minHeight = '200px';
    readmeDiv.style.maxHeight = 'calc(100vh - 280px)';
    readmeDiv.style.overflowY = 'auto';
    readmeDiv.style.lineHeight = '1.6';
    readmeDiv.style.fontSize = '0.9rem';
    readmeDiv.style.color = 'var(--text-primary, #e8e8e8)';
    readmeDiv.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 120px; flex-direction: column; gap: 10px;">
                    <div class="spinner" style="width: 30px; height: 30px; border: 3px solid var(--bg-tertiary, #ddd); border-top: 3px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="color: var(--text-muted, #999); font-size: 0.85rem;">Loading README...</p>
                </div>`;
    mainDiv.appendChild(readmeDiv);
    // Pipeline/Results Tree
    mainDiv.appendChild(buildResultsTreeBox());
    plotDisplays.appendChild(mainDiv);

    // Load README
    var readmeEl = document.getElementById('repo-readme');
    fetch('https://raw.githubusercontent.com/' + owner + '/' + repoName + '/main/README.md')
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(text) {
            if (!text) { readmeEl.innerHTML = '<p style="color: var(--text-muted, #999);">No README available.</p>'; return; }
            readmeEl.innerHTML = '<div class="rendered-markdown">' + marked.parse(text) + '</div>';
        })
        .catch(function() { readmeEl.innerHTML = '<p style="color: var(--text-muted, #999);">Could not load README.</p>'; });
}

// Load and display a log file in the main content area with level filtering
async function loadLogFile(url, displayName, participant) {
    const emptyState = document.getElementById('empty-state');
    const plotDisplays = document.getElementById('plot-displays');
    if (!emptyState || !plotDisplays) return;

    // Remove previous active states and mark clicked item
    document.querySelectorAll('.tree-item.active').forEach(item => item.classList.remove('active'));
    if (event && event.target) {
        const item = event.target.closest('.tree-item');
        if (item) item.classList.add('active');
    }
    emptyState.style.display = 'none';

    // Scroll the main area to top so the log header is visible
    const mainArea = document.querySelector('.analysis-main');
    if (mainArea) mainArea.scrollTop = 0;

    plotDisplays.innerHTML = `
        <div class="plot-display active" id="current-plot" style="display: flex; flex-direction: column; height: calc(100vh - 220px);">
            <div style="margin-bottom: 12px; flex-shrink: 0;">
                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 4px;">Log: ${displayName}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary, #aaa); margin-bottom: 12px;">Participant: ${participant} <span id="log-line-count" style="margin-left: 16px; color: var(--text-muted, #666);"></span></div>
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <button id="log-filter-all" onclick="filterLog('all')" style="padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-primary, #2a2a2a); background: var(--accent-primary, #c9a227); color: var(--bg-primary, #0f0f0f); font-size: 0.8rem; cursor: pointer; font-weight: 600;">All</button>
                    <button id="log-filter-warn" onclick="filterLog('warn')" style="padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-primary, #2a2a2a); background: var(--bg-secondary, #161616); color: var(--text-primary, #e8e8e8); font-size: 0.8rem; cursor: pointer;">⚠ Warnings</button>
                    <button id="log-filter-error" onclick="filterLog('error')" style="padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-primary, #2a2a2a); background: var(--bg-secondary, #161616); color: var(--text-primary, #e8e8e8); font-size: 0.8rem; cursor: pointer;">✖ Errors</button>
                </div>
            </div>
            <div id="log-content" style="padding: 16px; background: var(--bg-secondary, #161616); border: 1px solid var(--border-primary, #2a2a2a); border-radius: 8px; flex: 1; min-height: 0; overflow-y: auto; font-family: monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--text-primary, #e8e8e8);">
                <div style="display: flex; align-items: center; justify-content: center; height: 120px; flex-direction: column; gap: 10px;">
                    <div class="spinner" style="width: 30px; height: 30px; border: 3px solid var(--bg-tertiary, #ddd); border-top: 3px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="color: var(--text-muted, #999); font-size: 0.85rem;">Loading log file...</p>
                </div>
            </div>
        </div>
    `;

    try {
        await waitForHyparquet();
        // Fetch raw parquet file from GitHub
        const arrayBuffer = await fetchRawArrayBuffer(url);
        
        const rows = await window.hyparquetReadObjects({ file: arrayBuffer });
        // Extract text: join all string values from all rows
        let text = '';
        if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            console.log('[Log] Rows:', rows.length, 'Columns:', cols);
            // Find the column most likely containing log text
            const textCol = cols.find(c => /log|text|message|content|output/i.test(c)) || cols[0];
            console.log('[Log] Using column:', textCol);
            // Each row's value may itself contain newlines (e.g. entire log in one cell)
            const parts = [];
            for (const r of rows) {
                const val = r[textCol];
                if (val != null) parts.push(String(val));
            }
            text = parts.join('\n');
            console.log('[Log] Total text length:', text.length, 'chars');
        }
        window._logLines = text.split('\n');
        console.log('[Log] Total lines after split:', window._logLines.length);
        window._logFilter = 'all';
        renderLogLines('all');
    } catch (e) {
        console.error('[Analysis] Error loading log parquet:', e);
        document.getElementById('log-content').innerHTML = '<span style="color: var(--text-muted, #999);">Could not load log file.</span>';
    }
}

function filterLog(level) {
    window._logFilter = level;
    // Update button styles
    ['all', 'warn', 'error'].forEach(function(l) {
        var btn = document.getElementById('log-filter-' + l);
        if (!btn) return;
        if (l === level) {
            btn.style.background = 'var(--accent-primary, #c9a227)';
            btn.style.color = 'var(--bg-primary, #0f0f0f)';
            btn.style.fontWeight = '600';
        } else {
            btn.style.background = 'var(--bg-secondary, #161616)';
            btn.style.color = 'var(--text-primary, #e8e8e8)';
            btn.style.fontWeight = 'normal';
        }
    });
    renderLogLines(level);
}

function renderLogLines(level) {
    var lines = window._logLines || [];
    var el = document.getElementById('log-content');
    if (!el) return;
    var filtered;
    if (level === 'warn') {
        filtered = lines.filter(function(l) { return /warn|warning/i.test(l); });
    } else if (level === 'error') {
        filtered = lines.filter(function(l) { return /error|exception|fatal|critical/i.test(l); });
    } else {
        filtered = lines;
    }
    if (filtered.length === 0) {
        el.innerHTML = '<span style="color: var(--text-muted, #999);">No ' + (level === 'all' ? '' : level + ' ') + 'entries found.</span>';
        return;
    }
    // Show line count
    var countEl = document.getElementById('log-line-count');
    if (countEl) {
        countEl.textContent = filtered.length + ' / ' + lines.length + ' lines';
    }
    // Colorize lines
    var html = filtered.map(function(line) {
        var escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (/error|exception|fatal|critical/i.test(line)) {
            return '<span style="color: #ff6b6b;">' + escaped + '</span>';
        } else if (/warn|warning/i.test(line)) {
            return '<span style="color: #ffd93d;">' + escaped + '</span>';
        }
        return escaped;
    }).join('\n');
    el.innerHTML = html;
    // Reset scroll after layout to ensure we start at the top
    requestAnimationFrame(function() {
        el.scrollTop = 0;
        var mainArea = document.querySelector('.analysis-main');
        if (mainArea) mainArea.scrollTop = 0;
    });
}

// Simplified export bar for plot displays
function createExportBar(url, participant, displayName) {
    const exportBar = document.createElement('div');
    exportBar.className = 'export-bar';
    exportBar.innerHTML = `
        <button class="export-btn png" onclick="exportPlotAsPNG('current-plot-chart')">
            &#8659; PNG
        </button>
        <button class="export-btn pdf" onclick="exportPlotAsPDF('current-plot-chart', '${participant}', '${displayName}')">
            &#8659; PDF
        </button>
        <button class="export-btn parquet" onclick="downloadParquetFile({repo_name: window.analysisData.repoName, file_path: '${url.replace(`https://raw.githubusercontent.com/CGutt-hub/${window.analysisData.repoName}/main/`, '')}'})">
            &#8659; Parquet
        </button>
        <button class="export-btn csv" onclick="exportPlotAsCSV('${url}', '${displayName}')">
            &#8659; CSV
        </button>
        <span id="load-status" style="color: var(--text-muted, #999); font-size: 0.85rem; margin-left: auto;">
            Preparing...
        </span>
    `;
    return exportBar;
}

// Expose functions to global scope for inline onclick handlers
window.loadPlotFile = loadPlotFile;
window.toggleFolder = toggleFolder;
window.showRepoInfo = showRepoInfo;
window.loadLogFile = loadLogFile;
window.filterLog = filterLog;
window.exportPlotAsPNG = exportPlotAsPNG;
window.exportPlotAsSVG = exportPlotAsSVG;
window.exportPlotAsPDF = exportPlotAsPDF;
window.exportPlotAsCSV = exportPlotAsCSV;
window.exportPlotAsXLS = exportPlotAsXLS;
window.pipelineZoom = pipelineZoom;

// Re-apply Plotly colors when theme changes (light/dark toggle)
new MutationObserver(() => {
    const chartDiv = document.getElementById('current-plot-chart');
    if (!chartDiv || !chartDiv.data || !chartDiv.data.length) return;
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg-secondary').trim() || '#161616';
    const txt = cs.getPropertyValue('--text-primary').trim() || '#e8e8e8';
    const grid = cs.getPropertyValue('--border-primary').trim() || '#2a2a2a';
    Plotly.relayout(chartDiv, {
        'paper_bgcolor': bg, 'plot_bgcolor': bg,
        'font.color': txt, 'title.font.color': txt,
        'xaxis.tickfont.color': txt, 'xaxis.title.font.color': txt,
        'xaxis.gridcolor': grid, 'xaxis.linecolor': grid,
        'yaxis.tickfont.color': txt, 'yaxis.title.font.color': txt,
        'yaxis.gridcolor': grid, 'yaxis.linecolor': grid,
        'legend.font.color': txt,
    });
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
