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
  syncOnStartup: false
};

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

    const syncBtn = btnBar.createEl('button', { text: 'Sync Now', cls: 'mod-cta' });
    syncBtn.addEventListener('click', () => {
      this.plugin.syncVault(true);
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
      return;
    }

    for (const log of this.plugin.logs) {
      const entry = this.logContainer.createDiv({ cls: `git-sync-log-entry ${log.type || ''}` });
      entry.setText(`[${log.time}] ${log.text}`);
    }

    this.logContainer.scrollTop = this.logContainer.scrollHeight;
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
  }
}

class GitSyncPlugin extends obsidian.Plugin {
  async onload() {
    this.logs = [];
    this.isSyncing = false;
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
      id: 'git-sync-push',
      name: 'Push changes to GitHub',
      callback: () => this.pushVault(true)
    });

    this.addCommand({
      id: 'git-sync-logs',
      name: 'View sync logs & status',
      callback: () => new GitSyncLogModal(this.app, this).open()
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

  executeGit(args, cwd) {
    return new Promise((resolve) => {
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

      let stdout = '';
      let stderr = '';

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
        resolve({ success: false, stdout, stderr: errorText, code: -1 });
      });

      child.on('close', (code) => {
        resolve({ success: code === 0, stdout, stderr, code });
      });
    });
  }

  async testGitInstallation() {
    const vaultPath = this.getVaultBasePath() || process.cwd();
    const res = await this.executeGit(['--version'], vaultPath);
    if (res.success) {
      return { success: true, version: res.stdout.trim() };
    }
    return { success: false, error: res.stderr || 'Git process exited with an error' };
  }

  formatCommitMessage() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    const template = this.settings.commitMessage || DEFAULT_SETTINGS.commitMessage;
    return template.replace(/\{date\}/g, dateStr).replace(/\{time\}/g, timeStr);
  }

  async syncVault(manual = true) {
    if (this.isSyncing) {
      new obsidian.Notice('Git Sync is already in progress.');
      return;
    }

    const vaultPath = this.getVaultBasePath();
    if (!vaultPath) {
      new obsidian.Notice('Error: Could not determine local vault path.');
      return;
    }

    const repoUrl = (this.settings.repoUrl || '').trim();
    if (!repoUrl) {
      new obsidian.Notice('Please configure your GitHub Repository URL in Git Sync settings first.');
      return;
    }

    const branch = (this.settings.branch || 'main').trim();

    this.isSyncing = true;
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
      this.log(`--- SYNC ERROR: ${err.message} ---`, 'error');
      this.updateStatusBar('Sync Failed', '✗');
      new obsidian.Notice(`Git Sync failed: ${err.message}`, 7000);
    } finally {
      this.isSyncing = false;
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

    this.isSyncing = true;
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
      this.log(`Pull failed: ${err.message}`, 'error');
      this.updateStatusBar('Pull Failed', '✗');
      new obsidian.Notice(`Git Sync: Pull failed: ${err.message}`, 6000);
    } finally {
      this.isSyncing = false;
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

    this.isSyncing = true;
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
      this.log(`Push failed: ${err.message}`, 'error');
      this.updateStatusBar('Push Failed', '✗');
      new obsidian.Notice(`Git Sync: Push failed: ${err.message}`, 6000);
    } finally {
      this.isSyncing = false;
    }
  }
}

module.exports = GitSyncPlugin;
module.exports.default = GitSyncPlugin;

