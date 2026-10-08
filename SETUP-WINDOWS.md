# Setting up google-contacts-mcp on Windows (personal build)

This sets up the `yannick/main` build so Claude Desktop starts the server itself over stdio, using a sign-in saved once on this PC. You don't need a background server or a bridge.

Commands below are for **PowerShell**. Replace `<you>` with your Windows user folder name (look at `echo $env:USERPROFILE`).

## 0. Prerequisites

Install Node.js LTS and Git if you don't have them:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close and reopen PowerShell, then check: `node -v` (should be v22 or later) and `git --version`.

## 1. Google Cloud project (once, under your CRC Workspace account)

Sign in to <https://console.cloud.google.com/> with your **@carbonremoval.ca** account.

1. **Create a project**, e.g. `crc-contacts-mcp`, in the CRC organization.
2. **Enable the People API**: *APIs & Services → Library →* search "Google People API" *→ Enable*.
3. **OAuth consent screen** (*Google Auth Platform*, formerly "OAuth consent screen"):
   - *Branding*: app name e.g. "Contacts MCP (Yannick)", your email as support and developer contact.
   - *Audience*: user type **Internal**. Internal apps need no Google verification, and their refresh tokens don't expire after 7 days the way "External / Testing" ones do.
   - *Data access → Add or remove scopes*: add these three:
     - `https://www.googleapis.com/auth/contacts`
     - `https://www.googleapis.com/auth/directory.readonly`
     - `https://www.googleapis.com/auth/contacts.other.readonly`
4. **OAuth client**: *Clients → Create client →* application type **Desktop app**, name e.g. "Claude Desktop". Copy the **Client ID** and **Client secret**.
5. **If sign-in is blocked** later with "access blocked / admin restricted": a CRC Workspace admin may need to allow the app. In the Admin console go to *Security → Access and data control → API controls → Manage third-party app access*, add the OAuth client ID and mark it **Trusted**. This happens if access to Contacts is restricted for the domain.

## 2. Install

Use a stable folder, because Claude Desktop will point at it:

```powershell
mkdir "$env:USERPROFILE\mcp" -Force
git clone https://github.com/ytrottier/google-contacts-mcp "$env:USERPROFILE\mcp\google-contacts-mcp"
cd "$env:USERPROFILE\mcp\google-contacts-mcp"
git checkout yannick/main
npm ci
npm run build
```

If PowerShell says running scripts is disabled when you type `npm`, use `npm.cmd` instead (e.g. `npm.cmd ci`).

Create the folder that photos will be read from:

```powershell
mkdir "$env:USERPROFILE\Pictures\contact-photos" -Force
```

## 3. Sign in once

```powershell
cd "$env:USERPROFILE\mcp\google-contacts-mcp"
$env:GOOGLE_CLIENT_ID = "<client id>.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET = "<client secret>"
npm run auth
```

Your browser opens Google's consent screen. (If it doesn't, copy the URL printed in PowerShell.) Approve it, and you should see "Signed in to google-contacts-mcp". The refresh token is saved to `%APPDATA%\google-contacts-mcp\token.json`.

Run `npm run auth` again whenever Claude reports that the sign-in has expired or been revoked, for example after you remove the app's access in your Google account.

## 4. Claude Desktop configuration

Open the config file. The easiest way is from Claude Desktop: *Settings → Developer → Edit Config*. The file is `%APPDATA%\Claude\claude_desktop_config.json`. Add the server under `mcpServers`, keeping any other servers you already have:

```json
{
  "mcpServers": {
    "google-contacts": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\mcp\\google-contacts-mcp\\dist\\main.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "<client id>.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "<client secret>",
        "GOOGLE_CONTACTS_TOKEN_FILE": "C:\\Users\\<you>\\AppData\\Roaming\\google-contacts-mcp\\token.json",
        "PHOTO_DIR": "C:\\Users\\<you>\\Pictures\\contact-photos",
        "DISABLE_DELETE_TOOLS": "1"
      }
    }
  }
}
```

Notes:

- Backslashes in JSON paths must be doubled, as shown.
- `GOOGLE_CONTACTS_TOKEN_FILE` is the default location written out in full. Setting it explicitly means Claude Desktop reads the same file `npm run auth` wrote, even if the Store version of Claude Desktop redirects `%APPDATA%` for its child processes.
- `DISABLE_DELETE_TOOLS=1` hides the tools that permanently delete contacts, photos and labels.
- **About the client secret:** under Google's model, a Desktop-app client secret is not truly secret; it ships inside installed apps. Your real credential is the refresh token in `token.json`. Still, don't share or commit this config file or `token.json`. Anyone who has both can read and edit your contacts.

**Fully quit and restart Claude Desktop**: right-click the tray icon and choose *Quit*. Closing the window isn't enough. Under *Settings → Developer*, the `google-contacts` server should show as running.

## 5. Smoke test

In a new Claude chat:

1. *"Search my Google contacts for <a colleague you know is saved>."* This should return their details.
2. Create a throwaway contact: *"Create a contact named Test Person at company Testco with job title Tester."*
3. *"Update only the job title of Test Person to Chief Tester."* Then check in [Google Contacts](https://contacts.google.com) that the company is still **Testco**. This is the bug fixed in `fix/partial-name-org-update`.
4. Photo from file: save any small JPEG or PNG into `Pictures\contact-photos` as `test.jpg`. Ask *"Set Test Person's photo from the file test.jpg."*
5. Delete the throwaway contact in the Google Contacts web UI, since the delete tools are disabled.

Everyday uses:

- *"Add the person from this email signature as a contact."*
- *"Find <name> in my other contacts and save them to my contacts."* This uses the people you've emailed but never saved.
- Crop a portrait from a Zoom/Teams screenshot, save it into `contact-photos`, then *"Set <name>'s photo from <file>."*

## 6. Recovery

The People API has no trash. If something goes wrong, open [Google Contacts](https://contacts.google.com), click *Settings (gear) → Undo changes*, and pick a time. This restores your whole contact list to how it was at any point in the last 30 days.

## Updating later

```powershell
cd "$env:USERPROFILE\mcp\google-contacts-mcp"
git pull
npm ci
npm run build
```

Then restart Claude Desktop.
