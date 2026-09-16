# Deploying to AWS (single EC2 instance, IP-based, no domain)

This deploys the whole app — Express/WebSocket server + React client — onto one EC2 box,
reachable from anywhere at `http://<ELASTIC_IP>/`. Nginx sits in front, serving the built
client as static files and reverse-proxying `/api` and `/ws` to the Node process on
`localhost:4000`. PM2 keeps the server running and restarts it on crash/reboot.

## Why this shape

- **better-sqlite3** is a single on-disk file — needs one persistent machine, not
  serverless/multi-instance.
- **Playwright** (auto-login) drives a real headless Chromium — needs a full Linux box with
  browser deps, not Lambda.
- **No app-level login exists yet** (see README — single seeded user, no auth layer). Once
  this is reachable from the whole internet, anyone with the IP can open it and place virtual
  orders. This guide adds **HTTP Basic Auth at the Nginx layer** to close that gap — treat it
  as required, not optional, for this deployment shape.
- Your Kite password + TOTP secret will sit in a plaintext `.env` on this box for auto-login
  to work. Keep SSH locked to your own IP and keep the box patched — a compromised box means a
  compromised Zerodha login.

---

## 1. Launch the EC2 instance

AWS Console → EC2 → **Launch instance**.

- **Name**: `kite-paper` (anything you like)
- **AMI**: Ubuntu Server 22.04 LTS (64-bit x86)
- **Instance type**: `t3.micro` (free-tier eligible) — see note below if builds struggle on 1GB
  RAM; `t3.small` is a smoother paid alternative (~$15/mo)
- **Key pair**: create a new one, download the `.pem` file, keep it safe — you'll need it to
  SSH in
- **Network settings** → Edit:
  - Allow SSH (22) from **My IP** only (not Anywhere — this is your admin door)
  - Allow HTTP (80) from **Anywhere** (0.0.0.0/0) — this is the app itself
  - Do **not** open port 4000 publicly; Nginx will proxy to it internally
- **Storage**: 20 GiB gp3 (within the free-tier allowance)
- Launch.

## 2. Give it a fixed public IP (Elastic IP)

Without this, the public IP changes every time the instance stops/starts, breaking "access
from anywhere" and the Kite redirect URL.

EC2 → **Elastic IPs** → Allocate → select it → **Actions → Associate Elastic IP address** →
pick your instance. Note the address — call it `ELASTIC_IP` for the rest of this guide.

## 3. SSH in

```bash
chmod 400 /path/to/your-key.pem
ssh -i /path/to/your-key.pem ubuntu@ELASTIC_IP
```

## 4. Install system dependencies

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3 nginx git

# PM2 (keeps the server alive, restarts on crash/reboot)
sudo npm install -g pm2

# Optional but recommended on t3.micro (1GB RAM) — npm install / vite build / playwright
# install can OOM without this. Skip if you chose t3.small or larger.
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Get the code onto the server

Simplest if your repo is on GitHub:

```bash
git clone <your-repo-url> ~/zerodha-clone
cd ~/zerodha-clone
```

If it's not pushed anywhere yet, `scp` the folder from your machine instead (run this from
your **local** machine, not the server):

```bash
scp -i /path/to/your-key.pem -r "D:/backtesting/Zerodha clone" ubuntu@ELASTIC_IP:~/zerodha-clone
```

## 6. Configure environment files

**Server** — create `~/zerodha-clone/server/.env` on the instance:

```bash
nano ~/zerodha-clone/server/.env
```

```
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_REDIRECT_URL=http://ELASTIC_IP/api/auth/callback
CLIENT_URL=http://ELASTIC_IP
PORT=4000
VIRTUAL_CAPITAL=2000000

# Optional — auto-login
KITE_USER_ID=your_kite_user_id
KITE_PASSWORD=your_kite_password
KITE_TOTP_SECRET=your_base32_totp_secret
```

Replace `ELASTIC_IP` with the actual address. This file holds real secrets — never commit it
(`.gitignore` already excludes `.env`).

**Client** — create `~/zerodha-clone/client/.env`:

```bash
nano ~/zerodha-clone/client/.env
```

```
VITE_API_URL=
VITE_WS_URL=ws://ELASTIC_IP/ws
```

`VITE_API_URL` is intentionally empty — the client will call `/api/...` as a relative path,
which Nginx proxies to the server on the same origin, so it works regardless of how you reach
the box. `VITE_WS_URL` must be a full URL (the `WebSocket` API doesn't accept relative paths),
so it does bake in the IP — if you ever change `ELASTIC_IP`, rebuild the client (step 8).

## 7. Install dependencies and build

```bash
cd ~/zerodha-clone/server
npm install
npm run build          # tsc -> dist/
npx playwright install --with-deps chromium   # downloads Chromium + its OS deps, needed for auto-login

cd ~/zerodha-clone/client
npm install
npm run build           # vite build -> dist/
```

## 8. Configure Nginx

First, create a Basic Auth password file (pick your own username):

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd yourusername
```

Then the site config:

```bash
sudo nano /etc/nginx/sites-available/kite-paper
```

```nginx
server {
    listen 80;
    server_name _;

    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;

    root /home/ubuntu/app/client/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:4000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kite-paper /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

## 9. Run the server with PM2

```bash
cd ~/zerodha-clone/server
pm2 start dist/index.js --name kite-backend
pm2 startup    # prints a command — copy/paste and run it, it registers PM2 on boot
pm2 save
```

Useful commands later:
- `pm2 logs kite-backend` — tail logs
- `pm2 restart kite-backend` — after redeploying
- `pm2 status` — check it's up

## 10. Point Kite Connect at the new redirect URL

developers.kite.trade → your app → set **Redirect URL** to:

```
http://ELASTIC_IP/api/auth/callback
```

This must match `KITE_REDIRECT_URL` in `server/.env` exactly.

> Note: some OAuth providers reject plain-`http` or bare-IP redirect URLs in production. If
> Kite's dashboard refuses to save this, the fallback is a free/cheap domain pointed at
> `ELASTIC_IP` plus Let's Encrypt (`certbot --nginx`) for real HTTPS — ask if you hit this and
> want that set up.

## 11. Test

Visit `http://ELASTIC_IP` from any device/network. You'll get the Basic Auth prompt first
(the username/password from step 8), then the app itself. Try **Login with Kite** to confirm
the OAuth round-trip works end-to-end.

---

## Redeploying after code changes

```bash
cd ~/zerodha-clone && git pull        # or re-scp changed files
cd server && npm install && npm run build && pm2 restart kite-backend
cd ../client && npm install && npm run build   # nginx serves the new dist/ immediately, no restart needed
```

## Cost

- `t3.micro` + 20GB gp3: free for 12 months under the AWS Free Tier, then roughly $8-10/mo.
- Elastic IP: free while attached to a running instance; AWS charges a small hourly fee if you
  allocate one and leave it unattached — don't release the instance without also releasing the
  IP, or releasing both together.

## Backups (optional but worth doing)

`data.sqlite` on the instance is your only copy of trade history/positions. Either:
- EC2 → **Snapshots**, schedule a periodic EBS snapshot, or
- `scp ubuntu@ELASTIC_IP:~/zerodha-clone/server/data.sqlite ./backup/` periodically from your machine.
