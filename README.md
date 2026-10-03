# INDIA'S GOT WARRIORS — Multiplayer Arena

An original browser multiplayer game for a 2–4 player arena. The lobby supports room codes, callsigns, four contenders, synchronized hero selection and ready state, reconnectable player sessions, and host handoff. **The Glasswake** is a top-down arena with four named districts and original cover shapes. The room server simulates movement and resolves hits, damage, reloads, eliminations, and round results.

## Run locally

Install Node.js 20.19 or newer, then in this folder run:

```sh
npm install
npm run dev
```

Open the Vite address printed in the terminal (normally `http://localhost:5173`). The development server starts the WebSocket room service on port 3001 and forwards `/ws` connections to it.

## Try room creation and joining

1. Open the local game URL in one browser window. Enter a callsign and choose **Create a room**.
2. Copy the five-character room code shown in the lobby.
3. Open the same game URL in a second browser window or on another device on the same network. Enter a different callsign and that code, then choose **Join**.
4. Confirm both players appear in both lobbies and the seat count changes to `02 / 04`.
5. Select a different contender or choose **Ready up** in either window. Confirm the update appears in both.
6. Try an unknown code and a fifth player to see the room-not-found and full-room messages.
7. Close the host window. The remaining lobby should stay open and show the next player as host.

For a phone on the same Wi-Fi, use the computer's LAN address with port 5173 instead of `localhost`. Allow the development server through the local firewall if prompted.

## Phase 2 gameplay checks

Use two players in the same room. Ready up in both clients; the host chooses **Drop In** once both ready indicators are visible.

1. **Arena and camera:** Confirm both players spawn, see the arena labels and cover, and have the camera follow their own contender. Resize a browser window and confirm the arena remains framed.
2. **Movement:** On a laptop use **WASD** or arrow keys. On a phone drag the lower-left pad. Check that motion appears on both clients, diagonals do not move faster, and walls and cover stop movement.
3. **Aim and shooting:** On a laptop aim with the mouse and hold click; on a phone use **Fire** (aim follows the nearest active opponent). Confirm both clients see the tracer and the ammunition count drops. Shoot at a nearby cover piece and confirm the tracer ends with a small spark at its surface; line up an opponent behind that cover and confirm their health does not drop. Then move to a clear lane and confirm hits still register.
4. **Reload:** On a laptop click the visible **Reload · R** HUD button or press **R**; on a phone tap **Reload**. Confirm the current magazine/reserve counts stay visible while the HUD says **RELOADING**, then the magazine refills after a short delay and reserve ammo decreases. Try this with an empty magazine and with a full magazine (the full one should not start a reload).
5. **Health and elimination:** Land four shots on the same contender. Confirm health and hit feed synchronize after each hit. Stop shooting and wait three seconds; living contenders recover 5 health per second, up to 100. Hit them again during recovery and confirm the delay starts over. At zero health that contender is eliminated and can watch the remaining player.
6. **Round end and replay:** Eliminate all but one contender. Confirm the winner overlay appears on both clients; the host can choose **Run It Back** to reset players, health, and ammunition for another round.

Start with movement and aim checks before testing elimination. If shots seem to miss, stand in a clear lane between the arena's cover pieces and keep the target in the center of the cursor/aim direction.

## Deployment configuration

The production frontend is a static Vite build in `dist`. Run the Node room server as a separate web service that supports long-lived WebSocket connections. It serves `/ws` and `/health`, listens on the host-provided `PORT`, and keeps room state in memory. No login or database is required. The server supports 2–4 player matches, broadcasts room snapshots 20 times per second, runs a four-minute authoritative round timer, and reserves disconnected players' sessions for a 30-second reconnect window.

