# Home Assistant add-on

Runs `server/mcp.ts` on your Home Assistant host, so Claude on claude.ai and the phone app
can use `show_scene` / `apply_scene` (with the in-chat scene card) as a custom connector.

The add-on talks to Home Assistant through the Supervisor with its own token: no
long-lived access token needed.

## Install (local add-on)

On the Home Assistant host (Supervised; on HA OS use the Samba or SSH add-on and `/addons`):

```bash
dest=/usr/share/hassio/addons/local/a2ui_scene
sudo mkdir -p $dest/src
sudo rsync -a ha-addon/a2ui_scene/ $dest/
sudo rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude .env --exclude ha-addon ./ $dest/src/
```

Then in Home Assistant: **Settings → Add-ons → Add-on store → ⋮ → Check for updates**,
install **A2UI Scene MCP**, set `light` (and `tv` / `blinds` if you have them) and
`path_secret` (for example `openssl rand -hex 24`), and start it.

## Reach it from claude.ai

claude.ai needs HTTPS. With a Cloudflare tunnel in front of Home Assistant, add a rule
above the Home Assistant one:

```yaml
ingress:
  - hostname: ha.example.com
    path: ^/a2ui-scene/
    service: http://localhost:8790
  - hostname: ha.example.com
    service: http://localhost:8123
```

Then add a custom connector in Claude (Settings → Connectors) with the URL
`https://ha.example.com/a2ui-scene/<path_secret>/mcp`.

The secret path is the only access control: anyone with the URL can set your scene, so
keep it private and change `path_secret` if it leaks. It can only reach the entities you
configured, through the two tools.
