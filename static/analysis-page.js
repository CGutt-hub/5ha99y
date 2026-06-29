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

    // Flat table: no plot_type, no x_data/y_data â€” render as a data table, not a plot
    if (!columns.includes('x_data') && !columns.includes('y_data')) {
        return flatTableToPlotly(rows, title);
    }

    // Fallback: generic columnar data â€” plot all numeric columns
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
        // Double nested: y_data = [[[s1_vals], [s2_vals]]] â€” unwrap one layer
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
                    name: `${label} Â±var`,
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
                    name: `${label} Â±var`,
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

// Fallback: generic columnar data â€” plot all numeric columns vs first column
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
        pdfDoc.setAuthor('Ã‡aÄŸatay Ã–zcan Jagiello Gutt');
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
            <p style="color:var(--text-secondary)">Scanning repositories for analysis results…</p>
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
        if (data.truncated) console.warn(`[Analysis] Tree truncated for ${repoName} — some files may be missing`);

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

        return {
            name: repoName,
            owner,
            description: repo.readme || repo.description || '',
            resultsDir,
            folders
        };
    } catch (err) {
        console.warn(`[Analysis] Could not scan ${repoName}:`, err.message);
        return null;
    }
}

// Build a proper tree structure from flat folder-path -> files map
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
        return `<div class="tree-item" onclick="loadLogFile('${urlSafe}','${nameSafe}','${folderLabel}')" data-filename="${file.name.toLowerCase()}">📄 ${displayName}${sizeSpan}</div>`;
    }
    if (isTable) {
        return `<div class="tree-item" onclick="loadLogFile('${urlSafe}','${nameSafe}','${folderLabel}')" data-filename="${file.name.toLowerCase()}">📋 ${displayName}${sizeSpan}</div>`;
    }
    return `<div class="tree-item" onclick="loadPlotFile('${urlSafe}','${nameSafe}','${folderLabel}')" data-filename="${file.name.toLowerCase()}">📊 ${displayName}${sizeSpan}</div>`;
}

function renderTreeNode(node) {
    let html = '';
    node.files.forEach(file => { html += renderFileItem(file); });
    Object.keys(node.children).sort().forEach(name => {
        const child = node.children[name];
        const count = countTreeFiles(child);
        html += `<div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false"><span class="tree-folder-icon">▶</span><span>${name}</span><span style="color:var(--text-muted,#999);font-size:0.85em;margin-left:5px">(${count})</span></div><div class="tree-folder-content" style="display:none;margin-left:10px">`;
        html += renderTreeNode(child);
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

    const tree = buildFolderTree(folders);
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
}

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
        <div class="plot-header">
            <h2>${displayName}</h2>
            <div class="plot-meta">${folderLabel}</div>
        </div>
        <div class="export-bar">
            <span class="plot-download-label">Download:</span>
            <button class="export-btn" onclick="window._directDownload('${url}','${displayName}')">⤓ Parquet</button>
            <button class="export-btn" onclick="exportPlotAsCSV('${url}','${displayName}')">⤓ CSV</button>
            <button class="export-btn png" onclick="exportPlotAsPNG('${cid}','${displayName}')">⤓ PNG</button>
            <button class="export-btn pdf" onclick="exportPlotAsPDF('${cid}','${displayName}')">⤓ PDF</button>
        </div>
        <div id="${cid}" class="plot-container">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)">
                <div style="text-align:center"><div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Loading…</div>
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
        <div class="plot-header">
            <h2>${displayName}</h2>
            <div class="plot-meta">${folderLabel}</div>
        </div>
        <div class="export-bar">
            <span class="plot-download-label">Download:</span>
            <button class="export-btn" onclick="window._directDownload('${url}','${displayName}')">⤓ Parquet</button>
            <button class="export-btn" onclick="exportPlotAsCSV('${url}','${displayName}')">⤓ CSV</button>
            <button class="export-btn png" onclick="exportPlotAsPNG('${cid}','${displayName}')">⤓ PNG</button>
            <button class="export-btn pdf" onclick="exportPlotAsPDF('${cid}','${displayName}')">⤓ PDF</button>
        </div>
        <div id="${cid}" class="plot-container">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)">
                <div style="text-align:center"><div style="width:32px;height:32px;border:3px solid var(--accent-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px"></div>Loading…</div>
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