Set `PUBLIC_BACKEND_URL` to the backend's public HTTPS origin, without a path or `/ws` suffix. The client converts it to `wss://.../ws`. `VITE_SERVER_URL` remains supported for existing builds. In local development, leave both blank: the browser connects to the Vite origin and its `/ws` proxy forwards to `http://localhost:3001`. `RIFT_SERVER_URL` can change that local proxy target. Public/Vite-prefixed variables are included in browser code, so never put credentials or secrets in them.

The development server runs with Node's watch mode so server changes restart the room process. To check that the browser is using a backend with regeneration enabled, open `http://localhost:3001/health`; its response includes `healthRegeneration` with the maximum, delay, and rate. If `PUBLIC_BACKEND_URL` or the legacy `VITE_SERVER_URL` points to another backend, check that host's `/health` endpoint instead.

## Free public deployment on Cloudflare Pages

Cloudflare Pages publishes the static frontend. The project has no path-based client router, so it does not need an SPA fallback or `_redirects` file. The existing Vite build generates `dist/index.html`, bundled assets, and `robots.txt`; it generates `sitemap.xml` after `PUBLIC_SITE_URL` is set. The sitemap includes only the public landing page. Rooms and gameplay states are not public indexable pages.

The room server cannot run as a Pages static asset. Deploy it separately to a Node web-service host that supports WebSockets. Render currently offers free web services that accept WebSockets, but they sleep after 15 minutes without incoming traffic, can take about a minute to wake, and may restart; because this server keeps rooms in memory, those events can disconnect players and end rooms. This is suitable for a hobby launch with that limitation, not uninterrupted multiplayer availability. See [Render WebSockets](https://render.com/docs/websocket) and [free service limits](https://render.com/docs/free).

### GitHub

This project is initialized locally on branch `main`, but has no commit or remote. Create an empty GitHub repository without adding a README or license, then run these commands from the project folder using the repository URL GitHub provides:

```sh
git add .
git commit -m "Prepare game for deployment"
git remote add origin <GitHub repository URL>
git push -u origin main
```

### Deploy the backend

1. Push the initialized project to GitHub using the steps above.
2. In Render, create a **Web Service** from that repository, using the repository root.
3. Use `npm ci` as the build command and `npm start` as the start command. Set the health check path to `/health` if prompted. Render supplies `PORT`; no other backend environment variable is currently required.
4. Choose its Free instance for a no-cost hobby deployment. Copy the HTTPS origin Render assigns to the service; do not add `/ws` or `/health`.

### Deploy the frontend

1. In Cloudflare, open **Workers & Pages**, choose **Create application → Pages → Connect to Git**, and select the repository.
2. Select the production branch. Set the build command to `npm run build` and the build output directory to `dist`.
3. Add these Production build environment variables:
   - `PUBLIC_BACKEND_URL` = the exact HTTPS origin assigned to the backend service.
   - `PUBLIC_SITE_URL` = leave blank for the first deployment.
4. Deploy. Cloudflare assigns the public `*.pages.dev` URL; use that exact URL without a trailing path.
5. In the Pages project settings, set `PUBLIC_SITE_URL` to that exact HTTPS origin and redeploy. The next build will write the canonical and social URLs and generate `robots.txt` with the sitemap location plus `/sitemap.xml`.
6. Open the live URL in a private browser window. Create a room, then join it from another browser/device using its room code.

Cloudflare's current Pages settings for Vite are `npm run build` and `dist`; its Git integration deploys from the selected branch and generates a `*.pages.dev` URL. See [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Git integration setup](https://developers.cloudflare.com/pages/get-started/git-integration/).

### Submit the site to Google

After the `PUBLIC_SITE_URL` build is deployed, open Google Search Console and add the exact `https://<assigned-name>.pages.dev/` as a **URL-prefix** property. Use the HTML file or HTML tag verification method and publish Google's exact verification token/file at the site root, then verify ownership. Submit `https://<assigned-name>.pages.dev/sitemap.xml` in the Sitemaps report. In URL Inspection, inspect the root URL and request indexing. Google controls discovery and timing; submission does not guarantee ranking or immediate indexing.
