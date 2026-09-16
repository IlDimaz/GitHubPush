# Obsidian Git Sync

A lightweight, zero-bloat Obsidian community plugin that lets you sync your entire Obsidian vault directly to a GitHub repository with a single click.

No external Python scripts or terminal commands required — everything runs natively inside Obsidian!

---

## ✨ Features

- **🚀 One-Click Sync**: Click the sync icon in the left ribbon or click the status bar item.
- **📁 Automatic Vault Detection**: Automatically determines your vault's local path without manual configuration.
- **⚡ Fast Background Operations**: Stage, commit, and push changes in the background while you keep writing.
- **📊 Real-time Log Viewer**: Inspect complete Git outputs, commit messages, and errors in a built-in terminal-like window.
- **⏱️ Auto-Sync**: Automatically sync your vault on a schedule (every 5, 15, 30, or 60 minutes) or on Obsidian startup.
- **⌨️ Command Palette Support**: Access sync, pull, push, and logs from `Ctrl+P` (or `Cmd+P` on Mac).
- **🔒 Flexible Authentication**: Supports Git Credential Manager browser login, GitHub Personal Access Tokens (PAT), and SSH.

---

## 📥 Installation

### Method 1: Manual Installation (Recommended)

1. Download the latest release (`main.js`, `manifest.json`, and `styles.css`).
2. In your Obsidian vault, navigate to the plugins folder:
   ```text
   <Your-Vault>/.obsidian/plugins/obsidian-git-sync/
   ```
   *(Create the `obsidian-git-sync` folder if it doesn't exist).*
3. Place `main.js`, `manifest.json`, and `styles.css` inside that folder.
4. Open Obsidian, go to **Settings → Community plugins**, click **Reload plugins**, and enable **Git Sync**.

### Method 2: Via BRAT Plugin

If you use the [Obsidian BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin:
1. Open the Command Palette (`Ctrl+P`).
2. Search for `BRAT: Add a beta plugin for testing`.
3. Paste the repository URL: `https://github.com/IlDimaz/ObsidianSync` (or your repo URL).
4. Click **Add Plugin**.

---

## ⚙️ Prerequisites

This plugin requires **Git** installed on your system.

### On Windows:
Open PowerShell or Command Prompt and run:
```powershell
winget install Git.Git
```
*(Or download the installer from [git-scm.com](https://git-scm.com)).*

### On macOS:
```bash
brew install git
```

### On Linux (Ubuntu/Debian):
```bash
sudo apt update && sudo apt install git
```

---

## 🔑 How to Log In & Authenticate with GitHub

You have three easy ways to authenticate Git with GitHub:

### Option 1: Browser Login (Easiest — Recommended)

Git for Windows/macOS comes with **Git Credential Manager** pre-installed.

1. When you run your first sync from Obsidian (or terminal), Git will automatically launch a popup window in your web browser.
2. Click **"Sign in with your browser"**.
3. Authorize the application.
4. Done! Windows Credential Manager will securely remember your session forever. You won't have to enter passwords again.

---

### Option 2: GitHub Personal Access Token (PAT)

If you prefer using a token or if two-factor authentication (2FA) is enabled on your GitHub account:

#### Step 1: Generate the Token on GitHub
1. Log into [GitHub](https://github.com).
2. Click your profile picture in the top-right corner → **Settings**.
3. Scroll all the way down the left sidebar and click **Developer settings** (or visit `https://github.com/settings/apps`).
4. Click **Personal access tokens** → **Tokens (classic)**.
5. Click **Generate new token** → **Generate new token (classic)**.
6. Under **Note**, enter a name (e.g. `Obsidian Vault Sync`).
7. Under **Expiration**, select your preferred duration (e.g. `90 days` or `No expiration`).
8. Under **Select scopes**, check the box for:
   - ✅ **`repo`** (Full control of private repositories).
9. Scroll down and click the green **Generate token** button.
10. **Copy your token immediately** (it starts with `ghp_...`). *You won't be able to see it again!*

#### Step 2: Use the Token in Obsidian
In **Settings → Git Sync → GitHub Repository URL**, embed your token into the URL like this:
```text
https://<YOUR_TOKEN>@github.com/username/repository.git
```
*Example:*
```text
https://ghp_AbCdEf1234567890@github.com/IlDimaz/INGINFMN.git
```
Git will authenticate seamlessly using your token for all sync operations.

---

### Option 3: GitHub CLI

If you have GitHub CLI installed, you can log in directly from your terminal:
```powershell
gh auth login
```
Select **GitHub.com** → **HTTPS** → **Yes** (Authenticate with web browser).

---

## 🛠️ Configuration & Settings

Open **Settings (`Ctrl+,`) → Community plugins → Git Sync**:

| Setting | Description | Default |
| :--- | :--- | :--- |
| **GitHub Repository URL** | Your remote repository URL (HTTPS or SSH). | *(empty)* |
| **Git Executable Path** | Path to the Git binary. Leave as `git` or specify full path (e.g. `C:\Program Files\Git\cmd\git.exe`). Includes a **Test Git** button. | `git` |
| **Git Author Name** | Your name or GitHub username for commit authorship. | *(empty)* |
| **Git Author Email** | Your GitHub-associated email address for commits. | *(empty)* |
| **Branch** | The target branch to push and pull from. | `main` |
| **Commit Message Template** | Template for commit messages. Placeholders supported: `{date}` (YYYY-MM-DD) and `{time}` (HH:MM:SS). | `Auto-sync Obsidian Vault - {date} {time}` |
| **Pull Before Push** | Pull remote changes before staging and committing. Recommended if syncing between multiple devices. | `false` |
| **Force Push** | Use `--force` when pushing. Useful for initial vault backup or single-user vaults. | `true` |
| **Automatic Sync Interval** | Schedule automatic background sync (Disabled, 5m, 15m, 30m, 60m). | `Disabled` |
| **Sync On Startup** | Automatically triggers sync 3 seconds after Obsidian starts up. | `false` |

---

## 🖥️ Usage

- **Ribbon Button**: Click the sync icon (🔄) in Obsidian's left ribbon to trigger sync immediately.
- **Status Bar**: Check the status bar at the bottom right (`Git Sync: Ready ✓`, `Syncing... ⏳`, or `Synced at 17:50 ✓`). Click it at any time to open the **Log Viewer**.
- **Command Palette (`Ctrl+P`)**:
  - `Git Sync: Sync vault to GitHub`
  - `Git Sync: Pull latest changes from GitHub`
  - `Git Sync: Push changes to GitHub`
  - `Git Sync: View sync logs & status`

---

## ❓ Frequently Asked Questions & Troubleshooting

### Why does the first sync take 3-5 minutes?
On your very first sync, Git commits and uploads your **entire vault from scratch**, including all images (`.png`, `.jpg`), PDF attachments, and configuration files. Depending on your vault size and home internet upload speed, uploading 50-100MB of attachments will take a few minutes. 

**Future syncs only upload your modified notes**, which takes just 1-2 seconds!

### "Author identity unknown / Please tell me who you are"
Git requires an author name and email to create commits. Simply go to **Settings → Git Sync** and enter your **Git Author Name** and **Git Author Email**.

### "LF will be replaced by CRLF" warnings
These are normal Git messages on Windows indicating that line endings are being standardized between Windows (`CRLF`) and Unix/GitHub (`LF`). You can safely ignore them.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

