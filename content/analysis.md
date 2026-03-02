+++
title = "Real-Time Research Analysis"
+++

<style>
/* Analysis Toolbox-inspired layout with website theming */
.analysis-layout {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
}

.analysis-top-bar {
    height: 60px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    padding: 0 20px;
    flex-shrink: 0;
}

.analysis-top-bar h1 {
    font-size: 1.25rem;
    color: var(--text-primary);
    margin: 0;
}

.analysis-body {
    display: flex;
    flex: 1;
    overflow: hidden;
}

.analysis-sidebar {
    width: 300px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
}

.search-container {
    padding: 15px;
    border-bottom: 1px solid var(--border-primary);
}

.search-box {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 0.9rem;
}

.search-box:focus {
    outline: none;
    border-color: var(--accent-primary);
}

.file-explorer {
    flex: 1;
    overflow-y: auto;
    padding: 15px;
}

.explorer-header {
    font-size: 0.85rem;
    font-weight: bold;
    color: var(--text-secondary);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.repo-section {
    margin-bottom: 15px;
}

.repo-name {
    font-weight: bold;
    color: var(--accent-primary);
    margin-bottom: 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px;
    border-radius: 4px;
    transition: all 0.2s;
}

.repo-name:hover {
    background: var(--bg-tertiary);
    color: var(--accent-hover);
}

.repo-toggle {
    font-size: 0.8rem;
    display: inline-block;
    width: 16px;
    transition: transform 0.2s;
}

.repo-toggle.expanded {
    transform: rotate(90deg);
}

.file-list {
    margin-left: 20px;
    display: none;
}

.file-list.expanded {
    display: block;
}

.file-item {
    padding: 6px 10px;
    margin: 2px 0;
    cursor: pointer;
    border-radius: 3px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    transition: all 0.2s;
}

.file-item:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
}

.file-item.active {
    background: var(--accent-subtle);
    color: var(--accent-primary);
    font-weight: 600;
}

.file-item.hidden-by-search {
    display: none;
}

.analysis-main {
    flex: 1;
    overflow-y: auto;
    padding: 30px;
    background: var(--bg-primary);
}

.empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-secondary);
}

.empty-state h2 {
    color: var(--text-primary);
    margin-bottom: 15px;
}

.plot-display {
    display: none;
}

.plot-display.active {
    display: block;
}

.plot-header {
    margin-bottom: 25px;
    padding-bottom: 15px;
    border-bottom: 2px solid var(--border-primary);
}

.plot-header h2 {
    color: var(--text-primary);
    margin-bottom: 10px;
    font-size: 1.5rem;
}

.plot-meta {
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.6;
}

.plot-meta a {
    color: var(--accent-primary);
    text-decoration: none;
}

.plot-meta a:hover {
    text-decoration: underline;
}

.plot-container {
    width: 100%;
    height: 600px;
    background: var(--bg-secondary);
    border-radius: 6px;
    padding: 10px;
}

.download-btn {
    display: inline-block;
    padding: 8px 16px;
    margin-left: 15px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s;
}

.download-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
}

.download-all-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    padding: 20px;
    margin-bottom: 30px;
    display: none;
}

.download-all-section.visible {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
}

.download-all-btn {
    padding: 12px 24px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
}

.download-all-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-2px);
}

@media (max-width: 968px) {
    .analysis-sidebar {
        width: 250px;
    }
}

@media (max-width: 768px) {
    .analysis-body {
        flex-direction: column;
    }
    
    .analysis-sidebar {
        width: 100%;
        max-height: 300px;
        border-right: none;
        border-bottom: 1px solid var(--border-primary);
    }
    
    .download-all-section.visible {
        flex-direction: column;
        text-align: center;
    }
    
    .plot-container {
        height: 400px;
    }
}
</style>

