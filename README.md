# Obsidian GitHub Pull&Push

A lightweight Obsidian community plugin for synchronizing your entire Obsidian vault with a GitHub repository.

Git operations are handled directly by the plugin, so no external Python scripts or manual terminal commands are required.

## Features

* **One-click synchronization** — Sync your vault from the ribbon icon or the status bar.
* **Automatic vault detection** — The plugin automatically detects the local path of the currently open vault.
* **Git initialization** — Automatically initializes a Git repository inside the vault when needed.
* **Pull and push support** — Pull changes from GitHub, push local changes, or run a complete sync.
* **Automatic synchronization** — Optionally sync your vault every 5, 15, 30, or 60 minutes.
* **Sync on startup** — Optionally start a synchronization shortly after Obsidian starts.
* **Interruptible operations** — Stop an active Git operation directly from the log viewer or Command Palette.
* **Live operation logs** — View Git output and synchronization status directly inside Obsidian.
* **Vault restoration** — Download and restore an entire Obsidian vault from a GitHub repository.
* **Remote vault validation** — Before replacing local files, the plugin can verify that the remote repository actually contains an Obsidian vault.
* **Configurable Git executable** — Use `git` from the system PATH or specify a custom Git executable.
* **Custom commit messages** — Configure a commit message template with `{date}` and `{time}` placeholders.
* **Flexible authentication** — GitHub authentication is handled through Git, supporting HTTPS credentials, Git Credential Manager, PATs, and SSH.

## Installation

### Manual Installation

1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the repository.
2. Open your Obsidian vault directory.
3. Navigate to:

```text
<Your-Vault>/.obsidian/plugins/obsidian-git-sync/
```

4. Create the `obsidian-git-sync` directory if it does not exist.
5. Place the three downloaded files inside it.
6. Open Obsidian.
7. Go to **Settings → Community plugins**.
8. Reload the plugins and enable **GitHub Pull&Push**.

4. Enter:

```text
https://github.com/IlDimaz/ObsidianGitManage
```

5. Add the plugin and enable it from Obsidian's Community Plugins settings.

## Requirements

The plugin requires Git to be installed on your computer.

### Windows

Using PowerShell or Command Prompt:

```powershell
winget install Git.Git
```

Alternatively, install Git from:

https://git-scm.com/

### macOS

```bash
brew install git
```

### Linux

On Debian/Ubuntu:

```bash
sudo apt update
sudo apt install git
```

You can verify that Git is available with:

```bash
git --version
```

The plugin also includes a **Test Git** button in its settings to verify the configured Git executable.

## Configuration

Open:

**Settings → Community plugins → GitHub Pull&Push**

### GitHub Repository URL

The remote Git repository used for synchronization.

Example:

```text
https://github.com/username/my-vault.git
```

SSH repositories are also supported:

```text
git@github.com:username/my-vault.git
```

### Git Executable Path

The Git executable used by the plugin.

The default value is:

```text
git
```

If Git is not available through your system PATH, you can specify the complete executable path.

Example on Windows:

```text
C:\Program Files\Git\cmd\git.exe
```

A **Test Git** button is available to verify the configuration.

### Git Author Name

The name used when creating Git commits.

### Git Author Email

The email address used when creating Git commits.

### Branch

The Git branch used for synchronization.

Default:

```text
main
```

### Commit Message Template

Defines the message used when creating automatic commits.

Default:

```text
Auto-sync Obsidian Vault - {date} {time}
```

Available placeholders:

* `{date}` — current date in `YYYY-MM-DD` format
* `{time}` — current time in `HH:MM:SS` format

### Pull Before Push

When enabled, the plugin pulls the configured remote branch before staging and committing local changes.

This can be useful when the same vault is synchronized from multiple devices.

Default:

```text
Disabled
```

### Force Push

When enabled, the plugin uses `git push --force`.

This can be useful for a single-user vault or for an initial backup, but it can overwrite remote history.

Default:

```text
Enabled
```

Use this option carefully when multiple devices or contributors use the same repository.

### Automatic Sync Interval

Automatically synchronize the vault while Obsidian is running.

Available options:

* Disabled
* Every 5 minutes
* Every 15 minutes
* Every 30 minutes
* Every 60 minutes

Default:

```text
Disabled
```

### Sync On Startup

Automatically start a synchronization after Obsidian starts.

Default:

```text
Disabled
```

### Require Obsidian Vault Structure

When enabled, the plugin verifies that the remote repository contains an Obsidian vault before allowing a destructive vault pull.

The check looks for an `.obsidian` directory and Obsidian configuration files such as:

```text
.obsidian/app.json
.obsidian/appearance.json
.obsidian/core-plugins.json
.obsidian/community-plugins.json
.obsidian/workspace.json
.obsidian/hotkeys.json
```

Default:

```text
Enabled
```

This provides an additional safeguard against accidentally pointing the plugin at an unrelated Git repository.

## Authentication

The plugin relies on Git for authentication rather than implementing a separate GitHub authentication system.

### Git Credential Manager

Git Credential Manager is the simplest option for HTTPS repositories.

After installing Git, perform a Git operation. Git Credential Manager can open a browser authentication flow and securely store the resulting credentials.

### Personal Access Token

A GitHub Personal Access Token can also be used with HTTPS authentication.

If using a token, avoid committing or publishing the token anywhere. In particular, do not commit a repository URL containing a token into a file inside your vault.

For long-term use, Git Credential Manager or SSH is generally preferable to storing credentials directly in repository URLs.

### SSH

SSH authentication can be used with repositories such as:

```text
git@github.com:username/repository.git
```

Configure your SSH key with GitHub before using the repository URL in the plugin.

