const obsidian = require('obsidian');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  repoUrl: '',
  branch: 'main',
  gitPath: 'git',
  authorName: '',
  authorEmail: '',
  commitMessage: 'Auto-sync Obsidian Vault - {date} {time}',
  pullBeforePush: false,
  forcePush: true,
  autoSyncIntervalMinutes: 0,
  syncOnStartup: false,
  requireVaultStructure: true
};

/**
 * Files Obsidian itself keeps in a vault. Their presence in a remote branch is
 * how we recognise a repository that really holds an Obsidian vault.
 */
const OBSIDIAN_BASE_FILES = [
  '.obsidian/app.json',
  '.obsidian/appearance.json',
  '.obsidian/core-plugins.json',
  '.obsidian/core-plugins-migration.json',
  '.obsidian/community-plugins.json',
  '.obsidian/workspace.json',
  '.obsidian/hotkeys.json',
  '.obsidian/graph.json',
  '.obsidian/file-recovery.json'
];

/**
 * Inspects a list of repository paths and reports whether they describe an
 * Obsidian vault. Used on the remote tree *before* anything local is touched.
 */
function analyzeRemoteTree(paths) {
  const normalized = (paths || []).map(p => String(p).replace(/\\/g, '/'));
  const found = OBSIDIAN_BASE_FILES.filter(f => normalized.includes(f));
  const missing = OBSIDIAN_BASE_FILES.filter(f => !normalized.includes(f));
  const hasConfigDir = normalized.some(p => p.startsWith('.obsidian/'));

  return {
    isVault: hasConfigDir && found.length > 0,
    hasConfigDir: hasConfigDir,
    found: found,
    missing: missing,
    fileCount: normalized.filter(p => p && !p.endsWith('/')).length
  };
}

/**
 * Thrown when the user interrupts an operation with the Stop button.
 * Distinguished from real git failures so the caller can report a clean stop
 * instead of an error.
 */
class GitSyncCancelledError extends Error {
  constructor(message = 'Operation interrupted by user') {
    super(message);
    this.name = 'GitSyncCancelledError';
  }
}

class GitSyncLogModal extends obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'git-sync-log-header' });
    header.createEl('h2', { text: 'Git Sync Log & Status' });

    this.logContainer = contentEl.createDiv({ cls: 'git-sync-log-container' });
    this.refreshLogs();

    const btnBar = contentEl.createDiv({ cls: 'git-sync-btn-bar' });

    this.syncBtn = btnBar.createEl('button', { text: 'Sync Now', cls: 'mod-cta' });
    this.syncBtn.addEventListener('click', () => {
      this.plugin.syncVault(true);
    });

    this.pullBtn = btnBar.createEl('button', { text: 'Pull' });
    this.pullBtn.addEventListener('click', () => {
      this.plugin.pullVaultFromGitHub(true);
    });

    this.stopBtn = btnBar.createEl('button', { text: 'Stop', cls: 'mod-warning git-sync-stop-btn' });
    this.stopBtn.addEventListener('click', () => {
      this.plugin.stopOperation();
    });

    const copyBtn = btnBar.createEl('button', { text: 'Copy Logs' });
    copyBtn.addEventListener('click', () => {
      const fullText = this.plugin.logs.map(l => `[${l.time}] ${l.text}`).join('\n');
      navigator.clipboard.writeText(fullText).then(() => {
        new obsidian.Notice('Logs copied to clipboard!');
      });
    });

    const clearBtn = btnBar.createEl('button', { text: 'Clear Logs' });
    clearBtn.addEventListener('click', () => {
      this.plugin.logs = [];
      this.refreshLogs();
    });

    this.plugin.activeLogModal = this;
    this.updateButtons();
  }

  onClose() {
    if (this.plugin.activeLogModal === this) {
      this.plugin.activeLogModal = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }

  refreshLogs() {
    if (!this.logContainer) return;
    this.logContainer.empty();

    if (this.plugin.logs.length === 0) {
      this.logContainer.createEl('div', { text: 'No logs recorded yet.', cls: 'git-sync-log-entry info' });
      this.updateButtons();
      return;
    }

    for (const log of this.plugin.logs) {
      const entry = this.logContainer.createDiv({ cls: `git-sync-log-entry ${log.type || ''}` });
      entry.setText(`[${log.time}] ${log.text}`);
    }

    this.logContainer.scrollTop = this.logContainer.scrollHeight;
    this.updateButtons();
  }

  /**
   * Keeps the action buttons in sync with the plugin state. Called on open, on
   * every log line and whenever the plugin starts/stops an operation.
   */
  updateButtons() {
    const running = !!this.plugin.isSyncing;
    const stopping = !!this.plugin.cancelRequested;

    if (this.syncBtn) {
      this.syncBtn.disabled = running;
      this.syncBtn.setText(running ? 'Syncing...' : 'Sync Now');
    }

    if (this.pullBtn) {
      this.pullBtn.disabled = running;
      this.pullBtn.setText(running ? 'Pulling...' : 'Pull');
    }

    if (this.stopBtn) {
      this.stopBtn.disabled = !running || stopping;
      this.stopBtn.setText(stopping ? 'Stopping...' : 'Stop');
    }
  }
}