<div class="analysis-layout">
    <div class="analysis-top-bar">
        <h1>📊 Real-Time Research Analysis</h1>
    </div>
    
    <div class="analysis-body">
        <aside class="analysis-sidebar">
            <div class="search-container">
                <input type="text" id="search-box" class="search-box" placeholder="Search files...">
            </div>
            
            <div class="file-explorer">
                <div class="explorer-header">📁 Repositories</div>
                <div id="file-tree"></div>
            </div>
        </aside>

        <main class="analysis-main">
            <div id="empty-state" class="empty-state">
                <h2>Select a plot from the sidebar</h2>
                <p>Click on any analysis file to view its interactive visualization.</p>
            </div>
            
            <div id="download-all-section" class="download-all-section">
                <div>
                    <strong>Open Data Export</strong>
                    <p style="margin: 5px 0 0 0; color: var(--text-secondary); font-size: 0.85rem;">
                        Download all analysis data for independent verification and open-source analysis
                    </p>
                </div>
                <button id="download-all-btn" class="download-all-btn">📥 Download All Data</button>
            </div>
            
            <div id="plot-displays"></div>
        </main>
    </div>
</div>

<script src="https://cdn.plot.ly/plotly-2.27.0.min.js" charset="utf-8"></script>
<script>
// Analysis data embedded from research repositories
const plotsData = [];

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

function downloadAllData() {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `research-analysis-export_${timestamp}.json`;
    const exportData = {
        export_date: new Date().toISOString(),
        total_plots: plotsData.length,
        data: plotsData
    };
    downloadJSON(exportData, filename);
}

// Build file tree from plot data
function buildFileTree() {
    const fileTree = document.getElementById('file-tree');
    
    // Group by repository
    const repoMap = {};
    plotsData.forEach((plot, index) => {
        if (!repoMap[plot.repo_name]) {
            repoMap[plot.repo_name] = [];
        }
        repoMap[plot.repo_name].push({ ...plot, index });
    });
    
    // Create tree structure
    Object.keys(repoMap).sort().forEach(repoName => {
        const repoSection = document.createElement('div');
        repoSection.className = 'repo-section';
        
        const repoHeader = document.createElement('div');
        repoHeader.className = 'repo-name';
        repoHeader.innerHTML = `<span class="repo-toggle">▶</span> 📁 ${repoName}`;
        
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        repoMap[repoName].forEach(plot => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.textContent = plot.file_path;
            fileItem.dataset.index = plot.index;
            fileItem.dataset.repoName = plot.repo_name;
            fileItem.dataset.filePath = plot.file_path;
            
            fileItem.onclick = () => {
                showPlot(plot.index);
            };
            
            fileList.appendChild(fileItem);
        });
        
        // Toggle expansion
        repoHeader.onclick = () => {
            const isExpanded = fileList.classList.toggle('expanded');
            const toggleIcon = repoHeader.querySelector('.repo-toggle');
            toggleIcon.textContent = isExpanded ? '▼' : '▶';
            toggleIcon.classList.toggle('expanded', isExpanded);
        };
        
        repoSection.appendChild(repoHeader);
        repoSection.appendChild(fileList);
        fileTree.appendChild(repoSection);
    });
    
    // Expand first repo and show first plot by default
    if (fileTree.firstChild) {
        const firstRepo = fileTree.firstChild.querySelector('.repo-name');
        firstRepo.click();
        const firstFile = fileTree.firstChild.querySelector('.file-item');
        if (firstFile) {
            firstFile.click();
        }
    }
}

// Show a specific plot
function showPlot(index) {
    // Update active state in sidebar
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-index="${index}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // Hide empty state and all plots
    document.getElementById('empty-state').style.display = 'none';
    document.querySelectorAll('.plot-display').forEach(plot => {
        plot.classList.remove('active');
    });
    
    // Show selected plot
    const plotDisplay = document.getElementById(`plot-${index}`);
    if (plotDisplay) {
        plotDisplay.classList.add('active');
    }
}

// Search functionality
document.getElementById('search-box')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const fileItems = document.querySelectorAll('.file-item');
    
    fileItems.forEach(item => {
        const repoName = item.dataset.repoName.toLowerCase();
        const filePath = item.dataset.filePath.toLowerCase();
        const matches = repoName.includes(query) || filePath.includes(query);
        
        if (matches || query === '') {
            item.classList.remove('hidden-by-search');
        } else {
            item.classList.add('hidden-by-search');
        }
    });
});

