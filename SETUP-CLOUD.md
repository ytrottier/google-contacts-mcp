# Running google-contacts-mcp in the cloud (Google Cloud Run)

This puts the contacts server on Google Cloud Run, in CRC's Google Cloud project, so Claude can use it from the web, the mobile app, Cowork and cloud sessions, even with your laptop off. You then add it to Claude as a connector.

You can run two copies from the same code:

| Service | What it can do | Google permissions it asks for |
|---|---|---|
| `contacts-mcp` → **Contacts (cloud)** | everything except photos from files | contacts only |
| `contacts-mcp-drive` → **Contacts (cloud + Drive photos)** | the same, plus setting a photo from a Google Drive folder you name | contacts + read-only Google Drive |

Each person who connects signs in with their own Google account, and the server only ever acts on that person's own contacts and Drive. The server stores no sign-ins: Claude holds each person's sign-in and sends it with each request.

All commands below go in **Google Cloud Shell**. Open <https://console.cloud.google.com>, select the CRC project you used for the laptop setup, and click the **>_** icon at the top right. You need permission to deploy in that project. If a step is refused, ask whoever administers CRC's Google Cloud.

## 1. Create a Web OAuth client

The laptop uses a *Desktop* client. The cloud needs a separate *Web application* client. Keep both.

1. Go to **Google Auth Platform → Clients → Create client**.
2. Application type: **Web application**. Name: `Contacts MCP (cloud)`.
3. Leave *Authorized redirect URIs* empty for now. You'll add them in step 4.
4. Create, then copy the **Client ID** and **Client secret**.
5. Only if you'll run the Drive copy: in **Google Auth Platform → Data access → Add or remove scopes**, add `https://www.googleapis.com/auth/drive.readonly`.

## 2. Store the client in Secret Manager

In Cloud Shell, replacing the two placeholders:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

printf '%s' 'PASTE-CLIENT-ID' | gcloud secrets create contacts-mcp-client-id --data-file=-
printf '%s' 'PASTE-CLIENT-SECRET' | gcloud secrets create contacts-mcp-client-secret --data-file=-

PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
for s in contacts-mcp-client-id contacts-mcp-client-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

## 3. Deploy

Get the code:

```bash
git clone -b yannick/main https://github.com/ytrottier/google-contacts-mcp
cd google-contacts-mcp
```

Deploy **Contacts (cloud)**:

```bash
gcloud run deploy contacts-mcp --source . \
  --region northamerica-northeast1 --allow-unauthenticated --min-instances 0 \
  --update-env-vars DISABLE_DELETE_TOOLS=1 \
  --set-secrets GOOGLE_CLIENT_ID=contacts-mcp-client-id:latest,GOOGLE_CLIENT_SECRET=contacts-mcp-client-secret:latest

URL=$(gcloud run services describe contacts-mcp --region northamerica-northeast1 --format='value(status.url)')
gcloud run services update contacts-mcp --region northamerica-northeast1 --update-env-vars MCP_BASE_URL=$URL
echo "$URL"
```

Optionally, deploy **Contacts (cloud + Drive photos)**. It uses the same commands, with a different service name and one extra setting:

```bash
gcloud run deploy contacts-mcp-drive --source . \
  --region northamerica-northeast1 --allow-unauthenticated --min-instances 0 \
  --update-env-vars DISABLE_DELETE_TOOLS=1,ENABLE_DRIVE_PHOTOS=1 \
  --set-secrets GOOGLE_CLIENT_ID=contacts-mcp-client-id:latest,GOOGLE_CLIENT_SECRET=contacts-mcp-client-secret:latest

DRIVE_URL=$(gcloud run services describe contacts-mcp-drive --region northamerica-northeast1 --format='value(status.url)')
gcloud run services update contacts-mcp-drive --region northamerica-northeast1 --update-env-vars MCP_BASE_URL=$DRIVE_URL
echo "$DRIVE_URL"
```

Notes:
- The first deploy asks to create an Artifact Registry repository. Answer **Y**.
- Builds take a few minutes.
- `--allow-unauthenticated` is needed because Claude connects from the internet. Access is controlled by the Google sign-in instead: your OAuth app is **Internal**, so only CRC Google accounts can sign in. The server also only sends sign-in codes back to Claude and other known apps, and requires PKCE (Adam's 1.3.1 fix).
- If the deploy is refused because of an organization policy about public ("allUsers") access, CRC's Google Cloud administrator needs to allow it for these services.
- `--min-instances 0` means the service sleeps when unused. The first request after a pause takes a few seconds, and the cost stays at or near zero for light use.
- `DISABLE_DELETE_TOOLS=1` leaves out the tools that permanently delete contacts, photos and labels. To turn them on later for a service: `gcloud run services update contacts-mcp --region northamerica-northeast1 --remove-env-vars DISABLE_DELETE_TOOLS`.

## 4. Add the redirect addresses to the Web client

Back in **Google Auth Platform → Clients → Contacts MCP (cloud)**, add one *Authorized redirect URI* for each service you deployed:

- the printed `$URL` followed by `/callback`, for example `https://contacts-mcp-abc123-nn.a.run.app/callback`
- for the Drive copy, the printed `$DRIVE_URL` followed by `/callback`

Then click **Save**. It can take a few minutes to take effect.

## 5. Add it to Claude

In Claude (claude.ai or the desktop app), go to **Settings → Connectors → Add custom connector**:

- Name: `Contacts (cloud)`, or `Contacts (cloud + Drive photos)` for the Drive copy
- URL: the service address followed by `/mcp`, for example `https://contacts-mcp-abc123-nn.a.run.app/mcp`

Click **Connect** and sign in with your CRC Google account.

If you don't see *Add custom connector*, the owner of your Claude organization may need to add it for the organization.

On your laptop, Claude Desktop will then show both "Contacts (laptop)" and "Contacts (cloud)". That works, but you can turn one off in Claude's connector settings to avoid having the same tools twice.

## 6. Smoke test, with your laptop off

From Claude on the web or your phone:

1. *"Search my Google contacts for <someone you know is saved>."*
2. *"Create a contact named Test Person at company Testco with job title Tester"*, then *"Update only the job title of Test Person to Chief Tester."* Check in Google Contacts that the company is still Testco.
3. Drive copy only: put a small JPEG in a Drive folder, for example `Headshots`. Ask *"Set Test Person's photo from test.jpg in my Headshots folder."*
4. Delete Test Person in the Google Contacts web page.

## Updating later

```bash
cd ~/google-contacts-mcp && git pull
```

Then re-run the `gcloud run deploy …` command for each service from step 3. The `MCP_BASE_URL` and the secrets are kept.
