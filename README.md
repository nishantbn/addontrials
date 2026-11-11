# 🎬 StreamPlay for Nuvio & Stremio

A high-reliability streaming addon engineered to replicate the source-retrieval gold standard of **CloudStream StreamPlay (`StreamPlay.cs3`)**.

---

## Supported Providers & Parity

| Provider | Mechanism | Status | Quality & Formats |
| :--- | :--- | :--- | :--- |
| **Vidy** | Dynamic NextJS chunk scraper + Seed handshake + 32-bit FNV-1a & Knuth multiplicative keystream XOR cipher | ✅ 100% Parity | Auto HLS Master (`.m3u8`), 2160p (4K), 1080p, 720p, 480p |
| **4KHDHub** | Dynamic GitHub domain sync (`phisher98/TVVVV`) + ROT13 multi-base64 WP-HTTP unshortener + HubCloud direct resolver | ✅ 100% Parity | 4K UHD REMUX, 1080p BluRay Direct (`.mkv`/`.mp4` up to 50GB+) |
| **VidFast** | Next.js App Router token extraction + Fastify multi-server embed exchange | ✅ Integrated | Multi-Server Direct Streams + WebVTT Subtitles |

---

## 🚀 Easy Installation Options

### Option 1: Local Runner (Easiest & Fastest, Zero Dependencies)

No build steps or external npm packages required — runs purely on native Node.js 18+!

```bash
cd nuvio-streamplay
npm start
```
*The addon server starts immediately at `http://localhost:7000`.*

### Option 2: 1-Click Free Cloud Deployment (Vercel)

Deploy to Vercel for a permanent HTTPS installation URL:
1. Push this folder to your GitHub.
2. In [Vercel](https://vercel.com), click **Add New** -> **Project** -> Import the repository.
3. Click **Deploy** (zero configuration required).
4. Copy your project domain (e.g. `https://my-streamplay.vercel.app/manifest.json`).

### Option 3: Docker Container

```bash
docker build -t nuvio-streamplay .
docker run -d -p 7000:7000 --name nuvio-streamplay nuvio-streamplay
```

---

## 📲 Adding to Nuvio

1. Open **Nuvio** on your device (Desktop, TV, or Mobile).
2. Go to **Settings** -> **Addons** (or **Plugins**).
3. Select **Add External Addon / URL**.
4. Enter your manifest URL:
   - For local runner: `http://localhost:7000/manifest.json` (or your local IP for TV: `http://192.168.x.x:7000/manifest.json`)
   - For hosted deployment: `https://your-deployment.vercel.app/manifest.json`
5. Click **Install**. StreamPlay will now appear in your playback sources whenever you select any Movie or TV Show!

---

## 🧪 Verification & Self-Testing

To run the automated verification suite against real live movie and TV targets:

```bash
npm test
```
