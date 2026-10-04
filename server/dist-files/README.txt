Blockcraft dedicated server
===========================

Requirements: Node.js 20 or newer (https://nodejs.org). Nothing else to install.

Start it
  Windows:        double-click start.bat
  macOS / Linux:  ./start.sh   (or: node server.mjs)

It prints the addresses to use, for example:
  friends on your network open http://192.168.1.20:8080/ and choose Join Server

Playing on your network
  1. Everyone opens http://<the server's IP>:8080/ in their browser (use this address, not the
     github.io site: browsers block https pages from joining an unencrypted LAN server).
  2. Under Multiplayer the server address is already filled in. Pick a room name (each room is
     its own world; "default" if blank) and click Join Server.
  Windows may ask to let Node.js through the firewall: allow it on private networks.

Playing over the internet
  Put it behind a TLS proxy (Caddy, nginx, Cloudflare Tunnel...) so players connect with wss://
  on port 443, or pass TLS_CERT and TLS_KEY (certificate and key files). Then players can join from
  any copy of the game, including the github.io site, with the server's address.

Settings (environment variables)
  PORT          port to listen on (default 8080)
  WORLDS_DIR    where worlds are saved (default ./worlds; one folder per room)
  SEED          seed for new worlds (default random)
  PVP           true / false (default true)
  OPS           comma-separated player names that are operators in every room ("*" = everyone)
  MAX_PLAYERS   per room (default 20)
  TLS_CERT, TLS_KEY   serve https/wss directly
  Example (Windows):  set PORT=25565 && node server.mjs
  Example (macOS/Linux):  PORT=25565 OPS=Steve node server.mjs

Running server
  Worlds autosave every 5 minutes and when the server stops (Ctrl+C).
  Type commands into the server window, e.g. "op Steve", "time set day", "say hello", or
  "<room>: <command>" for a room other than "default".
  Each room keeps ops.json, whitelist.json, banned-players.json and banned-ips.json in its folder.