/**
 * Asks the user to confirm a destructive action (e.g. overwriting local files
 * with the remote vault). Resolves true when confirmed, false otherwise.
 */
class GitSyncConfirmModal extends obsidian.Modal {
  constructor(app, options = {}) {
    super(app);
    this.title = options.title || 'Confirm';
    this.message = options.message || '';
    this.confirmText = options.confirmText || 'Confirm';
    this.cancelText = options.cancelText || 'Cancel';
    this.onConfirm = options.onConfirm || null;
    this.onCancel = options.onCancel || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: this.message, cls: 'git-sync-confirm-message' });

    const btnBar = contentEl.createDiv({ cls: 'git-sync-btn-bar' });

    const cancelBtn = btnBar.createEl('button', { text: this.cancelText });
    cancelBtn.addEventListener('click', () => {
      this._settle(false);
    });

    const confirmBtn = btnBar.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    confirmBtn.addEventListener('click', () => {
      this._settle(true);
    });
  }

  _settle(confirmed) {
    const confirmCb = this.onConfirm;
    const cancelCb = this.onCancel;
    this.onConfirm = null;
    this.onCancel = null;
    this.close();
    if (confirmed && confirmCb) confirmCb();
    if (!confirmed && cancelCb) cancelCb();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.onConfirm || this.onCancel) {
      this._settle(false);
    }
  }
}

class GitSyncSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Git Sync Settings' });

    new obsidian.Setting(containerEl)
      .setName('GitHub Repository URL')
      .setDesc('HTTPS or SSH repository URL (e.g. https://github.com/username/vault.git)')
      .addText(text => text
        .setPlaceholder('https://github.com/username/vault.git')
        .setValue(this.plugin.settings.repoUrl)
        .onChange(async (value) => {
          this.plugin.settings.repoUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Git Executable Path')
      .setDesc('Path to git executable. Leave as "git" if it is in your system PATH, or specify full path (e.g. C:\\Program Files\\Git\\cmd\\git.exe)')
      .addText(text => text
        .setPlaceholder('git')
        .setValue(this.plugin.settings.gitPath)
        .onChange(async (value) => {
          this.plugin.settings.gitPath = value.trim() || 'git';
          await this.plugin.saveSettings();
        }))
      .addButton(btn => btn
        .setButtonText('Test Git')
        .onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Checking...');
          const res = await this.plugin.testGitInstallation();
          btn.setDisabled(false);
          btn.setButtonText('Test Git');
          if (res.success) {
            new obsidian.Notice(`Git detected: ${res.version}`);
          } else {
            new obsidian.Notice(`Git test failed: ${res.error}`, 6000);
          }
        }));

    new obsidian.Setting(containerEl)
      .setName('Git Author Name')
      .setDesc('Your name or GitHub username (used for commit history)')
      .addText(text => text
        .setPlaceholder('e.g. IlDimaz')
        .setValue(this.plugin.settings.authorName)
        .onChange(async (value) => {
          this.plugin.settings.authorName = value.trim();
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Git Author Email')
      .setDesc('Your email address associated with GitHub')
      .addText(text => text
        .setPlaceholder('e.g. user@example.com')
        .setValue(this.plugin.settings.authorEmail)
        .onChange(async (value) => {
          this.plugin.settings.authorEmail = value.trim();
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Branch')
      .setDesc('Target Git branch to push/pull from (usually "main")')
      .addText(text => text
        .setPlaceholder('main')
        .setValue(this.plugin.settings.branch)
        .onChange(async (value) => {
          this.plugin.settings.branch = value.trim() || 'main';
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Commit Message Template')
      .setDesc('Commit message. Placeholders available: {date} (YYYY-MM-DD), {time} (HH:MM:SS)')
      .addText(text => text
        .setPlaceholder('Auto-sync Obsidian Vault - {date} {time}')
        .setValue(this.plugin.settings.commitMessage)
        .onChange(async (value) => {
          this.plugin.settings.commitMessage = value;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Pull Before Push')
      .setDesc('Fetch and pull remote changes before committing and pushing.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.pullBeforePush)
        .onChange(async (value) => {
          this.plugin.settings.pullBeforePush = value;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Force Push')
      .setDesc('Use --force when pushing. Useful for initial setup or single-user vaults, but may overwrite remote history.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.forcePush)
        .onChange(async (value) => {
          this.plugin.settings.forcePush = value;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Automatic Sync Interval')
      .setDesc('Periodically sync changes in the background while Obsidian is open.')
      .addDropdown(dropdown => dropdown
        .addOption('0', 'Disabled (Manual only)')
        .addOption('5', 'Every 5 minutes')
        .addOption('15', 'Every 15 minutes')
        .addOption('30', 'Every 30 minutes')
        .addOption('60', 'Every 60 minutes')
        .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
        .onChange(async (value) => {
          this.plugin.settings.autoSyncIntervalMinutes = parseInt(value, 10);
          await this.plugin.saveSettings();
          this.plugin.setupAutoSyncInterval();
        }));

    new obsidian.Setting(containerEl)
      .setName('Sync On Startup')
      .setDesc('Trigger sync automatically when Obsidian starts.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Require Obsidian Vault Structure')
      .setDesc('When pulling from GitHub, verify that the remote repository actually contains an Obsidian vault (an .obsidian folder with config files) before overwriting local files.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.requireVaultStructure)
        .onChange(async (value) => {
          this.plugin.settings.requireVaultStructure = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Actions' });

    new obsidian.Setting(containerEl)
      .setName('Manual Operations')
      .setDesc('Run sync or inspect log output.')
      .addButton(btn => btn
        .setButtonText('Sync Vault Now')
        .setCta()
        .onClick(() => {
          this.plugin.syncVault(true);
        }))
      .addButton(btn => btn
        .setButtonText('View Logs')
        .onClick(() => {
          new GitSyncLogModal(this.app, this.plugin).open();
        }));

    new obsidian.Setting(containerEl)
      .setName('Pull Vault From GitHub')
      .setDesc('Fetch the repository configured above and validate that it contains an Obsidian vault, then replace the files in this vault with the remote content. Local changes that were never committed are lost, so this asks for confirmation first.')
      .addButton(btn => btn
        .setButtonText('Pull Vault')
        .setWarning()
        .onClick(() => {
          this.plugin.pullVaultFromGitHub(true);
        }));
  }
}

class GitSyncPlugin extends obsidian.Plugin {
  async onload() {
    this.logs = [];
    this.isSyncing = false;
    this.cancelRequested = false;
    this.activeChildren = new Set();
    this.activeLogModal = null;
    this.intervalId = null;

    await this.loadSettings();

    // Ribbon icon
    this.addRibbonIcon('refresh-cw', 'Sync Vault to GitHub', () => {
      this.syncVault(true);
    });

    // Status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass('git-sync-status-bar');
    this.statusBarItem.addEventListener('click', () => {
      new GitSyncLogModal(this.app, this).open();
    });
    this.updateStatusBar('Ready', '✓');

    // Commands
    this.addCommand({
      id: 'git-sync-vault',
      name: 'Sync vault to GitHub',
      callback: () => this.syncVault(true)
    });

    this.addCommand({
      id: 'git-sync-pull',
      name: 'Pull latest changes from GitHub',
      callback: () => this.pullVault(true)
    });

    this.addCommand({
      id: 'git-sync-pull-vault',
      name: 'Pull vault from GitHub (replace local files)',
      callback: () => this.pullVaultFromGitHub(true)
    });

    this.addCommand({
      id: 'git-sync-push',
      name: 'Push changes to GitHub',
      callback: () => this.pushVault(true)
    });

    this.addCommand({
      id: 'git-sync-logs',
      name: 'View sync logs & status',
      callback: () => new GitSyncLogModal(this.app, this).open()
    });

    this.addCommand({
      id: 'git-sync-stop',
      name: 'Stop current sync operation',
      checkCallback: (checking) => {
        if (!this.isSyncing) return false;
        if (!checking) this.stopOperation();
        return true;
      }
    });

    // Settings tab
    this.addSettingTab(new GitSyncSettingTab(this.app, this));

    // Auto-sync timer
    this.setupAutoSyncInterval();

    // Startup sync
    if (this.settings.syncOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        setTimeout(() => {
          this.syncVault(false);
        }, 3000);
      });
    }

    this.log('Obsidian Git Sync plugin initialized successfully.', 'info');
  }

  onunload() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Never leave a git process running when the plugin is disabled mid-operation.
    if (this.isSyncing) {
      this.cancelRequested = true;
      this.killActiveChildProcesses();
      this.isSyncing = false;
      this.activeChildren.clear();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setupAutoSyncInterval() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const minutes = this.settings.autoSyncIntervalMinutes;
    if (minutes > 0) {
      this.intervalId = window.setInterval(() => {
        this.log(`Auto-sync interval triggered (${minutes} min).`, 'info');
        this.syncVault(false);
      }, minutes * 60 * 1000);
    }
  }

  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === 'function') {
      return adapter.getBasePath();
    }
    if (adapter && adapter.basePath) {
      return adapter.basePath;
    }
    return null;
  }

  log(text, type = 'info') {
    if (!text) return;
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim() && type === 'info') continue;
      const timestamp = new Date().toLocaleTimeString();
      this.logs.push({ time: timestamp, text: line, type });
      if (this.logs.length > 600) {
        this.logs.shift();
      }
    }
    if (this.activeLogModal && typeof this.activeLogModal.refreshLogs === 'function') {
      this.activeLogModal.refreshLogs();
    }
  }

  updateStatusBar(statusText, icon = '') {
    if (!this.statusBarItem) return;
    this.statusBarItem.setText(`Git Sync: ${icon ? icon + ' ' : ''}${statusText}`);
  }

  setSyncingState(running) {
    this.isSyncing = running;
    if (!running) {
      this.cancelRequested = false;
      this.activeChildren.clear();
    }
    this.notifyModalState();
  }

  notifyModalState() {
    if (this.activeLogModal && typeof this.activeLogModal.updateButtons === 'function') {
      this.activeLogModal.updateButtons();
    }
  }

  /**
   * Interrupts the running sync/pull/push by killing its git process tree.
   * The pending executeGit promise rejects with GitSyncCancelledError, which
   * stops the remaining steps of the operation.
   */
  stopOperation() {
    if (!this.isSyncing) {
      new obsidian.Notice('Git Sync: no operation is currently running.');
      return;
    }
    if (this.cancelRequested) {
      new obsidian.Notice('Git Sync: already stopping...');
      return;
    }

    this.cancelRequested = true;
    this.log('Stop requested - interrupting the running git process...', 'error');
    this.updateStatusBar('Stopping...', '⏹');
    this.killActiveChildProcesses();
    this.notifyModalState();
  }

  killActiveChildProcesses() {
    for (const child of this.activeChildren) {
      if (!child || child.killed || !child.pid) continue;

      try {
        if (process.platform === 'win32') {
          // Git runs under cmd.exe because we spawn with shell: true, so killing
          // the shell alone would leave git.exe running. Kill the whole tree.
          spawn(this.getTaskkillPath(), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGTERM');
          const target = child;
          window.setTimeout(() => {
            try {
              if (!target.killed) target.kill('SIGKILL');
            } catch (e) {
              // Process is already gone.
            }
          }, 2000);
        }
      } catch (err) {
        this.log(`Failed to stop git process: ${err.message}`, 'error');
      }
    }
  }

  getTaskkillPath() {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const fullPath = path.join(root, 'System32', 'taskkill.exe');
    return fs.existsSync(fullPath) ? fullPath : 'taskkill';
  }

  executeGit(args, cwd) {
    return new Promise((resolve, reject) => {
      if (this.cancelRequested) {
        return reject(new GitSyncCancelledError('Git command skipped: operation was stopped.'));
      }

      const gitCmd = this.settings.gitPath || 'git';
      this.log(`$ ${gitCmd} ${args.join(' ')}`, 'info');

      let child;
      try {
        child = spawn(gitCmd, args, {
          cwd: cwd,
          shell: true,
          windowsHide: true,
          env: process.env
        });
      } catch (err) {
        const errMsg = `Failed to spawn Git process: ${err.message}`;
        this.log(errMsg, 'error');
        return resolve({ success: false, stdout: '', stderr: errMsg, code: -1 });
      }

      // Only track processes that belong to a vault operation, so one-off
      // commands (e.g. "Test Git" from the settings tab) are never interrupted.
      if (this.isSyncing) {
        this.activeChildren.add(child);
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (code, errorText) => {
        if (settled) return;
        settled = true;
        this.activeChildren.delete(child);

        if (this.cancelRequested) {
          return reject(new GitSyncCancelledError());
        }
        if (errorText) {
          return resolve({ success: false, stdout, stderr: errorText, code: -1 });
        }
        resolve({ success: code === 0, stdout, stderr, code });
      };

      child.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        this.log(str.trimEnd(), 'stdout');
      });

      child.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        this.log(str.trimEnd(), 'stderr');
      });

      child.on('error', (err) => {
        let errorText = err.message;
        if (err.code === 'ENOENT') {
          errorText = `Git not found at "${gitCmd}". Please install Git (e.g. winget install Git.Git) or specify the full path in settings.`;
        }
        this.log(`Error: ${errorText}`, 'error');
        settle(-1, errorText);
      });

      child.on('close', (code) => {
        settle(code);
      });
    });
  }

  async testGitInstallation() {
    const vaultPath = this.getVaultBasePath() || process.cwd();
    try {
      const res = await this.executeGit(['--version'], vaultPath);
      if (res.success) {
        return { success: true, version: res.stdout.trim() };
      }
      return { success: false, error: res.stderr || 'Git process exited with an error' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  formatCommitMessage() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    const template = this.settings.commitMessage || DEFAULT_SETTINGS.commitMessage;
    return template.replace(/\{date\}/g, dateStr).replace(/\{time\}/g, timeStr);
  }

  async syncVault(manual = true) {
    const ctx = this.prepareOperation({ requireRepoUrl: true });
    if (!ctx) return;
    const { vaultPath, repoUrl, branch } = ctx;

    this.setSyncingState(true);
    this.updateStatusBar('Syncing...', '⏳');
    if (manual) new obsidian.Notice('Git Sync: Starting synchronization...');
    this.log(`\n========================================`, 'highlight');
    this.log(`Sync started: ${new Date().toLocaleString()}`, 'highlight');
    this.log(`Vault directory: ${vaultPath}`, 'info');
    this.log(`Remote: ${repoUrl} (${branch})`, 'info');
    this.log(`========================================`, 'highlight');

    try {
      // 1. Check if git repo initialized
      const gitDir = path.join(vaultPath, '.git');
      if (!fs.existsSync(gitDir)) {
        this.log('Initializing local git repository...', 'highlight');
        const initRes = await this.executeGit(['init'], vaultPath);
        if (!initRes.success) throw new Error(`git init failed: ${initRes.stderr}`);

        this.log(`Setting default branch to "${branch}"...`, 'highlight');
        await this.executeGit(['branch', '-M', branch], vaultPath);
      }

      // 2. Set remote origin
      this.log('Configuring remote origin...', 'highlight');
      await this.executeGit(['remote', 'remove', 'origin'], vaultPath);
      const remoteRes = await this.executeGit(['remote', 'add', 'origin', repoUrl], vaultPath);
      if (!remoteRes.success) {
        // In case remove failed and origin exists, update url
        await this.executeGit(['remote', 'set-url', 'origin', repoUrl], vaultPath);
      }

      // 3. Optional: Pull changes first
      if (this.settings.pullBeforePush) {
        this.log(`Pulling latest changes from origin/${branch}...`, 'highlight');
        await this.executeGit(['pull', 'origin', branch], vaultPath);
      }

      // 4. Set Author Identity if configured in settings
      if (this.settings.authorName) {
        await this.executeGit(['config', 'user.name', this.settings.authorName], vaultPath);
      }
      if (this.settings.authorEmail) {
        await this.executeGit(['config', 'user.email', this.settings.authorEmail], vaultPath);
      }

      // 5. Stage changes
      this.log('Staging files (git add .)...', 'highlight');
      const addRes = await this.executeGit(['add', '.'], vaultPath);
      if (!addRes.success) throw new Error(`git add failed: ${addRes.stderr}`);

      // 6. Commit changes
      const commitMsg = this.formatCommitMessage();
      this.log(`Committing changes: "${commitMsg}"...`, 'highlight');
      const commitRes = await this.executeGit(['commit', '-m', `"${commitMsg}"`], vaultPath);
      
      const stdout = (commitRes.stdout || '').toLowerCase();
      const stderr = (commitRes.stderr || '').toLowerCase();
      const combinedOutput = stdout + ' ' + stderr;
      const nothingToCommit = combinedOutput.includes('nothing to commit') || combinedOutput.includes('working tree clean');

      if (!commitRes.success) {
        if (nothingToCommit) {
          this.log('Working tree clean, no new changes to commit.', 'info');
        } else if (combinedOutput.includes('author identity unknown') || combinedOutput.includes('tell me who you are')) {
          throw new Error('Author identity unknown. Please enter your "Git Author Name" and "Git Author Email" in Git Sync settings.');
        } else {
          // Check if at least one commit exists
          const headCheck = await this.executeGit(['rev-parse', '--verify', 'HEAD'], vaultPath);
          if (!headCheck.success) {
            throw new Error(`Git commit failed: ${commitRes.stderr || commitRes.stdout}`);
          }
          this.log(`Commit note: ${commitRes.stderr || commitRes.stdout}`, 'info');
        }
      }

      // 7. Push to remote
      this.log(`Pushing to origin ${branch}...`, 'highlight');
      const pushArgs = ['push', '-u', 'origin', branch];
      if (this.settings.forcePush) {
        pushArgs.push('--force');
      }

      const pushRes = await this.executeGit(pushArgs, vaultPath);
      if (!pushRes.success) {
        throw new Error(`git push failed: ${pushRes.stderr || 'unknown error'}`);
      }

      this.log('--- SYNC COMPLETED SUCCESSFULLY ---', 'success');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.updateStatusBar(`Synced at ${timeStr}`, '✓');
      if (manual) new obsidian.Notice('Git Sync: Vault successfully synced to GitHub!');

    } catch (err) {
      if (err instanceof GitSyncCancelledError) {
        this.log('--- SYNC STOPPED BY USER ---', 'highlight');
        this.log('Vault may be partially synced (e.g. committed locally but not pushed). Run Sync again to reconcile.', 'info');
        this.updateStatusBar('Stopped', '⏹');
        new obsidian.Notice('Git Sync: Operation stopped.', 4000);
      } else {
        this.log(`--- SYNC ERROR: ${err.message} ---`, 'error');
        this.updateStatusBar('Sync Failed', '✗');
        new obsidian.Notice(`Git Sync failed: ${err.message}`, 7000);
      }
    } finally {
      this.setSyncingState(false);
    }
  }

  /**
   * Shared entry checks for an operation. Returns null (after telling the user
   * why) when the operation must not start.
   */
  prepareOperation(settings) {
    const options = settings || {};

    if (this.isSyncing) {
      new obsidian.Notice('An operation is already in progress.');
      return null;
    }

    const vaultPath = this.getVaultBasePath();
    if (!vaultPath) {
      new obsidian.Notice('Error: Could not determine local vault path.');
      return null;
    }

    const repoUrl = (this.settings.repoUrl || '').trim();
    if (options.requireRepoUrl && !repoUrl) {
      new obsidian.Notice('Please configure your GitHub Repository URL in Git Sync settings first.');
      return null;
    }

    return {
      vaultPath: vaultPath,
      repoUrl: repoUrl,
      branch: (this.settings.branch || 'main').trim()
    };
  }

  /**
   * Opens a confirmation dialog and resolves true only when the user confirms.
   */
  confirmAction(options) {
    return new Promise((resolve) => {
      new GitSyncConfirmModal(this.app, {
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      }).open();
    });
  }

  /**
   * Pulls the configured repository into this vault: fetch, verify that the
   * remote really contains an Obsidian vault, confirm, then reset the local
   * files to the remote branch.
   */
  async pullVaultFromGitHub(manual = true) {
    const ctx = this.prepareOperation({ requireRepoUrl: true });
    if (!ctx) return;
    const { vaultPath, repoUrl, branch } = ctx;

    this.setSyncingState(true);
    this.updateStatusBar('Pulling...', '⏳');
    this.log(`\n========================================`, 'highlight');
    this.log(`Pull started: ${new Date().toLocaleString()}`, 'highlight');
    this.log(`Remote: ${repoUrl} (${branch})`, 'info');
    this.log(`Vault directory: ${vaultPath}`, 'info');
    this.log(`========================================`, 'highlight');

    try {
      // 1. Make sure the vault folder is a git repository
      const gitDir = path.join(vaultPath, '.git');
      if (!fs.existsSync(gitDir)) {
        this.log('Initializing local git repository...', 'highlight');
        const initRes = await this.executeGit(['init'], vaultPath);
        if (!initRes.success) throw new Error(`git init failed: ${initRes.stderr}`);
        await this.executeGit(['branch', '-M', branch], vaultPath);
      }

      // 2. Point origin at the configured repository
      this.log('Configuring remote origin...', 'highlight');
      await this.executeGit(['remote', 'remove', 'origin'], vaultPath);
      const remoteRes = await this.executeGit(['remote', 'add', 'origin', repoUrl], vaultPath);
      if (!remoteRes.success) {
        await this.executeGit(['remote', 'set-url', 'origin', repoUrl], vaultPath);
      }

      // 3. Download the remote branch (this does not touch local files yet)
      this.log(`Fetching origin/${branch}...`, 'highlight');
      const fetchRes = await this.executeGit(['fetch', 'origin', branch], vaultPath);
      if (!fetchRes.success) {
        throw new Error(fetchRes.stderr || `Could not fetch origin/${branch}. Check the repository URL and your credentials.`);
      }

      // 4. Validate the remote content before overwriting anything
      const treeRes = await this.executeGit(['ls-tree', '-r', '--name-only', `origin/${branch}`], vaultPath);
      if (!treeRes.success) {
        throw new Error(treeRes.stderr || `Could not read the remote tree of origin/${branch}.`);
      }

      const remotePaths = (treeRes.stdout || '').split(/\r?\n/).filter(l => l.trim().length > 0);
      const vaultInfo = analyzeRemoteTree(remotePaths);
      this.lastPullInfo = vaultInfo;

      if (vaultInfo.isVault) {
        this.log('Remote verified: Obsidian vault structure detected.', 'success');
        this.log(`  .obsidian base files: ${vaultInfo.found.length}/${OBSIDIAN_BASE_FILES.length}`, 'info');
        this.log(`  Found: ${vaultInfo.found.join(', ')}`, 'info');
      } else {
        this.log('Remote repository does not look like an Obsidian vault.', 'error');
        this.log(`  .obsidian config folder: ${vaultInfo.hasConfigDir ? 'found' : 'MISSING'}`, 'error');
        this.log(`  Obsidian base files found: ${vaultInfo.found.length}/${OBSIDIAN_BASE_FILES.length}`, 'error');
        this.log('  A vault must contain an .obsidian folder with the files Obsidian itself writes (app.json, appearance.json, ...).', 'info');
      }

      this.log(`Files on remote: ${vaultInfo.fileCount}`, 'info');

      // 5. Describe what is about to be downloaded.
      // Args go through a shell, so the format string must not contain spaces
      // or pipe characters - use %n as the separator instead.
      const headRes = await this.executeGit(['log', '-1', '--format=%h%n%an%n%ad%n%s', `origin/${branch}`], vaultPath);
      if (headRes.success && headRes.stdout.trim()) {
        const lines = headRes.stdout.trim().split(/\r?\n/);
        const hash = lines[0] || '?';
        const author = lines[1] || 'unknown';
        const date = lines[2] || '';
        const subject = lines[3] || '';
        this.log(`Remote HEAD: ${hash} - ${subject} (${author}${date ? ', ' + date : ''})`, 'info');
      }

      const localHeadRes = await this.executeGit(['rev-parse', '--verify', 'HEAD'], vaultPath);
      if (localHeadRes.success) {
        const deltaRes = await this.executeGit(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`], vaultPath);
        if (deltaRes.success && deltaRes.stdout.trim()) {
          const parts = deltaRes.stdout.trim().split(/\s+/);
          this.log(`Commit difference (remote-only / local-only): ${parts[0] || 0} / ${parts[1] || 0}`, 'info');
        }
      } else {
        this.log('Local repository has no commits yet - this is a fresh pull.', 'info');
      }

      // Abort before touching local files when the remote is not a vault
      if (!vaultInfo.isVault && this.settings.requireVaultStructure) {
        this.log('Aborted: no local file was changed.', 'error');
        this.log('Disable "Require Obsidian Vault Structure" in the Git Sync settings to pull this repository anyway.', 'info');
        throw new Error('The remote repository is not an Obsidian vault - nothing was pulled.');
      }

      // 6. Ask the user before overwriting local files
      if (manual) {
        const statusRes = await this.executeGit(['status', '--porcelain'], vaultPath);
        const dirtyCount = (statusRes.stdout || '').split(/\r?\n/).filter(l => l.trim().length > 0).length;
        const message = [
          `Download ${vaultInfo.fileCount} file(s) from ${repoUrl} (${branch}) and replace the contents of this vault?`,
          dirtyCount > 0
            ? `${dirtyCount} local file(s) have uncommitted changes and will be overwritten.`
            : 'No uncommitted local changes were found.',
          'This cannot be undone.'
        ].join('\n\n');

        const proceed = await this.confirmAction({
          title: 'Pull vault from GitHub?',
          message: message,
          confirmText: 'Pull & overwrite'
        });

        if (!proceed) {
          this.log('Pull cancelled by user - nothing was changed.', 'highlight');
          this.updateStatusBar('Ready', '✓');
          new obsidian.Notice('Git Sync: Pull cancelled.');
          return;
        }
      }

      // 7. Replace the local files with the remote branch
      this.log(`Checking out origin/${branch}...`, 'highlight');
      const resetRes = await this.executeGit(['reset', '--hard', `origin/${branch}`], vaultPath);
      if (!resetRes.success) {
        throw new Error(resetRes.stderr || 'git reset failed');
      }
      await this.executeGit(['branch', '--set-upstream-to', `origin/${branch}`, branch], vaultPath);

      // 8. Confirm the vault is really on disk now
      if (vaultInfo.found.length > 0) {
        const verified = vaultInfo.found.filter(f => fs.existsSync(path.join(vaultPath, ...f.split('/'))));
        if (verified.length === vaultInfo.found.length) {
          this.log(`Vault verified on disk: all ${verified.length} Obsidian base files are present.`, 'success');
        } else {
          this.log(`Vault check after pull: ${verified.length}/${vaultInfo.found.length} Obsidian base files present.`, 'error');
        }
      }

      this.log(`--- PULL COMPLETED (${vaultInfo.fileCount} files) ---`, 'success');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.updateStatusBar(`Pulled at ${timeStr}`, '✓');
      if (manual) new obsidian.Notice(`Git Sync: Vault pulled from GitHub (${vaultInfo.fileCount} files).`);

    } catch (err) {
      if (err instanceof GitSyncCancelledError) {
        this.log('--- PULL STOPPED BY USER ---', 'highlight');
        this.log('Local files may be partially updated. Run Pull again to finish.', 'info');
        this.updateStatusBar('Stopped', '⏹');
        new obsidian.Notice('Git Sync: Pull stopped.', 4000);
      } else {
        this.log(`Pull failed: ${err.message}`, 'error');
        this.updateStatusBar('Pull Failed', '✗');
        new obsidian.Notice(`Git Sync: Pull failed: ${err.message}`, 6000);
      }
    } finally {
      this.setSyncingState(false);
    }
  }

  async pullVault(manual = true) {
    if (this.isSyncing) {
      new obsidian.Notice('An operation is already in progress.');
      return;
    }

    const vaultPath = this.getVaultBasePath();
    if (!vaultPath) return;

    const branch = (this.settings.branch || 'main').trim();

    this.setSyncingState(true);
    this.updateStatusBar('Pulling...', '⏳');
    this.log(`Pulling from origin ${branch}...`, 'highlight');

    try {
      const res = await this.executeGit(['pull', 'origin', branch], vaultPath);
      if (res.success) {
        this.log('Pull completed successfully.', 'success');
        this.updateStatusBar('Ready', '✓');
        if (manual) new obsidian.Notice('Git Sync: Pull completed successfully!');
      } else {
        throw new Error(res.stderr || 'Pull failed');
      }
    } catch (err) {
      if (err instanceof GitSyncCancelledError) {
        this.log('--- PULL STOPPED BY USER ---', 'highlight');
        this.updateStatusBar('Stopped', '⏹');
        new obsidian.Notice('Git Sync: Pull stopped.', 4000);
      } else {
        this.log(`Pull failed: ${err.message}`, 'error');
        this.updateStatusBar('Pull Failed', '✗');
        new obsidian.Notice(`Git Sync: Pull failed: ${err.message}`, 6000);
      }
    } finally {
      this.setSyncingState(false);
    }
  }

  async pushVault(manual = true) {
    if (this.isSyncing) {
      new obsidian.Notice('An operation is already in progress.');
      return;
    }

    const vaultPath = this.getVaultBasePath();
    if (!vaultPath) return;

    const branch = (this.settings.branch || 'main').trim();

    this.setSyncingState(true);
    this.updateStatusBar('Pushing...', '⏳');
    this.log(`Pushing to origin ${branch}...`, 'highlight');

    try {
      const pushArgs = ['push', '-u', 'origin', branch];
      if (this.settings.forcePush) pushArgs.push('--force');

      const res = await this.executeGit(pushArgs, vaultPath);
      if (res.success) {
        this.log('Push completed successfully.', 'success');
        this.updateStatusBar('Ready', '✓');
        if (manual) new obsidian.Notice('Git Sync: Push completed successfully!');
      } else {
        throw new Error(res.stderr || 'Push failed');
      }
    } catch (err) {
      if (err instanceof GitSyncCancelledError) {
        this.log('--- PUSH STOPPED BY USER ---', 'highlight');
        this.updateStatusBar('Stopped', '⏹');
        new obsidian.Notice('Git Sync: Push stopped.', 4000);
      } else {
        this.log(`Push failed: ${err.message}`, 'error');
        this.updateStatusBar('Push Failed', '✗');
        new obsidian.Notice(`Git Sync: Push failed: ${err.message}`, 6000);
      }
    } finally {
      this.setSyncingState(false);
    }
  }
}

module.exports = GitSyncPlugin;
module.exports.default = GitSyncPlugin;

