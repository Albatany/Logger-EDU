# Consent Link Analytics

A privacy-aware college demonstration of how tracking links and visitor analytics work.

## What the project demonstrates

1. A user creates a short tracking URL that points to a destination URL.
2. A visitor opens the short URL.
3. The application shows a privacy notice before storing visitor information.
4. If the visitor presses **Agree & Continue**, the backend records:
   - public-facing IP address seen by the web server
   - browser and browser version
   - operating system
   - device category/vendor/model when the User-Agent exposes it
   - screen resolution, language, timezone and referrer
5. Precise latitude/longitude is recorded only if:
   - the visitor checks the GPS option, AND
   - the browser's own location permission is granted.
6. The visitor is redirected to the intended URL.
7. The creator can inspect consented visits through a private dashboard token.

## Why IP is available to a server

Every normal HTTP/HTTPS request has to travel between the client and the server.
The server therefore needs a network return address and can ordinarily observe the
source IP address, or a proxy/CDN header representing it.

That does **not** mean an IP reveals an exact house location. IP geolocation is
normally approximate and may identify only a city/region or even a network
provider's gateway. VPNs, carrier-grade NAT, mobile networks, corporate networks,
proxies and CDNs can reduce accuracy.

## Device detection

The server reads the HTTP `User-Agent` header and parses it with `ua-parser-js`.
Some browsers expose enough information to infer a phone family/model, but modern
privacy protections increasingly reduce this information. Therefore exact device
model detection is not guaranteed.

## GPS location

The JavaScript `navigator.geolocation` API is different from IP geolocation.
The browser asks the visitor for permission before returning coordinates.

In this demo, GPS is deliberately optional and the coordinates are not requested
unless the visitor selects the option.

## Architecture

Visitor
  |
  v
GET /r/:code
  |
  v
Consent page  -- no visitor record persisted here
  |
  | visitor presses Agree
  v
POST /api/link/:code/consent
  |
  +--> source IP from HTTP request
  +--> User-Agent parsing
  +--> browser metadata
  +--> optional GPS coordinates
  |
  v
store.json
  |
  v
Redirect to destination

Creator
  |
  v
/dashboard.html?token=...
  |
  v
GET /api/dashboard/:token
  |
  v
Analytics table

## Running locally

Install Node.js 18+.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Testing from another device on the same Wi-Fi

Start the server and find your computer's LAN IP.

Linux:

```bash
ip addr
```

Then, for example:

```text
http://192.168.1.10:3000
```

A local-network test will normally show a private LAN IP instead of a public IP.
For a real public-facing demonstration, deploy the app to an HTTPS hosting service.

## Important HTTPS note

Browser geolocation generally requires a secure context (HTTPS), except localhost
during development. If deployed publicly and you want the browser GPS prompt to
work, serve the application over HTTPS.

## Security / privacy design choices

- No IP/visitor record is saved when the tracking URL is merely opened.
- Data is persisted only after explicit consent.
- GPS is separately optional.
- The destination URL is displayed to the visitor.
- Only `http` and `https` destination schemes are accepted.
- A random high-entropy token protects each analytics dashboard.
- This project is intended for consenting test participants and coursework.

## Lecturer explanation — short version

> This project demonstrates the same underlying networking concepts used by
> tracking-link analytics. When a visitor makes an HTTP request, the server can
> observe the request IP and HTTP headers. After explicit consent, my backend
> stores that network information and parses the User-Agent to estimate the
> browser, operating system and device. For precise coordinates, the project uses
> the browser Geolocation API, which requires a separate permission decision.
> The short-link ID associates each visit with a destination URL, while a private
> dashboard token separates the public tracking link from the analytics interface.
> After collection, the server returns the destination and the browser redirects
> the visitor there.

## Good questions a lecturer may ask

### Is the IP address always the person's real device IP?
No. It may be the public address of a router, cellular carrier, VPN, proxy or
corporate network. NAT means many devices can share a public address.

### Can you determine someone's exact home from an IP address?
Not reliably. IP geolocation is an approximation. Exact coordinates require a
different signal such as browser geolocation and user permission.

### Why can the website see an IP without JavaScript?
The HTTP request itself reaches the server through the network, so the server can
observe the source connection or trusted proxy/CDN headers.

### Why can device-model detection fail?
Modern browsers intentionally limit fingerprintable device information, and many
User-Agent strings contain only generic platform information.

### Why use a random dashboard token?
The public short code must be shareable, while the analytics data should not be
public. A long random token acts as an access secret for the classroom demo.

### What could be improved in a production system?
Use a proper database, authentication, encrypted transport, retention/deletion
controls, rate limiting, audit logs, CSRF protections where relevant, proxy-header
validation, and an appropriate privacy policy.


## Version 2 notes

### LAN/private IP

The dashboard now includes a `LAN IP` column.

This field is populated only when the Node.js server is contacted directly on a
local network and the connection source is a private address such as:

- `192.168.x.x`
- `10.x.x.x`
- `172.16.x.x` through `172.31.x.x`

When the application is hosted on the public internet, a visitor's LAN address
normally does not cross the NAT/router boundary. In that case the field correctly
shows that it is unavailable.

Do not confuse an internal address belonging to a reverse proxy/container with
the visitor's actual LAN address. The demo deliberately avoids presenting a
proxy address as the visitor's private IP.

### Location behavior

After the visitor presses **Agree & Continue**, the application immediately calls
the browser Geolocation API. If permission has already been granted, it can return
the coordinates without another permission dialog. If the permission state is
`prompt`, the browser will display its own permission prompt. If the visitor
declines, the application continues without GPS coordinates.

A website cannot programmatically force the browser to select "Allow".

### Local-network test

The server now listens on `0.0.0.0`, so another device on the same network can
connect directly.

Run:

```bash
npm install
npm start
```

Find your Linux machine's private IPv4 address:

```bash
ip -4 addr
```

For example, if the computer is `192.168.1.20`, open this from a phone on the
same Wi-Fi:

```text
http://192.168.1.20:3000
```

This direct local-network mode is the mode in which the server can see a
visitor's LAN/private IP.

Note that browser geolocation generally requires HTTPS except for the special
`localhost` development case.

### Fast HTTPS public test with Cloudflare Tunnel

With the app running locally on port 3000, install `cloudflared` and run:

```bash
sudo pacman -S cloudflared
cloudflared tunnel --url http://localhost:3000
```

The command returns a temporary HTTPS `trycloudflare.com` URL. Open the generator
through that HTTPS URL so generated tracking links also use the public hostname.

Quick Tunnels are intended for testing, not production.

Because traffic is going through a public tunnel/proxy, the visitor's LAN/private
IP is not expected to be visible to this application. The public-facing client IP
can still be supplied by an appropriate trusted proxy header.

### Deployment

For an always-online deployment, use a Node.js-capable host such as Render or
Railway.

The demo currently stores data in `data/store.json`. A normal cloud instance may
have an ephemeral filesystem, so for persistent analytics use a persistent
disk/volume or migrate the store to PostgreSQL/another database.

Set this environment variable if you want generated URLs to always use one
canonical hostname:

```text
BASE_URL=https://your-domain.example
```

Otherwise, Version 2 automatically builds the tracking URL from the hostname used
to access the link generator.
