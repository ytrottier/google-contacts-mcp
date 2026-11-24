# Google Contacts for Claude: which version to use

This lets Claude read and edit your own Google Contacts: look people up, add people from email signatures, fix job titles, set photos. It comes in three versions. Pick the one that fits you.

| Version | Works when | Photos from a file | It asks Google for |
|---|---|---|---|
| **Contacts (cloud)** | anywhere: Claude on the web, phone, desktop, Cowork | no; send the photo in the chat instead | your contacts |
| **Contacts (cloud + Drive photos)** | anywhere | yes, from a **Google Drive** folder you name | your contacts **and read-only access to your Google Drive** |
| **Contacts (laptop)** | only in Claude Desktop on your computer, while it's on | yes, from a folder **on your computer** you name | your contacts |

Whichever you pick:
- **You sign in with your own Google account.** Claude only ever sees your own contacts, and with the Drive version your own Drive. Nobody else can reach your data through it, and you can't reach theirs.
- **Name the folder when you ask for a photo**, for example *"set Jane's photo from jane.jpg in my Headshots folder"*. If you forget, Claude will ask. To skip that, add a line such as "My contact photos are in my Headshots folder" to your Claude instructions.
- Tools that permanently delete contacts may be turned off. Google Contacts has no trash. To undo mistakes, use **Google Contacts → Settings → Undo changes**, which restores your contacts to any point in the last 30 days.

## Cloud versions

Ask Yannick for the connector address, then in Claude go to **Settings → Connectors → Add custom connector**:

- Name: `Contacts (cloud)` or `Contacts (cloud + Drive photos)`
- URL: the address you were given, ending in `/mcp`

Click **Connect** and sign in with your CRC Google account. The Drive version shows a Google screen asking for read access to your Drive. Only accept it if you want photos from Drive. Otherwise, use the plain cloud version.

If you don't see *Add custom connector*, your Claude organization owner may need to add the connector for the organization.

## Laptop version

Follow `SETUP-WINDOWS.md`. It needs Node.js and about 15 minutes. You choose your own top-level photo folder (`PHOTO_ROOT`) in the setup, and the tool never reads outside it. Use the client ID and secret Yannick gives you, and don't share them outside CRC.

You can also use a laptop version and a cloud version together. Claude shows them under the names you gave them.