// Render all analysis results
function renderPlots() {
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState = document.getElementById('empty-state');
    const downloadSection = document.getElementById('download-all-section');
    
    if (plotsData.length === 0) {
        emptyState.innerHTML = `
            <h2>No deployed experiments yet</h2>
            <p><em>Results will appear here once experiments are ready for public deployment.</em></p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-primary);">
            <h3>About This Page</h3>
            <p style="max-width: 600px; margin: 15px auto;">
                This page displays real-time analysis results from deployed research experiments. 
                Experiments appear here after analysis pipelines have been validated, pilots completed, and proposals approved.
            </p>
            <h3 style="margin-top: 30px;">Deployment Workflow</h3>
            <ol style="text-align: left; max-width: 600px; margin: 15px auto; line-height: 1.8;">
                <li><strong>Analysis Structure</strong> — Pipeline is developed and matured in backoffice</li>
                <li><strong>Pilot Testing</strong> — Protocol is validated with pilot participants</li>
                <li><strong>Proposal Approval</strong> — Research proposal is submitted and approved</li>
                <li><strong>Public Deployment</strong> — Experiment moves to public-facing repository</li>
                <li><strong>Real-Time Updates</strong> — Analysis results sync automatically as data is collected</li>
            </ol>
            <p style="max-width: 600px; margin: 20px auto;">
                <strong>Analysis Toolbox</strong> generates JSON representations at each processing step, 
                enabling transparent observation of data collection and analysis as it happens.
            </p>
        `;
        return;
    }
    
    // Hide empty state and show download section
    emptyState.style.display = 'none';
    downloadSection.classList.add('visible');
    document.getElementById('download-all-btn').onclick = downloadAllData;
    
    // Build file tree
    buildFileTree();
    
    // Create a display for each plot
    plotsData.forEach((plotItem, index) => {
        const plotDisplay = document.createElement('div');
        plotDisplay.className = 'plot-display';
        plotDisplay.id = `plot-${index}`;
        
        // Header with metadata
        const header = document.createElement('div');
        header.className = 'plot-header';
        header.innerHTML = `
            <h2>📊 ${plotItem.file_path}</h2>
            <div class="plot-meta">
                <p><strong>Repository:</strong> <a href="${plotItem.repo_url}" target="_blank">${plotItem.repo_name}</a></p>
                <p>
                    <strong>Last Updated:</strong> ${new Date(plotItem.updated).toLocaleString()}
                    <button class="download-btn" onclick="downloadPlotData(plotsData[${index}])">
                        📥 Download Data
                    </button>
                </p>
            </div>
        `;
        plotDisplay.appendChild(header);
        
        // Plot container
        const plotContainer = document.createElement('div');
        plotContainer.className = 'plot-container';
        plotContainer.id = `plot-container-${index}`;
        plotDisplay.appendChild(plotContainer);
        
        plotDisplays.appendChild(plotDisplay);
        
        // Render plot with Plotly
        try {
            const plotData = plotItem.plot_data;
            
            // Handle different JSON formats from Analysis Toolbox
            if (plotData.data && plotData.layout) {
                // Plotly JSON format (preferred)
                Plotly.newPlot(`plot-container-${index}`, plotData.data, plotData.layout, {responsive: true});
            } else if (Array.isArray(plotData)) {
                // Array of traces
                Plotly.newPlot(`plot-container-${index}`, plotData, {}, {responsive: true});
            } else if (plotData.x && plotData.y) {
                // Simple x, y data
                Plotly.newPlot(`plot-container-${index}`, [plotData], {}, {responsive: true});
            } else {
                // Unknown format - show JSON
                plotContainer.innerHTML = `
                    <pre style="background: var(--code-bg); padding: 15px; overflow: auto; border-radius: 4px; height: 100%;">
                        ${JSON.stringify(plotData, null, 2)}
                    </pre>
                `;
            }
        } catch (error) {
            plotContainer.innerHTML = `
                <div style="padding: 20px; color: var(--text-secondary);">
                    <p style="color: red; margin-bottom: 10px;">⚠️ Error rendering analysis: ${error.message}</p>
                    <details>
                        <summary style="cursor: pointer; margin-bottom: 10px;">View raw JSON</summary>
                        <pre style="background: var(--bg-tertiary); padding: 15px; overflow: auto; border-radius: 4px;">
                            ${JSON.stringify(plotItem.plot_data, null, 2)}
                        </pre>
                    </details>
                </div>
            `;
        }
    });
}

// Render when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPlots);
} else {
    renderPlots();
}
</script>
