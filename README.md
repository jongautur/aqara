# Aqara Local (Camera) — Home Assistant Custom Integration

Local-first Home Assistant integration for Aqara cameras (built and verified
against the **Aqara G410** doorbell). Exposes the camera's on-device RTSP
streams as Home Assistant camera entities — **no cloud, no HomeKit**.

> Scope note: the **U200 Lite lock** is handled by Home Assistant's built-in
> **Matter** integration and is intentionally *not* duplicated here. This
> integration covers the part HA doesn't handle well out of the box: the
> Aqara camera's local RTSP feed, with discovery and a proper config flow.

## Features

- 🔍 **Zeroconf auto-discovery** via `_aqara._tcp` (pre-fills the host)
- 🎥 Two camera entities per device: **Main** and **Sub** stream
- 🔐 Credentials/paths entered in the UI (URL-encoded automatically)
- 🖼️ Snapshots via ffmpeg; live view via HA `stream` / go2rtc (WebRTC/HLS)
- 🏠 100% local — works with Frigate, automations, and dashboards

## Verified defaults (Aqara G410)

| Setting | Value |
|---|---|
| Port | `8554` (LIVE555, Digest auth) |
| Main stream | `/ch1` — 1600×1200, H.264 + AAC |
| Substream | `/ch2` — 1280×960, H.264 + AAC |

Enable RTSP in the **Aqara app → Camera settings → RTSP** to obtain the
username/password.

## Installation (HACS)

1. HACS → ⋮ → **Custom repositories**.
2. Add this repo URL, category **Integration**.
3. Install **Aqara Local (Camera)**, then restart Home Assistant.
4. **Settings → Devices & Services → Add Integration → Aqara Local**
   (or accept the auto-discovered device).
5. Enter host, port, RTSP username/password. Defaults suit the G410.

## Bundled dashboard card

The integration auto-registers a Lovelace card — **no manual HACS resource
needed**. After install it appears in the card picker as **"Aqara Doorbell
Card"**, or add it by YAML:

```yaml
type: custom:aqara-doorbell-card
name: Front Door
camera: camera.aqara_doorbell_main
lock: lock.aqara_smart_lock_u200_lite_2
battery: sensor.aqara_smart_lock_u200_lite_battery_2   # optional
auto_relock: number.aqara_smart_lock_u200_lite_auto_relock_time  # optional
motion: binary_sensor.g410_doorbell_motion             # optional (person badge)
```

It shows the live camera, lock status, battery, auto-relock and Open / Unlock /
Lock buttons. The **Open** button auto-disables on locks that don't support the
Matter OPEN (unlatch) feature. If the JS doesn't load after install, hard-refresh
the browser (Ctrl/Cmd+Shift+R) to clear the cached frontend.

## Use with Frigate

Point Frigate at the substream for detection and the main stream for
recording (see `frigate-aqara.yaml` in the parent project for a full config):

```yaml
inputs:
  - path: rtsp://USER:PASS@HOST:8554/ch1   # record
    roles: [record]
  - path: rtsp://USER:PASS@HOST:8554/ch2   # detect
    roles: [detect]
```

## Notifications (blueprints)

Two ready-made automation blueprints ship in
[`blueprints/automation/aqara_local/`](blueprints/automation/aqara_local). They
send actionable **Companion-app** notifications (with action buttons) and are
fully local. Import, then pick your entities + your `notify.mobile_app_*`
service:

- **Doorbell – person at door** — fires on a presence sensor (the G410's
  **Matter Occupancy** sensor, or a Frigate person sensor), sends a snapshot
  with **Unlock** / **Live view** buttons; tapping Unlock unlocks your Matter
  lock.
  [Import](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fjongautur%2Faqara%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Faqara_local%2Fdoorbell_person_notify.yaml)
- **Lock – status notifications** — alerts on unlock, jam, and
  left-unlocked-too-long (with a **Lock now** button).
  [Import](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fjongautur%2Faqara%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Faqara_local%2Flock_notify.yaml)

> The doorbell blueprint just needs a presence `binary_sensor` — the G410's
> Matter Occupancy sensor works with no Frigate required. The lock blueprint
> just needs your Matter lock.

## Limitations / honesty

- This exposes **video/audio/snapshots** only. The **physical doorbell button
  press** is *not* available unless your device exposes it over Matter; use
  Frigate person-detection as a local doorbell trigger otherwise.
- Credentials are stored by Home Assistant and embedded in stream URLs —
  appropriate for a trusted LAN.
- Tested on the G410; other Aqara cameras may use different ports/paths —
  override them in the config flow.

## License

MIT