## Usage

### Sync Vault

Click the synchronization icon in the left ribbon.

The plugin performs the following operations:

1. Detects the vault directory.
2. Initializes Git if necessary.
3. Configures the remote repository.
4. Optionally pulls the remote branch.
5. Configures the Git author identity.
6. Stages changes with `git add .`.
7. Creates a commit.
8. Pushes the selected branch to GitHub.

The default branch is `main`.

The synchronization process is implemented directly through Git commands executed by the plugin.

### Status Bar

The status bar displays the current synchronization state.

Clicking the status bar opens the log viewer.

The status can indicate states such as:

```text
Git Sync: Ready
Syncing...
Pulling...
Pushing...
Stopped
Synced at 17:50
Sync Failed
```

### Log Viewer

The log viewer displays Git output while operations are running.

It provides controls for:

* **Sync Now** — Run a complete synchronization.
* **Pull** — Pull the latest remote changes.
* **Stop** — Stop the currently running Git operation.
* **Copy Logs** — Copy the current logs.
* **Clear Logs** — Clear the log buffer.

The plugin keeps a bounded log buffer rather than indefinitely storing operation output.

## Command Palette

The following commands are available through Obsidian's Command Palette:

```text
Git Sync: Sync vault to GitHub
Git Sync: Pull latest changes from GitHub
Git Sync: Pull vault from GitHub (replace local files)
Git Sync: Push changes to GitHub
Git Sync: View sync logs & status
Git Sync: Stop current sync operation
```

The stop command is only available while a Git operation is running.

## Pulling Changes

### Pull latest changes

The standard pull operation retrieves the latest changes from the configured GitHub repository while preserving the local Git history.

Use:

```text
Git Sync: Pull latest changes from GitHub
```

### Pull and replace the vault

The plugin also provides a separate operation for restoring a vault from GitHub:

```text
Git Sync: Pull vault from GitHub (replace local files)
```

This operation is intended for situations such as:

* Setting up a vault on a new computer.
* Restoring a vault from a backup.
* Replacing a local vault with the version stored in GitHub.

Before modifying local files, the plugin:

1. Fetches the remote branch.
2. Inspects the remote Git tree.
3. Checks for an Obsidian vault structure.
4. Displays information about the remote repository.
5. Checks for uncommitted local changes.
6. Asks for confirmation before replacing local files.

If the remote repository does not appear to contain an Obsidian vault and **Require Obsidian Vault Structure** is enabled, the operation is aborted before local files are changed.

### Warning

Pulling a vault with the replace operation can overwrite local files.

Make sure important local changes are committed or backed up before using it.

## Restoring a Vault on a New Computer

To restore an existing vault:

1. Install Obsidian.
2. Install Git.
3. Create and open a new empty Obsidian vault.
4. Install **GitHub Pull&Push**.
5. Open the plugin settings.
6. Enter the GitHub repository URL.
7. Configure the branch and Git author information.
8. Authenticate with GitHub.
9. Run:

```text
Git Sync: Pull vault from GitHub (replace local files)
```

10. Review the information shown by the plugin.
11. Confirm the operation.

The remote repository is fetched and validated before the local vault is replaced.

## Stopping an Operation

A running Git operation can be stopped from:

**Log Viewer → Stop**

or through:

```text
Ctrl+P
→ Git Sync: Stop current sync operation
```

The plugin tracks active Git child processes and terminates them when an operation is cancelled.

An interrupted synchronization may leave a local commit that has not yet been pushed. Running synchronization again allows the remaining operation to complete.

## Git Repository Structure

The plugin works directly with the Git repository inside the Obsidian vault.

A typical vault will therefore contain:

```text
MyVault/
├── .git/
├── .obsidian/
├── Notes/
├── Attachments/
└── ...
```

The `.git` directory contains the local Git repository and should normally not be edited manually.

Whether `.obsidian` should be committed is a personal choice. If you want the vault restoration validation to recognize the repository automatically, the repository needs to contain the relevant Obsidian configuration files.

## Troubleshooting

### Git was not found

If the plugin reports that Git cannot be found:

1. Make sure Git is installed.
2. Run:

```powershell
git --version
```

3. If the command works in a terminal but not in Obsidian, specify the full Git executable path in the plugin settings.

On Windows, a common path is:

```text
C:\Program Files\Git\cmd\git.exe
```

### Author identity unknown

If Git reports:

```text
Author identity unknown
```

enter both:

* **Git Author Name**
* **Git Author Email**

in the plugin settings.

These values are used to configure the local Git repository before creating commits.

### LF will be replaced by CRLF

On Windows, Git may display messages about converting between LF and CRLF line endings.

These messages are related to Git's line-ending configuration and are not necessarily errors.

### Authentication failed

Check:

* The repository URL.
* Your GitHub permissions.
* Your Git credentials.
* Your SSH configuration if using an SSH repository.
* Whether the repository is private.

You can test the configured Git installation from the plugin settings and test repository access independently with Git if necessary.

## Safety Considerations

This plugin operates directly on your vault's Git repository.

In particular:

* **Force Push** can overwrite remote history.
* **Pull Before Push** can introduce remote changes into the local repository.
* **Pull vault from GitHub** can replace local files.
* Storing credentials directly inside a repository URL is not recommended.
* Large attachments can significantly increase Git repository size.

Always keep an independent backup of important data if the vault contains files that cannot be easily recreated.

## License

This project is licensed under the [MIT License](LICENSE).

## Repository

Source code and releases:

[IlDimaz/ObsidianGitManage](https://github.com/IlDimaz/ObsidianGitManage?utm_source=chatgpt.com)
